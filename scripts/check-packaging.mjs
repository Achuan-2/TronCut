import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
for (const name of ["ffmpeg", "ffprobe", "uv"]) {
  const file = path.resolve(
    "resources/bin",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
  if (!fs.existsSync(file))
    throw new Error(`安装包缺少目标平台媒体引擎：${file}`);
  const result = spawnSync(file, [name === "uv" ? "--version" : "-version"], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`安装包媒体引擎不能独立运行：${name}`);
}
for (const name of [
  "FFmpeg-LICENSE.txt",
  "FFmpeg-README.txt",
  "uv-LICENSE-MIT.txt",
  "uv-LICENSE-APACHE.txt",
]) {
  if (!fs.existsSync(path.resolve("resources/bin", name)))
    throw new Error(`安装包缺少第三方许可声明：${name}`);
}
if (process.platform === "win32") {
  for (const name of ["wgc-capture.exe", "cursor-sampler.exe"]) {
    if (!fs.existsSync(path.resolve("resources/bin", name)))
      throw new Error(`安装包缺少原生录屏组件：${name}`);
  }
  if (!fs.existsSync(path.resolve("resources/bin", "OpenScreen-LICENSE.txt")))
    throw new Error("安装包缺少第三方许可声明：OpenScreen-LICENSE.txt");
}
for (const name of [
  "pyproject.toml",
  "uv.lock",
  "transcribe.py",
  "prepare.py",
  "synthesize.py",
  "models.py",
  "caption_utils.py",
  "model_cache.py",
  "server.py",
  "lux.py",
  "clone.py",
]) {
  if (!fs.existsSync(path.resolve("workers/onnx", name)))
    throw new Error(`安装包缺少 sherpa-onnx worker：${name}`);
}
if (!fs.existsSync(path.resolve("workers/windows-speech/synthesize.ps1")))
  throw new Error("安装包缺少 Windows 系统语音 worker");
console.log("安装包媒体引擎、Windows 语音与 sherpa-onnx worker 检查通过");
