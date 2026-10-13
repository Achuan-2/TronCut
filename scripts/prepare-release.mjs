// Prepare reviewable artifacts only. This script never commits, pushes, or publishes.
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
const source = `TronCut-${pkg.version}-source.zip`;
const ffmpegSource = "FFmpeg-946fcce07b-source.tar.gz";
const buildInfoName = `TronCut-${pkg.version}-build-info.json`;
const revision = spawnSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  windowsHide: true,
});
if (revision.status !== 0) throw new Error("Cannot resolve source commit.");
const restoredEntry = process.env.TRONCUT_SOURCE_ENTRY_RESTORED === "1";
await fs.writeFile(
  path.join(root, buildInfoName),
  JSON.stringify(
    {
      version: pkg.version,
      sourceCommit: revision.stdout.trim(),
      buildToolsCommit: process.env.TRONCUT_BUILD_TOOLS_SHA || null,
      platform: "windows",
      arch: "x64",
      signed: false,
      restoredEntry: restoredEntry
        ? {
            file: "index.html",
            sha256: await checksum("index.html"),
            reason: "The v0.2.0 tag omitted the existing Vite entry file.",
          }
        : null,
    },
    null,
    2,
  ) + "\n",
);
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
await run("git", [
  "archive",
  "--format=zip",
  `--prefix=TronCut-${pkg.version}/`,
  "-o",
  path.join(root, source),
  "HEAD",
]);
// Include provenance and the documented v0.2.0 repair in the source archive.
// Later tags must already contain their entry file; no other sources are patched.
const additions = [
  [
    path.join(root, buildInfoName),
    `TronCut-${pkg.version}/RELEASE-BUILD-INFO.json`,
  ],
];
if (restoredEntry)
  additions.push([
    path.resolve("index.html"),
    `TronCut-${pkg.version}/index.html`,
  ]);
await run("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$archive = [System.IO.Compression.ZipFile]::Open(${quote(path.join(root, source))}, [System.IO.Compression.ZipArchiveMode]::Update)`,
    "try {",
    ...additions.map(
      ([file, entry]) =>
        `[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, ${quote(file)}, ${quote(entry)}) | Out-Null`,
    ),
    "} finally { $archive.Dispose() }",
  ].join("\n"),
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
const names = [installer, portable, source, ffmpegSource, buildInfoName];
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
