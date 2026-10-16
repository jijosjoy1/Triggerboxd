"""Serial, rules-only job consumer. No public listener or model inference."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import urllib.parse
import urllib.request
from pathlib import Path

from . import classify, config
from .providers import NoMatch, ProviderError
from .providers.opensubtitles import OpenSubtitles
from .providers.subdl import Subdl, extract_subtitle
from .rules import Lexicon
from .store import Store
from .subtitles import MAX_SUBTITLE_BYTES, SUPPORTED_SUFFIXES, SubtitleError, load_subtitle

ROOT = Path(__file__).resolve().parents[1]
LIMITS = {"subdl": {"search": 1900, "download": 250},
          "opensubtitles": {"search": 1000, "download": 4}}


class JobError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, origin: str, token: str):
        parsed = urllib.parse.urlsplit(origin)
        local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
        if (parsed.scheme != "https" and not (parsed.scheme == "http" and local)) or not parsed.hostname:
            raise ValueError("Pipeline origin requires HTTPS (HTTP permitted only on loopback)")
        if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("Pipeline origin must contain only scheme and host")
        if not 32 <= len(token) <= 4096 or any(c.isspace() for c in token):
            raise ValueError("Pipeline token missing or invalid")
        self.url = origin.rstrip("/") + "/api/internal/subtitle-jobs/"
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, body: dict) -> dict:
        req = urllib.request.Request(self.url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Authorization": "Bearer " + self.token,
                                              "Content-Type": "application/json"})
        try:
            with self.opener.open(req, timeout=30) as response:
                raw = response.read(65537)
            if len(raw) > 65536:
                raise ValueError()
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError()
            return payload
        except Exception:
            # Neither response bodies nor exception strings are safe log material.
            raise JobError("job_service_unavailable") from None


def validate_job(job: dict) -> None:
    if not isinstance(job, dict) or type(job.get("tmdbId")) is not int or not 0 < job["tmdbId"] < 10**10:
        raise JobError("invalid_job")
    for key in ("id", "leaseToken"):
        if not isinstance(job.get(key), str) or not 1 <= len(job[key]) <= 512:
            raise JobError("invalid_job")


def compact_result(subtitle, lexicon: Lexicon) -> dict:
    analysis = classify.analyze(subtitle, lexicon)
    estimate = analysis["familyAwkwardnessEstimate"]
    return {"rating": estimate["rating"], "verdict": estimate["verdict"],
            "factors": estimate["factors"], "rulesVersion": lexicon.version,
            "scorerVersion": classify.SCORER_VERSION, "subtitleLanguage": "EN",
            "subtitleHash": subtitle.sha256, "cueCount": subtitle.cue_count}


def find_cached(tmdb_id: int, directories: tuple[Path, ...]):
    for directory in directories:
        for path in sorted(directory.glob(f"{tmdb_id}.*")):
            if path.is_symlink() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
                continue
            try:
                subtitle = load_subtitle(path)
                if subtitle.declared_tmdb_id == tmdb_id and (subtitle.language or "").upper() == "EN":
                    return subtitle
            except (SubtitleError, OSError):
                continue
    return None


def fetch_subtitle(tmdb_id: int, provider_name: str, cache: Path, store: Store):
    secrets = config.load_secrets()
    if provider_name == "subdl":
        if not secrets.get("SUBDL_API_KEY"):
            raise JobError("provider_error")
        provider = Subdl(secrets["SUBDL_API_KEY"])
    elif provider_name == "opensubtitles":
        if not secrets.get("OPENSUBTITLES_API_KEY"):
            raise JobError("provider_error")
        provider = OpenSubtitles(secrets["OPENSUBTITLES_API_KEY"],
                                 username=secrets.get("OPENSUBTITLES_USERNAME"),
                                 password=secrets.get("OPENSUBTITLES_PASSWORD"))
    else:
        raise JobError("provider_error")
    limits = LIMITS[provider_name]
    # Check both budgets before spending a search on a movie we cannot download.
    for action in ("search", "download"):
        if store.quota_used(scope="provider", subject=provider_name, action=action) >= limits[action]:
            raise JobError("quota_exhausted")

    def reserve(action):
        if not store.quota_reserve(scope="provider", subject=provider_name, action=action,
                                   amount=1, ceiling=limits[action]):
            raise JobError("quota_exhausted")

    reserve("search")
    try:
        if provider_name == "opensubtitles":
            _, entries = provider.search(tmdb_id=tmdb_id, languages=("EN",))
            entry = provider.select(entries, tmdb_id=tmdb_id, language="EN", allow_hearing_impaired=True).entry
        else:
            movies, candidates = provider.search(tmdb_id=tmdb_id, film_name=None, languages=("EN",))
            entry = provider.select(movies=movies, candidates=candidates, tmdb_id=tmdb_id,
                                    language="EN", allow_hearing_impaired=True).candidate
        if entry is None:
            raise JobError("subtitle_unavailable")
        reserve("download")
        if provider_name == "opensubtitles":
            result = provider.download(entry.file_id)
            name, content = result.file_name, result.content
            if result.remaining is not None and result.remaining <= 0:
                used = store.quota_used(scope="provider", subject=provider_name, action="download")
                store.quota_reserve(scope="provider", subject=provider_name, action="download",
                                    amount=max(0, limits["download"] - used), ceiling=limits["download"])
        else:
            name, content = extract_subtitle(provider.download(entry))
    except NoMatch:
        raise JobError("subtitle_unavailable") from None
    except ProviderError:
        raise JobError("provider_error") from None
    if len(content) > MAX_SUBTITLE_BYTES:
        raise JobError("analysis_failed")
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        suffix = ".srt"
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = cache / f"{tmdb_id}.en.{hashlib.sha256(content).hexdigest()[:24]}{suffix}"
    path.write_bytes(content)
    try:
        return load_subtitle(path, language="EN")
    except SubtitleError:
        path.unlink(missing_ok=True)
        raise JobError("analysis_failed") from None


def prune_cache(cache: Path, *, now=None) -> None:
    """Only remove worker-owned subtitle cache; never touch manual private drafts."""
    now = time.time() if now is None else now
    paths = sorted((p for p in cache.glob("*") if p.is_file() and not p.is_symlink()
                    and p.suffix in SUPPORTED_SUFFIXES), key=lambda p: p.stat().st_mtime, reverse=True)
    for index, path in enumerate(paths):
        if index >= 100 or now - path.stat().st_mtime > 7 * 86400:
            path.unlink()


def run_once(client: Client, *, root=ROOT, provider_name="opensubtitles") -> str:
    """A SQLite write lease is released by the OS even if the process crashes."""
    root = Path(root)
    lock = sqlite3.connect(root / "worker-lock.sqlite", timeout=0)
    store = None
    try:
        try:
            lock.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError:
            return "busy"
        cache = root / "worker-cache"
        prune_cache(cache)
        job = client.call({"action": "claim"}).get("data")
        if job is None:
            return "idle"
        validate_job(job)
        envelope = {"id": job["id"], "leaseToken": job["leaseToken"]}
        try:
            subtitle = find_cached(job["tmdbId"], (cache, root / "subs"))
            if subtitle is None:
                store = Store(root / "state.sqlite")
                subtitle = fetch_subtitle(job["tmdbId"], provider_name, cache, store)
            result = compact_result(subtitle, Lexicon.load())
        except Exception as exc:
            reason = str(exc) if isinstance(exc, JobError) else "analysis_failed"
            if reason not in ("subtitle_unavailable", "quota_exhausted", "provider_error", "analysis_failed"):
                reason = "analysis_failed"
            client.call({"action": "fail", **envelope, "reason": reason})
            return "failed"
        # Do not convert uncertain delivery into a failure that could overwrite completion.
        client.call({"action": "complete", **envelope, "result": result})
        return "completed"
    finally:
        if store is not None:
            store.close()
        lock.close()


def main(argv=None) -> int:
    import argparse
    parser = argparse.ArgumentParser(description="Consume moderator subtitle jobs (rules only)")
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--provider", choices=tuple(LIMITS), default="opensubtitles")
    args = parser.parse_args(argv)
    try:
        client = Client(os.environ.get("TRIGGERBOXD_PIPELINE_ORIGIN", ""),
                        os.environ.get("TRIGGERBOXD_PIPELINE_TOKEN", ""))
    except ValueError:
        print("Worker configuration invalid; check private environment file.")
        return 2
    while True:
        try:
            status = run_once(client, provider_name=args.provider)
        except Exception:
            status = "service_error"
        print("Subtitle worker: " + status, flush=True)
        if args.once:
            return 1 if status == "service_error" else 0
        time.sleep(60)
