#!/usr/bin/env python
"""Triggerboxd draft-warning pipeline - Phase 4: offline vs included-model comparison.

Runs the deterministic rules engine and an included model over the same subtitle,
then reports where they agree and disagree. This is a second opinion, not a
replacement: the offline engine stays the baseline, and if the model route is
unavailable the run degrades to offline-only and says so.

Only models on the free/included allowlist can be used. There is no paid fallback.

    python run_compare.py --subtitles .\\subs\\579974.en.6587782.srt
    python run_compare.py --subtitles .\\subs --model glm-5.3-flash --draft
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tbpipe import classify, report  # noqa: E402
from tbpipe.model import (  # noqa: E402
    DAILY_TOKEN_BUDGET, DEFAULT_MODEL, FREE_MODELS, ModelClient, ModelError, ModelUnavailable,
)
from tbpipe.report import CATEGORY_SLUGS  # noqa: E402
from tbpipe.rules import Lexicon  # noqa: E402
from tbpipe.store import Store  # noqa: E402
from tbpipe.subtitles import SubtitleError, discover_subtitles, load_subtitle  # noqa: E402

OUT_ROOT = Path(__file__).resolve().parent / "out"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare offline rules against an included model.")
    parser.add_argument("--subtitles", required=True, help="subtitle file or directory")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"one of: {', '.join(FREE_MODELS)}")
    parser.add_argument("--budget", type=int, default=DAILY_TOKEN_BUDGET, help="token ceiling for this run")
    parser.add_argument("--draft", action="store_true", help="write a merged draft including model candidates")
    parser.add_argument("--index", help="Phase 1 index.json to attach verified OTT metadata")
    parser.add_argument("--stamp", help="output folder name (default today)")
    return parser.parse_args(argv)


def load_index(path: str | None) -> dict[int, dict]:
    if not path:
        return {}
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"--index unreadable: {exc}") from None
    indexed: dict[int, dict] = {}
    for item in payload.get("verified") or []:
        movie = item.get("movie") or {}
        if isinstance(movie.get("tmdbId"), int):
            indexed[movie["tmdbId"]] = item
    return indexed


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = parse_args(argv)
    if args.model not in FREE_MODELS:
        raise SystemExit(f"--model must be one of: {', '.join(FREE_MODELS)}")

    try:
        lexicon = Lexicon.load()
    except Exception as exc:
        print(f"ERROR: {exc}")
        return 2
    try:
        files = discover_subtitles(args.subtitles)
    except SubtitleError as exc:
        print(f"ERROR: {exc}")
        return 2
    if not files:
        print(f"No subtitle files found under {args.subtitles}")
        return 1

    indexed = load_index(args.index)
    stamp = args.stamp or datetime.now().strftime("%Y-%m-%d")
    out_dir = OUT_ROOT / stamp / "comparisons"
    store = Store(Path(__file__).resolve().parent / "state.sqlite")
    try:

        print("Triggerboxd draft-warning pipeline - phase 4 (model comparison)")
        print(f"Model: {args.model} | rules: {lexicon.version} | budget: {args.budget} tokens")

        model: ModelClient | None = None
        model_note = ""
        def record_usage(delta: int) -> None:
            args_for_quota = {"scope": "model", "subject": args.model, "action": "tokens"}
            if delta > 0 and not store.quota_reserve(**args_for_quota, amount=delta, ceiling=args.budget):
                raise ModelUnavailable("model token allowance nearly exhausted")
            if delta < 0:
                store.quota_release(**args_for_quota, amount=-delta)

        try:
            already = store.quota_used(scope="model", subject=args.model, action="tokens")
            remaining = max(0, args.budget - already)
            print(f"Model allowance today: {already} used, {remaining} remaining of {args.budget}")
            if remaining <= 0:
                # The ceiling is a daily one, so a day already at the limit does no
                # model work rather than starting a chunk it cannot afford.
                model = None
                model_note = f"daily model allowance already used ({already} of {args.budget}); offline-only result"
                print(f"  {model_note}")
            else:
                model = ModelClient(model=args.model, token_budget=args.budget,
                                    tokens_already_used=already, usage_callback=record_usage)
                if not model.available():
                    raise ModelUnavailable("no model route secret available")
        except (ModelUnavailable, ModelError) as exc:
            model = None
            model_note = f"model route unavailable ({exc}); offline-only result"
            print(f"  {model_note}")

        compared = 0
        for path in files:
            try:
                subtitle = load_subtitle(path)
            except SubtitleError as exc:
                print(f"  skip {path.name}: {exc}")
                continue

            offline = classify.analyze(subtitle, lexicon)
            offline_counts = {c["category"]: c["evidenceCount"] for c in offline["categories"] if c["state"] == classify.STATE_CANDIDATE}
            offline_hits = [h for h in lexicon.scan(subtitle.cues, 1)]

            record = {
                "subtitle": subtitle.as_dict(),
                "offline": {
                    "method": "offline-rules",
                    "rulesVersion": lexicon.version,
                    "categories": offline_counts,
                    "evidence": [h.as_dict() for h in offline_hits[:80]],
                },
                "model": None,
                "comparison": None,
                "notes": [],
            }

            if model is not None:
                try:
                    result = model.classify(subtitle.cues, CATEGORY_SLUGS)
                except (ModelUnavailable, ModelError) as exc:
                    record["notes"].append(f"model call failed: {exc}")
                    result = None
                if result is not None:
                    model_counts: dict[str, list[dict]] = {}
                    for finding in result.findings:
                        model_counts.setdefault(finding.category, []).append(finding.as_dict())
                    agree = sorted(set(offline_counts) & set(model_counts))
                    offline_only = sorted(set(offline_counts) - set(model_counts))
                    model_only = sorted(set(model_counts) - set(offline_counts))
                    record["model"] = {
                        "model": result.model,
                        "usage": result.usage.as_dict(),
                        "stopped": result.stopped,
                        "findings": [f.as_dict() for f in result.findings],
                        "categories": {k: len(v) for k, v in sorted(model_counts.items())},
                    }
                    record["comparison"] = {"agree": agree, "offlineOnly": offline_only, "modelOnly": model_only}
                    print(f"  {path.name}: agree {len(agree)}, offline-only {len(offline_only)}, model-only {len(model_only)}, "
                          f"tokens {result.usage.total}, rejected {result.usage.rejected}")
                    if result.stopped:
                        record["notes"].append(f"model run stopped early: {result.stopped}")

            if args.draft:
                attached = indexed.get(subtitle.declared_tmdb_id) if subtitle.declared_tmdb_id else None
                movie = (attached or {}).get("movie") or {"tmdbId": subtitle.declared_tmdb_id, "title": path.stem,
                                                          "originalTitle": None, "releaseDate": None,
                                                          "originalLanguage": subtitle.language}
                draft = classify.draft_for(movie=movie, subtitle=subtitle, analysis=offline,
                                           window=(attached or {}).get("window"), region=(attached or {}).get("territory"),
                                           source="local_file")
                if record["model"]:
                    draft["analysis"]["model"] = record["model"]["model"]
                    by_category = {}
                    for finding in record["model"]["findings"]:
                        by_category.setdefault(finding["category"], []).append(finding)
                    for entry in draft["categories"]:
                        extra = by_category.get(entry["category"])
                        if extra:
                            entry["modelEvidence"] = extra
                            if entry["state"] == classify.STATE_UNKNOWN and entry["category"] not in lexicon.visual_only:
                                # Subtitle text cannot establish visual-only
                                # categories, so a model finding must not promote
                                # them out of unknown.
                                entry["state"] = "candidate_model_only"
                draft["comparison"] = record["comparison"]
                (out_dir).mkdir(parents=True, exist_ok=True)
                identity = f"{subtitle.declared_tmdb_id or 'unmatched'}.{subtitle.language or 'und'}.{subtitle.sha256[:12]}.{lexicon.version}"
                report.write_json(out_dir / f"{identity}.draft.json", draft)

            out_dir.mkdir(parents=True, exist_ok=True)
            identity = f"{subtitle.declared_tmdb_id or 'unmatched'}.{subtitle.language or 'und'}.{subtitle.sha256[:12]}.{lexicon.version}"
            report.write_json(out_dir / f"{identity}.compare.json", record)
            compared += 1

        quota = store.quota_snapshot()
    finally:
        store.close()

    print("")
    print("Summary")
    print(f"  subtitles compared    : {compared}")
    print(f"  model used            : {args.model if model else 'none'}")
    if model_note:
        print(f"  note                  : {model_note}")
    print(f"  comparisons folder    : {out_dir}")
    print("  allowance used today:")
    for row in quota:
        print(f"    - {row['scope']} | {row['subject']} | {row['action']}: {row['used']}")
    print("  paid fallback: disabled; severity: never asserted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
