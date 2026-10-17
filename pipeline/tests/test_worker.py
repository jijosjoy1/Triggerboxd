import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tbpipe.worker import Client, JobError, compact_result, fetch_subtitle, prune_cache, run_once
from tbpipe.rules import Lexicon
from tbpipe.store import Store
from tbpipe.subtitles import load_subtitle

JOB = {"id": "job-1", "movieId": "movie-1", "tmdbId": 123, "title": "Movie", "leaseToken": "lease-secret"}
SUBTITLE = "1\n00:00:01,000 --> 00:00:02,000\nWhat the hell?\n\n"


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.client = Mock()
        self.client.call.side_effect = [{"data": JOB}, {"data": {"ok": True}}]

    def tearDown(self):
        self.tmp.cleanup()

    def cached(self):
        folder = self.root / "subs"
        folder.mkdir()
        path = folder / "123.en.local.srt"
        path.write_text(SUBTITLE, encoding="utf-8")
        return path

    def test_cache_avoids_provider_and_sends_only_compact_result(self):
        self.cached()
        with patch("tbpipe.worker.fetch_subtitle") as fetch:
            self.assertEqual(run_once(self.client, root=self.root), "completed")
        fetch.assert_not_called()
        payload = self.client.call.call_args_list[1].args[0]
        self.assertEqual(payload["action"], "complete")
        result = payload["result"]
        self.assertEqual(set(result), {"rating", "verdict", "factors", "rulesVersion", "scorerVersion",
                                      "subtitleLanguage", "subtitleHash", "cueCount"})
        self.assertNotIn("hell", json.dumps(result))
        self.assertEqual(len(result["subtitleHash"]), 64)
        self.assertEqual(result["subtitleLanguage"], "EN")

    def test_idle_does_not_fetch(self):
        self.client.call.side_effect = [{"data": None}]
        self.assertEqual(run_once(self.client, root=self.root), "idle")

    def test_busy_does_not_claim(self):
        lock = sqlite3.connect(self.root / "worker-lock.sqlite")
        lock.execute("BEGIN IMMEDIATE")
        try:
            self.assertEqual(run_once(self.client, root=self.root), "busy")
            self.client.call.assert_not_called()
        finally:
            lock.close()

    def test_error_details_are_never_sent(self):
        with patch("tbpipe.worker.fetch_subtitle", side_effect=RuntimeError("https://secret?api_key=bad")):
            self.assertEqual(run_once(self.client, root=self.root), "failed")
        payload = self.client.call.call_args_list[1].args[0]
        self.assertEqual(payload["reason"], "analysis_failed")
        self.assertNotIn("api_key", json.dumps(payload))

    def test_quota_failure_is_distinct(self):
        with patch("tbpipe.worker.fetch_subtitle", side_effect=JobError("quota_exhausted")):
            run_once(self.client, root=self.root)
        self.assertEqual(self.client.call.call_args_list[1].args[0]["reason"], "quota_exhausted")

    def test_uncertain_completion_is_not_reported_as_failure(self):
        self.cached()
        self.client.call.side_effect = [{"data": JOB}, JobError("service unavailable")]
        with self.assertRaises(JobError):
            run_once(self.client, root=self.root)
        self.assertEqual(self.client.call.call_count, 2)

    def test_invalid_job_does_not_fetch(self):
        self.client.call.side_effect = [{"data": {**JOB, "tmdbId": "123; command"}}]
        with patch("tbpipe.worker.fetch_subtitle") as fetch, self.assertRaises(JobError):
            run_once(self.client, root=self.root)
        fetch.assert_not_called()

    def test_unrated_is_preserved(self):
        path = self.cached()
        path.write_text(SUBTITLE.replace("What the hell?", "Good morning."), encoding="utf-8")
        result = compact_result(load_subtitle(path), Lexicon.load())
        self.assertIsNone(result["rating"])
        self.assertIsNone(result["verdict"])

    def test_no_search_when_download_quota_exhausted(self):
        store = Store(self.root / "state.sqlite")
        try:
            store.quota_reserve(scope="provider", subject="subdl", action="download", amount=250, ceiling=250)
            with patch("tbpipe.worker.config.load_secrets", return_value={"SUBDL_API_KEY": "secret"}), \
                    patch("tbpipe.worker.Subdl") as provider, self.assertRaisesRegex(JobError, "quota_exhausted"):
                fetch_subtitle(123, "subdl", self.root / "cache", store)
            provider.return_value.search.assert_not_called()
        finally:
            store.close()

    def test_bad_cached_file_does_not_block_fetch(self):
        path = self.cached()
        path.write_text("invalid subtitle", encoding="utf-8")
        with patch("tbpipe.worker.fetch_subtitle", side_effect=JobError("subtitle_unavailable")) as fetch:
            self.assertEqual(run_once(self.client, root=self.root), "failed")
        fetch.assert_called_once()

    def test_provider_success_reserves_both_budgets_and_caches(self):
        store = Store(self.root / "state.sqlite")
        provider = Mock()
        provider.search.return_value = ([], [])
        provider.select.return_value.candidate = Mock()
        provider.download.return_value = b"archive"
        try:
            with patch("tbpipe.worker.config.load_secrets", return_value={"SUBDL_API_KEY": "secret"}), \
                    patch("tbpipe.worker.Subdl", return_value=provider), \
                    patch("tbpipe.worker.extract_subtitle", return_value=("../../escape.srt", SUBTITLE.encode())):
                subtitle = fetch_subtitle(123, "subdl", self.root / "cache", store)
            self.assertEqual(subtitle.path.parent, self.root / "cache")
            self.assertEqual(subtitle.declared_tmdb_id, 123)
            for action in ("search", "download"):
                self.assertEqual(store.quota_used(scope="provider", subject="subdl", action=action), 1)
        finally:
            store.close()

    def test_failed_search_still_spends_reserved_allowance(self):
        from tbpipe.providers import ProviderError
        store = Store(self.root / "state.sqlite")
        provider = Mock()
        provider.search.side_effect = ProviderError("credential-bearing detail")
        try:
            with patch("tbpipe.worker.config.load_secrets", return_value={"SUBDL_API_KEY": "secret"}), \
                    patch("tbpipe.worker.Subdl", return_value=provider), \
                    self.assertRaisesRegex(JobError, "^provider_error$"):
                fetch_subtitle(123, "subdl", self.root / "cache", store)
            self.assertEqual(store.quota_used(scope="provider", subject="subdl", action="search"), 1)
            self.assertEqual(store.quota_used(scope="provider", subject="subdl", action="download"), 0)
        finally:
            store.close()

    def test_scorer_version_is_separate_from_vocabulary_version(self):
        subtitle = load_subtitle(self.cached())
        lexicon = Lexicon.load()
        result = compact_result(subtitle, lexicon)
        self.assertEqual(result["scorerVersion"], "family-dialogue-1")
        self.assertEqual(result["rulesVersion"], lexicon.version)
        from tbpipe import classify
        self.assertEqual(classify.analyze(subtitle, lexicon)["familyAwkwardnessEstimate"]["scoreVersion"],
                         result["scorerVersion"])

    def test_prune_only_cache_and_keeps_seven_days(self):
        self.cached()
        cache = self.root / "worker-cache"
        cache.mkdir()
        stale = cache / "123.en.local.srt"
        stale.write_text(SUBTITLE, encoding="utf-8")
        prune_cache(cache, now=stale.stat().st_mtime + 8 * 86400)
        self.assertFalse(stale.exists())
        self.assertTrue((self.root / "subs" / "123.en.local.srt").exists())


class ClientTests(unittest.TestCase):
    def test_origins(self):
        for origin in ("http://example.com", "https://host/path", "https://user:pass@host", "https://host?token=x"):
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                Client(origin, "secret")
        Client("https://triggerboxd.com", "s" * 32)
        Client("http://127.0.0.1:8787", "s" * 32)

    def test_api_path_has_trailing_slash_to_avoid_next_redirect(self):
        client = Client("https://triggerboxd.com/", "s" * 32)
        self.assertEqual(client.url, "https://triggerboxd.com/api/internal/subtitle-jobs/")

    def test_token_matches_server_minimum(self):
        with self.assertRaises(ValueError):
            Client("https://triggerboxd.com", "s" * 31)

    def test_transport_errors_do_not_leak_body(self):
        client = Client("https://triggerboxd.com", "s" * 32)
        client.opener = Mock()
        client.opener.open.side_effect = RuntimeError("secret response body")
        with self.assertRaisesRegex(JobError, "^job_service_unavailable$"):
            client.call({"action": "claim"})

    def test_redirects_are_disabled(self):
        from tbpipe.worker import NoRedirect
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, "", {}, "https://other"))

    def test_request_sends_a_descriptive_user_agent(self):
        # Cloudflare terminates Python's default User-Agent with HTTP 403
        # "error code: 1010" (banned browser signature), which made every poll
        # fail as service_error until the worker identified itself.
        from tbpipe.worker import USER_AGENT
        client = Client("https://triggerboxd.com", "s" * 32)
        captured = {}

        class Capture:
            def open(self, req, timeout=None):
                captured["ua"] = req.get_header("User-agent")
                captured["auth"] = req.get_header("Authorization")
                raise RuntimeError("stop here")

        client.opener = Capture()
        with self.assertRaises(JobError):
            client.call({"action": "claim"})
        self.assertEqual(captured["ua"], USER_AGENT)
        self.assertNotIn("urllib", (captured["ua"] or "").lower())
        self.assertTrue(captured["auth"].startswith("Bearer "))


if __name__ == "__main__":
    unittest.main()
