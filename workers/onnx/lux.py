"""LuxTTS ONNX integration with TronCut-owned downloads, prompts and model cache."""
import hashlib
import json
import os
from pathlib import Path
import time
import wave

import numpy as np

from model_cache import ModelCache, models, model_key, file_key
from models import MODELS, resolve_model

prompts = ModelCache(capacity=16)
# Upstream multiplies speed by 1.3 before the ONNX encoder divides the *total*
# duration, including the fixed reference. Cancel that factor so short sentences
# retain their full generated duration. User speed is applied only by FFmpeg.
BASE_SPEED = 1.0 / 1.3


def progress(percent, label):
    print("TRONCUT_PROGRESS " + json.dumps({"percent": percent, "label": label}, ensure_ascii=False), flush=True)


def load_lux(directory):
    from luxtts_onnx import LuxTTSOnnx
    from luxtts_onnx.tokenizer import EmiliaTokenizer
    import onnxruntime as ort

    for name, (_, _, expected) in MODELS["lux-onnx"]["sources"].items():
        with (directory / name).open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != expected:
                raise RuntimeError(f"LuxTTS 模型文件校验失败：{name}；请重新下载完整 ONNX 模型")
    # Initialize the library's inference object from verified local files. Its
    # regular constructor can download whole HF repos, including PyTorch weights,
    # and cannot enforce TronCut's offline or cancellation rules.
    tts = LuxTTSOnnx.__new__(LuxTTSOnnx)
    settings = ort.SessionOptions()
    settings.intra_op_num_threads = min(4, os.cpu_count() or 1)
    settings.inter_op_num_threads = 1
    for attribute, filename in (("text_encoder", "text_encoder.onnx"), ("fm_decoder", "fm_decoder.onnx"), ("vocos", "vocos.onnx")):
        setattr(tts, attribute, ort.InferenceSession(str(directory / filename), sess_options=settings, providers=["CPUExecutionProvider"]))
    tts.feat_dim = int(tts.fm_decoder.get_modelmeta().custom_metadata_map["feat_dim"])
    tts.tokenizer = EmiliaTokenizer(token_file=str(directory / "tokens.txt"))
    return tts


def cached_lux(request):
    if request.get("device", "cpu") not in ("auto", "cpu"):
        raise ValueError("LuxTTS ONNX 当前使用 CPU")
    directory = resolve_model("lux-onnx", request.get("modelDir"), request.get("offline", False), progress)
    key = model_key("lux-onnx", directory)
    def load():
        progress(10, "正在加载 LuxTTS ONNX 模型（CPU）")
        return load_lux(directory)
    tts, cached, seconds = models.get(key, load)
    if cached:
        progress(10, "复用已加载的 LuxTTS ONNX 模型（CPU）")
    return tts, directory, cached, seconds


def clone_voice(request, output):
    import soundfile as sf
    transcript = request.get("transcript", "").strip()
    if not transcript or len(transcript) > 2000:
        raise ValueError("请填写参考音频的文字内容（最多 2000 字符）")
    audio, rate = sf.read(request["input"], dtype="float32")
    if audio.ndim != 1 or not 3 <= len(audio) / rate <= 30.1:
        raise ValueError("请使用 3–30 秒的单声道参考音频")
    if not np.isfinite(audio).all() or float(np.sqrt(np.mean(audio ** 2))) < 1e-5:
        raise ValueError("参考录音没有有效声音，请检查麦克风或更换参考音频")
    tts, _, _, _ = cached_lux(request)
    progress(40, "正在提取参考声音特征")
    prompt = tts.encode_prompt(request["input"], transcript, duration=30.1)
    if not prompt["prompt_tokens"][0]:
        raise ValueError("参考文字没有可用的中文或英文内容")
    tts.save_prompt(prompt, str(output))
    progress(95, "声音特征已保存")


def synthesize(request, output):
    from synthesize import text_chunks
    prompt_file = Path(request["promptFile"])
    tts, directory, cached, seconds = cached_lux(request)
    prompt, _, _ = prompts.get(file_key(prompt_file), lambda: tts.load_prompt(str(prompt_file)))
    chars = int(request.get("captionChars", 100))
    if not 8 <= chars <= 100:
        raise ValueError("字幕分段长度必须在 8–100 字符之间")
    chunks = text_chunks(request["text"], chars)
    if not chunks:
        raise ValueError("请输入有效的配音文字")
    started = time.monotonic()
    count, segments = 0, []
    with wave.open(str(output), "wb") as audio:
        audio.setparams((1, 2, 48000, 0, "NONE", ""))
        for index, chunk in enumerate(chunks):
            progress(15 + 75 * index / len(chunks), f"LuxTTS · CPU：正在生成第 {index + 1}/{len(chunks)} 段")
            # Final playback speed is applied exactly once by FFmpeg.
            samples = np.asarray(tts.generate(chunk, prompt, num_steps=4, speed=BASE_SPEED), dtype=np.float32).reshape(-1)
            if not len(samples) or not np.isfinite(samples).all():
                raise RuntimeError("LuxTTS 没有生成有效音频")
            audio.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
            start = count / 48000
            count += len(samples)
            segments.append({"start": start, "end": count / 48000, "text": chunk})
    metadata = {"model": "lux-onnx", "device": "cpu", "precision": "float32", "sampleRate": 48000,
                "duration": count / 48000, "loadSeconds": seconds, "modelCached": cached,
                "generationSeconds": time.monotonic() - started, "modelDirectory": str(directory), "segments": segments}
    Path(f"{output}.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
    progress(90, "LuxTTS 克隆配音生成完成")
