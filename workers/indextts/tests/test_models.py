import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from models import prepare_models, required_files


class IndexModelsTest(unittest.TestCase):
    def test_offline_missing_model_fails_without_download(self):
        calls = []
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(sys.modules, {"huggingface_hub": SimpleNamespace(snapshot_download=lambda **args: calls.append(args))}):
                with self.assertRaisesRegex(ValueError, "离线模型不完整"):
                    prepare_models(Path(folder), True)
        self.assertEqual(calls, [])

    def test_complete_model_cache_is_used_offline(self):
        calls = []
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for file in required_files(root):
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b"cached")
            with patch.dict(sys.modules, {"huggingface_hub": SimpleNamespace(snapshot_download=lambda **args: calls.append(args))}):
                prepare_models(root, True)
            self.assertTrue((root / "troncut-models.json").is_file())
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
