"""Encode a voice prompt, usable both as a resident task and from the command line."""
import argparse
import json
from pathlib import Path
from lux import clone_voice

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    clone_voice(json.loads(Path(args.request).read_text(encoding="utf-8")), Path(args.output))
