import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lux import clone_voice, synthesize, prompts
from models import MODELS, resolve_model


class LuxTests(unittest.TestCase):
    def setUp(self):
        prompts.clear()

    def test_clone_rejects_silence_before_loading_models(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = Path(folder) / "silent.wav"
            sf.write(audio, np.zeros(4 * 24000), 24000)
            with patch("lux.cached_lux") as load:
                with self.assertRaisesRegex(ValueError, "没有有效声音"):
                    clone_voice({"input": str(audio), "transcript": "参考声音"}, Path(folder) / "prompt.npz")
                load.assert_not_called()

    def test_clone_encodes_the_whole_reference_with_the_supplied_transcript(self):
        tts = Mock()
        tts.encode_prompt.return_value = {"prompt_tokens": [[1, 2]]}
        with tempfile.TemporaryDirectory() as folder:
            audio, output = Path(folder) / "reference.wav", Path(folder) / "prompt.npz"
            sf.write(audio, np.sin(np.arange(4 * 24000) * 0.1).astype(np.float32) * 0.1, 24000)
            with patch("lux.cached_lux", return_value=(tts, Path(folder), True, 0)), patch("lux.progress"):
                clone_voice({"input": str(audio), "transcript": "这是参考文字。"}, output)
            tts.encode_prompt.assert_called_once_with(str(audio), "这是参考文字。", duration=30.1)
            tts.save_prompt.assert_called_once_with(tts.encode_prompt.return_value, str(output))

    def test_saved_prompts_are_cached_and_speed_is_left_to_ffmpeg(self):
        tts = SimpleNamespace(load_prompt=Mock(return_value={"prompt": True}), generate=Mock(return_value=np.ones(4800) * 0.1))
        with tempfile.TemporaryDirectory() as folder:
            prompt = Path(folder) / "prompt.npz"
            prompt.write_bytes(b"prompt")
            with patch("lux.cached_lux", return_value=(tts, Path(folder), True, 0)), patch("lux.progress"):
                for index in range(2):
                    output = Path(folder) / f"{index}.wav"
                    synthesize({"text": "测试配音。", "promptFile": str(prompt), "speed": 1.5}, output)
                    metadata = json.loads(Path(f"{output}.json").read_text(encoding="utf-8"))
                    self.assertEqual(metadata["sampleRate"], 48000)
                    self.assertTrue(metadata["modelCached"])
                    self.assertEqual(metadata["loadSeconds"], 0)
                    self.assertEqual(metadata["segments"][0]["text"], "测试配音。")
            tts.load_prompt.assert_called_once()
            self.assertAlmostEqual(tts.generate.call_args.kwargs["speed"] * 1.3, 1.0)

    def test_download_is_pinned_hash_verified_and_offline_cache_is_reused(self):
        spec = MODELS["lux-onnx"].copy()
        expected = hashlib.sha256(b"onnx model").hexdigest()
        spec["sources"] = {name: ("repo/model", "pinned-revision", expected) for name in spec["files"]}
        def fetch(url, destination, _progress):
            self.assertIn("/pinned-revision/", url)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b"onnx model")
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"TRONCUT_ONNX_MODELS": folder}), \
                patch.dict(MODELS, {"lux-onnx": spec}), patch("models.download", side_effect=fetch) as network:
            directory = resolve_model("lux-onnx", "", False, Mock())
            self.assertEqual(network.call_count, 4)
            self.assertEqual(resolve_model("lux-onnx", "", True, Mock()), directory)
            self.assertEqual(network.call_count, 4)


if __name__ == "__main__":
    unittest.main()
