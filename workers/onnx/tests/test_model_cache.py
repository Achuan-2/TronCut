from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model_cache import ModelCache, model_key, models, vad_models
from synthesize import synthesize
from transcribe import load_cpu_recognizer


class ModelCacheTests(unittest.TestCase):
    def setUp(self):
        models.clear()
        vad_models.clear()

    def test_lru_and_failed_loads(self):
        cache = ModelCache(capacity=2)
        factory = Mock(side_effect=[object(), object(), object()])
        first, cached, _ = cache.get("a", factory)
        self.assertFalse(cached)
        cache.get("b", factory)
        self.assertIs(cache.get("a", factory)[0], first)
        cache.get("c", factory)
        self.assertEqual(list(cache.entries), ["a", "c"])
        with self.assertRaises(RuntimeError):
            cache.get("broken", Mock(side_effect=RuntimeError("load failed")))
        self.assertNotIn("broken", cache.entries)

    def test_changed_model_file_and_language_have_different_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            for name in ("model.int8.onnx", "tokens.txt"):
                (directory / name).write_bytes(b"model")
            before = model_key("sensevoice", directory, "zh")
            self.assertNotEqual(before, model_key("sensevoice", directory, "en"))
            (directory / "tokens.txt").write_bytes(b"updated tokens")
            self.assertNotEqual(before, model_key("sensevoice", directory, "zh"))

    def test_tts_reuses_model_across_voices_and_texts(self):
        import json
        tts = SimpleNamespace(num_speakers=3, sample_rate=16000,
                              generate=Mock(return_value=SimpleNamespace(samples=[0.1] * 800)))
        with tempfile.TemporaryDirectory() as folder, \
                patch("synthesize.resolve_model", return_value=Path(folder)), \
                patch("synthesize.model_key", return_value="kokoro"), \
                patch("synthesize.load_tts", return_value=tts) as load, \
                patch("synthesize.progress"):
            for index in range(2):
                output = Path(folder) / f"{index}.wav"
                synthesize({"engine": "kokoro-onnx", "voice": str(index), "text": f"文字{index}"}, output)
                metadata = json.loads(Path(f"{output}.json").read_text(encoding="utf-8"))
                self.assertEqual(metadata["modelCached"], bool(index))
                if index:
                    self.assertEqual(metadata["loadSeconds"], 0)
            load.assert_called_once()
            self.assertEqual([call.kwargs["sid"] for call in tts.generate.call_args_list], [0, 1])

    def test_asr_reuses_model_but_not_stream_and_separates_sensevoice_languages(self):
        recognizer = Mock()
        with patch("transcribe.resolve_model", return_value=Path("model")), \
                patch("transcribe.model_key", side_effect=lambda engine, directory, language: (engine, language)), \
                patch("transcribe.create_recognizer", return_value=recognizer) as load, \
                patch("transcribe.progress"):
            for language in ("zh", "zh", "en"):
                recognize = load_cpu_recognizer({"engine": "sensevoice", "language": language})
                recognize([[0.1]], language)
            self.assertEqual(load.call_count, 2)
            self.assertEqual(recognizer.create_stream.call_count, 3)


if __name__ == "__main__":
    unittest.main()
