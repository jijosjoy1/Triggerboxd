"""OTT-release verification.

A TMDB primary release date, or a current provider listing, does *not* establish
an OTT release inside the window. Only a dated Digital (type 4) release in the
region does. Everything else is skipped with a reason so it can be reviewed by a
human instead of silently treated as a premiere.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .tmdb import DIGITAL_RELEASE_TYPE, Movie
from .window import Window

THEATRICAL_TYPES = (2, 3)

REASON_NO_RELEASE_DATES = "no_release_dates"
REASON_REGION_NOT_LISTED = "region_not_listed"
REASON_DIGITAL_OUTSIDE_WINDOW = "digital_release_outside_window"
REASON_THEATRICAL_ONLY = "theatrical_only_in_window"
REASON_PROVIDER_WITHOUT_DATE = "provider_listing_without_dated_digital_release"
REASON_NO_DIGITAL = "no_digital_release_found"


@dataclass(frozen=True)
class Verified:
    movie: Movie
    ott_date: str
    region: str
    platforms: tuple[str, ...]
    platform_verified: bool
    source: str
    notes: tuple[str, ...] = ()

    def as_dict(self) -> dict:
        return {
            "status": "ott_verified",
            "movie": self.movie.as_dict(),
            "ottDate": self.ott_date,
            "territory": self.region,
            "platforms": list(self.platforms),
            "platformVerified": self.platform_verified,
            "source": self.source,
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class Skipped:
    movie: Movie
    reason: str
    detail: str

    def as_dict(self) -> dict:
        return {
            "status": "skipped",
            "movie": self.movie.as_dict(),
            "reason": self.reason,
            "detail": self.detail,
        }


def _safe_day(value: str) -> date | None:
    """TMDB dates are usually ISO, but a malformed one must not abort the run."""
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def _region_release_dates(payload: dict | None, region: str) -> list[dict] | None:
    if not isinstance(payload, dict):
        return None
    results = payload.get("results")
    if not isinstance(results, list):
        return None
    for entry in results:
        if not isinstance(entry, dict):
            continue
        if entry.get("iso_3166_1") == region:
            dates = entry.get("release_dates")
            # Present but not a list is a data problem, not a proven absence.
            return dates if isinstance(dates, list) else None
    return None


def _subscription_platforms(payload: dict | None, region: str) -> tuple[str, ...]:
    results = (payload or {}).get("results")
    if not isinstance(results, dict):
        return ()
    entry = results.get(region)
    if not isinstance(entry, dict):
        return ()
    names: list[str] = []
    flatrate = entry.get("flatrate")
    if not isinstance(flatrate, list):
        return ()
    for item in flatrate:
        if not isinstance(item, dict):
            continue
        name = item.get("provider_name")
        if isinstance(name, str) and name and name not in names:
            names.append(name)
    return tuple(names)


def verify_release(
    movie: Movie,
    release_dates_payload: dict | None,
    providers_payload: dict | None,
    window: Window,
    region: str,
) -> Verified | Skipped:
    """Pure decision function; no network access."""
    dates = _region_release_dates(release_dates_payload, region)
    if dates is None:
        return Skipped(movie, REASON_REGION_NOT_LISTED, f"{region} has no release-date entry")

    def day(entry: dict) -> str | None:
        raw = entry.get("release_date")
        return raw[:10] if isinstance(raw, str) and len(raw) >= 10 else None

    digital = sorted(
        d for d in (day(e) for e in dates if isinstance(e, dict) and e.get("type") == DIGITAL_RELEASE_TYPE)
        if d and _safe_day(d) is not None  # reject impossible dates like 2024-02-00
    )
    in_window = [d for d in digital if window.start.isoformat() <= d <= window.end.isoformat()]
    platforms = _subscription_platforms(providers_payload, region)

    if in_window:
        notes = () if platforms else ("No subscription platform listed for the region; the dated release still verifies the window.",)
        return Verified(
            movie=movie,
            ott_date=in_window[0],
            region=region,
            platforms=platforms,
            platform_verified=bool(platforms),
            source=f"tmdb.release_dates type={DIGITAL_RELEASE_TYPE} region={region}",
            notes=notes,
        )

    if digital:
        return Skipped(movie, REASON_DIGITAL_OUTSIDE_WINDOW, f"dated digital release {digital[0]} is outside {window.label}")

    theatrical = sorted(
        d for d in (day(e) for e in dates if isinstance(e, dict) and e.get("type") in THEATRICAL_TYPES)
        if d and _safe_day(d) and window.contains(_safe_day(d))
    )
    if theatrical:
        return Skipped(movie, REASON_THEATRICAL_ONLY, f"theatrical release {theatrical[0]} only, no digital date")

    if platforms:
        return Skipped(movie, REASON_PROVIDER_WITHOUT_DATE, f"listed on {', '.join(platforms)} with no dated digital release")

    return Skipped(movie, REASON_NO_DIGITAL, "no dated digital release found for the region")
