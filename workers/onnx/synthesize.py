"""Kokoro/VITS synthesis through sherpa-onnx; no PyTorch dependency."""
import argparse
import json
import os
from pathlib import Path
import re
import time
import wave

import numpy as np
import sherpa_onnx

from models import resolve_model
from model_cache import models, model_key


def progress(percent, label):
    print("TRONCUT_PROGRESS " + json.dumps({"percent": percent, "label": label}, ensure_ascii=False), flush=True)


def text_chunks(text, limit=100):
    """Keep punctuation and bounded chunks so long narration cannot exceed model limits."""
    chunks, pending = [], ""
    for part in re.findall(r"[^。！？!?；;\n]+[。！？!?；;\n]*|[。！？!?；;\n]+", text):
        while len(part) > limit:
            if pending.strip():
                chunks.append(pending.strip())
                pending = ""
            boundary = max(part.rfind(" ", 0, limit), part.rfind("，", 0, limit), part.rfind(",", 0, limit))
            boundary = boundary + 1 if boundary > limit // 2 else limit
            chunks.append(part[:boundary].strip())
            part = part[boundary:]
        if len(pending) + len(part) > limit:
            if pending.strip():
                chunks.append(pending.strip())
            pending = ""
        pending += part
    if pending.strip():
        chunks.append(pending.strip())
    return chunks


def synthesize(request, output):
    engine = request["engine"]
    if engine == "lux-onnx":
        from lux import synthesize as synthesize_lux
        return synthesize_lux(request, output)
    if engine not in ("kokoro-onnx", "vits-onnx"):
        raise ValueError("请选择 Kokoro 或 VITS ONNX 模型")
    if request.get("device", "cpu") not in ("auto", "cpu"):
        raise ValueError("当前 sherpa-onnx 运行环境仅支持 CPU")
    sid = int(request["voice"])
    directory = resolve_model(engine, request.get("modelDir"), request.get("offline", False), progress)
    key = model_key(engine, directory)
    def load():
        progress(10, f"正在加载 {engine} ONNX 模型（CPU）")
        return load_tts(engine, directory)
    tts, cached, load_seconds = models.get(key, load)
    if cached:
        progress(10, f"复用已加载的 {engine} ONNX 模型（CPU）")
    if not 0 <= sid < tts.num_speakers:
        raise ValueError(f"该模型音色编号超出范围：0–{tts.num_speakers - 1}")
    caption_chars = int(request.get("captionChars", 100))
    if not 8 <= caption_chars <= 100:
        raise ValueError("字幕分段长度必须在 8–100 字符之间")
    chunks = text_chunks(request["text"], limit=caption_chars)
    if not chunks:
        raise ValueError("请输入有效的配音文字")
    generation = time.monotonic()
    sample_count = 0
    segments = []
    with wave.open(str(output), "wb") as audio_file:
        audio_file.setnchannels(1)
        audio_file.setsampwidth(2)
        audio_file.setframerate(tts.sample_rate)
        for index, chunk in enumerate(chunks):
            progress(15 + 75 * index / len(chunks), f"ONNX · CPU：正在生成第 {index + 1}/{len(chunks)} 段")
            # Playback speed is applied once by Electron's atempo conversion.
            audio = tts.generate(chunk, sid=sid, speed=1.0)
            samples = np.asarray(audio.samples, dtype=np.float32)
            if not len(samples) or not np.isfinite(samples).all():
                raise RuntimeError(f"第 {index + 1} 段没有生成有效音频")
            audio_file.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
            segment_start = sample_count / tts.sample_rate
            sample_count += len(samples)
            segments.append({"start": segment_start, "end": sample_count / tts.sample_rate, "text": chunk})
    metadata = {"model": engine, "device": "cpu", "precision": "int8" if engine == "kokoro-onnx" else "float32",
                "sampleRate": tts.sample_rate, "duration": sample_count / tts.sample_rate,
                "loadSeconds": load_seconds, "modelCached": cached,
                "generationSeconds": time.monotonic() - generation,
                "modelDirectory": str(directory), "segments": segments}
    Path(f"{output}.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    progress(90, "ONNX 配音生成完成")


def load_tts(engine, directory):
    model = sherpa_onnx.OfflineTtsModelConfig(num_threads=min(4, os.cpu_count() or 1), provider="cpu")
    if engine == "kokoro-onnx":
        model.kokoro = sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=str(directory / "model.int8.onnx"), voices=str(directory / "voices.bin"),
            tokens=str(directory / "tokens.txt"), data_dir=str(directory / "espeak-ng-data"),
            lexicon=",".join(str(directory / name) for name in ("lexicon-us-en.txt", "lexicon-zh.txt")))
        rules = ("phone-zh.fst", "date-zh.fst", "number-zh.fst")
    else:
        model.vits = sherpa_onnx.OfflineTtsVitsModelConfig(
            model=str(directory / "model.onnx"), tokens=str(directory / "tokens.txt"),
            lexicon=str(directory / "lexicon.txt"))
        rules = ("phone.fst", "date.fst", "number.fst")
    config = sherpa_onnx.OfflineTtsConfig(model=model, rule_fsts=",".join(str(directory / name) for name in rules),
                                          max_num_sentences=1)
    if not config.validate():
        raise RuntimeError("ONNX 配音模型配置无效，请检查模型目录")
    return sherpa_onnx.OfflineTts(config)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    synthesize(json.loads(Path(args.request).read_text(encoding="utf-8")), Path(args.output))


if __name__ == "__main__":
    main()
