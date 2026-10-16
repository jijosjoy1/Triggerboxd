"""Read-only TMDB client. The token is never logged or included in output."""

from __future__ import annotations

import http.client
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

API_ROOT = "https://api.themoviedb.org/3"
DIGITAL_RELEASE_TYPE = 4


class TmdbError(RuntimeError):
    pass


@dataclass(frozen=True)
class Movie:
    tmdb_id: int
    title: str
    original_title: str
    release_date: str | None
    original_language: str | None
    popularity: float

    @classmethod
    def from_payload(cls, payload: dict) -> "Movie | None":
        """Coerce defensively: one malformed row must not abort a page."""
        try:
            tmdb_id = int(payload["id"])
        except (KeyError, TypeError, ValueError):
            return None
        if tmdb_id <= 0:
            return None
        try:
            popularity = float(payload.get("popularity") or 0.0)
        except (TypeError, ValueError):
            popularity = 0.0
        title = payload.get("title") or payload.get("original_title") or "Untitled"
        return cls(
            tmdb_id=tmdb_id,
            title=str(title),
            original_title=str(payload.get("original_title") or title),
            release_date=(payload.get("release_date") if isinstance(payload.get("release_date"), str) and payload.get("release_date") else None),
            original_language=(payload.get("original_language") if isinstance(payload.get("original_language"), str) and payload.get("original_language") else None),
            popularity=popularity,
        )

    def as_dict(self) -> dict:
        return {
            "tmdbId": self.tmdb_id,
            "title": self.title,
            "originalTitle": self.original_title,
            "releaseDate": self.release_date,
            "originalLanguage": self.original_language,
            "popularity": self.popularity,
        }


class Tmdb:
    def __init__(self, token: str, retries: int = 2, timeout: int = 30):
        if not token:
            raise TmdbError("TMDB_READ_ACCESS_TOKEN is not configured")
        self._token = token
        self._retries = max(0, retries)
        self._timeout = timeout

    def _get(self, path: str, **params) -> dict:
        query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        url = f"{API_ROOT}{path}?{query}" if query else f"{API_ROOT}{path}"
        request = urllib.request.Request(
            url,
            headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
        )
        last: Exception | None = None
        for attempt in range(self._retries + 1):
            try:
                with urllib.request.urlopen(request, timeout=self._timeout) as response:
                    raw = response.read()
                    # A 200 with an HTML error page or a truncated body must not
                    # escape as a bare ValueError.
                    try:
                        parsed = json.loads(raw.decode("utf-8"))
                    except (ValueError, UnicodeDecodeError) as exc:
                        last = exc
                        if attempt < self._retries:
                            time.sleep(2 ** attempt)
                            continue
                        raise TmdbError(f"TMDB returned a malformed body for {path}") from None
                    if not isinstance(parsed, dict):
                        raise TmdbError(f"TMDB returned an unexpected body for {path}")
                    return parsed
            except urllib.error.HTTPError as exc:
                last = exc
                # Only a rate limit is worth retrying; 4xx otherwise is terminal.
                if exc.code == 429 and attempt < self._retries:
                    time.sleep(2 ** attempt)
                    continue
                raise TmdbError(f"TMDB HTTP {exc.code} for {path}") from None
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
                last = exc
                if attempt < self._retries:
                    time.sleep(2 ** attempt)
                    continue
                raise TmdbError(f"TMDB unavailable for {path}") from None
        raise TmdbError(f"TMDB failed for {path}") from last

    def discover_digital_releases(
        self,
        *,
        region: str,
        start: str,
        end: str,
        languages: tuple[str, ...] = (),
        page: int = 1,
    ) -> dict:
        return self._get(
            "/discover/movie",
            with_release_type=DIGITAL_RELEASE_TYPE,
            region=region,
            **{
                "release_date.gte": start,
                "release_date.lte": end,
                "with_original_language": "|".join(languages) if languages else None,
            },
            sort_by="primary_release_date.desc",
            include_adult="false",
            page=page,
        )

    def release_dates(self, movie_id: int) -> dict:
        return self._get(f"/movie/{movie_id}/release_dates")

    def watch_providers(self, movie_id: int) -> dict:
        return self._get(f"/movie/{movie_id}/watch/providers")
