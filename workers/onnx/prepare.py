"""Download a selected model and shared VAD before the first media task."""
import argparse
import json
from pathlib import Path

from models import MODELS, resolve_model, resolve_vad


def progress(percent, label):
    print("TRONCUT_PROGRESS " + json.dumps({"percent": percent, "label": label}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    engine = json.loads(Path(args.request).read_text(encoding="utf-8"))["engine"]
    if engine not in MODELS:
        raise ValueError("请选择支持的 ONNX 模型")
    directory = resolve_model(engine, "", False, progress)
    if engine in ("qwen3-asr", "sensevoice"):
        resolve_vad("", False, progress)
    Path(args.output).write_text(json.dumps({"engine": engine, "directory": str(directory)}, ensure_ascii=False), encoding="utf-8")
    progress(100, "ONNX 模型已就绪")


if __name__ == "__main__":
    main()
