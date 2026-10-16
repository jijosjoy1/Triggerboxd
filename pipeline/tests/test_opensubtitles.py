import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tbpipe.providers import ProviderError, ProviderUnavailable  # noqa: E402
from tbpipe.providers.opensubtitles import (  # noqa: E402
    Entry, OpenSubtitles, bare_imdb_id, canonical_query,
)

KEY = "TESTKEY_not_real_0000000000000000"
LINK = "https://www.opensubtitles.com/download/ONETIMESECRETTOKEN/sample.srt"


def entry_payload(sub_id="1", file_id=111, language="en", hi=False, trusted=True, mt=False,
                  downloads=500, release="Movie.2022.1080p.WEB-DL", tmdb=579974, fpo=False):
    return {
        "id": sub_id,
        "type": "subtitle",
        "attributes": {
            "language": language,
            "hearing_impaired": hi,
            "from_trusted": trusted,
            "machine_translated": mt,
            "ai_translated": False,
            "foreign_parts_only": fpo,
            "download_count": downloads,
            "release": release,
            "fps": 23.976,
            "feature_details": {"tmdb_id": tmdb, "imdb_id": 8178634, "title": "RRR", "year": 2022, "feature_type": "Movie"},
            "files": [{"file_id": file_id, "file_name": f"{release}.srt", "cd_number": 1}],
        },
    }


class FakeTransport:
    def __init__(self, *, search=None, download=None, login_token="tok_abc", status=200):
        self.search_payload = search if search is not None else {"total_count": 3, "data": [entry_payload()]}
        self.download_payload = download if download is not None else {"link": LINK, "file_name": "sample.srt", "remaining": 4, "requests": 1}
        self.login_token = login_token
        self.status = status
        self.calls: list[tuple[str, str, dict]] = []
        self.fetched: list[str] = []

    def request(self, method, url, *, headers, body=None, timeout=60):
        self.calls.append((method, url, headers))
        if url.endswith("/login"):
            return 200, {}, {"token": self.login_token, "user": {"allowed_downloads": 5, "vip": False}}
        if "/subtitles" in url:
            return self.status, {}, self.search_payload
        if url.endswith("/download"):
            return self.status, {}, self.download_payload
        if url.endswith("/infos/user"):
            return 200, {}, {"data": {"remaining_downloads": 3}}
        return 404, {}, {}

    def get_bytes(self, url, *, timeout=120):
        self.fetched.append(url)
        return b"1\n00:00:01,000 --> 00:00:02,000\nhello\n"


class QueryTests(unittest.TestCase):
    def test_parameters_are_alphabetical_lowercase_and_drop_empties(self):
        query = canonical_query({"tmdb_id": 579974, "languages": "EN", "query": None, "year": 2022, "type": "movie"})
        self.assertEqual(query, "languages=en&tmdb_id=579974&type=movie&year=2022")

    def test_imdb_ids_lose_the_tt_prefix(self):
        self.assertEqual(bare_imdb_id("tt8178634"), "8178634")
        self.assertEqual(bare_imdb_id(8178634), "8178634")
        self.assertIsNone(bare_imdb_id(None))


class HeaderTests(unittest.TestCase):
    def test_every_request_carries_api_key_and_user_agent(self):
        transport = FakeTransport()
        OpenSubtitles(KEY, transport=transport).search(tmdb_id=579974)
        method, url, headers = transport.calls[-1]
        self.assertEqual(method, "GET")
        self.assertEqual(headers["Api-Key"], KEY)
        self.assertTrue(headers["User-Agent"])
        self.assertNotIn("library", headers["User-Agent"].lower())
        self.assertIn("languages=en", url)

    def test_missing_key_is_refused(self):
        with self.assertRaises(ProviderUnavailable):
            OpenSubtitles("")


class LoginTests(unittest.TestCase):
    def test_no_credentials_means_anonymous_downloads(self):
        client = OpenSubtitles(KEY, transport=FakeTransport())
        self.assertFalse(client.credentials)
        self.assertIsNone(client.login())

    def test_token_is_cached_across_downloads(self):
        transport = FakeTransport()
        client = OpenSubtitles(KEY, username="u", password="p", transport=transport, sleep=lambda _s: None)
        client.download(111)
        client.download(222)
        logins = [c for c in transport.calls if c[1].endswith("/login")]
        self.assertEqual(len(logins), 1)

    def test_expired_token_is_refreshed(self):
        transport = FakeTransport()
        now = [datetime(2026, 10, 16, tzinfo=timezone.utc)]
        client = OpenSubtitles(KEY, username="u", password="p", transport=transport,
                               sleep=lambda _s: None, clock=lambda: now[0])
        client.download(111)
        now[0] = now[0] + timedelta(hours=25)
        client.download(222)
        logins = [c for c in transport.calls if c[1].endswith("/login")]
        self.assertEqual(len(logins), 2)

    def test_login_rate_limit_is_respected(self):
        slept: list[float] = []
        client = OpenSubtitles(KEY, username="u", password="p", transport=FakeTransport(), sleep=slept.append)
        client.login()
        self.assertEqual(slept, [1])

    def test_logged_in_download_sends_the_bearer_token(self):
        transport = FakeTransport()
        client = OpenSubtitles(KEY, username="u", password="p", transport=transport, sleep=lambda _s: None)
        client.download(111)
        download_call = [c for c in transport.calls if c[1].endswith("/download")][-1]
        self.assertEqual(download_call[2]["Authorization"], "Bearer tok_abc")

    def test_anonymous_download_sends_no_authorization(self):
        transport = FakeTransport()
        OpenSubtitles(KEY, transport=transport).download(111)
        download_call = [c for c in transport.calls if c[1].endswith("/download")][-1]
        self.assertNotIn("Authorization", download_call[2])


class DownloadTests(unittest.TestCase):
    def test_fetches_the_one_time_link_and_never_returns_it(self):
        transport = FakeTransport()
        result = OpenSubtitles(KEY, transport=transport).download(111)
        self.assertEqual(transport.fetched, [LINK])
        self.assertIn(b"hello", result.content)
        self.assertEqual(result.file_name, "sample.srt")
        self.assertEqual(result.remaining, 4)
        self.assertNotIn("ONETIMESECRETTOKEN", repr(result))

    def test_a_refused_download_reports_the_provider_message(self):
        transport = FakeTransport(download={"message": "You have downloaded your allowed 5 subtitles"})
        with self.assertRaises(ProviderError) as ctx:
            OpenSubtitles(KEY, transport=transport).download(111)
        self.assertIn("download refused by provider", str(ctx.exception))


class SearchAndSelectTests(unittest.TestCase):
    def test_maps_entries_and_verifies_the_feature(self):
        transport = FakeTransport()
        total, entries = OpenSubtitles(KEY, transport=transport).search(tmdb_id=579974)
        self.assertEqual(total, 3)
        self.assertEqual(entries[0].file_id, 111)
        self.assertEqual(entries[0].feature_tmdb_id, 579974)
        self.assertEqual(entries[0].feature_year, 2022)

    def test_prefers_trusted_non_machine_translated_and_popular(self):
        entries = [
            type(OpenSubtitles(KEY, transport=FakeTransport()).search(tmdb_id=1)[1][0]).from_payload(entry_payload("1", downloads=5, trusted=False)),
            type(OpenSubtitles(KEY, transport=FakeTransport()).search(tmdb_id=1)[1][0]).from_payload(entry_payload("2", downloads=900, trusted=True)),
            type(OpenSubtitles(KEY, transport=FakeTransport()).search(tmdb_id=1)[1][0]).from_payload(entry_payload("3", downloads=9999, trusted=False, mt=True)),
        ]
        picked = OpenSubtitles.select(entries, tmdb_id=579974)
        self.assertEqual(picked.entry.subtitle_id, "2")
        self.assertEqual(picked.reason, "trusted_upload")

    def test_flags_a_machine_translated_only_result(self):
        from tbpipe.providers.opensubtitles import Entry

        entries = [Entry.from_payload(entry_payload("1", mt=True, trusted=False))]
        picked = OpenSubtitles.select(entries, tmdb_id=579974)
        self.assertEqual(picked.reason, "machine_translated_only")

    def test_refuses_a_mismatched_feature(self):
        from tbpipe.providers.opensubtitles import Entry

        entries = [Entry.from_payload(entry_payload("1", tmdb=111111))]
        picked = OpenSubtitles.select(entries, tmdb_id=579974)
        self.assertIsNone(picked.entry)
        self.assertEqual(picked.reason, "feature_id_mismatch")

    def test_reports_no_results_and_missing_language(self):
        from tbpipe.providers.opensubtitles import Entry

        self.assertEqual(OpenSubtitles.select([], tmdb_id=1).reason, "no_results")
        picked = OpenSubtitles.select([Entry.from_payload(entry_payload(language="fr"))], tmdb_id=579974, language="en")
        self.assertIsNone(picked.entry)
        self.assertEqual(picked.reason, "no_subtitle_in_language")

    def test_avoids_incomplete_foreign_parts_only_when_a_complete_copy_exists(self):
        from tbpipe.providers.opensubtitles import Entry

        entries = [Entry.from_payload(entry_payload("1", fpo=True, downloads=9999)),
                   Entry.from_payload(entry_payload("2", fpo=False, downloads=1))]
        picked = OpenSubtitles.select(entries, tmdb_id=579974)
        self.assertEqual(picked.entry.subtitle_id, "2")


if __name__ == "__main__":
    unittest.main()

class MalformedShapeTests(unittest.TestCase):
    def test_malformed_attributes_do_not_raise(self):
        for bad in ({"attributes": "nonsense"},
                    {"attributes": {"files": "notalist"}},
                    {"attributes": {"files": ["notadict"]}},
                    "a string",
                    None):
            self.assertIsNone(Entry.from_payload(bad), repr(bad))

    def test_a_non_dict_feature_details_degrades_to_unverifiable(self):
        # Must not raise; it simply cannot be checked against a film id.
        entry = Entry.from_payload({"attributes": {"files": [{"file_id": 1}], "feature_details": "x"}})
        self.assertIsNotNone(entry)
        self.assertIsNone(entry.feature_tmdb_id)

    def test_a_non_list_data_field_yields_no_entries(self):
        from tbpipe.providers.opensubtitles import OpenSubtitles

        class T:
            def request(self, method, url, **kw): return 200, {}, {"data": {"oops": 1}, "total_count": 1}
            def get_bytes(self, url, **kw): return b""

        total, entries = OpenSubtitles(KEY, transport=T()).search(tmdb_id=1)
        self.assertEqual(entries, [])
