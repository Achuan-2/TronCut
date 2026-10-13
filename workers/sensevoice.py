"""SenseVoiceSmall + FSMN-VAD, using integrated FunASR code rather than remote Python."""
from caption_utils import decode_sensevoice_result, vad_ranges
from functools import lru_cache
from pathlib import Path
import os


def cached_model(model_id):
    """Use an already downloaded local model without querying the hub on every launch."""
    root = Path(os.environ.get("MODELSCOPE_CACHE", Path.home() / ".cache/modelscope"))
    candidates = [root / "models" / model_id.replace("/", "--") / "snapshots/master", root / "hub/models" / model_id, root / "hub" / model_id]
    for candidate in candidates:
        if (candidate / "model.pt").is_file() and (candidate / "config.yaml").is_file():
            return str(candidate)
    return model_id


@lru_cache(maxsize=1)
def load_models(device):
    from funasr import AutoModel
    model = AutoModel(model=cached_model("iic/SenseVoiceSmall"), trust_remote_code=False, device=device, disable_update=True)
    vad = AutoModel(model=cached_model("iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"), trust_remote_code=False, device=device, disable_update=True, max_single_segment_time=10000)
    return model, vad


def recognize_segments(model, ranges, read_segment, language, progress):
    cues, fallback = [], 0
    for index, (start, end) in enumerate(ranges):
        results = model.generate(
            input=read_segment(start, end),
            fs=16000,
            language=language,
            use_itn=True,
            output_timestamp=True,
            batch_size=1,
        )
        if not results:
            continue
        converted, precision = decode_sensevoice_result(results[0], start, end)
        if precision == "vad-segment" and converted:
            fallback += 1
        cues.extend(converted)
        progress(20 + 78 * (index + 1) / len(ranges), f"SenseVoice：已识别 {index + 1}/{len(ranges)} 个语音段")
    return cues, fallback


def transcribe_sensevoice(input_file, language, requested_device, progress):
    import os
    import soundfile as sf
    import torch
    import time

    if requested_device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA 不可用，请选择自动或 CPU；GPU 模式需要匹配的 PyTorch/CUDA 运行环境。")
    device = "cuda:0" if requested_device != "cpu" and torch.cuda.is_available() else "cpu"
    load_started = time.perf_counter()
    torch.set_num_threads(min(8, max(1, os.cpu_count() or 1)))
    progress(1, f"正在加载 SenseVoiceSmall / FSMN-VAD（{device}），首次运行会下载模型")
    # disable_update avoids doing package upgrade/network checks on every transcription.
    model, vad = load_models(device)
    model_load_seconds = time.perf_counter() - load_started
    with sf.SoundFile(input_file) as audio:
        if audio.samplerate != 16000 or audio.channels != 1:
            raise ValueError("SenseVoice 工作进程需要 16 kHz 单声道音频，应用会在调用前自动转换。")
        duration = audio.frames / audio.samplerate

        def read_segment(start, end):
            audio.seek(round(start * audio.samplerate))
            return audio.read(max(0, round((end - start) * audio.samplerate)), dtype="float32")

        ranges = []
        vad_started = time.perf_counter()
        # Bound VAD memory to one minute and ASR encoder memory to ten seconds.
        for window_start in range(0, max(1, int(duration + 0.999)), 60):
            window_end = min(duration, window_start + 60)
            if window_end <= window_start:
                break
            result = vad.generate(input=read_segment(window_start, window_end), fs=16000, is_final=True, max_single_segment_time=10000)
            values = result[0].get("value", []) if result else []
            ranges.extend(vad_ranges(values, window_start, window_end))
            progress(2 + 18 * window_end / duration, "正在检测语音区间，跳过静音")
        vad_seconds = time.perf_counter() - vad_started
        asr_started = time.perf_counter()
        cues, fallback = recognize_segments(model, ranges, read_segment, language, progress)
        asr_seconds = time.perf_counter() - asr_started
    if fallback:
        progress(99, f"识别完成：{fallback} 段使用真实 VAD 区间，未提供词级时间戳")
    return cues, {"engine": "sensevoice", "model": "iic/SenseVoiceSmall", "device": device, "timestampFallbackSegments": fallback, "audioSeconds": duration,
                  "modelLoadSeconds": model_load_seconds, "vadSeconds": vad_seconds, "asrSeconds": asr_seconds}
