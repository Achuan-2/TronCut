import { z } from "zod";

export const onnxModelSchema = z.enum([
  "qwen3-asr",
  "sensevoice",
  "kokoro-onnx",
  "vits-onnx",
]);
export type OnnxModel = z.infer<typeof onnxModelSchema>;
export interface PreparedOnnxModel {
  engine: OnnxModel;
  directory: string;
}

/** CUDA recognition uses an optional extra in a separate virtual environment. */
export function onnxWorkerArguments(
  workers: string,
  script: "transcribe.py" | "synthesize.py" | "prepare.py",
  request: string,
  output: string,
  offline = false,
  cuda = false,
): string[] {
  return [
    "run",
    "--project",
    workers,
    "--python",
    "3.12",
    "--frozen",
    ...(cuda ? ["--extra", "qwen-gpu"] : []),
    ...(offline ? ["--offline"] : []),
    "python",
    `${workers}/${script}`,
    "--request",
    request,
    "--output",
    output,
  ];
}
