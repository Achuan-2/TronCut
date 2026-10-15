"""Official Qwen3-ASR CUDA backend; imported only for explicit GPU requests."""
import importlib.abc
import importlib.machinery
import importlib.util
import sys
from types import SimpleNamespace

from models import resolve_model

GPU_BATCH_SIZE = 4

class _LazyAlignmentTokenizer(importlib.abc.MetaPathFinder):
    """Defer qwen-asr 0.0.6's eager Japanese alignment model initialization.

    Recognition does not use the forced aligner. Python's standard lazy loader
    keeps the real module available if alignment is added later, without loading
    its separate CPU model during every GPU recognition task.
    """
    def find_spec(self, fullname, path, target=None):
        if fullname != "nagisa":
            return None
        spec = importlib.machinery.PathFinder.find_spec(fullname, path)
        if spec and spec.loader:
            spec.loader = importlib.util.LazyLoader(spec.loader)
        return spec


def qwen_model_class():
    finder = _LazyAlignmentTokenizer()
    sys.meta_path.insert(0, finder)
    try:
        from qwen_asr import Qwen3ASRModel
        return Qwen3ASRModel
    finally:
        sys.meta_path.remove(finder)


def load_gpu_recognizer(request, progress):
    try:
        import torch
    except (ImportError, OSError) as error:
        raise RuntimeError("GPU 环境未就绪，请联网重新准备 CUDA 环境，或选择 CPU") from error
    if not torch.cuda.is_available():
        raise RuntimeError("未检测到可用的 NVIDIA CUDA 显卡，请更新显卡驱动或选择 CPU")
    progress(2, "CUDA 显卡可用，正在初始化识别组件（首次启动可能较慢）")
    try:
        Qwen3ASRModel = qwen_model_class()
    except (ImportError, OSError) as error:
        raise RuntimeError("GPU 识别组件加载失败，请重新准备 CUDA 环境，或选择 CPU") from error
    directory = resolve_model("qwen3-asr-cuda", request.get("modelDir"),
                              request.get("offline", False), progress)
    name = torch.cuda.get_device_name(0)
    progress(8, f"正在加载 Qwen3-ASR GPU 模型：{name}")
    try:
        model = Qwen3ASRModel.from_pretrained(
            str(directory), dtype=torch.float16, device_map="cuda:0",
            attn_implementation="sdpa", max_inference_batch_size=GPU_BATCH_SIZE,
            max_new_tokens=128, local_files_only=True,
        )
    except torch.cuda.OutOfMemoryError as error:
        raise RuntimeError("GPU 显存不足，请关闭其他占用显存的程序，或切换 CPU 后重试") from error
    # Report the actual device after loading, rather than only the requested one.
    if model.device.type != "cuda":
        raise RuntimeError("Qwen3-ASR 未加载到 GPU，请选择 CPU 或检查 CUDA 环境")
    progress(10, f"GPU 已就绪：{name} · FP16")

    def recognize(batch, language):
        try:
            with torch.inference_mode():
                results = model.transcribe(audio=[(samples, 16000) for samples in batch], language=language)
            # No aligner is loaded: retain real VAD boundaries, without inventing word times.
            return [SimpleNamespace(text=result.text, tokens=[], timestamps=[]) for result in results]
        except torch.cuda.OutOfMemoryError as error:
            raise RuntimeError("GPU 显存不足，请关闭其他占用显存的程序，或切换 CPU 后重试") from error

    return recognize
