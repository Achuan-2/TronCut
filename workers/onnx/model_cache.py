"""Bounded, process-local cache of native ONNX sessions. Requests run serially."""
from collections import OrderedDict
from pathlib import Path
import time

from models import MODELS


class ModelCache:
    def __init__(self, capacity=4):
        self.capacity = capacity
        self.entries = OrderedDict()

    def get(self, key, factory):
        if key in self.entries:
            value = self.entries.pop(key)
            self.entries[key] = value
            return value, True, 0.0
        # Evict before loading to bound peak native-session memory.
        while len(self.entries) >= self.capacity:
            self.entries.popitem(last=False)
        started = time.monotonic()
        value = factory()
        self.entries[key] = value
        return value, False, time.monotonic() - started

    def clear(self):
        self.entries.clear()


def file_key(file):
    file = Path(file).resolve()
    stat = file.stat()
    return str(file), stat.st_size, stat.st_mtime_ns


def model_key(engine, directory, *settings):
    return (engine, tuple(file_key(directory / name) for name in MODELS[engine]["files"]), *settings)


models = ModelCache()
vad_models = ModelCache(capacity=1)
