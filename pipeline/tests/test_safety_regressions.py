import io
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from tbpipe.discover import Skipped, verify_release
from tbpipe.model import ModelClient, ModelError, ModelUnavailable, resolve_model_path
from tbpipe.providers import ProviderError
from tbpipe.providers.opensubtitles import OpenSubtitles
from tbpipe.providers.subdl import Subdl, extract_subtitle
from tbpipe.redact import redact
from tbpipe.store import Store
from tbpipe.subtitles import Cue
from tbpipe.tmdb import Movie
from tbpipe.window import window_for
from tbpipe.subtitles import SubtitleError, load_subtitle
from run_local import load_index
from run_fetch import parse_args as fetch_args, targets as fetch_targets


class SafetyRegressions(unittest.TestCase):
    def test_premium_override_does_not_enable_classification(self):
        with patch.dict(os.environ, {"TB_ALLOW_PREMIUM_MODEL": "1"}):
            with self.assertRaises(ModelError):
                resolve_model_path("premium-model")
            with self.assertRaises(ModelError):
                resolve_model_path("other-provider/deepseek-v4.1-flash")

    def test_redact_json_credentials_and_signed_link(self):
        value = '{"token":"SYNTHETIC_LOGIN_TOKEN_123","password":"SYNTHETIC_PASSWORD_123","link":"https://example.invalid/download/SYNTHETIC_SIGNED_PATH_123"}'
        output = redact(value)
        for secret in ("SYNTHETIC_LOGIN_TOKEN_123", "SYNTHETIC_PASSWORD_123", "SYNTHETIC_SIGNED_PATH_123"):
            self.assertNotIn(secret, output)

    def test_opensubtitles_zero_remaining_prevents_next_download(self):
        class Transport:
            calls = 0
            def request(self, *_args, **_kwargs):
                self.calls += 1
                return 200, {}, {"link": "https://example.invalid/file", "remaining": 0, "requests": 5}
            def get_bytes(self, *_args, **_kwargs):
                return b"sample"
        transport = Transport()
        client = OpenSubtitles("test", transport=transport)
        self.assertEqual(client.download(1).remaining, 0)
        with self.assertRaises(ProviderError):
            client.download(2)
        self.assertEqual(transport.calls, 1)

    def test_subdl_malformed_entries_fail_as_provider_error(self):
        with self.assertRaises(ProviderError):
            Subdl._candidates(1)

    def test_zip_expansion_is_bounded(self):
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("large.srt", b"A" * 2_000_000)
        with self.assertRaises(ProviderError):
            extract_subtitle(archive.getvalue())

    def test_local_subtitle_size_is_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "large.srt"
            path.write_bytes(b"1\n00:00:01,000 --> 00:00:02,000\n" + b"A" * 1_000_001)
            with self.assertRaises(SubtitleError):
                load_subtitle(path)

    def test_malformed_index_has_controlled_error(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "index.json"
            path.write_text("{bad", encoding="utf-8")
            with self.assertRaises(SystemExit):
                load_index(str(path))

    def test_fetch_skips_malformed_index_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "index.json"
            path.write_text('{"verified": [null, 7, {"movie": null}]}', encoding="utf-8")
            self.assertEqual(fetch_targets(fetch_args(["--index", str(path)])), [])

    def test_subdl_malformed_movie_results_fail_as_provider_error(self):
        class Transport:
            def get_json(self, *_args):
                return {"status": True, "results": 7, "subtitles": []}
        with self.assertRaises(ProviderError):
            Subdl("test", transport=Transport()).search(tmdb_id=1)

    def test_provider_refusal_never_echoes_arbitrary_token_text(self):
        marker = "SYNTHETIC_SECRET_VALUE_123"
        class Transport:
            def request(self, *_args, **_kwargs):
                return 200, {}, {"message": f"refused authorization {marker}"}
        with self.assertRaises(ProviderError) as error:
            OpenSubtitles("test", transport=Transport()).download(1)
        self.assertNotIn(marker, str(error.exception))

    def test_null_release_date_row_is_skipped(self):
        movie = Movie(1, "Example", "Example", None, "en", 0)
        outcome = verify_release(movie, {"results": [{"iso_3166_1": "IN", "release_dates": [None]}]}, {}, window_for(), "IN")
        self.assertIsInstance(outcome, Skipped)

    def test_atomic_quota_reservation_refuses_ceiling(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state.sqlite"
            one, two = Store(path), Store(path)
            try:
                args = {"scope": "provider", "subject": "subdl", "action": "download"}
                self.assertTrue(one.quota_reserve(**args, amount=1, ceiling=1))
                self.assertFalse(two.quota_reserve(**args, amount=1, ceiling=1))
                self.assertEqual(two.quota_used(**args), 1)
            finally:
                one.close(); two.close()

    def test_model_failed_reply_still_reports_usage(self):
        observations = []
        class Transport:
            def message(self, *_args, **_kwargs):
                return {"usage": {"input_tokens": 100, "output_tokens": 20}, "content": [{"type": "text", "text": "invalid"}]}
        client = ModelClient(transport=Transport(), usage_callback=lambda used: observations.append(used))
        with self.assertRaises(ModelError):
            client.classify([Cue(0, "1", 0, 100, "hello")], ("language",))
        self.assertEqual(sum(observations), 120)

    def test_model_rejects_call_without_full_budget_reservation(self):
        class Transport:
            calls = 0
            def message(self, *_args, **_kwargs):
                self.calls += 1
                return {"usage": {"input_tokens": 150, "output_tokens": 2000}, "content": []}
        transport = Transport()
        result = ModelClient(transport=transport, token_budget=2100).classify([Cue(0, "1", 0, 100, "hello")], ("language",))
        self.assertEqual(transport.calls, 0)
        self.assertEqual(result.stopped, "token_budget_reached")

    def test_unknown_usage_stops_following_chunks(self):
        class Transport:
            calls = 0
            def message(self, *_args, **_kwargs):
                self.calls += 1
                return {"content": [{"type": "text", "text": '{"findings": []}'}]}
        transport = Transport()
        cues = [Cue(i, str(i), i * 1000, i * 1000 + 500, "hello") for i in range(50)]
        result = ModelClient(transport=transport).classify(cues, ("language",))
        self.assertEqual(transport.calls, 1)
        self.assertEqual(result.stopped, "usage_unavailable")


if __name__ == "__main__":
    unittest.main()
