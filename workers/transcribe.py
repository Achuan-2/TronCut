"""Local-only ASR sidecar; VAD and word timestamps keep captions aligned to speech."""
import argparse
import json
import time
from pathlib import Path


def split_words(segments, max_chars=22):
    cues = []
    for segment in segments:
        words = list(segment.words or [])
        if not words:
            if segment.text.strip():
                cues.append({"start": segment.start, "end": segment.end, "text": segment.text.strip()})
            continue
        pending = []
        for word in words:
            pending.append(word)
            content = "".join(item.word for item in pending).strip()
            if len(content) >= max_chars or content.endswith(("。", "！", "？", ".", "!", "?")):
                cues.append({"start": pending[0].start, "end": pending[-1].end, "text": content})
                pending = []
        if pending:
            cues.append({"start": pending[0].start, "end": pending[-1].end, "text": "".join(item.word for item in pending).strip()})
    return [cue for cue in cues if cue["text"] and cue["end"] > cue["start"]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--language", default="auto")
    parser.add_argument("--model", default="medium")
    parser.add_argument("--engine", choices=["faster-whisper", "sensevoice"], default="faster-whisper")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    args = parser.parse_args()
    started = time.perf_counter()
    def progress(percent, label):
        print("FRAMECRAFT_PROGRESS " + json.dumps({"percent": percent, "label": label}, ensure_ascii=False), flush=True)
    if args.engine == "sensevoice":
        from sensevoice import transcribe_sensevoice
        cues, metadata = transcribe_sensevoice(args.input, args.language, args.device, progress)
        metadata["totalSeconds"] = time.perf_counter() - started
        Path(args.output).write_text(json.dumps(cues, ensure_ascii=False, indent=2), encoding="utf-8")
        Path(args.output + ".metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        return
    from faster_whisper import WhisperModel
    # CPU/int8 is the reproducible baseline on both Windows and macOS.
    # CUDA is reserved for an explicit setting once the required runtime has been checked.
    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, _ = model.transcribe(args.input, language=None if args.language == "auto" else args.language, beam_size=5, vad_filter=True, word_timestamps=True)
    Path(args.output).write_text(json.dumps(split_words(segments), ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
