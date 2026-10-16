import sys
import unittest
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tbpipe.window import IST, Window, window_for  # noqa: E402


class WindowTests(unittest.TestCase):
    def test_covers_the_seven_complete_days_before_today(self):
        now = datetime(2026, 10, 15, 9, 0, tzinfo=IST)
        window = window_for(now)
        self.assertEqual(window.end, date(2026, 10, 14))
        self.assertEqual(window.start, date(2026, 10, 8))
        self.assertEqual((window.end - window.start).days + 1, 7)

    def test_excludes_the_day_in_progress(self):
        morning = window_for(datetime(2026, 10, 15, 0, 1, tzinfo=IST))
        night = window_for(datetime(2026, 10, 15, 23, 59, tzinfo=IST))
        self.assertEqual(morning.start, night.start)
        self.assertEqual(morning.end, night.end)
        self.assertFalse(morning.contains(date(2026, 10, 15)))

    def test_uses_ist_regardless_of_the_callers_timezone(self):
        utc = ZoneInfo("UTC")
        # 2026-10-15 21:00 UTC is 2026-10-16 02:30 IST, so "yesterday" is the 15th.
        window = window_for(datetime(2026, 10, 15, 21, 0, tzinfo=utc))
        self.assertEqual(window.end, date(2026, 10, 15))
        self.assertEqual(window.start, date(2026, 10, 9))

    def test_contains_is_inclusive(self):
        window = Window(start=date(2026, 10, 8), end=date(2026, 10, 14), generated_at=datetime.now(tz=IST))
        self.assertTrue(window.contains(date(2026, 10, 8)))
        self.assertTrue(window.contains(date(2026, 10, 14)))
        self.assertFalse(window.contains(date(2026, 10, 7)))
        self.assertFalse(window.contains(date(2026, 10, 15)))

    def test_rejects_naive_datetimes_and_bad_day_counts(self):
        with self.assertRaises(ValueError):
            window_for(datetime(2026, 10, 15, 9, 0))
        with self.assertRaises(ValueError):
            window_for(datetime(2026, 10, 15, 9, 0, tzinfo=IST), days=0)

    def test_labels_are_stable(self):
        window = window_for(datetime(2026, 10, 15, 9, 0, tzinfo=IST))
        self.assertEqual(window.label, "2026-10-08..2026-10-14")
        payload = window.as_dict()
        self.assertEqual(payload["timezone"], "Asia/Kolkata")
        self.assertEqual(payload["days"], 7)
        self.assertEqual(payload["startDate"], "2026-10-08")
        self.assertEqual(payload["endDate"], "2026-10-14")


if __name__ == "__main__":
    unittest.main()
