"""Streaming WAV reader + Silero VAD + sherpa-onnx offline recognition."""
import argparse
import json
import os
from pathlib import Path
import wave

import numpy as np
import sherpa_onnx

from caption_utils import recognition_cues
from models import resolve_model, resolve_vad

SAMPLE_RATE = 16000
QWEN_LANGUAGES = {
    "zh": "Chinese",
    "en": "English",
    "ja": "Japanese",
    "ko": "Korean",
    "yue": "Cantonese",
}


def progress(percent, label):
    print("FRAMECRAFT_PROGRESS " + json.dumps({"percent": percent, "label": label}, ensure_ascii=False), flush=True)


def transcribe(request):
    engine = request["engine"]
    if engine not in ("qwen3-asr", "sensevoice"):
        raise ValueError("请选择 Qwen3-ASR 或 SenseVoiceSmall ONNX 模型")
    device = request.get("device", "cpu")
    if device not in ("auto", "cpu"):
        raise ValueError("语音识别仅支持 CPU")
    language = request.get("language", "auto")
    if language != "auto" and language not in QWEN_LANGUAGES:
        raise ValueError("不支持的识别语言")
    recognize = load_cpu_recognizer(request)
    progress(10, f"{engine} CPU 模型已就绪")
    vad_model = resolve_vad(request.get("modelDir"), request.get("offline", False), progress)
    return recognize_wav(request["input"], recognize, vad_model, engine, "CPU", language)


def load_cpu_recognizer(request):
    engine = request["engine"]
    language = request.get("language", "auto")
    directory = resolve_model(engine, request.get("modelDir"), request.get("offline", False), progress)
    threads = min(4, os.cpu_count() or 1)
    common = dict(num_threads=threads, provider="cpu")
    progress(8, f"正在加载 {engine} ONNX 模型（CPU）")
    if engine == "qwen3-asr":
        recognizer = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
            **common,
            conv_frontend=str(directory / "conv_frontend.onnx"),
            encoder=str(directory / "encoder.int8.onnx"),
            decoder=str(directory / "decoder.int8.onnx"),
            tokenizer=str(directory / "tokenizer"),
            feature_dim=128,
            max_total_len=512,
            max_new_tokens=128,
            temperature=1e-6,
            top_p=0.8,
            seed=42,
        )
    else:
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            **common, tokens=str(directory / "tokens.txt"),
            model=str(directory / "model.int8.onnx"),
            language="" if language == "auto" else language, use_itn=True)
    def recognize(batch, language):
        results = []
        for samples in batch:
            stream = recognizer.create_stream()
            if engine == "qwen3-asr" and language:
                stream.set_option("language", language)
            stream.accept_waveform(SAMPLE_RATE, samples)
            recognizer.decode_stream(stream)
            results.append(stream.result)
        return results

    return recognize


def recognize_wav(input_path, recognize, vad_model, engine, label, language):
    """Stream VAD segments through the CPU recognizer, preserving project time."""
    config = sherpa_onnx.VadModelConfig()
    config.silero_vad.model = str(vad_model)
    config.silero_vad.min_silence_duration = 0.35
    config.silero_vad.min_speech_duration = 0.15
    config.silero_vad.max_speech_duration = 8.0
    config.silero_vad.window_size = 512
    config.sample_rate = SAMPLE_RATE
    config.num_threads = 1
    config.provider = "cpu"
    vad = sherpa_onnx.VoiceActivityDetector(config, buffer_size_in_seconds=30)
    cues = []
    count = 0
    pending = []

    def decode_pending():
        nonlocal count
        if not pending:
            return
        results = recognize([samples for _, _, samples in pending], QWEN_LANGUAGES.get(language))
        if len(results) != len(pending):
            raise RuntimeError("识别结果数量与语音段不一致，请重试")
        for result, (start, end, _) in zip(results, pending):
            # Segment once in the shared editor pipeline.
            cues.extend(recognition_cues(result, start, end))
        count += len(pending)
        pending.clear()

    def drain(total_samples):
        while not vad.empty():
            segment = vad.front
            start = segment.start / SAMPLE_RATE
            samples = np.asarray(segment.samples, dtype=np.float32)
            end = min(total_samples / SAMPLE_RATE, start + len(samples) / SAMPLE_RATE)
            if len(samples) and end > start:
                pending.append((start, end, samples))
                decode_pending()
            vad.pop()

    with wave.open(input_path, "rb") as audio:
        if (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()) != (SAMPLE_RATE, 1, 2):
            raise ValueError("识别输入必须为 16 kHz 单声道 PCM16 WAV")
        total = audio.getnframes()
        processed, reported = 0, -1
        while data := audio.readframes(512):
            samples = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768
            processed += len(samples)
            if len(samples) < 512:
                samples = np.pad(samples, (0, 512 - len(samples)))
            vad.accept_waveform(samples)
            drain(total)
            percent = 12 + int(86 * processed / max(total, 1))
            if percent != reported:
                progress(percent, f"{engine} · {label}：已识别 {count} 个语音段")
                reported = percent
        # Flush preserves a final utterance even without trailing silence.
        vad.flush()
        drain(total)
        decode_pending()
    return sorted(cues, key=lambda cue: cue["start"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    cues = transcribe(request)
    Path(args.output).write_text(json.dumps(cues, ensure_ascii=False), encoding="utf-8")
    progress(100, f"ONNX 识别完成：{len(cues)} 条字幕")


if __name__ == "__main__":
    main()
