import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from caption_utils import TimedToken, clean_text, decode_sensevoice_result, tokens_to_cues, vad_ranges
from sensevoice import recognize_segments


class SenseVoiceCaptionTests(unittest.TestCase):
    def test_current_pairs_are_milliseconds_with_global_offset(self):
        result = {"text": "<|zh|><|NEUTRAL|><|Speech|>你好", "words": ["你", "好"], "timestamp": [[100, 300], [400, 600]]}
        cues, precision = decode_sensevoice_result(result, 60, 70)
        self.assertEqual(precision, "ctc-word")
        self.assertEqual(cues, [{"start": 60.1, "end": 60.6, "text": "你好"}])

    def test_legacy_triples_are_seconds(self):
        cues, _ = decode_sensevoice_result({"timestamp": [["▁hello", 0.1, 0.3], ["▁world", 0.4, 0.8]]}, 5, 8)
        self.assertEqual(cues[0], {"start": 5.1, "end": 5.8, "text": "hello world"})

    def test_missing_times_preserve_real_vad_interval(self):
        cues, precision = decode_sensevoice_result({"text": "<|zh|><|HAPPY|><|Speech|><|withitn|>真实文字"}, 4, 6)
        self.assertEqual(cues, [{"start": 4, "end": 6, "text": "真实文字"}])
        self.assertEqual(precision, "vad-segment")

    def test_mismatched_word_count_does_not_drop_transcript(self):
        cues, precision = decode_sensevoice_result({"text": "完整文字", "words": ["部分"], "timestamp": [[0, 100], [100, 200]]}, 1, 3)
        self.assertEqual(cues[0]["text"], "完整文字")
        self.assertEqual(precision, "vad-segment")

    def test_non_finite_times_use_vad_fallback(self):
        cues, precision = decode_sensevoice_result({"text": "原文", "words": ["原文"], "timestamp": [[float("nan"), 500]]}, 0, 2)
        self.assertEqual(precision, "vad-segment")
        self.assertEqual(cues[0]["end"], 2)

    def test_tags_only_silence_does_not_create_subtitle(self):
        cues, _ = decode_sensevoice_result({"text": "<|nospeech|><|BGM|>"}, 0, 10)
        self.assertEqual(cues, [])

    def test_length_and_pause_split_only_on_real_token_boundaries(self):
        tokens = [TimedToken("中", 0, 0.2), TimedToken("文", 0.2, 0.4), TimedToken("字", 1.5, 1.8), TimedToken("幕", 1.8, 2)]
        self.assertEqual(tokens_to_cues(tokens, max_chars=2), [{"start": 0, "end": 0.4, "text": "中文"}, {"start": 1.5, "end": 2, "text": "字幕"}])

    def test_vad_windows_are_offset_and_bounded(self):
        self.assertEqual(vad_ranges([[1000, 24000]], 60, 80), [(61, 71), (71, 80)])
        self.assertEqual(vad_ranges([[2000, 1000]], 0, 5), [])

    def test_segment_loop_requests_timestamps_without_remote_code(self):
        class Model:
            def generate(self, **kwargs):
                self.kwargs = kwargs
                return [{"words": ["中文"], "timestamp": [[100, 600]], "text": "中文"}]
        model, events = Model(), []
        cues, fallback = recognize_segments(model, [(10, 12)], lambda start, end: [start, end], "zh", lambda percent, label: events.append(percent))
        self.assertTrue(model.kwargs["output_timestamp"])
        self.assertEqual(model.kwargs["input"], [10, 12])
        self.assertEqual(cues[0]["start"], 10.1)
        self.assertEqual(fallback, 0)
        self.assertEqual(events, [98])


if __name__ == "__main__":
    unittest.main()
