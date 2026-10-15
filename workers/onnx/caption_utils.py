"""Use model timestamps when available; otherwise retain real VAD boundaries."""
import math
import re

TAG = re.compile(r"<\|[^|]*\|>")


def clean_text(text):
    return TAG.sub("", str(text)).replace("▁", " ").strip()


def recognition_cues(result, start, end):
    """Keep the entire VAD text and validated token timing for one later split."""
    text = clean_text(result.text)
    if not text or end <= start:
        return []
    cue = {"start": start, "end": end, "text": text}
    tokens = list(result.tokens or [])
    timestamps = list(result.timestamps or [])
    durations = list(getattr(result, "durations", []) or [])
    if not tokens or len(tokens) != len(timestamps):
        return [cue]
    if any(not math.isfinite(t) or t < 0 or (i and t < timestamps[i - 1])
           for i, t in enumerate(timestamps)):
        return [cue]
    words, cursor = [], 0
    for index, raw_token in enumerate(tokens):
        token = clean_text(raw_token)
        if not token:
            continue
        position = text.find(token, cursor)
        if position < 0:
            return [cue]
        token_start = min(end, start + timestamps[index])
        if len(durations) == len(tokens) and math.isfinite(durations[index]) and durations[index] > 0:
            token_end = min(end, token_start + durations[index])
        else:
            token_end = min(end, start + timestamps[index + 1]) if index + 1 < len(tokens) else end
        if token_end <= token_start:
            return [cue]
        next_cursor = position + len(token)
        words.append({"start": token_start, "end": token_end, "text": text[cursor:next_cursor]})
        cursor = next_cursor
    if words and cursor == len(text):
        cue["words"] = words
    return [cue]
