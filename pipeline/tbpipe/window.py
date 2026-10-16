"""Rolling previous-7-days window, computed in Asia/Kolkata.

The window ends *yesterday* and excludes the day in progress, so a run at 09:00
and the same run at 23:00 cover an identical range. Exact dates are recorded in
every run so a report can always be tied to the period it describes.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")
WINDOW_DAYS = 7


@dataclass(frozen=True)
class Window:
    start: date
    end: date
    generated_at: datetime
    timezone: str = "Asia/Kolkata"

    @property
    def label(self) -> str:
        return f"{self.start.isoformat()}..{self.end.isoformat()}"

    def contains(self, day: date) -> bool:
        return self.start <= day <= self.end

    def as_dict(self) -> dict:
        return {
            "timezone": self.timezone,
            "startDate": self.start.isoformat(),
            "endDate": self.end.isoformat(),
            "generatedAt": self.generated_at.isoformat(),
            "days": (self.end - self.start).days + 1,
        }


def window_for(now: datetime | None = None, days: int = WINDOW_DAYS) -> Window:
    """Return the previous `days` complete days in IST."""
    if days < 1:
        raise ValueError("days must be >= 1")
    moment = now if now is not None else datetime.now(tz=IST)
    if moment.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    local = moment.astimezone(IST)
    end = local.date() - timedelta(days=1)
    start = end - timedelta(days=days - 1)
    return Window(start=start, end=end, generated_at=local)


def parse_iso_day(value: str) -> date:
    return date.fromisoformat(value)
