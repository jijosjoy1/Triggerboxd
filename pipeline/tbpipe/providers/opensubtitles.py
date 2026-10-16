"""OpenSubtitles adapter (search + download).

Contract details that matter, all taken from the published API docs and
confirmed against the live API:

* Two credentials. `Api-Key` (consumer key) authenticates the *application* and
  is required on every request. A login token authenticates the *user* and only
  changes whose download allowance is spent. Login is optional here: anonymous
  downloads are enabled for this key, so no password is needed.
* A descriptive `User-Agent` is mandatory; a library default is refused.
* Query parameters must be canonical: alphabetical, lowercased values, empty
  values omitted, and IMDb ids without the `tt` prefix.
* Login is rate limited to 1 request/second, so the token is cached for its
  24 hour life and only refreshed on expiry or a 401.
* The `/download` response contains a one-time `link` with an embedded secret.
  It is fetched immediately and never stored, logged or written to an artefact.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from . import ProviderError, ProviderUnavailable

API_ROOT = "https://api.opensubtitles.com/api/v1"
USER_AGENT = "TriggerboxdPipeline v0.1"
TOKEN_LIFETIME = timedelta(hours=23)  # issued for 24h; refresh a little early

DEFAULT_LANGUAGE = "en"
MAX_SUBTITLE_BYTES = 1_000_000


class _Transport:
    def request(self, method: str, url: str, *, headers: dict[str, str], body: dict | None = None, timeout: int = 60):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                try:
                    payload = json.loads(raw.decode("utf-8")) if raw else {}
                except (ValueError, UnicodeDecodeError):
                    raise ProviderError("OpenSubtitles returned malformed JSON") from None
                return response.status, response.headers, payload
        except urllib.error.HTTPError as exc:
            # Error bodies can contain tokens, so only the status is surfaced.
            if exc.code in (401, 403):
                raise ProviderUnavailable(f"OpenSubtitles refused the request (HTTP {exc.code})") from None
            if exc.code == 429:
                raise ProviderError("OpenSubtitles rate limit reached (HTTP 429)") from None
            raise ProviderError(f"OpenSubtitles HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ProviderUnavailable(f"OpenSubtitles unreachable: {type(exc).__name__}") from None

    def get_bytes(self, url: str, *, timeout: int = 120) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                content = response.read(MAX_SUBTITLE_BYTES + 1)
                if len(content) > MAX_SUBTITLE_BYTES:
                    raise ProviderError("OpenSubtitles file exceeds size limit")
                return content
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as exc:
            raise ProviderUnavailable(f"OpenSubtitles file fetch failed: {type(exc).__name__}") from None


def canonical_query(params: dict) -> str:
    """Alphabetical, lowercased, empty values dropped - as the API requires."""
    cleaned = {key: str(value).lower() for key, value in params.items() if value not in (None, "")}
    return "&".join(f"{key}={urllib.parse.quote_plus(value)}" for key, value in sorted(cleaned.items()))


def bare_imdb_id(value: str | int | None) -> str | None:
    """The API wants imdb ids without the `tt` prefix."""
    if value in (None, ""):
        return None
    text = str(value).strip().lower()
    return text[2:] if text.startswith("tt") else text


@dataclass(frozen=True)
class Entry:
    subtitle_id: str
    file_id: int
    file_name: str
    language: str
    hearing_impaired: bool
    ai_translated: bool
    machine_translated: bool
    foreign_parts_only: bool
    from_trusted: bool
    download_count: int
    release: str
    fps: float | None
    feature_tmdb_id: int | None
    feature_imdb_id: str | None
    feature_title: str
    feature_year: int | None

    @classmethod
    def from_payload(cls, payload: dict) -> "Entry | None":
        """Coerce defensively: a malformed row must not abort the whole run."""
        if not isinstance(payload, dict):
            return None
        attributes = payload.get("attributes")
        if not isinstance(attributes, dict):
            return None
        files = attributes.get("files")
        if not isinstance(files, list) or not files or not isinstance(files[0], dict):
            return None
        if not isinstance(files[0].get("file_id"), int):
            return None
        feature = attributes.get("feature_details")
        if not isinstance(feature, dict):
            feature = {}
        fps = attributes.get("fps")
        return cls(
            subtitle_id=str(payload.get("id") or ""),
            file_id=int(files[0]["file_id"]),
            file_name=str(files[0].get("file_name") or ""),
            language=str(attributes.get("language") or "").lower(),
            hearing_impaired=bool(attributes.get("hearing_impaired")),
            ai_translated=bool(attributes.get("ai_translated")),
            machine_translated=bool(attributes.get("machine_translated")),
            foreign_parts_only=bool(attributes.get("foreign_parts_only")),
            from_trusted=bool(attributes.get("from_trusted")),
            download_count=int(attributes["download_count"]) if isinstance(attributes.get("download_count"), int) else 0,
            release=str(attributes.get("release") or ""),
            fps=float(fps) if isinstance(fps, (int, float)) else None,
            feature_tmdb_id=int(feature["tmdb_id"]) if str(feature.get("tmdb_id") or "").isdigit() else None,
            feature_imdb_id=str(feature["imdb_id"]) if feature.get("imdb_id") else None,
            feature_title=str(feature.get("title") or ""),
            feature_year=int(feature["year"]) if str(feature.get("year") or "").isdigit() else None,
        )

    def as_dict(self) -> dict:
        return {
            "subtitleId": self.subtitle_id,
            "fileId": self.file_id,
            "fileName": self.file_name,
            "language": self.language,
            "hearingImpaired": self.hearing_impaired,
            "machineTranslated": self.machine_translated or self.ai_translated,
            "fromTrusted": self.from_trusted,
            "downloadCount": self.download_count,
            "release": self.release,
            "fps": self.fps,
            "featureTmdbId": self.feature_tmdb_id,
            "featureYear": self.feature_year,
        }


@dataclass(frozen=True)
class Download:
    file_name: str
    content: bytes
    remaining: int | None
    requests_used: int | None


@dataclass
class Selection:
    entry: Entry | None
    considered: int
    reason: str
    alternatives: list[dict]

    @property
    def file_id(self) -> int | None:
        return self.entry.file_id if self.entry else None


class OpenSubtitles:
    def __init__(self, api_key: str, *, username: str | None = None, password: str | None = None,
                 transport: _Transport | None = None, user_agent: str = USER_AGENT,
                 sleep=time.sleep, clock=lambda: datetime.now(tz=timezone.utc)):
        if not api_key:
            raise ProviderUnavailable("OPENSUBTITLES_API_KEY is not configured")
        self._key = api_key
        self._username = username
        self._password = password
        self._transport = transport or _Transport()
        self._user_agent = user_agent
        self._sleep = sleep
        self._clock = clock
        self._remaining: int | None = None
        self._token: str | None = None
        self._token_at: datetime | None = None
        self._user: dict | None = None

    # -- headers ---------------------------------------------------------
    def _headers(self, *, json_body: bool = False, token: str | None = None) -> dict[str, str]:
        headers = {"Accept": "application/json", "Api-Key": self._key, "User-Agent": self._user_agent}
        if json_body:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    # -- login -----------------------------------------------------------
    @property
    def credentials(self) -> bool:
        return bool(self._username and self._password)

    def login(self, *, force: bool = False) -> str | None:
        """Return a valid token, or None to download anonymously."""
        if not self.credentials:
            return None
        fresh = self._token and self._token_at and self._clock() - self._token_at < TOKEN_LIFETIME
        if fresh and not force:
            return self._token
        # Documented limit: 1 login request per second.
        status, _, payload = self._transport.request(
            "POST", f"{API_ROOT}/login",
            headers=self._headers(json_body=True),
            body={"username": self._username, "password": self._password},
        )
        token = payload.get("token") if isinstance(payload, dict) else None
        if status != 200 or not token:
            raise ProviderUnavailable("OpenSubtitles login did not return a token")
        self._token = str(token)
        self._token_at = self._clock()
        self._user = payload.get("user") if isinstance(payload.get("user"), dict) else None
        self._sleep(1)
        return self._token

    def user_info(self) -> dict:
        token = self.login()
        if not token:
            return {}
        _, _, payload = self._transport.request("GET", f"{API_ROOT}/infos/user", headers=self._headers(token=token))
        return payload if isinstance(payload, dict) else {}

    # -- search ----------------------------------------------------------
    def search(self, *, tmdb_id: int | None = None, imdb_id: str | int | None = None, query: str | None = None,
               languages: tuple[str, ...] = (DEFAULT_LANGUAGE,), year: int | None = None,
               page: int = 1, order_by: str = "download_count") -> tuple[int, list[Entry]]:
        if not any((tmdb_id, imdb_id, query)):
            raise ProviderError("OpenSubtitles needs tmdb_id, imdb_id or query")
        params = {
            "tmdb_id": tmdb_id if tmdb_id else None,
            "imdb_id": bare_imdb_id(imdb_id),
            "query": query,
            "languages": ",".join(code.lower() for code in languages),
            "type": "movie",
            "year": year,
            "page": page,
            "order_by": order_by,
            "order_direction": "desc",
        }
        url = f"{API_ROOT}/subtitles?{canonical_query(params)}"
        _, _, payload = self._transport.request("GET", url, headers=self._headers())
        if not isinstance(payload, dict):
            return 0, []
        data = payload.get("data")
        if not isinstance(data, list):
            data = []
        entries = [entry for entry in (Entry.from_payload(item) for item in data) if entry]
        total = payload.get("total_count")
        return (int(total) if isinstance(total, int) else len(entries)), entries

    # -- selection -------------------------------------------------------
    @staticmethod
    def select(entries: list[Entry], *, tmdb_id: int | None = None, language: str = DEFAULT_LANGUAGE,
               allow_hearing_impaired: bool = False) -> Selection:
        if not entries:
            return Selection(None, 0, "no_results", [])
        total = len(entries)
        unverified = False
        if tmdb_id:
            # Prefer the entries that actually belong to the requested film. One
            # mis-tagged row must not disqualify the whole result set.
            matching = [e for e in entries if e.feature_tmdb_id == tmdb_id]
            if matching:
                entries = matching
            else:
                unknown = [e for e in entries if not e.feature_tmdb_id]
                if not unknown:
                    return Selection(None, total, "feature_id_mismatch", [])
                entries = unknown
                unverified = True  # the response gave nothing to verify against
        usable = [e for e in entries if e.language == language.lower()]
        hi_fallback = False
        if not allow_hearing_impaired:
            non_hi = [e for e in usable if not e.hearing_impaired]
            if non_hi:
                usable = non_hi
            elif usable:
                hi_fallback = True  # only caption-bearing copies exist
        complete = [e for e in usable if not e.foreign_parts_only] or usable
        if not complete:
            return Selection(None, len(entries), "no_subtitle_in_language", [])

        ordered = sorted(complete, key=lambda e: (
            0 if e.from_trusted else 1,
            1 if e.machine_translated or e.ai_translated else 0,
            -e.download_count,
            e.file_name.lower(),
        ))
        chosen = ordered[0]
        if chosen.machine_translated or chosen.ai_translated:
            reason = "machine_translated_only"
        elif chosen.from_trusted:
            reason = "trusted_upload"
        else:
            reason = "most_downloaded"
        if unverified:
            reason += "+unverified_feature"
        if hi_fallback:
            reason += "+hi_fallback"
        return Selection(chosen, total, reason, [e.as_dict() for e in ordered[1:6]])

    # -- download --------------------------------------------------------
    def download(self, file_id: int, *, sub_format: str = "srt") -> Download:
        # Refuse before spending: the allowance is reported by the previous call.
        if self._remaining is not None and self._remaining <= 0:
            raise ProviderUnavailable("OpenSubtitles reports no downloads remaining today")
        token = self.login()
        _, _, payload = self._transport.request(
            "POST", f"{API_ROOT}/download",
            headers=self._headers(json_body=True, token=token),
            body={"file_id": file_id, "sub_format": sub_format},
        )
        if not isinstance(payload, dict):
            raise ProviderError("OpenSubtitles download returned no payload")
        link = payload.get("link")
        if not isinstance(link, str) or not link.startswith("http"):
            if payload.get("message"):
                raise ProviderError("OpenSubtitles download refused by provider")
            raise ProviderError("OpenSubtitles download returned no link")
        remaining_value = payload.get("remaining")
        remaining = int(remaining_value) if str(remaining_value).lstrip("-").isdigit() else None
        if remaining is not None:
            self._remaining = remaining
        content = self._transport.get_bytes(link)
        return Download(
            file_name=str(payload.get("file_name") or f"opensubtitles-{file_id}.{sub_format}"),
            content=content,
            remaining=remaining,
            requests_used=int(payload["requests"]) if str(payload.get("requests") or "").isdigit() else None,
        )


def write_subtitle(download: Download, destination: Path) -> Path:
    """Persist only the file itself. The one-time link is never stored."""
    destination.write_bytes(download.content)
    return destination
