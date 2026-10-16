#!/usr/bin/env python
"""Triggerboxd draft-warning pipeline - Phase 2: local subtitles + offline rules.

Analyses subtitle files you already have. No provider, no key, no model, no
network. This is the always-available fallback path and the baseline the AI
comparison is measured against.

    python run_local.py --subtitles .\\subs
    python run_local.py --subtitles .\\subs\\1422822.en.srt --index .\\out\\<stamp>\\index.json
    python run_local.py --subtitles .\\subs --context-window 2

File names may carry identity: <tmdbId>[.<lang>][.<edition>].<ext>
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tbpipe import classify, report  # noqa: E402
from tbpipe.rules import Lexicon, LexiconError  # noqa: E402
from tbpipe.subtitles import SubtitleError, discover_subtitles, load_subtitle  # noqa: E402

OUT_ROOT = Path(__file__).resolve().parent / "out"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Analyse local subtitle files into private draft warnings.")
    parser.add_argument("--subtitles", required=True, help="subtitle file or directory")
    parser.add_argument("--index", help="discovery index.json to attach verified OTT metadata")
    parser.add_argument("--lexicon", help="override the lexicon path")
    parser.add_argument("--context-window", type=int, default=1, help="neighbouring cues considered for context rules (default 1)")
    parser.add_argument("--stamp", help="output folder name (default: today's IST date)")
    return parser.parse_args(argv)


def load_index(path: str | None) -> dict[int, dict]:
    if not path:
        return {}
    target = Path(path)
    if not target.is_file():
        raise SystemExit(f"--index not found: {target}")
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"--index unreadable: {type(exc).__name__}") from None
    if not isinstance(payload, dict) or not isinstance(payload.get("verified", []), list):
        raise SystemExit("--index must be a discovery object")
    indexed: dict[int, dict] = {}
    for item in payload.get("verified") or []:
        movie = item.get("movie") or {}
        if isinstance(movie.get("tmdbId"), int):
            indexed[movie["tmdbId"]] = {"movie": movie, "ottDate": item.get("ottDate"),
                                        "platforms": item.get("platforms"), "territory": item.get("territory"),
                                        "window": payload.get("window")}
    return indexed


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = parse_args(argv)
    if args.context_window < 0:
        raise SystemExit("--context-window must not be negative")

    try:
        lexicon = Lexicon.load(args.lexicon)
    except LexiconError as exc:
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
    print(f"Triggerboxd draft-warning pipeline - phase 2 (offline rules)")
    print(f"Rules version: {lexicon.version} | context window: {args.context_window}")
    print(f"Subtitle files: {len(files)}")

    stamp = args.stamp or datetime.now().strftime("%Y-%m-%d")
    drafts_dir = OUT_ROOT / stamp / "drafts"
    drafts_dir.mkdir(parents=True, exist_ok=True)

    analysed = 0
    failed = 0
    candidate_total = 0
    for path in files:
        try:
            subtitle = load_subtitle(path)
        except SubtitleError as exc:
            failed += 1
            print(f"  skip {path.name}: {exc}")
            continue

        analysis = classify.analyze(subtitle, lexicon, context_window=args.context_window)
        attached = indexed.get(subtitle.declared_tmdb_id) if subtitle.declared_tmdb_id else None
        movie = attached["movie"] if attached else {
            "tmdbId": subtitle.declared_tmdb_id,
            "title": path.stem if subtitle.declared_tmdb_id is None else None,
            "originalTitle": None,
            "releaseDate": None,
            "originalLanguage": subtitle.language,
        }
        draft = classify.draft_for(
            movie=movie,
            subtitle=subtitle,
            analysis=analysis,
            window=attached["window"] if attached else None,
            region=(attached or {}).get("territory"),
            source="local_file",
        )
        if attached:
            draft["ottDate"] = attached["ottDate"]
            draft["platforms"] = attached["platforms"]
        else:
            draft["limitations"].append("No verified OTT record attached; run with --index to link a discovery run.")

        candidates = [c["category"] for c in draft["categories"] if c["state"] == classify.STATE_CANDIDATE]
        candidate_total += len(candidates)
        analysed += 1
        name = f"{movie.get('tmdbId') or 'unmatched'}.{subtitle.language or 'und'}.{subtitle.sha256[:12]}.{lexicon.version}.draft.json"
        report.write_json(drafts_dir / name, draft)
        print(f"  analysed {path.name}: {len(candidates)} candidate categor{'y' if len(candidates) == 1 else 'ies'}"
              f"{' (' + ', '.join(candidates) + ')' if candidates else ''}")

    summary = {
        "files": len(files),
        "analysed": analysed,
        "failed": failed,
        "candidateCategories": candidate_total,
        "rulesVersion": lexicon.version,
        "contextWindow": args.context_window,
        "drafts": analysed,
    }
    report.write_json(OUT_ROOT / stamp / "phase2-summary.json", summary)

    print("")
    print("Summary")
    print(f"  files found           : {len(files)}")
    print(f"  analysed              : {analysed}")
    print(f"  failed / unreadable   : {failed}")
    print(f"  candidate categories  : {candidate_total}")
    print(f"  drafts written        : {analysed}")
    print(f"  drafts folder         : {drafts_dir}")
    print("  severity: never asserted; all categories remain null pending human review")
    return 0 if analysed else 1


if __name__ == "__main__":
    raise SystemExit(main())
