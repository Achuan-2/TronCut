"""Isolated IndexTTS 2.5 voice-cloning worker, compatible with TronCut progress IPC."""
import argparse
import json
import os
from pathlib import Path
import time

from models import MODEL_REPO, prepare_models


def progress(percent, label):
    print("TRONCUT_PROGRESS " + json.dumps({"percent": percent, "label": label}, ensure_ascii=False), flush=True)


def synthesize(options, output):
    started = time.perf_counter()
    progress(2, "正在检查 IndexTTS 运行环境")
    import numpy as np
    import soundfile as sf
    import torch

    requested = options.get("device", "auto")
    if requested == "auto":
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
    elif requested == "cuda":
        if not torch.cuda.is_available():
            raise ValueError("CUDA 不可用，请检查 NVIDIA 驱动或选择 CPU")
        device = "cuda:0"
    elif requested == "cpu":
        device = "cpu"
    else:
        raise ValueError("IndexTTS 当前支持 CPU 与 NVIDIA CUDA，MPS 尚未验证")
    if device.startswith("cuda") and not torch.cuda.is_bf16_supported():
        raise ValueError("当前显卡不支持 IndexTTS 的 BF16 模式，请选择 CPU")
    torch.set_num_threads(min(4, os.cpu_count() or 1))
    reference = Path(options["referenceAudio"])
    if not reference.is_file():
        raise ValueError("参考音频不存在，请重新选择")
    root = Path(os.environ["TRONCUT_INDEXTTS_MODELS"]).resolve()
    prepare_models(root, options.get("offline", False), progress)
    progress(12, f"正在加载 IndexTTS 2.5（{device}）")
    # Upstream resets HF_HUB_CACHE on import. Use a contained working directory,
    # with all required auxiliary files prepared, to prevent implicit downloads.
    from indextts.infer_v2_5 import IndexTTS2
    model = IndexTTS2(cfg_path=str(root / "config.yaml"), model_dir=str(root),
                      device=device, use_bf16=device.startswith("cuda"),
                      use_cuda_kernel=False, use_deepspeed=False,
                      use_accel=False, use_torch_compile=False, use_qwen_emo=False)
    loaded = time.perf_counter()
    progress(20, "IndexTTS 模型已加载，正在生成参考音色配音")
    # Small segments bound KV cache use on 6 GB GPUs. Let the upstream tokenizer
    # split at token boundaries rather than chopping pronunciation annotations.
    model.infer(spk_audio_prompt=str(reference), text=options["text"],
                lang="ZH" if options.get("language", "zh") == "zh" else "EN",
                output_path=str(output), duration_factor=1.0,
                max_text_tokens_per_segment=80, verbose=False)
    if not output.is_file():
        raise ValueError("IndexTTS 没有生成音频")
    audio, sample_rate = sf.read(output, dtype="float32")
    if not audio.size or not np.isfinite(audio).all() or not np.any(audio):
        raise ValueError("IndexTTS 返回了无效或静音音频")
    report = {
        "model": MODEL_REPO, "device": device, "precision": "bf16" if model.use_bf16 else "float32",
        "sampleRate": sample_rate, "duration": len(audio) / sample_rate,
        "loadSeconds": loaded - started, "generationSeconds": time.perf_counter() - loaded,
    }
    Path(str(output) + ".json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
    progress(94, "IndexTTS 配音生成完成")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf8"))
        synthesize(request, Path(args.output).resolve())
    except Exception as error:
        raise SystemExit(f"IndexTTS 配音失败：{error}") from error
