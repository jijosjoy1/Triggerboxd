"""One-off independent review of the pipeline by an included reviewer model.
This script exists so a stronger reviewer can audit the code. It reads the
sources itself, and reviews them in small batches because a single 25k-token
prompt makes the upstream time out before it starts answering.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent
sys.path.insert(0, str(PIPELINE))

from tbpipe.model import FREE_MODELS, _RouterTransport  # noqa: E402

# The same allowlist the pipeline enforces. A reviewer outside it is refused here
# too, so a paid or premium model cannot be pulled in by accident.
DEFAULT_REVIEWERS = ("deepseek-v4.1-flash", "mimo-v2.6-flash")

# Small batches: fewer input tokens means a fast first byte and a focused review.
GROUPS: dict[str, list[str]] = {
    "credentials-and-providers": [
        "tbpipe/config.py",
        "tbpipe/redact.py",
        "tbpipe/providers/__init__.py",
        "tbpipe/providers/subdl.py",
        "tbpipe/providers/opensubtitles.py",
    ],
    "model-and-evidence": [
        "tbpipe/model.py",
    ],
    "discovery-and-rules": [
        "tbpipe/window.py",
        "tbpipe/tmdb.py",
        "tbpipe/discover.py",
        "tbpipe/subtitles.py",
        "tbpipe/rules.py",
    ],
    "orchestration-and-artefacts": [
        "tbpipe/store.py",
        "tbpipe/classify.py",
        "tbpipe/report.py",
        "run_last_week.py",
        "run_fetch.py",
        "run_compare.py",
    ],
}

BRIEF = """You are performing an adversarial code review of part of a standalone Python pipeline
that produces PRIVATE DRAFT content warnings for films. It is not the web application.

Hard invariants:
1. It must never publish anything and never write to the Triggerboxd application database.
2. Content severity must remain null; a category with no evidence is unknown, never absent.
3. API keys, login tokens and one-time download links must never reach stdout, logs, JSON
   artefacts, filenames or the sqlite state file.
4. Only free/included models may be invoked; a paid model must be unreachable.
5. Model findings must cite cue text that actually exists; fabricated evidence must be
   rejected, and rejections must be visible.
6. Provider allowances must be tracked separately and never exhausted.
7. Malformed input must fail safely without killing the run.

Report only concrete defects, most severe first, using exactly:
  [severity: critical|major|minor] path/to/file.py:function - what is wrong - why it matters - smallest fix

Rules for your reply: go straight into findings, no preamble, no restating, no file dumps.
At most 6 findings. Hard limit 500 words. Do not invent problems. If you checked an invariant
from this batch and it holds, add one line per invariant under "Verified".

Files in this batch:
"""
REVIEW_SYSTEM_PROMPT = (
    "You are an adversarial senior code reviewer auditing a Python data pipeline. "
    "You report concrete defects, worst first, and you never invent problems. "
    "You do not rewrite files, restate instructions or summarise code. "
    "You go straight to the findings in the requested format."
)


def build_group_prompt(group: str) -> str:
    parts = [BRIEF]
    for relative in GROUPS[group]:
        path = PIPELINE / relative
        if path.is_file():
            parts.append(f"\n===== {relative} =====\n{path.read_text(encoding='utf-8')}")
    return "".join(parts)


def ask(transport, reviewer: str, prompt: str, max_tokens: int) -> tuple[str, dict]:
    payload = transport.message(reviewer, prompt, max_tokens=max_tokens, timeout=420, system=REVIEW_SYSTEM_PROMPT)
    text = "".join(b.get("text", "") for b in (payload.get("content") or []) if isinstance(b, dict))
    return text, (payload.get("usage") or {})


def main() -> int:
    argv = sys.argv[1:]
    reviewers = [a for a in argv if not a.startswith("--")] or list(DEFAULT_REVIEWERS)
    refused = [name for name in reviewers if name not in FREE_MODELS]
    if refused:
        print(f"refused (not on the free/included allowlist): {', '.join(refused)}")
        print(f"allowed reviewers: {', '.join(FREE_MODELS)}")
        return 2
    out_dir = PIPELINE / "out" / "reviews"
    out_dir.mkdir(parents=True, exist_ok=True)
    transport = _RouterTransport()
    for reviewer in reviewers:
        safe = reviewer.replace("/", "_")
        sections: list[str] = [
            f"# Independent review by {reviewer}",
            f"Generated {datetime.now().isoformat(timespec='seconds')}",
            "",
        ]
        total_tokens = 0
        for group, files in GROUPS.items():
            prompt = build_group_prompt(group)
            text, usage = "", {}
            for attempt, budget in enumerate((12000, 6000)):
                try:
                    text, usage = ask(transport, reviewer, prompt, budget)
                    break
                except Exception as exc:
                    text = f"(review call failed: {type(exc).__name__}: {str(exc)[:160]})"
                    if attempt == 0:
                        time.sleep(3)
            total_tokens += int(usage.get("input_tokens") or 0) + int(usage.get("output_tokens") or 0)
            sections += [f"## {group}", "", text.strip() or "(empty reply)", ""]
            print(f"{reviewer} | {group}: chars={len(text)} usage={usage}")
        target = out_dir / f"{safe}.md"
        target.write_text("\n".join(sections) + f"\ntotal tokens: {total_tokens}\n", encoding="utf-8")
        print(f"{reviewer}: -> {target.relative_to(PIPELINE)} ({total_tokens} tokens)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
