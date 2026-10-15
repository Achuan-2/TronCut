// Prepare reviewable artifacts only. This script never commits, pushes, or publishes.
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
if (
  process.env.TRONCUT_RELEASE_TAG &&
  process.env.TRONCUT_RELEASE_TAG !== `v${pkg.version}`
)
  throw new Error("Release tag does not match package.json version.");
if (process.platform !== "win32")
  throw new Error("This release helper prepares Windows x64 artifacts.");
const root = path.resolve("release", "publish", `v${pkg.version}`);
await fs.mkdir(root, { recursive: true });
// GitHub's tag archive is the canonical TronCut source download. Remove a
// stale locally prepared project-source ZIP so broad artifact globs cannot
// accidentally publish it again.
await fs.rm(path.join(root, `TronCut-${pkg.version}-source.zip`), {
  force: true,
});
// Remove metadata left by earlier packaging runs from the publish directory.
await fs.rm(path.join(root, `TronCut-${pkg.version}-build-info.json`), {
  force: true,
});
const quote = (value) => `'${value.replace(/'/g, "''")}'`;
async function run(binary, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      windowsHide: true,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${binary} exited with ${code}`)),
    );
  });
}
async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
const installer = `TronCut-Setup-${pkg.version}-windows-x64.exe`;
const portable = `TronCut-${pkg.version}-windows-x64.zip`;
const ffmpegSource = "FFmpeg-946fcce07b-source.tar.gz";
await fs.copyFile(
  path.resolve(`release/TronCut Setup ${pkg.version}.exe`),
  path.join(root, installer),
);
console.log("Packaging the complete portable app…");
await run("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `Compress-Archive -Path ${quote(path.resolve("release/win-unpacked/*"))} -DestinationPath ${quote(path.join(root, portable))} -CompressionLevel Optimal -Force`,
]);
const url = "https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/946fcce07b";
const cached = path.resolve(".cache/release-sources", ffmpegSource);
await fs.mkdir(path.dirname(cached), { recursive: true });
if (
  !(await fs.access(cached).then(
    () => true,
    () => false,
  ))
) {
  console.log("Downloading the pinned upstream FFmpeg source…");
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new Error(`FFmpeg source download failed (${response.status})`);
  const temp = `${cached}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temp));
  await fs.rename(temp, cached);
}
if (
  (await checksum(cached)) !==
  "86f82e82456005881d1b97e9ce02f8a40bf2d181c8c958f8ae736886fdba2a34"
)
  throw new Error("Pinned FFmpeg source SHA256 mismatch.");
await fs.copyFile(cached, path.join(root, ffmpegSource));
const names = [installer, portable, ffmpegSource];
const manifest = [];
for (const name of names) {
  const file = path.join(root, name);
  manifest.push({
    name,
    bytes: (await fs.stat(file)).size,
    sha256: await checksum(file),
  });
}
await fs.writeFile(
  path.join(root, "SHA256SUMS.txt"),
  manifest.map((item) => `${item.sha256}  ${item.name}`).join("\n") + "\n",
);
await fs.writeFile(
  path.join(root, "artifacts.json"),
  JSON.stringify(
    { version: pkg.version, ffmpegSourceUrl: url, assets: manifest },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ root, assets: manifest }, null, 2));
