import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tbpipe.subtitles import SubtitleError, discover_subtitles, load_subtitle, normalize, parse_name  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample.en.srt"


class NormalizeTests(unittest.TestCase):
    def test_strips_position_tags_and_music_glyphs(self):
        self.assertEqual(normalize("{\\an8}Damn it!"), "Damn it!")
        self.assertEqual(normalize("<i>hello</i>"), "hello")
        self.assertEqual(normalize("♪ la la ♪"), "la la")

    def test_collapses_whitespace_and_line_breaks(self):
        self.assertEqual(normalize("one\\Ntwo  three"), "one two three")

    def test_normalizes_unicode_to_nfc(self):
        decomposed = "e\u0301"
        self.assertEqual(normalize(decomposed), "\u00e9")


class LoadTests(unittest.TestCase):
    def setUp(self):
        self.subtitle = load_subtitle(FIXTURE)

    def test_preserves_declared_cue_ids(self):
        self.assertEqual([cue.cue_id for cue in self.subtitle.cues], ["1", "2", "3", "4", "5", "6", "7"])

    def test_preserves_timestamps(self):
        first = self.subtitle.cues[0]
        self.assertEqual((first.start_ms, first.end_ms), (1000, 3000))
        last = self.subtitle.cues[-1]
        self.assertEqual((last.start_ms, last.end_ms), (19000, 21000))

    def test_drops_cues_with_no_readable_text(self):
        # The trailing music-only cue carries no content and must not appear.
        self.assertEqual(self.subtitle.cue_count, 7)
        self.assertFalse(any("la la" in cue.text for cue in self.subtitle.cues))

    def test_hashes_the_file_stably(self):
        self.assertEqual(len(self.subtitle.sha256), 64)
        self.assertEqual(self.subtitle.sha256, load_subtitle(FIXTURE).sha256)

    def test_reports_the_file_it_read(self):
        payload = self.subtitle.as_dict()
        self.assertEqual(payload["file"], "sample.en.srt")
        self.assertEqual(payload["cues"], 7)


class NameTests(unittest.TestCase):
    def test_identity_from_file_name(self):
        self.assertEqual(parse_name(Path("1422822.en.srt")), (1422822, "en", None))
        self.assertEqual(parse_name(Path("1422822.ta.director-cut.srt")), (1422822, "ta", "director-cut"))
        self.assertEqual(parse_name(Path("1422822.srt")), (1422822, None, None))
        self.assertEqual(parse_name(Path("random-name.srt")), (None, None, None))

    def test_name_identity_is_used_when_no_override_is_given(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "1544847.ml.srt"
            target.write_bytes(FIXTURE.read_bytes())
            subtitle = load_subtitle(target)
            self.assertEqual(subtitle.declared_tmdb_id, 1544847)
            self.assertEqual(subtitle.language, "ml")


class DiscoveryTests(unittest.TestCase):
    def test_finds_supported_files_and_ignores_others(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.srt").write_bytes(FIXTURE.read_bytes())
            (root / "b.vtt").write_text("WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n", encoding="utf-8")
            (root / "notes.txt").write_text("ignore me", encoding="utf-8")
            found = discover_subtitles(root)
            self.assertEqual([p.name for p in found], ["a.srt", "b.vtt"])

    def test_rejects_missing_paths_and_bad_formats(self):
        with self.assertRaises(SubtitleError):
            load_subtitle(FIXTURE.parent / "does-not-exist.srt")
        with self.assertRaises(SubtitleError):
            load_subtitle(FIXTURE.parent / "notes.txt")

    def test_reads_a_vtt_file(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "clip.en.vtt"
            target.write_text("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nThe ghost is here.\n", encoding="utf-8")
            subtitle = load_subtitle(target)
            self.assertEqual(subtitle.cue_count, 1)
            self.assertEqual(subtitle.cues[0].text, "The ghost is here.")


if __name__ == "__main__":
    unittest.main()
