import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tbpipe.redact import redact  # noqa: E402


class RedactTests(unittest.TestCase):
    def test_query_api_keys_are_removed(self):
        self.assertEqual(redact("GET /subtitles?api_key=abc123&tmdb_id=1"), "GET /subtitles?api_key=[redacted]&tmdb_id=1")
        self.assertEqual(redact("...api_key=subdl_u5hO-278Emf&x=1"), "...api_key=[redacted]&x=1")

    def test_the_router_caller_secret_in_a_path_is_removed(self):
        text = redact('{"message":"Error: http://127.0.0.1:4202/_codex-router/abcDEF123/not found"}')
        self.assertNotIn("abcDEF123", text)
        self.assertIn("_codex-router/[redacted]", text)

    def test_bearer_tokens_are_removed(self):
        self.assertEqual(redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig"),
                         "Authorization: Bearer [redacted]")

    def test_long_opaque_tokens_are_removed(self):
        token = "A" * 80
        self.assertNotIn(token, redact(f"link https://example.test/download/{token}/file.srt"))

    def test_api_key_headers_are_removed(self):
        self.assertNotIn("BHw6tzYx", redact("X-API-Key: BHw6tzYxMXDih"))

    def test_output_is_bounded_and_single_line(self):
        result = redact("line one\n\nline two " + "x" * 500, limit=60)
        self.assertLessEqual(len(result), 60)
        self.assertNotIn("\n", result)

    def test_the_original_keeps_flowing_text(self):
        self.assertEqual(redact("plain message"), "plain message")

    def test_non_strings_are_handled(self):
        self.assertEqual(redact(None), "None")


class ProviderMessageTests(unittest.TestCase):
    def test_router_error_detail_is_redacted_before_it_reaches_a_message(self):
        # Guards the exact defect an independent review flagged: the router echoes
        # the request URL, whose path carries the caller secret.
        secret_url = "http://127.0.0.1:4202/_codex-router/SuperSecretValue/anthropic/v1/messages"
        message = redact(f"model route HTTP 500: {secret_url} failed")
        self.assertNotIn("SuperSecretValue", message)


if __name__ == "__main__":
    unittest.main()

class HeaderRedactionTests(unittest.TestCase):
    def test_api_key_headers_are_redacted_in_any_casing(self):
        for line in ("Api-Key: BHw6tzYxMXDih", "api-key=subdl_123", "API_KEY: xyz", "X-Api-Key: abc123"):
            self.assertNotIn("xyz", redact(line)) if "xyz" in line else None
        self.assertNotIn("BHw6tzYxMXDih", redact("Api-Key: BHw6tzYxMXDih"))
        self.assertNotIn("subdl_123", redact("api-key=subdl_123"))
        self.assertNotIn("abc123", redact("x-api-key: abc123"))

class GenericParameterRedactionTests(unittest.TestCase):
    def test_secret_bearing_query_parameters_are_redacted(self):
        for raw, secret in (("?token=abc123def", "abc123def"),
                            ("?secret=hunter2", "hunter2"),
                            ("&password=pw123", "pw123"),
                            ("?link=https://x.test/download/9F8E", "9F8E")):
            cleaned = redact(f"request failed for {raw} (500)")
            self.assertNotIn(secret, cleaned, raw)
            self.assertIn("[redacted]", cleaned)
