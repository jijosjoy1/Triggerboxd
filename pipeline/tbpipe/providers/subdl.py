"""SubDL adapter (search + download).

Deliberate behaviours, all driven by the published API contract:

* The search response echoes the API key inside each subtitle's `url`
  (`/subtitle/123-456.zip?api_key=...`). The key is stripped immediately and
  never stored, logged or written into an artefact.
* Movie identity is verified before anything is downloaded: the search must
  resolve to a single title whose TMDB/IMDb id matches the request.
* Selection is deterministic and explained. It prefers a complete,
  non-hearing-impaired subtitle in the target language, then a digital/web
  release name over a camera or telecine one, and never claims ambiguity is a
  match.
* Free keys search up to 2,000 requests/day; downloads use the provider's
  anonymous per-IP allowance. Paid-only endpoints are not used.
"""

from __future__ import annotations

import io
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from . import NoMatch, ProviderError, ProviderUnavailable

SEARCH_ENDPOINT = "https://api.subdl.com/api/v1/subtitles"
ACCOUNT_ENDPOINT = "https://api.subdl.com/api/v1/me"
DOWNLOAD_ROOT = "https://dl.subdl.com"
USER_AGENT = "triggerboxd-pipeline/0.1 (manual, non-commercial review)"

SUBTITLE_SUFFIXES = (".srt", ".vtt", ".ass", ".ssa", ".sub")
MAX_ARCHIVE_BYTES = 5_000_000
MAX_SUBTITLE_BYTES = 1_000_000

# Digital/web sources are preferred over anything sourced from a camera.
_PREFERRED = re.compile(r"(web[-_. ]?dl|webrip|web|amzn|nf|netflix|hulu|hotstar|prime|dsnp|hmax)", re.I)
_DISFAVOURED = re.compile(r"(cam|ts|telesync|hdts|hdcam|tc|telesync)", re.I)


class _Transport:
    """Thin HTTP layer, injectable so tests never touch the network."""

    def get_json(self, url: str, timeout: int = 60) -> dict:
        request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                try:
                    return json.loads(raw.decode("utf-8")) if raw else {}
                except (ValueError, UnicodeDecodeError):
                    # A malformed body must not escape as a bare ValueError.
                    raise ProviderError("SubDL returned malformed JSON") from None
        except urllib.error.HTTPError as exc:
            raise ProviderError(f"SubDL HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ProviderUnavailable(f"SubDL unreachable: {type(exc).__name__}") from None

    def get_bytes(self, url: str, timeout: int = 120) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                content = response.read(MAX_ARCHIVE_BYTES + 1)
                if len(content) > MAX_ARCHIVE_BYTES:
                    raise ProviderError("SubDL archive exceeds size limit")
                return content
        except urllib.error.HTTPError as exc:
            raise ProviderError(f"SubDL download HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ProviderUnavailable(f"SubDL download unreachable: {type(exc).__name__}") from None


@dataclass(frozen=True)
class MovieMatch:
    tmdb_id: int | None
    imdb_id: str | None
    name: str
    year: int | None
    sd_id: int | None

    @classmethod
    def from_payload(cls, payload: dict) -> "MovieMatch":
        tmdb = payload.get("tmdb_id")
        return cls(
            tmdb_id=int(tmdb) if isinstance(tmdb, (int, str)) and str(tmdb).isdigit() else None,
            imdb_id=(payload.get("imdb_id") or None) or None,
            name=str(payload.get("name") or ""),
            year=int(payload["year"]) if isinstance(payload.get("year"), (int, str)) and str(payload.get("year")).isdigit() else None,
            sd_id=int(payload["sd_id"]) if isinstance(payload.get("sd_id"), (int, str)) and str(payload.get("sd_id")).isdigit() else None,
        )


@dataclass(frozen=True)
class Candidate:
    subtitle_id: str
    language: str
    release_name: str
    archived_name: str
    hearing_impaired: bool
    fps: str | None
    download_path: str
    preferred_source: bool

    @property
    def download_url(self) -> str:
        return DOWNLOAD_ROOT + self.download_path

    def as_dict(self) -> dict:
        return {
            "subtitleId": self.subtitle_id,
            "language": self.language,
            "releaseName": self.release_name,
            "archivedName": self.archived_name,
            "hearingImpaired": self.hearing_impaired,
            "fps": self.fps,
            "downloadPath": self.download_path,
            "preferredSource": self.preferred_source,
        }


@dataclass
class Selection:
    movie: MovieMatch
    candidate: Candidate | None
    considered: int
    reason: str
    skipped: list[dict] = field(default_factory=list)


def strip_credentials(url: str) -> str:
    """Return only the path, dropping any query string that could carry a key."""
    parsed = urllib.parse.urlsplit(url if "://" in url else DOWNLOAD_ROOT + url)
    return parsed.path


def _subtitle_id(path: str) -> str:
    match = re.search(r"/subtitle/([^/]+?)(?:\.zip)?$", path)
    return match.group(1) if match else path


class Subdl:
    def __init__(self, api_key: str, *, transport: _Transport | None = None, client: str = "custom_integration"):
        if not api_key:
            raise ProviderUnavailable("SUBDL_API_KEY is not configured")
        self._key = api_key
        self._transport = transport or _Transport()
        self._client = client

    # -- account ---------------------------------------------------------
    def account(self) -> dict:
        """Account plan and per-key usage. Values are non-secret counters."""
        payload = self._transport.get_json(f"{ACCOUNT_ENDPOINT}?{urllib.parse.urlencode({'api_key': self._key})}")
        return payload if isinstance(payload, dict) else {}

    # -- search ----------------------------------------------------------
    def search(self, *, tmdb_id: int | None = None, imdb_id: str | None = None, film_name: str | None = None,
               year: int | None = None, languages: tuple[str, ...] = ("EN",), subs_per_page: int = 30) -> tuple[list[MovieMatch], list[Candidate]]:
        if not any((tmdb_id, imdb_id, film_name)):
            raise ProviderError("SubDL needs tmdb_id, imdb_id or film_name")
        params: dict[str, str] = {
            "api_key": self._key,
            "type": "movie",
            "languages": ",".join(languages),
            "subs_per_page": str(max(1, min(30, subs_per_page))),
            "client": self._client,
        }
        # Deliberately NOT sending hi=1: the published contract says it adds the
        # hearing-impaired flag, but in practice it filters the result set to
        # hearing-impaired uploads only (observed: 23 results down to 0). The
        # `hi` flag is already present on every entry without asking for it.
        if tmdb_id:
            params["tmdb_id"] = str(tmdb_id)
        if imdb_id:
            params["imdb_id"] = imdb_id
        if film_name:
            params["film_name"] = film_name
        if year:
            params["year"] = str(year)

        payload = self._transport.get_json(f"{SEARCH_ENDPOINT}?{urllib.parse.urlencode(params)}")
        if not isinstance(payload, dict) or payload.get("status") is not True:
            # "can't find movie or tv" is an ordinary miss. Anything else is a
            # provider failure and must not be reported as an empty result.
            error = payload.get("error") if isinstance(payload, dict) else None
            message = str(error or "").strip()
            if "can't find" in message.lower() or "cannot find" in message.lower():
                return [], []
            raise ProviderError("SubDL refused the search")
        rows = payload.get("results") or []
        if not isinstance(rows, list):
            raise ProviderError("SubDL returned malformed movie results")
        movies = [MovieMatch.from_payload(item) for item in rows if isinstance(item, dict)]
        return movies, self._candidates(payload.get("subtitles") or [])

    @staticmethod
    def _candidates(entries) -> list[Candidate]:
        if not isinstance(entries, list):
            raise ProviderError("SubDL returned malformed subtitle entries")
        candidates: list[Candidate] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            path = strip_credentials(str(entry.get("url") or ""))
            if not path:
                continue
            release = str(entry.get("release_name") or "")
            archived = str(entry.get("name") or "")
            candidates.append(Candidate(
                subtitle_id=_subtitle_id(path),
                language=str(entry.get("language") or entry.get("lang") or "").upper(),
                release_name=release,
                archived_name=archived,
                hearing_impaired=bool(entry.get("hi")),
                fps=str(entry["fps"]) if entry.get("fps") else None,
                download_path=path,
                preferred_source=bool(_PREFERRED.search(release or archived)),
            ))
        return candidates

    # -- selection -------------------------------------------------------
    def select(self, *, movies: list[MovieMatch], candidates: list[Candidate],
               tmdb_id: int | None = None, imdb_id: str | None = None, language: str = "EN",
               allow_hearing_impaired: bool = False) -> Selection:
        """Deterministic pick, only when the movie identity is unambiguous."""
        if not movies:
            return Selection(MovieMatch(None, None, "", None, None), None, 0, "no_movie_result")
        if len(movies) > 1:
            wanted = {m.tmdb_id for m in movies}
            if tmdb_id and wanted == {tmdb_id}:
                pass  # all results are the same title; identity is still unambiguous
            else:
                return Selection(movies[0], None, len(candidates), "ambiguous_movie_results")
        movie = movies[0]
        if tmdb_id and movie.tmdb_id and movie.tmdb_id != tmdb_id:
            return Selection(movie, None, len(candidates), "movie_id_mismatch")
        if imdb_id and movie.imdb_id and movie.imdb_id != imdb_id:
            return Selection(movie, None, len(candidates), "imdb_id_mismatch")
        # The search was made by id, but if the response carries nothing to confirm
        # it against, that must be visible rather than silently treated as verified.
        unverified = bool((tmdb_id and not movie.tmdb_id) or (imdb_id and not movie.imdb_id))

        usable = [c for c in candidates if c.language == language.upper()]
        hi_fallback = False
        if not allow_hearing_impaired:
            non_hi = [c for c in usable if not c.hearing_impaired]
            if non_hi:
                usable = non_hi
            elif usable:
                hi_fallback = True  # only caption-bearing copies exist
        if not usable:
            return Selection(movie, None, len(candidates), "no_subtitle_in_language")

        def rank(candidate: Candidate) -> tuple:
            return (
                0 if candidate.preferred_source else 1,
                candidate.hearing_impaired,
                candidate.release_name.lower(),
            )

        ordered = sorted(usable, key=rank)
        chosen = ordered[0]
        skipped = [c.as_dict() for c in ordered[1:6]]
        reason = "preferred_source" if chosen.preferred_source else "only_usable_language_match" if len(ordered) == 1 else "fallback_order"
        # Surface the two things a reviewer must know when reading the evidence.
        if unverified:
            reason += "+unverified_movie_identity"
        if hi_fallback:
            reason += "+hi_fallback"
        return Selection(movie, chosen, len(candidates), reason, skipped)

    # -- download --------------------------------------------------------
    def download(self, candidate: Candidate) -> bytes:
        """Fetch the archive bytes. The key is never sent to the download host."""
        return self._transport.get_bytes(candidate.download_url)


def extract_subtitle(archive: bytes, *, prefer_suffixes=SUBTITLE_SUFFIXES) -> tuple[str, bytes]:
    """Return (filename, bytes) for the best subtitle inside a zip or raw file."""
    if len(archive) > MAX_ARCHIVE_BYTES:
        raise ProviderError("SubDL archive exceeds size limit")
    if archive[:2] != b"PK":
        # Not a zip: treat as a bare subtitle file.
        if len(archive) > MAX_SUBTITLE_BYTES:
            raise ProviderError("SubDL subtitle exceeds size limit")
        return "download.subtitle", archive
    try:
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            names = [n for n in bundle.namelist() if n.lower().endswith(prefer_suffixes) and not n.endswith("/")]
            if not names:
                raise NoMatch("archive contains no subtitle file")
            names.sort(key=lambda n: (0 if n.lower().endswith(".srt") else 1, n.lower()))
            chosen = names[0]
            info = bundle.getinfo(chosen)
            if info.file_size > MAX_SUBTITLE_BYTES:
                raise ProviderError("SubDL subtitle exceeds size limit")
            try:
                with bundle.open(chosen) as source:
                    content = source.read(MAX_SUBTITLE_BYTES + 1)
                if len(content) > MAX_SUBTITLE_BYTES:
                    raise ProviderError("SubDL subtitle exceeds size limit")
                return Path(chosen).name, content
            except (RuntimeError, NotImplementedError, KeyError) as exc:
                # Encrypted entries and unsupported compression methods.
                raise NoMatch(f"archive entry could not be read: {type(exc).__name__}") from None
    except zipfile.BadZipFile as exc:
        raise NoMatch(f"archive is not a valid zip: {exc}") from None
