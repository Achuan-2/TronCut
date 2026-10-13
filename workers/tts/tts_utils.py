"""Pure narration helpers, independent of model and device initialization."""
import re
from collections.abc import Callable


def split_text(text: str, limit: int = 180) -> list[str]:
    """Split paragraphs at sentence/word boundaries while bounding model input length."""
    if limit < 1:
        raise ValueError("分段长度必须大于零")
    chunks = []
    for paragraph in text.strip().splitlines():
        parts = re.findall(r"[^。！？!?；;]+[。！？!?；;]*|[。！？!?；;]+", paragraph.strip())
        current = ""
        for part in parts:
            while len(part) > limit:
                if current:
                    chunks.append(current)
                    current = ""
                # Prefer a word/clause boundary; hard-split only uninterrupted text.
                boundaries = [match.end() for match in re.finditer(r"[\s，,、：:]", part[:limit])]
                cut = boundaries[-1] if boundaries and boundaries[-1] >= limit // 2 else limit
                chunks.append(part[:cut])
                part = part[cut:]
            if len(current) + len(part) > limit:
                chunks.append(current)
                current = ""
            current += part
        if current:
            chunks.append(current)
    return chunks


def phoneme_chunks(text: str, phonemize: Callable, limit: int = 510) -> list[str]:
    """Avoid Kokoro's silent phoneme truncation after Chinese/number expansion."""
    if limit < 1:
        raise ValueError("音素长度必须大于零")
    phonemes, _ = phonemize(text)
    if not phonemes:
        raise ValueError("文字没有可朗读的音素，请检查文稿")
    if len(phonemes) <= limit:
        return [phonemes]
    if len(text) < 2:
        raise ValueError("单个字符转换后的音素过长，请将数字或符号改写为文字")
    return [
        phonemes
        for part in split_text(text, max(1, len(text) // 2))
        for phonemes in phoneme_chunks(part, phonemize, limit)
    ]


def choose_device(requested, torch):
    if requested == "auto":
        if torch.cuda.is_available():
            return "cuda"
        # CPU is the safe automatic choice on Mac; MPS remains explicitly selectable.
        return "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise ValueError("CUDA 不可用，请选择 CPU，或配置支持 CUDA 的 PyTorch。")
    if requested == "mps" and not torch.backends.mps.is_available():
        raise ValueError("MPS 不可用，请选择 CPU；MPS 仅适用于支持的 Mac。")
    if requested not in {"cpu", "cuda", "mps"}:
        raise ValueError("未知计算设备")
    return requested
