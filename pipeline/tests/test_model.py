import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tbpipe.model import (  # noqa: E402
    FREE_MODELS, ModelClient, ModelError, chunk_cues, parse_findings, render_chunk,
)
from tbpipe.subtitles import Cue  # noqa: E402


def cue(index, text="he aimed the gun at her"):
    return Cue(index=index, cue_id=str(index + 1), start_ms=index * 1000, end_ms=index * 1000 + 900, text=text)


def reply(findings, text=None):
    """Anthropic-shaped reply. Defaults to encoding `findings` as the JSON body."""
    body = text if text is not None else json.dumps({"findings": findings})
    return {"content": [{"type": "text", "text": body}], "usage": {"input_tokens": 100, "output_tokens": 20}}


class FakeTransport:
    def __init__(self, payloads=None, secret="s3cr3t"):
        self.payloads = payloads or [reply([{"category": "physical_violence", "cueId": "1", "quote": "gun"}])]
        self.calls: list[tuple[str, str]] = []
        self._secret = secret

    def secret(self):
        return self._secret

    def message(self, model, prompt, *, max_tokens=1200, timeout=120):
        self.calls.append((model, prompt))
        return self.payloads[min(len(self.calls) - 1, len(self.payloads) - 1)]


class AllowlistTests(unittest.TestCase):
    def test_only_included_models_are_callable(self):
        for model in FREE_MODELS:
            self.assertEqual(ModelClient(model=model, transport=FakeTransport()).model, model)

    def test_a_paid_or_unknown_model_is_refused(self):
        for model in ("gpt-6.1-sol", "claude-opus-5", "deepseek-v4-pro", ""):
            with self.assertRaises(ModelError):
                ModelClient(model=model, transport=FakeTransport())

    def test_default_model_is_on_the_allowlist(self):
        self.assertIn(ModelClient(transport=FakeTransport()).model, FREE_MODELS)


class ChunkTests(unittest.TestCase):
    def test_windows_overlap_and_preserve_order(self):
        cues = [cue(i) for i in range(10)]
        windows = chunk_cues(cues, size=4, overlap=2)
        self.assertEqual([len(w) for w in windows], [4, 4, 4, 4])
        # Adjacent windows share exactly `overlap` cues.
        self.assertEqual(windows[0][-2].cue_id, windows[1][0].cue_id)
        self.assertEqual([c.cue_id for c in windows[0]], ["1", "2", "3", "4"])
        # Every cue is classified at least once, and the tail is covered.
        covered = {c.cue_id for w in windows for c in w}
        self.assertEqual(covered, {str(i + 1) for i in range(10)})
        self.assertEqual(windows[-1][-1].cue_id, "10")

    def test_a_single_window_for_a_short_file(self):
        windows = chunk_cues([cue(i) for i in range(3)], size=40, overlap=5)
        self.assertEqual(len(windows), 1)
        self.assertEqual(len(windows[0]), 3)

    def test_empty_input_produces_nothing(self):
        self.assertEqual(chunk_cues([]), [])

    def test_invalid_geometry_is_refused(self):
        with self.assertRaises(ValueError):
            chunk_cues([cue(0)], size=0)
        with self.assertRaises(ValueError):
            chunk_cues([cue(0)], size=3, overlap=3)

    def test_rendered_chunk_keeps_ids_and_timestamps(self):
        rendered = render_chunk([cue(0), cue(1)])
        self.assertIn("1\t0\the aimed the gun at her", rendered)
        self.assertIn("2\t1000\t", rendered)


class ParseTests(unittest.TestCase):
    window = [cue(0), cue(1, "you damn idiot")]

    def test_accepts_a_well_formed_finding(self):
        accepted, rejected = parse_findings(
            json.dumps({"findings": [{"category": "physical_violence", "cueId": "1", "quote": "gun"}]}),
            self.window, ("physical_violence", "language"))
        self.assertEqual(len(accepted), 1)
        self.assertEqual(rejected, 0)
        self.assertEqual(accepted[0].cue_id, "1")

    def test_tolerates_a_markdown_fence(self):
        raw = "```json\n" + json.dumps({"findings": []}) + "\n```"
        accepted, _ = parse_findings(raw, self.window, ("language",))
        self.assertEqual(accepted, [])

    def test_rejects_a_fabricated_quote(self):
        accepted, rejected = parse_findings(
            json.dumps({"findings": [{"category": "language", "cueId": "1", "quote": "he said a slur"}]}),
            self.window, ("language",))
        self.assertEqual(accepted, [])
        self.assertEqual(rejected, 1)

    def test_rejects_an_unknown_cue_id(self):
        accepted, rejected = parse_findings(
            json.dumps({"findings": [{"category": "language", "cueId": "999", "quote": "gun"}]}),
            self.window, ("language", "physical_violence"))
        self.assertEqual(accepted, [])
        self.assertEqual(rejected, 1)

    def test_rejects_a_category_outside_the_allowed_set(self):
        accepted, rejected = parse_findings(
            json.dumps({"findings": [{"category": "interpretive_dance", "cueId": "1", "quote": "gun"}]}),
            self.window, ("language",))
        self.assertEqual(accepted, [])
        self.assertEqual(rejected, 1)

    def test_rejects_an_empty_quote(self):
        accepted, rejected = parse_findings(
            json.dumps({"findings": [{"category": "language", "cueId": "1", "quote": "   "}]}),
            self.window, ("language",))
        self.assertEqual(accepted, [])
        self.assertEqual(rejected, 1)

    def test_non_json_and_wrong_shapes_raise(self):
        for raw in ("I think this film is violent.", json.dumps({"result": []}), "[]", ""):
            with self.assertRaises(ModelError):
                parse_findings(raw, self.window, ("language",))


class ClassifyTests(unittest.TestCase):
    def test_aggregates_findings_and_usage(self):
        transport = FakeTransport([
            reply([{"category": "physical_violence", "cueId": "1", "quote": "gun"}]),
            reply([{"category": "language", "cueId": "6", "quote": "damn"}]),
        ])
        cues = [cue(i, "he aimed the gun" if i % 5 == 0 else "you damn idiot") for i in range(10)]
        result = ModelClient(transport=transport).classify(cues, ("physical_violence", "language"))
        self.assertEqual(result.usage.calls, 1)  # 10 cues fit in one window
        self.assertEqual(result.usage.input_tokens, 100)
        self.assertEqual(result.usage.output_tokens, 20)
        self.assertEqual(result.usage.total, 120)
        self.assertEqual(len(result.findings), 1)

    def test_stops_before_dispatch_when_the_budget_cannot_afford_a_chunk(self):
        # A chunk needs MAX_TOKENS_PER_CHUNK of headroom. If the allowance cannot
        # cover one, nothing is sent - stopping before the spend, not after.
        transport = FakeTransport([reply([])])
        cues = [cue(i) for i in range(200)]
        result = ModelClient(transport=transport, token_budget=100).classify(cues, ("language",))
        self.assertEqual(result.stopped, "token_budget_reached")
        self.assertEqual(result.usage.calls, 0)
        self.assertEqual(transport.calls, [])

    def test_stops_at_the_chunk_ceiling(self):
        transport = FakeTransport([reply([])])
        cues = [cue(i) for i in range(4000)]
        result = ModelClient(transport=transport, token_budget=10_000_000, max_chunks=3).classify(cues, ("language",))
        self.assertEqual(result.usage.chunks, 3)
        self.assertEqual(result.stopped, "max_chunks_reached")

    def test_rejected_findings_are_counted_not_silently_dropped(self):
        transport = FakeTransport([reply([
            {"category": "language", "cueId": "1", "quote": "gun"},
            {"category": "language", "cueId": "1", "quote": "not in the cue"},
        ])])
        result = ModelClient(transport=transport).classify([cue(0)], ("language",))
        self.assertEqual(len(result.findings), 1)
        self.assertEqual(result.usage.rejected, 1)

    def test_a_route_failure_surfaces_rather_than_being_ignored(self):
        class Broken(FakeTransport):
            def message(self, *a, **k):
                raise ModelError("router said no")

        with self.assertRaises(ModelError):
            ModelClient(transport=Broken()).classify([cue(0)], ("language",))

    def test_one_bad_chunk_does_not_discard_the_others(self):
        # Chunk 0 truncated, chunk 1 fine: the good work must survive.
        transport = FakeTransport([
            {"content": [], "usage": {"input_tokens": 100, "output_tokens": 50}, "stop_reason": "max_tokens"},
            reply([{"category": "language", "cueId": "26", "quote": "damn"}]),
        ])
        cues = [cue(i, "you damn idiot") for i in range(50)]
        result = ModelClient(transport=transport, token_budget=10_000_000).classify(cues, ("language",))
        self.assertEqual(result.usage.failed_chunks, 1)
        self.assertGreaterEqual(len(result.findings), 1)
        # 50 cues at 25 per window with 5 overlap is three windows.
        self.assertEqual(result.usage.chunks, 3)
        self.assertTrue(result.usage.chunk_errors[0].startswith("chunk 0:"))

    def test_an_empty_reply_is_treated_as_a_failed_chunk(self):
        transport = FakeTransport([{"content": [{"type": "text", "text": ""}], "usage": {"input_tokens": 5, "output_tokens": 0}}])
        with self.assertRaises(ModelError):
            ModelClient(transport=transport).classify([cue(0)], ("language",))

    def test_usage_is_added_to_the_existing_budget(self):
        client = ModelClient(transport=FakeTransport([reply([])]), tokens_already_used=150_000, token_budget=200_000)
        self.assertEqual(client.tokens_used(), 150_000)


if __name__ == "__main__":
    unittest.main()

class FixedDefectTests(unittest.TestCase):
    """Regression tests for defects found by an independent review."""

    def test_tokens_already_used_still_counts_after_a_call(self):
        client = ModelClient(transport=FakeTransport([reply([])]), tokens_already_used=150_000, token_budget=200_000)
        client.classify([cue(0)], ("language",))
        # 150000 carried in + 120 from this call; the carried total must not be lost.
        self.assertEqual(client.tokens_used(), 150_120)

    def test_a_provider_error_on_one_chunk_keeps_the_others(self):
        class Flaky(FakeTransport):
            def message(self, model, prompt, **kw):
                self.calls.append((model, prompt))
                if len(self.calls) == 1:
                    raise ModelError("model route HTTP 502: upstream hiccup")
                return reply([{"category": "language", "cueId": "26", "quote": "damn"}])

        cues = [cue(i, "you damn idiot") for i in range(50)]
        result = ModelClient(transport=Flaky(), token_budget=10_000_000).classify(cues, ("language",))
        self.assertEqual(result.usage.failed_chunks, 1)
        self.assertGreaterEqual(len(result.findings), 1)

    def test_recorded_quote_is_the_cue_text_not_the_models_casing(self):
        window = [Cue(index=0, cue_id="1", start_ms=0, end_ms=1, text="You DAMN idiot")]
        accepted, rejected = parse_findings(
            json.dumps({"findings": [{"category": "language", "cueId": "1", "quote": "you damn idiot"}]}),
            window, ("language",))
        self.assertEqual(rejected, 0)
        self.assertEqual(accepted[0].quote, "You DAMN idiot")

    def test_a_one_character_quote_is_rejected(self):
        window = [Cue(index=0, cue_id="1", start_ms=0, end_ms=1, text="a gun here")]
        accepted, rejected = parse_findings(
            json.dumps({"findings": [{"category": "language", "cueId": "1", "quote": "a"}]}),
            window, ("language",))
        self.assertEqual((accepted, rejected), ([], 1))

    def test_non_numeric_usage_metadata_does_not_abort(self):
        transport = FakeTransport([{"content": [{"type": "text", "text": json.dumps({"findings": []})}],
                                    "usage": {"input_tokens": "many", "output_tokens": None}}])
        result = ModelClient(transport=transport).classify([cue(0)], ("language",))
        self.assertEqual(result.usage.total, 0)

class SecondPassRegressionTests(unittest.TestCase):
    """More regressions from the review: malformed provider shapes and dedup."""

    def test_overlapping_windows_do_not_duplicate_findings(self):
        # A 30-cue file with 25/5 windows re-sees cues 21-25 twice.
        transport = FakeTransport([reply([{"category": "language", "cueId": "22", "quote": "damn"}])])
        cues = [cue(i, "you damn idiot") for i in range(30)]
        result = ModelClient(transport=transport, token_budget=10_000_000).classify(cues, ("language",))
        keys = [(f.category, f.cue_id, f.quote) for f in result.findings]
        self.assertEqual(len(keys), len(set(keys)), keys)
