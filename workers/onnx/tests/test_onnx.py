import os
from pathlib import Path
import sys
import tempfile
import tarfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from caption_utils import result_cues
from models import MODELS, installed, resolve_model, resolve_vad
from synthesize import text_chunks


class OnnxTests(unittest.TestCase):
    def test_missing_timestamps_keep_real_vad_boundaries(self):
        result = SimpleNamespace(text="<|zh|>完整的字幕", tokens=["完", "整"], timestamps=[])
        self.assertEqual(result_cues(result, 2, 5), [{"start": 2, "end": 5, "text": "完整的字幕"}])

    def test_timestamps_split_captions_and_clip_to_segment(self):
        result = SimpleNamespace(text="你好。世界", tokens=["你", "好。", "世", "界"],
                                 timestamps=[0.1, 0.3, 0.7, 0.9], durations=[0.2, 0.2, 0.2, 0.2])
        self.assertEqual(result_cues(result, 10, 11), [
            {"start": 10.1, "end": 10.5, "text": "你好。"},
            {"start": 10.7, "end": 11, "text": "世界"},
        ])
        result.timestamps = [0.1, 0.3, 0.2, 0.9]
        self.assertEqual(result_cues(result, 10, 11), [{"start": 10, "end": 11, "text": "你好。世界"}])

    def test_no_orphan_punctuation_or_spaces_inside_subwords(self):
        result = SimpleNamespace(text="hello world.", tokens=["hel", "lo", "▁world", "."],
                                 timestamps=[0.1, 0.3, 0.7, 0.9])
        self.assertEqual(result_cues(result, 0, 1), [{"start": 0.1, "end": 1, "text": "hello world."}])
        result = SimpleNamespace(text="这是完整字幕。", tokens=["这", "是", "完", "整", "字", "幕", "。"],
                                 timestamps=[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
        cues = result_cues(result, 0, 1, max_chars=6)
        self.assertEqual(len(cues), 1)
        self.assertEqual(cues[0]["text"], "这是完整字幕。")

    def test_default_models_use_only_troncut_cache_and_never_network_offline(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"TRONCUT_ONNX_MODELS": folder}):
            directory = Path(folder) / MODELS["sensevoice"]["directory"]
            directory.mkdir()
            for file in MODELS["sensevoice"]["files"]:
                (directory / file).write_bytes(b"model")
            with patch("models.download") as network:
                self.assertEqual(resolve_model("sensevoice", "", True, lambda *_: None), directory)
                with self.assertRaisesRegex(RuntimeError, "本地缺少"):
                    resolve_model("qwen3-asr", "", True, lambda *_: None)
                with self.assertRaisesRegex(RuntimeError, "silero_vad"):
                    resolve_vad("", True, lambda *_: None)
                network.assert_not_called()

    def test_explicit_directory_is_validated_without_falling_back(self):
        with tempfile.TemporaryDirectory(prefix="模型 空格-") as folder:
            directory = Path(folder)
            with patch("models.download") as network:
                with self.assertRaisesRegex(RuntimeError, "模型目录不完整"):
                    resolve_model("sensevoice", folder, False, lambda *_: None)
                network.assert_not_called()
            for file in MODELS["sensevoice"]["files"]:
                (directory / file).write_bytes(b"model")
            self.assertTrue(installed(directory, MODELS["sensevoice"]))
            self.assertEqual(resolve_model("sensevoice", folder, True, lambda *_: None), directory.resolve())
            (directory / "silero_vad.onnx").write_bytes(b"vad")
            self.assertEqual(resolve_vad(folder, True, lambda *_: None), directory / "silero_vad.onnx")

    def test_qwen3_asr_model_requires_onnx_components_and_tokenizer(self):
        spec = MODELS["qwen3-asr"]
        self.assertEqual(spec["directory"], "qwen3-asr-0.6b")
        self.assertIn("conv_frontend.onnx", spec["files"])
        self.assertIn("encoder.int8.onnx", spec["files"])
        self.assertIn("decoder.int8.onnx", spec["files"])
        self.assertIn("tokenizer/chat_template.json", spec["files"])
        self.assertIn("tokenizer/vocab.json", spec["files"])

    def test_missing_asr_downloads_once_into_own_cache(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"TRONCUT_ONNX_MODELS": folder}):
            def fetch(_url, destination, _progress):
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(b"model")
            with patch("models.download", side_effect=fetch) as network:
                directory = resolve_model("sensevoice", "", False, lambda *_: None)
                self.assertEqual(directory, Path(folder) / "sensevoice-small")
                self.assertEqual(network.call_count, 2)
                self.assertTrue(installed(directory, MODELS["sensevoice"]))
                resolve_model("sensevoice", "", False, lambda *_: None)
                self.assertEqual(network.call_count, 2)
                resolve_vad("", False, lambda *_: None)
                self.assertEqual(network.call_count, 3)
                resolve_vad("", True, lambda *_: None)
                self.assertEqual(network.call_count, 3)

    def test_tts_archive_is_extracted_and_reused_without_redownload(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"TRONCUT_ONNX_MODELS": folder}):
            spec = MODELS["vits-onnx"]
            def fetch(_url, destination, _progress):
                inner = destination.parent / "fixture" / spec["inner"]
                inner.mkdir(parents=True)
                for name in spec["files"]:
                    (inner / name).write_bytes(b"model")
                with tarfile.open(destination, "w:bz2") as bundle:
                    bundle.add(inner, arcname=spec["inner"])
            with patch("models.download", side_effect=fetch) as network:
                directory = resolve_model("vits-onnx", "", False, lambda *_: None)
                self.assertTrue(installed(directory, spec))
                self.assertEqual(directory, Path(folder) / spec["directory"])
                resolve_model("vits-onnx", "", True, lambda *_: None)
                self.assertEqual(network.call_count, 1)

    def test_qwen3_asr_download_uses_official_asr_archive(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"TRONCUT_ONNX_MODELS": folder}):
            spec = MODELS["qwen3-asr"]
            def fetch(url, destination, _progress):
                self.assertIn("/asr-models/", url)
                inner = destination.parent / "fixture" / spec["inner"]
                for name in spec["files"]:
                    file = inner / name
                    file.parent.mkdir(parents=True, exist_ok=True)
                    file.write_bytes(b"model")
                with tarfile.open(destination, "w:bz2") as bundle:
                    bundle.add(inner, arcname=spec["inner"])
            with patch("models.download", side_effect=fetch) as network:
                directory = resolve_model("qwen3-asr", "", False, lambda *_: None)
                self.assertEqual(directory, Path(folder) / "qwen3-asr-0.6b")
                self.assertTrue(installed(directory, spec))
                self.assertEqual(network.call_count, 1)

    def test_long_text_is_preserved_and_chunks_are_bounded(self):
        text = "中文测试。" + "很长的连续文稿" * 90 + "。Hello world!最后一句。"
        chunks = text_chunks(text)
        self.assertTrue(all(0 < len(chunk) <= 100 for chunk in chunks))
        self.assertEqual("".join(chunks), text)


if __name__ == "__main__":
    unittest.main()
