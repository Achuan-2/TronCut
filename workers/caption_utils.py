"""Caption conversion without model dependencies; never invent word timings."""
import math
import re
from dataclasses import dataclass

TAG = re.compile(r"<\|[^|]*\|>")


@dataclass(frozen=True)
class TimedToken:
    text: str
    start: float
    end: float


def clean_text(text):
    return TAG.sub("", text).replace("▁", " ").strip()


def append_text(left, right):
    right = clean_text(right)
    if left and right and re.search(r"[A-Za-z0-9.,!?;:]$", left) and re.match(r"[A-Za-z0-9]", right):
        return f"{left} {right}"
    return left + right


def tokens_to_cues(tokens, max_chars=22, max_seconds=5.0):
    cues, pending = [], []

    def emit():
        if pending:
            text = ""
            for token in pending:
                text = append_text(text, token.text)
            if text:
                cues.append({"start": pending[0].start, "end": pending[-1].end, "text": text})
            pending.clear()

    for token in tokens:
        if not token.text or not math.isfinite(token.start) or not math.isfinite(token.end) or token.end <= token.start:
            continue
        text = ""
        for item in [*pending, token]:
            text = append_text(text, item.text)
        if pending and (len(text) > max_chars or token.end - pending[0].start > max_seconds or token.start - pending[-1].end > 0.7):
            emit()
        pending.append(token)
        if clean_text(token.text).endswith(("。", "！", "？", ".", "!", "?")):
            emit()
    emit()
    return cues


def decode_sensevoice_result(result, offset, segment_end):
    """Current FunASR pairs are milliseconds; legacy repository triples are seconds."""
    timestamps = result.get("timestamp") or []
    words = result.get("words") or []
    def fallback():
        text = clean_text(str(result.get("text", "")))
        return ([{"start": offset, "end": segment_end, "text": text}] if text and segment_end > offset else []), "vad-segment"
    tokens = []
    for index, timestamp in enumerate(timestamps):
        if not isinstance(timestamp, (list, tuple)):
            return fallback()
        if len(timestamp) == 2 and len(words) == len(timestamps):
            try:
                word, start, end = words[index], float(timestamp[0]) / 1000, float(timestamp[1]) / 1000
            except (TypeError, ValueError):
                return fallback()
        elif len(timestamp) == 3 and isinstance(timestamp[0], str):
            word, start, end = timestamp
        else:
            return fallback()
        text = clean_text(str(word))
        try:
            start, end = float(start), float(end)
        except (TypeError, ValueError):
            return fallback()
        if not math.isfinite(start) or not math.isfinite(end):
            return fallback()
        start, end = max(offset, offset + float(start)), min(segment_end, offset + float(end))
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            continue
        if tokens and start < tokens[-1].start:
            return fallback()
        if text:
            tokens.append(TimedToken(text, start, end))
    if tokens:
        return tokens_to_cues(tokens), "ctc-word"
    # Segment boundaries are real VAD boundaries; dividing them by character count would be misleading.
    return fallback()


def vad_ranges(values, offset, duration, max_seconds=10.0):
    ranges = []
    for pair in values:
        if len(pair) != 2:
            continue
        start = max(offset, offset + float(pair[0]) / 1000)
        end = min(duration, offset + float(pair[1]) / 1000)
        if not math.isfinite(start) or not math.isfinite(end) or end <= start:
            continue
        while start < end:
            boundary = min(end, start + max_seconds)
            ranges.append((start, boundary))
            start = boundary
    return sorted(ranges)
