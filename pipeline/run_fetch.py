#!/usr/bin/env python
"""Triggerboxd draft-warning pipeline - Phase 3: eligible subtitle fetching.

Takes verified OTT releases from a Phase 1 run (or an ad-hoc --movie), finds a
matching English subtitle through SubDL, downloads it inside the provider's
allowance, validates that it parses, and optionally runs the offline classifier.

It reports unavailable or ineligible sources briefly and continues with the rest.
An available download quota is not treated as permission for anything beyond
this private review use.

    python run_fetch.py --index .\\out\\2026-10-09_2026-10-15\\index.json --dry-run
    python run_fetch.py --index .\\out\\...\\index.json --limit 3 --analyse
    python run_fetch.py --movie 579974 --analyse
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tbpipe import classify, config, report  # noqa: E402
from tbpipe.providers import NoMatch, ProviderError, ProviderUnavailable  # noqa: E402
from tbpipe.providers.opensubtitles import OpenSubtitles  # noqa: E402
from tbpipe.providers.subdl import Subdl, extract_subtitle  # noqa: E402
from tbpipe.rules import Lexicon, LexiconError  # noqa: E402
from tbpipe.store import Store  # noqa: E402
from tbpipe.subtitles import SUPPORTED_SUFFIXES, SubtitleError, load_subtitle  # noqa: E402

OUT_ROOT = Path(__file__).resolve().parent / "out"
SUBS_DIR = Path(__file__).resolve().parent / "subs"

# Published allowances. Stop well short so a run cannot exhaust the account.
# Published allowances differ per provider, so the ceilings do too. A run stops
# short of the real limit rather than exhausting the account.
#   SubDL:         2000 search requests/day (free key); downloads use the
#                  anonymous 300/day per-IP allowance.
#   OpenSubtitles: downloads use the anonymous allowance of 5/day per IP per key.
PROVIDER_LIMITS = {
    "subdl": {"search": 1900, "download": 250},
    "opensubtitles": {"search": 1000, "download": 4},
}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch eligible subtitles for verified OTT releases.")
    parser.add_argument("--index", help="Phase 1 index.json with verified releases")
    parser.add_argument("--movie", type=int, action="append", default=[], help="ad-hoc TMDB id (repeatable)")
    parser.add_argument("--provider", choices=("opensubtitles", "subdl"), default="opensubtitles",
                        help="subtitle source (default opensubtitles)")
    parser.add_argument("--languages", default="EN", help="comma-separated SubDL language codes (default EN)")
    parser.add_argument("--limit", type=int, default=5, help="maximum movies to fetch (default 5)")
    parser.add_argument("--dry-run", action="store_true", help="search and select, download nothing")
    parser.add_argument("--analyse", action="store_true", help="run the offline classifier on each download")
    parser.add_argument("--allow-hi", action="store_true", help="permit hearing-impaired subtitles if nothing else exists")
    parser.add_argument("--lexicon", help="override the lexicon path")
    parser.add_argument("--stamp", help="output folder name (default today, IST)")
    return parser.parse_args(argv)


def targets(args) -> list[dict]:
    wanted: list[dict] = []
    if args.index:
        try:
            payload = json.loads(Path(args.index).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SystemExit(f"--index unreadable: {exc}") from None
        if not isinstance(payload, dict) or not isinstance(payload.get("verified", []), list):
            raise SystemExit("--index must be a discovery object")
        for item in payload.get("verified") or []:
            if not isinstance(item, dict):
                continue
            movie = item.get("movie") or {}
            if not isinstance(movie, dict):
                continue
            if isinstance(movie.get("tmdbId"), int):
                wanted.append({"movie": movie, "ottDate": item.get("ottDate"),
                               "platforms": item.get("platforms"), "territory": item.get("territory"),
                               "window": payload.get("window")})
    for tmdb_id in args.movie:
        wanted.append({"movie": {"tmdbId": tmdb_id, "title": None}, "ottDate": None,
                       "platforms": None, "territory": None, "window": None})
    return wanted


def main(argv: list[str] | None = None) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = parse_args(argv)
    if args.limit < 1:
        raise SystemExit("--limit must be at least 1")

    secrets = config.load_secrets()
    credentials = config.present(secrets)
    languages = tuple(code.strip().upper() for code in args.languages.split(",") if code.strip())
    if not languages:
        raise SystemExit("--languages must contain at least one language code")

    print("Triggerboxd draft-warning pipeline - phase 3 (subtitle fetch)")
    print(f"Provider: {args.provider}")
    if args.provider == "subdl" and not credentials.get("SUBDL_API_KEY"):
        print("SubDL is not configured (SUBDL_API_KEY missing); no subtitle can be fetched.")
        print("Local-file import stays available: python run_local.py --subtitles .\\subs")
        return 2
    if args.provider == "opensubtitles" and not credentials.get("OPENSUBTITLES_API_KEY"):
        print("OpenSubtitles is not configured (OPENSUBTITLES_API_KEY missing).")
        print("Local-file import stays available: python run_local.py --subtitles .\\subs")
        return 2

    wanted = targets(args)[: args.limit]
    if not wanted:
        print("Nothing to fetch: pass --index or --movie.")
        return 1

    provider = OpenSubtitles(secrets["OPENSUBTITLES_API_KEY"],
                             username=secrets.get("OPENSUBTITLES_USERNAME"),
                             password=secrets.get("OPENSUBTITLES_PASSWORD")) if args.provider == "opensubtitles" \
        else Subdl(secrets["SUBDL_API_KEY"])
    lexicon = None
    if args.analyse:
        try:
            lexicon = Lexicon.load(args.lexicon)
        except LexiconError as exc:
            print(f"ERROR: {exc}")
            return 2

    stamp = args.stamp or datetime.now().strftime("%Y-%m-%d")
    out_dir = OUT_ROOT / stamp
    drafts_dir = out_dir / "drafts"
    SUBS_DIR.mkdir(parents=True, exist_ok=True)
    store = Store(Path(__file__).resolve().parent / "state.sqlite")

    fetched: list[dict] = []
    skipped: list[dict] = []
    analysed = 0
    storage_used = 0
    try:
        # Read the ceiling for the provider actually in use. Reading SubDL's
        # counters on an OpenSubtitles run leaves that allowance unchecked.
        searches = store.quota_used(scope="provider", subject=args.provider, action="search")
        downloads = store.quota_used(scope="provider", subject=args.provider, action="download")
        print(f"Quota used today ({args.provider}): searches {searches}, downloads {downloads}")

        search_ceiling = PROVIDER_LIMITS[args.provider]["search"]
        download_ceiling = PROVIDER_LIMITS[args.provider]["download"]
        if searches >= search_ceiling:
            print(f"Search allowance for {args.provider} is nearly exhausted; stopping before any request.")
            return 1

        for item in wanted:
            if searches >= search_ceiling:
                print("Search allowance exhausted for today; stopping before the next request.")
                break
            movie = item["movie"]
            tmdb_id = movie["tmdbId"]
            title = movie.get("title") or f"TMDB {tmdb_id}"
            if not store.quota_reserve(scope="provider", subject=args.provider, action="search",
                                       amount=1, ceiling=search_ceiling):
                skipped.append({"tmdbId": tmdb_id, "title": title, "reason": "search_allowance_nearly_exhausted"})
                break
            searches += 1
            try:
                if args.provider == "opensubtitles":
                    _, entries = provider.search(tmdb_id=tmdb_id, languages=languages)
                    chosen = OpenSubtitles.select(entries, tmdb_id=tmdb_id, language=languages[0],
                                                  allow_hearing_impaired=args.allow_hi)
                    picked_entry = chosen.entry
                    picked_reason, considered, alternatives = chosen.reason, chosen.considered, chosen.alternatives
                else:
                    movies, candidates = provider.search(tmdb_id=tmdb_id, film_name=None, languages=languages)
                    chosen = provider.select(movies=movies, candidates=candidates, tmdb_id=tmdb_id,
                                             language=languages[0], allow_hearing_impaired=args.allow_hi)
                    picked_entry = chosen.candidate
                    picked_reason, considered, alternatives = chosen.reason, chosen.considered, chosen.skipped
            except (ProviderError, ProviderUnavailable) as exc:
                # The request was still sent, so it still counts against the allowance.
                skipped.append({"tmdbId": tmdb_id, "title": title, "reason": "provider_error", "detail": str(exc)})
                print(f"  {title}: provider error ({exc})")
                continue

            if not picked_entry:
                skipped.append({"tmdbId": tmdb_id, "title": title, "reason": picked_reason,
                                "detail": f"{considered} subtitle(s) considered"})
                print(f"  {title}: skipped ({picked_reason})")
                continue

            record = {
                "tmdbId": tmdb_id,
                "title": title,
                "ottDate": item.get("ottDate"),
                "platforms": item.get("platforms"),
                "territory": item.get("territory"),
                "selection": {"reason": picked_reason, "considered": considered,
                              "candidate": picked_entry.as_dict(), "alternatives": alternatives},
                "subtitleSource": args.provider,
            }

            if args.dry_run:
                record["status"] = "selected_not_downloaded"
                fetched.append(record)
                label = picked_entry.release_name if args.provider == "subdl" else picked_entry.file_name
                print(f"  {title}: selected {label} ({picked_reason}) - dry run")
                continue

            if downloads >= download_ceiling:
                skipped.append({"tmdbId": tmdb_id, "title": title, "reason": "download_allowance_nearly_exhausted",
                                "detail": f"{downloads} downloads used today"})
                print(f"  {title}: skipped (download allowance nearly exhausted)")
                continue

            if not store.quota_reserve(scope="provider", subject=args.provider, action="download",
                                       amount=1, ceiling=download_ceiling):
                skipped.append({"tmdbId": tmdb_id, "title": title,
                                "reason": "download_allowance_nearly_exhausted"})
                continue
            downloads += 1

            try:
                if args.provider == "opensubtitles":
                    result = provider.download(picked_entry.file_id)
                    name, content = result.file_name, result.content
                    if result.remaining is not None:
                        record["providerRemaining"] = result.remaining
                        if result.remaining <= 0:
                            # The provider says there is nothing left today; stop
                            # rather than collecting refusals.
                            downloads = download_ceiling
                            print("    provider reports no downloads remaining today; stopping")
                else:
                    archive = provider.download(picked_entry)
                    name, content = extract_subtitle(archive)
            except (ProviderError, NoMatch, ProviderUnavailable) as exc:
                skipped.append({"tmdbId": tmdb_id, "title": title, "reason": "download_failed", "detail": str(exc)})
                print(f"  {title}: download failed ({exc})")
                continue

            suffix = Path(name).suffix.lower() or ".srt"
            if suffix not in SUPPORTED_SUFFIXES:
                suffix = ".srt"
            safe_id = "".join(c for c in str(picked_entry.subtitle_id) if c.isascii() and c.isalnum())[:40]
            target = SUBS_DIR / f"{tmdb_id}.{languages[0].lower()}.{safe_id or 'unknown'}{suffix}"
            target.write_bytes(content)
            storage_used += len(content)

            try:
                subtitle = load_subtitle(target, language=languages[0])
            except SubtitleError as exc:
                target.unlink(missing_ok=True)
                skipped.append({"tmdbId": tmdb_id, "title": title, "reason": "unreadable_subtitle", "detail": str(exc)})
                print(f"  {title}: rejected after download ({exc})")
                continue

            record.update({
                "status": "downloaded",
                "file": target.name,
                "sha256": subtitle.sha256,
                "cues": subtitle.cue_count,
                "bytes": len(content),
            })
            print(f"  {title}: downloaded {target.name} ({subtitle.cue_count} cues) via {picked_reason}")

            if lexicon is not None:
                analysis = classify.analyze(subtitle, lexicon)
                draft = classify.draft_for(movie=movie, subtitle=subtitle, analysis=analysis,
                                           window=item.get("window"), region=item.get("territory"),
                                           source=args.provider)
                if item.get("ottDate"):
                    draft["ottDate"] = item["ottDate"]
                    draft["platforms"] = item.get("platforms")
                candidates_found = [c["category"] for c in draft["categories"] if c["state"] == classify.STATE_CANDIDATE]
                record["candidates"] = candidates_found
                drafts_dir.mkdir(parents=True, exist_ok=True)
                report.write_json(drafts_dir / f"{tmdb_id}.{subtitle.language or 'und'}.{subtitle.sha256[:12]}.{lexicon.version}.draft.json", draft)
                analysed += 1
                print(f"    analysed: {len(candidates_found)} candidate categor"
                      f"{'y' if len(candidates_found) == 1 else 'ies'}")

            fetched.append(record)

        account = {"checked": False}
    finally:
        quota = store.quota_snapshot()
        store.close()

    summary = {
        "stamp": stamp,
        "provider": args.provider,
        "languages": list(languages),
        "dryRun": args.dry_run,
        "requested": len(wanted),
        "downloaded": sum(1 for r in fetched if r.get("status") == "downloaded"),
        "selectedOnly": sum(1 for r in fetched if r.get("status") == "selected_not_downloaded"),
        "analysed": analysed,
        "skipped": len(skipped),
        "bytesStored": storage_used,
        "account": account,
    }
    if not args.dry_run:
        report.write_json(out_dir / "phase3-summary.json", summary)
        report.write_json(out_dir / "phase3-items.json", {"fetched": fetched, "skipped": skipped})

    print("")
    print("Summary")
    print(f"  movies requested      : {summary['requested']}")
    print(f"  subtitles downloaded  : {summary['downloaded']}")
    print(f"  selected only (dry)   : {summary['selectedOnly']}")
    print(f"  drafts generated      : {analysed}")
    print(f"  skipped / needs review: {summary['skipped']}")
    for entry in skipped:
        print(f"    - {entry['title']}: {entry['reason']}")
    print("  provider allowance used today:")
    if not quota:
        print("    - none recorded")
    for row in quota:
        print(f"    - {row['scope']} | {row['subject']} | {row['action']}: {row['used']}")
    print("  severity: never asserted; human review required before anything leaves draft")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
