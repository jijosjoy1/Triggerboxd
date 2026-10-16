#!/usr/bin/env python
"""Triggerboxd draft-warning pipeline - Phase 1: OTT discovery.

One manual command. Discovery only: no subtitle downloads, no model calls, no
publication, nothing written to Triggerboxd.

    python run_last_week.py                 # previous 7 complete days, cap 10
    python run_last_week.py --limit 3 --dry-run
    python run_last_week.py --window 2026-10-01 2026-10-07
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tbpipe import config, report  # noqa: E402
from tbpipe.discover import Skipped, Verified, verify_release  # noqa: E402
from tbpipe.store import Store  # noqa: E402
from tbpipe.tmdb import Movie, Tmdb, TmdbError  # noqa: E402
from tbpipe.window import IST, window_for  # noqa: E402

# Priority order the brief asks for; each list is tried in turn.
LANGUAGE_PRIORITY = ("ml", "ta", "te", "hi", "en")
DEFAULT_REGION = "IN"
DEFAULT_LIMIT = 10
OUT_ROOT = Path(__file__).resolve().parent / "out"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Discover recent OTT releases and draft warnings.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="maximum verified movies (default 10)")
    parser.add_argument("--region", default=DEFAULT_REGION, help="TMDB territory code (default IN)")
    parser.add_argument("--languages", default=",".join(LANGUAGE_PRIORITY), help="comma-separated priority list")
    parser.add_argument("--window", nargs=2, metavar=("START", "END"), help="override the window (YYYY-MM-DD)")
    parser.add_argument("--dry-run", action="store_true", help="resolve candidates without recording anything")
    parser.add_argument("--state", default=str(Path(__file__).resolve().parent / "state.sqlite"))
    return parser.parse_args(argv)


def resolve_window(args: argparse.Namespace):
    if args.window:
        try:
            start, end = (date.fromisoformat(value) for value in args.window)
        except ValueError as exc:
            raise SystemExit(f"--window: {exc}") from None
        if end < start:
            raise SystemExit("--window END must not be before START")
        base = window_for()
        from datetime import datetime

        return base.__class__(start=start, end=end, generated_at=base.generated_at)
    return window_for()


def main(argv: list[str] | None = None) -> int:
    # Console output stays ASCII: a Windows cp1252 console cannot encode arrows
    # or dashes, and a crashed report is worse than plain text.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = parse_args(argv)
    if args.limit < 1:
        raise SystemExit("--limit must be at least 1")

    window = resolve_window(args)
    languages = tuple(item.strip() for item in args.languages.split(",") if item.strip())
    secrets = config.load_secrets()
    credentials = config.present(secrets)

    print("Triggerboxd draft-warning pipeline - phase 1 (discovery only)")
    print(f"Window: {window.start} -> {window.end} ({window.timezone}, {(window.end - window.start).days + 1} days)")
    print(f"Territory: {args.region} | languages: {', '.join(languages)} | cap: {args.limit}")
    if not credentials.get("TMDB_READ_ACCESS_TOKEN"):
        print("ERROR: TMDB_READ_ACCESS_TOKEN is not configured (checked environment and .env.local).")
        return 2

    client = Tmdb(secrets["TMDB_READ_ACCESS_TOKEN"])
    verified: list[Verified] = []
    skipped: list[Skipped] = []
    seen: set[int] = set()

    # Walk the priority languages in order, then fill any remaining slots.
    for language in (*languages, None):
        if len(verified) >= args.limit:
            break
        try:
            payload = client.discover_digital_releases(
                region=args.region,
                start=window.start.isoformat(),
                end=window.end.isoformat(),
                languages=(language,) if language else (),
            )
        except TmdbError as exc:
            print(f"  discovery failed for {language or 'any'}: {exc}")
            continue

        for item in payload.get("results") or []:
            if len(verified) >= args.limit:
                break
            movie = Movie.from_payload(item)
            if movie is None:
                continue  # a malformed row must not abort the page
            if movie.tmdb_id in seen:
                continue  # deduplicate by TMDB id across language passes
            seen.add(movie.tmdb_id)
            try:
                outcome = verify_release(
                    movie,
                    client.release_dates(movie.tmdb_id),
                    client.watch_providers(movie.tmdb_id),
                    window,
                    args.region,
                )
            except TmdbError as exc:
                skipped.append(Skipped(movie, "lookup_failed", str(exc)))
                continue
            if isinstance(outcome, Verified):
                verified.append(outcome)
                print(f"  verified: {movie.title} ({movie.tmdb_id}) - {outcome.ott_date}")
            else:
                skipped.append(outcome)

    run_id: int | None = None
    store = Store(args.state)
    try:
        if not args.dry_run:
            run_id = store.start_run(region=args.region, window=window.as_dict())
            for item in verified:
                store.record_movie(run_id, item.movie.tmdb_id, "ott_verified", item.as_dict())
            for item in skipped:
                store.record_movie(run_id, item.movie.tmdb_id, "skipped", item.as_dict())
            store.finish_run(run_id, {"verified": len(verified), "skipped": len(skipped)})
        quota = store.quota_snapshot()
    finally:
        store.close()

    stamp = f"{window.start.isoformat()}_{window.end.isoformat()}"
    out_dir = OUT_ROOT / stamp
    index = {
        "window": window.as_dict(),
        "territory": args.region,
        "languages": list(languages),
        "verified": [item.as_dict() for item in verified],
        "skipped": [item.as_dict() for item in skipped],
        "summary": {
            "candidates": len(verified) + len(skipped),
            "ottVerified": len(verified),
            "subtitlesDownloaded": 0,
            "analysed": 0,
            "draftsGenerated": 0,
            "skipped": len(skipped),
        },
        "credentials": credentials,
        "quota": quota,
    }
    if not args.dry_run:
        report.write_json(out_dir / "index.json", index)
        (out_dir / "report.md").write_text(
            report.render_report(
                window=window.as_dict(),
                region=args.region,
                languages=languages,
                limit=args.limit,
                verified=index["verified"],
                skipped=index["skipped"],
                credentials=credentials,
                quota=quota,
                run_id=run_id,
            ),
            encoding="utf-8",
        )

    print("")
    print("Summary")
    print(f"  candidates discovered : {index['summary']['candidates']}")
    print(f"  OTT date verified     : {index['summary']['ottVerified']}")
    print(f"  skipped / review      : {index['summary']['skipped']}")
    print(f"  subtitles downloaded  : 0 (phase 1)")
    print(f"  analysed / drafts     : 0 (phase 1)")
    if args.dry_run:
        print("  dry run: nothing written")
    else:
        print(f"  report: {out_dir / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
