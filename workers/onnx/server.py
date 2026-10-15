"""Private JSON-lines worker. stdin EOF releases all cached native sessions."""
import json
import os
from pathlib import Path
import sys
import traceback


def serve():
    for line in sys.stdin:
        message = json.loads(line)
        result = {"id": message["id"]}
        try:
            os.environ["TRONCUT_ONNX_DOWNLOAD_TEMP"] = message["downloadTemp"]
            request = json.loads(Path(message["request"]).read_text(encoding="utf-8"))
            output = Path(message["output"])
            if message["script"] == "synthesize.py":
                from synthesize import synthesize
                synthesize(request, output)
            elif message["script"] == "transcribe.py":
                from transcribe import transcribe
                cues = transcribe(request)
                output.write_text(json.dumps(cues, ensure_ascii=False), encoding="utf-8")
            else:
                raise ValueError("不支持的 ONNX 任务")
            result["ok"] = True
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            result.update(ok=False, error=str(error))
        finally:
            os.environ.pop("TRONCUT_ONNX_DOWNLOAD_TEMP", None)
        print("TRONCUT_RESULT " + json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    serve()
