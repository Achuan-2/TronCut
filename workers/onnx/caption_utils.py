"""Use model timestamps when available; otherwise retain real VAD boundaries."""
import math
import re

TAG = re.compile(r"<\|[^|]*\|>")


def clean_text(text):
    return TAG.sub("", str(text)).replace("▁", " ").strip()


def result_cues(result, start, end, max_chars=22):
    text = clean_text(result.text)
    if not text or end <= start:
        return []
    tokens = list(result.tokens or [])
    timestamps = list(result.timestamps or [])
    durations = list(getattr(result, "durations", []) or [])
    fallback = [{"start": start, "end": end, "text": text}]
    if not tokens or len(tokens) != len(timestamps):
        return fallback
    if any(not math.isfinite(t) or t < 0 or (i and t < timestamps[i - 1])
           for i, t in enumerate(timestamps)):
        return fallback
    cues, pending, pending_start, pending_end = [], "", start, start
    text_cursor = 0
    for index, raw_token in enumerate(tokens):
        token = clean_text(raw_token)
        if not token:
            continue
        token_start = min(end, start + timestamps[index])
        if len(durations) == len(tokens) and math.isfinite(durations[index]) and durations[index] > 0:
            token_end = min(end, token_start + durations[index])
        else:
            token_end = min(end, start + timestamps[index + 1]) if index + 1 < len(tokens) else end
        if token_end <= token_start:
            # Repeated timestamps cannot be turned into credible word boundaries.
            return fallback
        # Preserve spaces from the recognizer's text, rather than inserting spaces
        # between Latin subword pieces (e.g. "hel" + "lo").
        position = text.find(token, text_cursor)
        spaced = (any(char.isspace() for char in text[text_cursor:position]) if position >= 0
                  else str(raw_token).startswith(("▁", " ")))
        if position >= 0:
            text_cursor = position + len(token)
        separator = " " if pending and spaced else ""
        punctuation_only = all(not char.isalnum() for char in token)
        if pending and not punctuation_only and (len(pending + separator + token) > max_chars or token_end - pending_start > 5):
            cues.append({"start": pending_start, "end": pending_end, "text": pending})
            pending, separator = "", ""
        if not pending:
            pending_start = token_start
        pending += separator + token
        pending_end = token_end
        if token.endswith(("。", "！", "？", ".", "!", "?")):
            cues.append({"start": pending_start, "end": pending_end, "text": pending})
            pending = ""
    if pending:
        cues.append({"start": pending_start, "end": pending_end, "text": pending})
    return cues or fallback
