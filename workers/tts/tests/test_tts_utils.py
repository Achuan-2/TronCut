import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tts_utils import choose_device, phoneme_chunks, split_text


class NarrationHelpersTest(unittest.TestCase):
    def test_long_multiline_text_keeps_every_character(self):
        text = "欢迎使用！\n" + "长文稿、文字与数字123。" * 80 + "\n?!"
        parts = split_text(text)
        self.assertEqual("".join(parts), text.replace("\n", ""))
        self.assertTrue(all(0 < len(part) <= 180 for part in parts))

    def test_empty_text_has_no_segments(self):
        self.assertEqual(split_text("  \n  "), [])

    def test_english_words_are_kept_at_chunk_boundaries(self):
        text = "Welcome to the video editor. " * 20
        parts = split_text(text)
        self.assertEqual("".join(parts), text.strip())
        self.assertTrue(all(len(part) <= 180 for part in parts))
        self.assertTrue(all(part.endswith(" ") for part in parts[:-1]))

    def test_invalid_limit_does_not_loop(self):
        with self.assertRaises(ValueError):
            split_text("配音", 0)

    def test_expanded_chinese_phonemes_are_not_truncated(self):
        text = "这是超过模型音素上限的中文文稿" * 20
        phonemize = lambda value: ("".join(char * 5 for char in value), None)
        parts = phoneme_chunks(text, phonemize)
        self.assertEqual("".join(parts), phonemize(text)[0])
        self.assertTrue(all(0 < len(part) <= 510 for part in parts))

    def test_unreadable_or_oversized_character_reports_error(self):
        with self.assertRaisesRegex(ValueError, "可朗读"):
            phoneme_chunks("test", lambda value: ("", None))
        with self.assertRaisesRegex(ValueError, "单个字符"):
            phoneme_chunks("1", lambda value: ("p" * 600, None))

    def test_missing_gpu_is_explicit_and_auto_uses_cpu(self):
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False),
                                backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)))
        self.assertEqual(choose_device("auto", torch), "cpu")
        with self.assertRaisesRegex(ValueError, "CUDA"):
            choose_device("cuda", torch)
        with self.assertRaisesRegex(ValueError, "MPS"):
            choose_device("mps", torch)


if __name__ == "__main__":
    unittest.main()
