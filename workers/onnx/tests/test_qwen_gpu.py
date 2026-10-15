"""CUDA routing contracts without requiring a GPU in unit-test environments."""
from pathlib import Path
import sys
import tempfile
import wave
from collections import deque
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from qwen_gpu import load_gpu_recognizer
from caption_utils import recognition_cues
from transcribe import transcribe, load_cpu_recognizer, recognize_wav


class QwenGpuTests(unittest.TestCase):
    def test_batches_keep_vad_times_and_flush_a_partial_final_batch(self):
        samples = np.zeros(8000, dtype=np.float32)

        class Vad:
            def __init__(self):
                self.segments = deque(SimpleNamespace(start=i * 16000, samples=samples)
                                      for i in range(5))

            @property
            def front(self):
                return self.segments[0]

            def empty(self):
                return not self.segments

            def pop(self):
                self.segments.popleft()

            def accept_waveform(self, _):
                pass

            def flush(self):
                self.segments.append(SimpleNamespace(start=96000, samples=samples))

        batches = []

        def recognize(batch, language):
            batches.append(len(batch))
            self.assertEqual(language, "Chinese")
            return [SimpleNamespace(text="字幕", tokens=[], timestamps=[]) for _ in batch]

        with tempfile.TemporaryDirectory() as folder:
            audio = str(Path(folder) / "input.wav")
            with wave.open(audio, "wb") as output:
                output.setparams((1, 2, 16000, 0, "NONE", ""))
                output.writeframes(bytes(8 * 16000 * 2))
            with patch("transcribe.sherpa_onnx.VoiceActivityDetector", return_value=Vad()), \
                    patch("transcribe.progress"):
                cues = recognize_wav(audio, recognize, "vad.onnx", "qwen3-asr", "GPU", "zh", 4)
        self.assertEqual(batches, [4, 2])
        self.assertEqual([(cue["start"], cue["end"]) for cue in cues],
                         [(i, i + 0.5) for i in (0, 1, 2, 3, 4, 6)])

    def test_missing_cuda_fails_before_model_download(self):
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))
        with patch.dict(sys.modules, {"torch": torch, "qwen_asr": SimpleNamespace(Qwen3ASRModel=Mock())}), \
                patch("qwen_gpu.resolve_model") as resolve:
            with self.assertRaisesRegex(RuntimeError, "未检测到可用"):
                load_gpu_recognizer({}, Mock())
            resolve.assert_not_called()

    def test_gpu_receives_samples_and_language_without_fabricated_word_times(self):
        import contextlib
        model = SimpleNamespace(device=SimpleNamespace(type="cuda"),
                                transcribe=Mock(return_value=[SimpleNamespace(text="你好")]))
        factory = Mock(return_value=model)
        torch = SimpleNamespace(float16="float16", inference_mode=contextlib.nullcontext,
                                cuda=SimpleNamespace(is_available=lambda: True,
                                get_device_name=lambda _: "test GPU", OutOfMemoryError=MemoryError))
        with patch.dict(sys.modules, {"torch": torch, "qwen_asr": SimpleNamespace(
                Qwen3ASRModel=SimpleNamespace(from_pretrained=factory))}), \
                patch("qwen_gpu.resolve_model", return_value=Path("local-model")) as resolve:
            recognize = load_gpu_recognizer({"modelDir": "local-model", "offline": True}, Mock())
            result = recognize([[0.1]], "Chinese")[0]
            self.assertEqual(recognition_cues(result, 2, 5), [{"start": 2, "end": 5, "text": "你好"}])
            resolve.assert_called_once_with("qwen3-asr-cuda", "local-model", True, unittest.mock.ANY)
            self.assertTrue(factory.call_args.kwargs["local_files_only"])
            self.assertEqual(factory.call_args.kwargs["device_map"], "cuda:0")
            model.transcribe.assert_called_once_with(audio=[([0.1], 16000)], language="Chinese")
            model.transcribe.side_effect = MemoryError()
            with self.assertRaisesRegex(RuntimeError, "显存不足"):
                recognize([[0.1]], None)

    def test_sensevoice_gpu_is_rejected_before_loading(self):
        with self.assertRaisesRegex(ValueError, "仅支持 Qwen3-ASR"):
            transcribe({"engine": "sensevoice", "device": "cuda"})

    def test_cpu_sensevoice_keeps_original_language_code(self):
        with patch("transcribe.resolve_model", return_value=Path("model")), \
                patch("transcribe.sherpa_onnx.OfflineRecognizer.from_sense_voice") as factory:
            load_cpu_recognizer({"engine": "sensevoice", "language": "zh"})
            self.assertEqual(factory.call_args.kwargs["language"], "zh")


if __name__ == "__main__":
    unittest.main()
