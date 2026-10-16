"""Draft artefacts. Everything written here is private review material and is
explicitly NOT verified or published. Severity stays null until a human decides.
"""

from __future__ import annotations

import json
from pathlib import Path

# The Triggerboxd category identifiers. Reused verbatim so a later import maps
# onto the existing schema without translation.
CATEGORY_SLUGS = (
    "nudity",
    "sexual_content",
    "sexual_violence",
    "gore_graphic_violence",
    "disturbing_content",
    "suicide_self_harm",
    "animal_harm",
    "drugs",
    "alcohol",
    "language",
    "physical_violence",
    "graphic_violence",
    "horror",
)


def draft_skeleton(*, window: dict, region: str) -> dict:
    """A verified movie with no analysis yet."""
    return {
        "draftVersion": 1,
        "reviewStatus": "draft_pending_human",
        "publication": "none",
        "generatedAt": window["generatedAt"],
        "ottWindow": window,
        "territory": region,
        "subtitle": {
            "source": None,
            "language": None,
            "edition": None,
            "sha256": None,
        },
        "analysis": {
            "method": None,
            "rulesVersion": None,
            "model": None,
        },
        "categories": [
            # severity is intentionally null: the pipeline never asserts a rating.
            {"category": slug, "severity": None, "state": "unknown", "evidence": []}
            for slug in CATEGORY_SLUGS
        ],
        "limitations": [],
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def render_report(*, window: dict, region: str, languages: tuple[str, ...], limit: int,
                  verified: list[dict], skipped: list[dict],
                  credentials: dict[str, bool], quota: list[dict], run_id: int | None = None) -> str:
    lines: list[str] = []
    lines.append("# Triggerboxd draft warnings - run report")
    lines.append("")
    lines.append("Private review material. Nothing here is verified, and nothing is published.")
    lines.append("")
    lines.append("## Run")
    lines.append(f"- Window: **{window['startDate']} -> {window['endDate']}** ({window['timezone']}, {window['days']} days)")
    lines.append(f"- Generated: {window['generatedAt']}")
    lines.append(f"- Territory: {region}")
    lines.append(f"- Language priority: {', '.join(languages) if languages else 'any'}")
    lines.append(f"- Verified-movie cap: {limit}")
    if run_id is not None:
        lines.append(f"- Local run id: {run_id}")
    lines.append("")
    lines.append("## Results")
    lines.append(f"- Movies discovered (candidates): {len(verified) + len(skipped)}")
    lines.append(f"- Movies with a verified dated OTT release: {len(verified)}")
    lines.append(f"- Subtitles downloaded: 0 (phase 1: discovery only)")
    lines.append(f"- Movies analysed: 0 (phase 1: discovery only)")
    lines.append(f"- Draft warnings generated: 0 (phase 1: discovery only)")
    lines.append(f"- Skipped / needs review: {len(skipped)}")
    lines.append("")

    lines.append("## Verified OTT releases")
    if not verified:
        lines.append("- None in this window.")
    for item in verified:
        movie = item["movie"]
        platforms = ", ".join(item["platforms"]) or "platform not listed"
        flag = "" if item["platformVerified"] else " (platform unverified)"
        lines.append(f"- **{movie['title']}** (TMDB {movie['tmdbId']}, {movie['originalLanguage']}) - {item['ottDate']} | {platforms}{flag}")
        lines.append(f"  - source: `{item['source']}`")
        for note in item["notes"]:
            lines.append(f"  - note: {note}")
    lines.append("")

    lines.append("## Skipped / needs review")
    if not skipped:
        lines.append("- None.")
    for item in skipped:
        movie = item["movie"]
        lines.append(f"- **{movie['title']}** (TMDB {movie['tmdbId']}) - `{item['reason']}` | {item['detail']}")
    lines.append("")

    lines.append("## Credentials detected (values never shown)")
    for key, ok in credentials.items():
        lines.append(f"- {key}: {'present' if ok else 'missing'}")
    lines.append("")

    lines.append("## Quota used today (UTC)")
    if not quota:
        lines.append("- No provider or model usage recorded.")
    for row in quota:
        lines.append(f"- {row['scope']} | {row['subject']} | {row['action']}: {row['used']}")
    lines.append("")
    lines.append("## Standing limitations")
    lines.append("- A digital release date does not by itself prove availability on every platform listed today.")
    lines.append("- Missing evidence is recorded as `unknown`, never as absence.")
    lines.append("- No severity is asserted; human review is required before any warning leaves draft state.")
    return "\n".join(lines) + "\n"
