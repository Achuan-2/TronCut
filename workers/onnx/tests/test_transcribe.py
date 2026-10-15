"""CPU recognition, streaming VAD timing, and unsupported device validation."""
from pathlib import Path
import sys
import tempfile
import wave
from collections import deque
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from transcribe import transcribe, load_cpu_recognizer, recognize_wav


class TranscribeTests(unittest.TestCase):
    def test_streaming_keeps_vad_times_and_flushes_the_final_segment(self):
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
                cues = recognize_wav(audio, recognize, "vad.onnx", "qwen3-asr", "CPU", "zh")
        self.assertEqual(batches, [1] * 6)
        self.assertEqual([(cue["start"], cue["end"]) for cue in cues],
                         [(i, i + 0.5) for i in (0, 1, 2, 3, 4, 6)])

    def test_cuda_is_rejected_before_loading_models(self):
        for engine in ("qwen3-asr", "sensevoice"):
            with self.subTest(engine=engine), patch("transcribe.load_cpu_recognizer") as load:
                with self.assertRaisesRegex(ValueError, "仅支持 CPU"):
                    transcribe({"engine": engine, "device": "cuda"})
                load.assert_not_called()

    def test_cpu_sensevoice_keeps_original_language_code(self):
        with patch("transcribe.resolve_model", return_value=Path("model")), \
                patch("transcribe.sherpa_onnx.OfflineRecognizer.from_sense_voice") as factory:
            load_cpu_recognizer({"engine": "sensevoice", "language": "zh"})
            self.assertEqual(factory.call_args.kwargs["language"], "zh")


if __name__ == "__main__":
    unittest.main()
