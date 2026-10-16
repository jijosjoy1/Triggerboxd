import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tbpipe.providers import NoMatch, ProviderError, ProviderUnavailable  # noqa: E402
from tbpipe.providers.subdl import Candidate, Subdl, extract_subtitle, strip_credentials  # noqa: E402

KEY = "subdl_TESTKEY_not_real_000000000000000000000000"


def payload(*, tmdb=579974, subtitles=None, results=None, status=True, error=None):
    return {
        "status": status,
        "error": error,
        "results": results if results is not None else [
            {"tmdb_id": tmdb, "imdb_id": "tt8178634", "name": "RRR", "year": 2022, "sd_id": 1, "type": "movie"}
        ],
        "subtitles": subtitles if subtitles is not None else [
            {"name": "RRR.2022.CAM.x264.zip", "release_name": "RRR.2022.CAM", "language": "EN", "hi": False,
             "fps": None, "url": f"/subtitle/111-222.zip?api_key={KEY}"},
            {"name": "RRR.2022.1080p.WEB-DL.zip", "release_name": "RRR.2022.1080p.WEB-DL", "language": "EN", "hi": False,
             "fps": "23.976", "url": f"/subtitle/333-444.zip?api_key={KEY}"},
            {"name": "RRR.2022.WEB-DL.HI.zip", "release_name": "RRR.2022.WEB-DL", "language": "EN", "hi": True,
             "fps": None, "url": f"/subtitle/555-666.zip?api_key={KEY}"},
        ],
    }


class FakeTransport:
    def __init__(self, body=None, raw=b""):
        self.body = body if body is not None else payload()
        self.raw = raw
        self.json_calls: list[str] = []
        self.byte_calls: list[str] = []

    def get_json(self, url, timeout=60):
        self.json_calls.append(url)
        return self.body

    def get_bytes(self, url, timeout=120):
        self.byte_calls.append(url)
        return self.raw


def zipped(name: str, content: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as bundle:
        bundle.writestr(name, content)
    return buffer.getvalue()


class CredentialTests(unittest.TestCase):
    def test_strips_a_key_from_the_returned_download_url(self):
        self.assertEqual(strip_credentials(f"/subtitle/1-2.zip?api_key={KEY}"), "/subtitle/1-2.zip")
        self.assertEqual(strip_credentials(f"https://dl.subdl.com/subtitle/1-2.zip?api_key={KEY}"), "/subtitle/1-2.zip")

    def test_candidates_never_carry_the_key(self):
        client = Subdl(KEY, transport=FakeTransport())
        _, candidates = client.search(tmdb_id=579974)
        dumped = str([c.as_dict() for c in candidates])
        self.assertNotIn(KEY, dumped)
        self.assertNotIn("api_key", dumped)
        self.assertEqual(candidates[0].download_path, "/subtitle/111-222.zip")
        self.assertEqual(candidates[0].download_url, "https://dl.subdl.com/subtitle/111-222.zip")

    def test_search_requires_an_identifier(self):
        with self.assertRaises(ProviderError):
            Subdl(KEY, transport=FakeTransport()).search()

    def test_search_does_not_send_the_hi_filter(self):
        # Observed against the live API: hi=1 filters the result set down to
        # hearing-impaired uploads (23 results to 0) instead of adding a flag,
        # so it must never be sent.
        transport = FakeTransport()
        Subdl(KEY, transport=transport).search(tmdb_id=579974)
        self.assertEqual(len(transport.json_calls), 1)
        url = transport.json_calls[0]
        self.assertIn("tmdb_id=579974", url)
        self.assertIn("languages=EN", url)
        self.assertNotIn("&hi=", url)

    def test_missing_key_is_refused(self):
        with self.assertRaises(ProviderUnavailable):
            Subdl("")


class SearchTests(unittest.TestCase):
    def test_maps_a_successful_response(self):
        movies, candidates = Subdl(KEY, transport=FakeTransport()).search(tmdb_id=579974)
        self.assertEqual(movies[0].tmdb_id, 579974)
        self.assertEqual(movies[0].year, 2022)
        self.assertEqual(len(candidates), 3)
        self.assertTrue(candidates[1].preferred_source)
        self.assertFalse(candidates[0].preferred_source)

    def test_an_ordinary_miss_is_not_an_error(self):
        body = {"status": False, "error": "can't find movie or tv"}
        movies, candidates = Subdl(KEY, transport=FakeTransport(body)).search(tmdb_id=1)
        self.assertEqual((movies, candidates), ([], []))


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.client = Subdl(KEY, transport=FakeTransport())
        self.movies, self.candidates = self.client.search(tmdb_id=579974)

    def test_prefers_a_digital_release_and_avoids_cam_and_hi(self):
        picked = self.client.select(movies=self.movies, candidates=self.candidates, tmdb_id=579974)
        self.assertIsNotNone(picked.candidate)
        self.assertEqual(picked.candidate.subtitle_id, "333-444")
        self.assertEqual(picked.reason, "preferred_source")

    def test_reports_a_missing_movie_result(self):
        picked = self.client.select(movies=[], candidates=[], tmdb_id=579974)
        self.assertIsNone(picked.candidate)
        self.assertEqual(picked.reason, "no_movie_result")

    def test_refuses_a_mismatched_movie_id(self):
        picked = self.client.select(movies=self.movies, candidates=self.candidates, tmdb_id=999999)
        self.assertIsNone(picked.candidate)
        self.assertEqual(picked.reason, "movie_id_mismatch")

    def test_refuses_ambiguous_multiple_titles(self):
        movies = [self.movies[0], self.movies[0].__class__(123, None, "Other", 2001, 2)]
        picked = self.client.select(movies=movies, candidates=self.candidates, tmdb_id=579974)
        self.assertIsNone(picked.candidate)
        self.assertEqual(picked.reason, "ambiguous_movie_results")

    def test_reports_when_the_language_is_missing(self):
        picked = self.client.select(movies=self.movies, candidates=self.candidates, tmdb_id=579974, language="ML")
        self.assertIsNone(picked.candidate)
        self.assertEqual(picked.reason, "no_subtitle_in_language")

    def test_can_opt_into_hearing_impaired_copies(self):
        only_hi = [Candidate("9", "EN", "X.WEB-DL", "x.zip", True, None, "/subtitle/9.zip", True)]
        picked = self.client.select(movies=self.movies, candidates=only_hi, tmdb_id=579974)
        self.assertIsNotNone(picked.candidate)
        self.assertTrue(picked.candidate.hearing_impaired)


class ExtractionTests(unittest.TestCase):
    def test_reads_an_srt_from_a_zip(self):
        archive = zipped("movie.srt", b"1\n00:00:01,000 --> 00:00:02,000\nhello\n")
        name, content = extract_subtitle(archive)
        self.assertEqual(name, "movie.srt")
        self.assertIn(b"hello", content)

    def test_prefers_srt_over_other_formats(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as bundle:
            bundle.writestr("movie.ass", b"[Script Info]")
            bundle.writestr("movie.srt", b"1\n00:00:01,000 --> 00:00:02,000\nhello\n")
        name, _ = extract_subtitle(buffer.getvalue())
        self.assertEqual(name, "movie.srt")

    def test_passes_through_a_bare_subtitle_file(self):
        name, content = extract_subtitle(b"1\n00:00:01,000 --> 00:00:02,000\nhello\n")
        self.assertIn(b"hello", content)

    def test_rejects_an_archive_without_a_subtitle(self):
        with self.assertRaises(NoMatch):
            extract_subtitle(zipped("readme.txt", b"nothing here"))

    def test_rejects_a_corrupt_archive(self):
        with self.assertRaises(NoMatch):
            extract_subtitle(b"PK\x03\x04 this is not a real zip")

    def test_download_never_uses_the_key(self):
        transport = FakeTransport(raw=b"1\n00:00:01,000 --> 00:00:02,000\nhello\n")
        client = Subdl(KEY, transport=transport)
        _, candidates = client.search(tmdb_id=579974)
        client.download(candidates[0])
        # The search request must authenticate, so it carries the key to the API
        # host only. The download must not carry it anywhere.
        self.assertTrue(all(url.startswith("https://api.subdl.com/") for url in transport.json_calls))
        self.assertEqual(transport.byte_calls, ["https://dl.subdl.com/subtitle/111-222.zip"])
        for url in transport.byte_calls:
            self.assertNotIn(KEY, url)
            self.assertNotIn("api_key", url)


if __name__ == "__main__":
    unittest.main()
