import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tbpipe import classify  # noqa: E402
from tbpipe.rules import Lexicon, LexiconError  # noqa: E402
from tbpipe.subtitles import Cue, load_subtitle  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample.en.srt"
LEXICON = Lexicon.load()


def categories_for(cues_filter=None, **kwargs):
    subtitle = load_subtitle(FIXTURE)
    analysis = classify.analyze(subtitle, LEXICON, **kwargs)
    return analysis, {c["category"]: c for c in analysis["categories"]}


class LexiconTests(unittest.TestCase):
    def test_lexicon_loads_with_a_version(self):
        self.assertTrue(LEXICON.version)
        self.assertGreater(len(LEXICON.rules), 0)

    def test_rules_are_declared_for_known_categories_only(self):
        from tbpipe.report import CATEGORY_SLUGS

        for rule in LEXICON.rules:
            self.assertIn(rule.category, CATEGORY_SLUGS, rule.id)

    def test_visual_only_categories_carry_no_rules(self):
        for category in LEXICON.visual_only:
            self.assertEqual([r for r in LEXICON.rules if r.category == category], [])


class ScanTests(unittest.TestCase):
    def setUp(self):
        self.subtitle = load_subtitle(FIXTURE)
        self.hits = LEXICON.scan(self.subtitle.cues, context_window=1)

    def test_finds_the_expected_categories(self):
        counts = Counter(hit.category for hit in self.hits)
        self.assertEqual(counts["physical_violence"], 1)
        self.assertEqual(counts["alcohol"], 2)
        self.assertEqual(counts["horror"], 1)
        self.assertEqual(counts["language"], 1)
        self.assertEqual(counts["drugs"], 1)
        self.assertEqual(counts["sexual_violence"], 1)

    def test_context_rule_suppresses_a_false_positive(self):
        # "Pass me a bar of soap" must not count as a drinking venue.
        soap_cue_ids = {hit.cue_id for hit in self.hits if hit.category == "alcohol"}
        self.assertNotIn("4", soap_cue_ids)
        self.assertEqual(soap_cue_ids, {"2", "6"})

    def test_unmatched_violence_phrasing_is_not_reported(self):
        # "You're killing me" is idiomatic, not violence.
        self.assertNotIn("7", {hit.cue_id for hit in self.hits if hit.category == "physical_violence"})

    def test_sexualized_person_reference_is_family_dialogue_evidence(self):
        cues = (Cue(index=0, cue_id="1", start_ms=0, end_ms=500,
                    text="He has a daughter, a real sexy chick!"),)

        hits = LEXICON.scan(cues)

        self.assertEqual([(hit.category, hit.note) for hit in hits],
                         [("sexual_content", "sexualized remark")])

    def test_every_hit_points_at_a_real_cue_and_timestamp(self):
        by_id = {cue.cue_id: cue for cue in self.subtitle.cues}
        for hit in self.hits:
            self.assertIn(hit.cue_id, by_id)
            self.assertEqual(hit.start_ms, by_id[hit.cue_id].start_ms)
            self.assertEqual(hit.end_ms, by_id[hit.cue_id].end_ms)
            self.assertTrue(hit.matched)
            self.assertTrue(hit.rule_id)

    def test_requires_near_gates_a_rule_until_context_appears(self):
        import json
        import tempfile

        payload = {
            "version": "test-context",
            "textEvidencedCategories": ["drugs"],
            "visualOnlyCategories": [],
            "rules": [
                {"id": "ctx", "category": "drugs", "pattern": "\\bhigh\\b", "requiresNear": ["on drugs"]}
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lex.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            lexicon = Lexicon.load(path)
            subtitle = load_subtitle(FIXTURE)
            without = [h for h in lexicon.scan(subtitle.cues, 1) if h.category == "drugs"]
            self.assertEqual(without, [])


class AnalysisTests(unittest.TestCase):
    def test_family_estimate_rates_sustained_strong_dialogue_with_assault_references_four(self):
        cues = tuple(
            Cue(index=i, cue_id=str(i + 1), start_ms=i * 1000, end_ms=i * 1000 + 500,
                text="What the fuck are you doing, bastard?")
            for i in range(8)
        ) + (
            Cue(index=8, cue_id="9", start_ms=8000, end_ms=8500,
                text="Are you here after some gang rape?"),
            Cue(index=9, cue_id="10", start_ms=9000, end_ms=9500,
                text="She said she was raped."),
        )
        subtitle = type("Subtitle", (), {"cues": cues})()

        analysis = classify.analyze(subtitle, LEXICON)

        estimate = analysis.get("familyAwkwardnessEstimate")
        self.assertIsNotNone(estimate)
        self.assertEqual(estimate["rating"], 4)
        self.assertEqual(estimate["verdict"], "The ceiling fan deserves an Oscar.")
        self.assertEqual(estimate["basis"], "subtitle_dialogue_rules")
        self.assertEqual(estimate["visualCoverage"], "unknown")

    def test_profanity_alone_is_capped_at_three(self):
        cues = tuple(
            Cue(index=i, cue_id=str(i + 1), start_ms=i * 1000, end_ms=i * 1000 + 500,
                text="Fuck this bullshit.")
            for i in range(60)
        )
        subtitle = type("Subtitle", (), {"cues": cues})()

        estimate = classify.analyze(subtitle, LEXICON).get("familyAwkwardnessEstimate")
        self.assertIsNotNone(estimate)

        self.assertEqual(estimate["rating"], 3)
        self.assertEqual(estimate["factors"]["strongProfanityCues"], 60)

    def test_no_family_dialogue_evidence_stays_unrated(self):
        cues = (Cue(index=0, cue_id="1", start_ms=0, end_ms=500,
                    text="The train arrives tomorrow."),)
        subtitle = type("Subtitle", (), {"cues": cues})()

        estimate = classify.analyze(subtitle, LEXICON).get("familyAwkwardnessEstimate")
        self.assertIsNotNone(estimate)

        self.assertIsNone(estimate["rating"])
        self.assertEqual(estimate["state"], "unknown")

    def test_every_category_is_reported_even_with_no_evidence(self):
        _, by_category = categories_for()
        from tbpipe.report import CATEGORY_SLUGS

        self.assertEqual(set(by_category), set(CATEGORY_SLUGS))

    def test_visual_only_categories_stay_unknown(self):
        _, by_category = categories_for()
        for slug in LEXICON.visual_only:
            self.assertEqual(by_category[slug]["state"], classify.STATE_UNKNOWN)

    def test_severity_is_never_asserted(self):
        _, by_category = categories_for()
        for entry in by_category.values():
            self.assertIsNone(entry["severity"])

    def test_a_category_without_evidence_is_unknown_not_absent(self):
        _, by_category = categories_for()
        for slug in ("sexual_content", "suicide_self_harm", "disturbing_content", "animal_harm"):
            self.assertEqual(by_category[slug]["state"], classify.STATE_UNKNOWN)
            self.assertTrue(by_category[slug]["limitation"])

    def test_evidence_is_bounded_and_counted(self):
        _, by_category = categories_for()
        for entry in by_category.values():
            self.assertLessEqual(len(entry["evidence"]), classify.MAX_EVIDENCE_PER_CATEGORY)
            self.assertGreaterEqual(entry["evidenceCount"], len(entry["evidence"]))

    def test_analysis_records_method_and_rules_version(self):
        analysis, _ = categories_for()
        self.assertEqual(analysis["analysis"]["method"], "offline-rules")
        self.assertIsNone(analysis["analysis"]["model"])
        self.assertEqual(analysis["analysis"]["rulesVersion"], LEXICON.version)

    def test_draft_is_never_published_and_keeps_evidence_private(self):
        subtitle = load_subtitle(FIXTURE)
        analysis = classify.analyze(subtitle, LEXICON)
        draft = classify.draft_for(movie={"tmdbId": 1, "title": "Fixture"}, subtitle=subtitle,
                                   analysis=analysis, window=None, region="IN")
        self.assertEqual(draft["publication"], "none")
        self.assertEqual(draft["reviewStatus"], "draft_pending_human")
        self.assertEqual(draft["subtitle"]["sha256"], subtitle.sha256)
        language = next(c for c in draft["categories"] if c["category"] == "language")
        self.assertTrue(language["evidence"][0]["startMs"] >= 0)
        self.assertEqual(draft["familyAwkwardnessEstimate"], analysis["familyAwkwardnessEstimate"])


if __name__ == "__main__":
    unittest.main()

class ContextPositionTests(unittest.TestCase):
    """The window must follow cue *position*, not cue.index, which has gaps."""

    def test_context_survives_gapped_indices(self):
        import json
        import tempfile

        payload = {
            "version": "test-gap",
            "textEvidencedCategories": ["alcohol"],
            "visualOnlyCategories": [],
            "rules": [{"id": "ctx-soap", "category": "alcohol", "pattern": "\\bsoap\\b",
                       "requiresNear": ["go to the bar"]}],
        }
        # The second cue has index 5 because four text-free cues were dropped.
        cues = [Cue(index=0, cue_id="1", start_ms=0, end_ms=1, text="let us go to the bar"),
                Cue(index=5, cue_id="2", start_ms=5, end_ms=6, text="pass me the soap")]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lex.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            hits = Lexicon.load(path).scan(cues, context_window=1)
        self.assertEqual([h.cue_id for h in hits], ["2"])

class LexiconValidationTests(unittest.TestCase):
    def test_a_string_instead_of_a_list_is_refused(self):
        import json
        import tempfile

        payload = {"version": "bad", "textEvidencedCategories": "language", "visualOnlyCategories": [], "rules": [
            {"id": "r", "category": "language", "pattern": "\\bdamn\\b"}]}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lex.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(LexiconError):
                Lexicon.load(path)

    def test_a_non_utf8_lexicon_is_a_lexicon_error_not_a_unicode_error(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lex.json"
            path.write_bytes(b"\xff\xfe\x00 not utf-8")
            with self.assertRaises(LexiconError):
                Lexicon.load(path)
