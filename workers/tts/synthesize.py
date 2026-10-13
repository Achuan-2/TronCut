"""Local Kokoro / Qwen3-TTS worker. No hosted speech endpoint or text upload."""
import argparse
import json
import os
from pathlib import Path
import time

from tts_utils import choose_device, phoneme_chunks, split_text

MODELS = {
    "kokoro": "hexgrad/Kokoro-82M-v1.1-zh",
    "qwen-small": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    "qwen-quality": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
}


def progress(percent, label):
    print("TRONCUT_PROGRESS " + json.dumps({"percent": percent, "label": label}, ensure_ascii=False), flush=True)


def synthesize(options, output):
    started = time.perf_counter()
    progress(2, "正在加载配音运行环境")
    import numpy as np
    import soundfile as sf
    import torch

    # Avoid oversubscribing laptop CPUs during audio generation.
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    device = choose_device(options.get("device", "auto"), torch)
    engine = options["engine"]
    parts = split_text(options["text"])
    if not parts:
        raise ValueError("请输入有效的配音文字")
    progress(5, f"正在加载 {engine} 模型（{device}）")
    if engine == "kokoro":
        from kokoro import KModel, KPipeline
        repo = MODELS[engine]
        model = KModel(repo_id=repo).to(device).eval()
        en_pipeline = KPipeline(lang_code="a", repo_id=repo, model=False)

        def english_phonemes(text):
            # Use dictionary/rule pronunciation; no eSpeak installation is required.
            phonemes, _ = en_pipeline.g2p(text)
            return phonemes

        pipeline = KPipeline(lang_code="z", repo_id=repo, model=model, en_callable=english_phonemes)
        sample_rate = 24000

        def generate(text):
            with torch.inference_mode():
                for phonemes in phoneme_chunks(text, pipeline.g2p):
                    for result in pipeline.generate_from_tokens(phonemes, voice=options["voice"], speed=1):
                        if result.audio is not None:
                            yield result.audio.detach().cpu().numpy()
    else:
        from qwen_tts import Qwen3TTSModel
        model = Qwen3TTSModel.from_pretrained(
            MODELS[engine], device_map=device,
            dtype=torch.float32 if device == "cpu" else torch.float16,
            attn_implementation="eager",
        )
        sample_rate = 24000  # Replaced with the tokenizer's actual output rate below.

        def generate(text):
            nonlocal sample_rate
            kwargs = {
                "text": text,
                "language": "Chinese" if options.get("language", "zh") == "zh" else "English",
                "speaker": options["voice"],
                "max_new_tokens": 4096,
            }
            if engine == "qwen-quality" and options.get("instruction"):
                kwargs["instruct"] = options["instruction"]
            with torch.inference_mode():
                wavs, sample_rate = model.generate_custom_voice(**kwargs)
            yield np.asarray(wavs[0], dtype=np.float32)

    loaded = time.perf_counter()
    progress(15, "模型已加载，正在生成配音")
    frames = 0
    writer = None
    try:
        for index, text in enumerate(parts):
            generated = False
            for audio in generate(text):
                audio = np.asarray(audio, dtype=np.float32).reshape(-1)
                if not audio.size or not np.isfinite(audio).all():
                    raise ValueError("模型返回了无效音频")
                if writer is None:
                    writer = sf.SoundFile(str(output), mode="w", samplerate=sample_rate, channels=1, subtype="PCM_16")
                if writer.samplerate != sample_rate:
                    raise ValueError("模型输出的采样率不一致")
                writer.write(audio)
                frames += audio.size
                generated = True
            if not generated:
                raise ValueError(f"第 {index + 1} 段没有生成语音，请检查文字或音色")
            if index + 1 < len(parts):
                silence = np.zeros(round(sample_rate * 0.2), dtype=np.float32)
                writer.write(silence)
                frames += silence.size
            progress(15 + 78 * (index + 1) / len(parts), f"已生成 {index + 1} / {len(parts)} 段配音")
    finally:
        if writer:
            writer.close()
    if not frames:
        raise ValueError("模型没有生成语音")
    report = {
        "model": MODELS[engine], "device": device, "sampleRate": sample_rate,
        "duration": frames / sample_rate, "loadSeconds": loaded - started,
        "generationSeconds": time.perf_counter() - loaded,
    }
    Path(str(output) + ".json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    progress(94, "语音生成完成")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text(encoding="utf8"))
    try:
        synthesize(request, Path(args.output))
    except Exception as error:
        raise SystemExit(f"本地配音失败：{error}") from error
