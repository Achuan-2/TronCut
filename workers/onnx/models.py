"""Resolve ONNX models from TronCut's cache or an explicitly selected directory."""
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request

RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download"
MODELS = {
    "qwen3-asr": {
        "directory": "qwen3-asr-0.6b",
        "release": "asr-models",
        "archive": "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25.tar.bz2",
        "inner": "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25",
        "files": (
            "conv_frontend.onnx",
            "encoder.int8.onnx",
            "decoder.int8.onnx",
            "tokenizer/chat_template.json",
            "tokenizer/config.json",
            "tokenizer/vocab.json",
            "tokenizer/merges.txt",
            "tokenizer/preprocessor_config.json",
            "tokenizer/tokenizer_config.json",
        ),
    },
    "sensevoice": {
        "directory": "sensevoice-small",
        "repo": "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
        "files": ("model.int8.onnx", "tokens.txt"),
    },
    "kokoro-onnx": {
        "directory": "kokoro-multi-lang-v1_1",
        "archive": "kokoro-int8-multi-lang-v1_1.tar.bz2",
        "inner": "kokoro-int8-multi-lang-v1_1",
        "files": ("model.int8.onnx", "tokens.txt", "voices.bin", "lexicon-us-en.txt",
                  "lexicon-zh.txt", "espeak-ng-data/phontab", "date-zh.fst", "number-zh.fst", "phone-zh.fst"),
    },
    "vits-onnx": {
        "directory": "vits-zh-aishell3",
        "archive": "vits-icefall-zh-aishell3.tar.bz2",
        "inner": "vits-icefall-zh-aishell3",
        "files": ("model.onnx", "tokens.txt", "lexicon.txt", "date.fst", "number.fst", "phone.fst"),
    },
}


def cache_root():
    return Path(os.environ.get("TRONCUT_ONNX_MODELS", Path.home() / ".cache/troncut/onnx"))


def staging_root():
    directory = Path(os.environ.get("TRONCUT_ONNX_DOWNLOAD_TEMP", cache_root()))
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def installed(directory, spec):
    return all((directory / file).is_file() and (directory / file).stat().st_size > 0
               for file in spec["files"])


def download(url, destination, progress):
    """Publish a complete file atomically; cancellation can only leave a temporary file."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".download-", dir=staging_root())
    os.close(fd)
    partial = Path(name)
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "TronCut/ONNX"})
        with urllib.request.urlopen(request, timeout=30) as response, partial.open("wb") as output:
            total = int(response.headers.get("Content-Length", 0))
            received, reported = 0, -1
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                received += len(chunk)
                percent = int(received * 100 / total) if total else 0
                if percent != reported:
                    progress(2, f"正在下载 {destination.name}：{received // 1048576} MB" +
                             (f" / {total // 1048576} MB（{percent}%）" if total else ""))
                    reported = percent
            if not received or (total and received != total):
                raise RuntimeError(f"模型下载不完整：{destination.name}")
        partial.replace(destination)
    except Exception as error:
        raise RuntimeError(f"下载 {destination.name} 失败，请检查网络或指定已有模型目录：{error}") from error
    finally:
        partial.unlink(missing_ok=True)


def resolve_model(engine, model_dir, offline, progress):
    spec = MODELS[engine]
    if model_dir:
        directory = Path(model_dir).expanduser().resolve()
        if not installed(directory, spec):
            missing = [name for name in spec["files"] if not (directory / name).is_file()]
            raise RuntimeError(f"模型目录不完整：{directory}；需要 {', '.join(missing) or '非空模型文件'}")
        progress(5, f"使用指定模型：{directory}")
        return directory
    cached = cache_root() / spec["directory"]
    if installed(cached, spec):
        progress(5, f"使用本地模型：{cached}")
        return cached
    if offline:
        raise RuntimeError(f"本地缺少 {spec['directory']} 模型；请选择完整模型目录，或关闭仅使用本地模型")
    cached.parent.mkdir(parents=True, exist_ok=True)
    # Download into our own staging directory, never into the user's supplied directory.
    with tempfile.TemporaryDirectory(prefix=".prepare-", dir=staging_root()) as staging:
        staging = Path(staging)
        if "repo" in spec:
            directory = staging / spec["directory"]
            for name in spec["files"]:
                download(f"https://huggingface.co/{spec['repo']}/resolve/main/{name}", directory / name, progress)
        else:
            archive = staging / spec["archive"]
            download(f"{RELEASE}/{spec.get('release', 'tts-models')}/{spec['archive']}", archive, progress)
            progress(3, "正在解压 ONNX 模型")
            with tarfile.open(archive) as bundle:
                bundle.extractall(staging / "unpacked", filter="data")
            directory = staging / "unpacked" / spec["inner"]
        if not installed(directory, spec):
            raise RuntimeError("下载的模型缺少必需文件，请重新准备模型")
        # Only replace the selected cache directory, after the replacement is complete.
        if cached.exists():
            shutil.rmtree(cached)
        directory.replace(cached)
    return cached


def resolve_vad(model_dir, offline, progress):
    candidates = [cache_root() / "silero_vad.onnx"]
    if model_dir:
        directory = Path(model_dir).expanduser()
        candidates += [directory / "silero_vad.onnx", directory.parent / "silero-vad/silero_vad.onnx"]
    for candidate in candidates:
        if candidate.is_file() and candidate.stat().st_size > 0:
            return candidate
    if offline:
        raise RuntimeError("本地缺少 silero_vad.onnx；可放入识别模型目录，或关闭仅使用本地模型下载一次")
    destination = candidates[0]
    download("https://huggingface.co/csukuangfj/vad/resolve/main/silero_vad.onnx", destination, progress)
    return destination
