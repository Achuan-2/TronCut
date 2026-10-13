// Windows development helper. Download and verify before extracting any executables.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
if (process.platform !== "win32")
  throw new Error(
    "macOS 请安装包含 libx264 的 FFmpeg，并在设置中选择 ffmpeg / ffprobe。",
  );
const url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const checksumResponse = await fetch(`${url}.sha256`);
if (!checksumResponse.ok) throw new Error("无法取得 FFmpeg 校验值");
const expected = (await checksumResponse.text())
  .trim()
  .split(/\s/)[0]
  .toLowerCase();
if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("FFmpeg 校验值格式错误");
await mkdir(".cache/engines", { recursive: true });
const file = ".cache/engines/ffmpeg.zip";
const response = await fetch(url);
if (!response.ok || !response.body)
  throw new Error(`FFmpeg 下载失败 ${response.status}`);
console.log(
  `正在下载 FFmpeg：${Math.round(Number(response.headers.get("content-length")) / 1048576)} MiB`,
);
await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
const hash = createHash("sha256");
for await (const chunk of createReadStream(file)) hash.update(chunk);
const actual = hash.digest("hex");
if (actual !== expected) throw new Error(`FFmpeg SHA256 校验失败：${actual}`);
await writeFile(
  ".cache/engines/download.json",
  JSON.stringify(
    { url, sha256: actual, downloaded: new Date().toISOString() },
    null,
    2,
  ),
);
console.log(`SHA256 校验通过：${actual}`);
