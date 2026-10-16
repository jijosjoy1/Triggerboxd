import sys
import unittest
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tbpipe import discover  # noqa: E402
from tbpipe.tmdb import Movie  # noqa: E402
from tbpipe.window import IST, Window  # noqa: E402

WINDOW = Window(start=date(2026, 10, 8), end=date(2026, 10, 14), generated_at=datetime(2026, 10, 15, 9, tzinfo=IST))
MOVIE = Movie(tmdb_id=1, title="Fixture", original_title="Fixture", release_date="2026-10-10",
              original_language="ml", popularity=1.0)


def release_dates(*entries, region="IN"):
    return {"results": [{"iso_3166_1": region, "release_dates": list(entries)}]}


def digital(day, region_note="IN"):
    return {"type": 4, "release_date": f"{day}T00:00:00.000Z", "note": region_note}


def theatrical(day):
    return {"type": 3, "release_date": f"{day}T00:00:00.000Z"}


def providers(*names, region="IN"):
    return {"results": {region: {"flatrate": [{"provider_name": n} for n in names]}}} if names else {"results": {}}


class VerifyReleaseTests(unittest.TestCase):
    def test_dated_digital_release_in_window_is_verified(self):
        outcome = discover.verify_release(MOVIE, release_dates(digital("2026-10-10")), providers("JioHotstar"), WINDOW, "IN")
        self.assertIsInstance(outcome, discover.Verified)
        self.assertEqual(outcome.ott_date, "2026-10-10")
        self.assertEqual(outcome.platforms, ("JioHotstar",))
        self.assertTrue(outcome.platform_verified)
        self.assertIn("type=4", outcome.source)

    def test_dated_release_without_a_platform_is_verified_but_flagged(self):
        outcome = discover.verify_release(MOVIE, release_dates(digital("2026-10-10")), providers(), WINDOW, "IN")
        self.assertIsInstance(outcome, discover.Verified)
        self.assertFalse(outcome.platform_verified)
        self.assertTrue(outcome.notes)

    def test_current_provider_listing_alone_is_not_a_premiere(self):
        outcome = discover.verify_release(MOVIE, release_dates(theatrical("2026-09-01")), providers("Netflix"), WINDOW, "IN")
        self.assertIsInstance(outcome, discover.Skipped)
        self.assertEqual(outcome.reason, discover.REASON_PROVIDER_WITHOUT_DATE)

    def test_primary_release_date_alone_does_not_verify_the_window(self):
        # Only a primary/t theatrical date exists, so nothing is verified.
        outcome = discover.verify_release(MOVIE, release_dates(theatrical("2026-10-09")), providers(), WINDOW, "IN")
        self.assertIsInstance(outcome, discover.Skipped)
        self.assertEqual(outcome.reason, discover.REASON_THEATRICAL_ONLY)

    def test_digital_release_outside_the_window_is_skipped(self):
        outcome = discover.verify_release(MOVIE, release_dates(digital("2026-09-30")), providers("Prime Video"), WINDOW, "IN")
        self.assertIsInstance(outcome, discover.Skipped)
        self.assertEqual(outcome.reason, discover.REASON_DIGITAL_OUTSIDE_WINDOW)

    def test_missing_region_is_reported_rather_than_assumed(self):
        outcome = discover.verify_release(MOVIE, release_dates(digital("2026-10-10"), region="US"), providers(), WINDOW, "IN")
        self.assertIsInstance(outcome, discover.Skipped)
        self.assertEqual(outcome.reason, discover.REASON_REGION_NOT_LISTED)

    def test_no_digital_entry_at_all_is_reported(self):
        outcome = discover.verify_release(MOVIE, release_dates(), providers(), WINDOW, "IN")
        self.assertIsInstance(outcome, discover.Skipped)
        self.assertEqual(outcome.reason, discover.REASON_NO_DIGITAL)

    def test_malformed_payloads_fail_closed(self):
        for payload in (None, {}, {"results": "nonsense"}, {"results": [{"iso_3166_1": "IN"}]}):
            outcome = discover.verify_release(MOVIE, payload, None, WINDOW, "IN")
            self.assertIsInstance(outcome, discover.Skipped)

    def test_window_boundaries_are_inclusive(self):
        for day in ("2026-10-08", "2026-10-14"):
            outcome = discover.verify_release(MOVIE, release_dates(digital(day)), providers("JioHotstar"), WINDOW, "IN")
            self.assertIsInstance(outcome, discover.Verified, day)

    def test_earliest_dated_digital_release_wins(self):
        outcome = discover.verify_release(
            MOVIE, release_dates(digital("2026-10-12"), digital("2026-10-09")), providers("JioHotstar"), WINDOW, "IN"
        )
        self.assertIsInstance(outcome, discover.Verified)
        self.assertEqual(outcome.ott_date, "2026-10-09")


class CategorySlugTests(unittest.TestCase):
    def test_draft_categories_are_the_triggerboxd_identifiers(self):
        from tbpipe import report

        self.assertEqual(len(report.CATEGORY_SLUGS), 13)
        for slug in ("nudity", "sexual_violence", "gore_graphic_violence", "horror", "graphic_violence"):
            self.assertIn(slug, report.CATEGORY_SLUGS)

    def test_a_fresh_draft_asserts_no_severity(self):
        from tbpipe import report

        draft = report.draft_skeleton(window=WINDOW.as_dict(), region="IN")
        self.assertEqual(draft["reviewStatus"], "draft_pending_human")
        self.assertEqual(draft["publication"], "none")
        self.assertTrue(all(c["severity"] is None for c in draft["categories"]))
        self.assertTrue(all(c["state"] == "unknown" for c in draft["categories"]))
        self.assertTrue(all(c["evidence"] == [] for c in draft["categories"]))


if __name__ == "__main__":
    unittest.main()

class InvalidDigitalDateTests(unittest.TestCase):
    def test_an_impossible_digital_date_is_not_verified(self):
        from tbpipe.discover import REASON_NO_DIGITAL, Skipped, verify_release

        payload = {"results": [{"iso_3166_1": "IN", "release_dates": [
            {"type": 4, "release_date": "2024-02-00T00:00:00.000Z"}]}]}
        outcome = verify_release(MOVIE, payload, {"results": {}}, WINDOW, "IN")
        self.assertIsInstance(outcome, Skipped)
        self.assertEqual(outcome.reason, REASON_NO_DIGITAL)
