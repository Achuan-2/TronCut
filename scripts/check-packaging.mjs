import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
for (const name of ["ffmpeg", "ffprobe"]) {
  const file = path.resolve(
    "resources/bin",
    name + (process.platform === "win32" ? ".exe" : ""),
  );
  if (!fs.existsSync(file))
    throw new Error(`安装包缺少目标平台媒体引擎：${file}`);
  const result = spawnSync(file, ["-version"], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(`安装包媒体引擎不能独立运行：${name}`);
}
console.log("安装包媒体引擎检查通过");
