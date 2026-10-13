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
if (process.platform === "win32") {
  for (const name of ["wgc-capture.exe", "cursor-sampler.exe"]) {
    if (!fs.existsSync(path.resolve("resources/bin", name)))
      throw new Error(`安装包缺少原生录屏组件：${name}`);
  }
  for (const name of [
    "FFmpeg-LICENSE.txt",
    "FFmpeg-README.txt",
    "uv-LICENSE-MIT.txt",
    "uv-LICENSE-APACHE.txt",
    "OpenScreen-LICENSE.txt",
  ]) {
    if (!fs.existsSync(path.resolve("resources/bin", name)))
      throw new Error(`安装包缺少第三方许可声明：${name}`);
  }
}
for (const name of ["pyproject.toml", "uv.lock", "synthesize.py", "tts_utils.py"]) {
  if (!fs.existsSync(path.resolve("workers/tts", name)))
    throw new Error(`安装包缺少配音 worker：${name}`);
}
for (const name of ["pyproject.toml", "uv.lock", "synthesize.py", "models.py"]) {
  if (!fs.existsSync(path.resolve("workers/indextts", name)))
    throw new Error(`安装包缺少 IndexTTS worker：${name}`);
}
console.log("安装包媒体引擎与配音 worker 检查通过");
