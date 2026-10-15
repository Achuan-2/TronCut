// Collect the unsigned DMG produced by electron-builder. This script creates
// reviewable artifacts only and never publishes or validates the application.
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
const arch = process.env.TRONCUT_RELEASE_ARCH;
if (!["arm64", "x64"].includes(arch))
  throw new Error("TRONCUT_RELEASE_ARCH must be arm64 or x64.");
if (process.platform !== "darwin" || process.arch !== arch)
  throw new Error(
    `Expected native macOS ${arch}, got ${process.platform} ${process.arch}.`,
  );
if (
  process.env.TRONCUT_RELEASE_TAG &&
  process.env.TRONCUT_RELEASE_TAG !== `v${pkg.version}`
)
  throw new Error("Release tag does not match package.json version.");

const root = path.resolve("release", "publish", `v${pkg.version}`);
const dmg = `TronCut-${pkg.version}-macos-${arch}.dmg`;
const buildInfoName = `TronCut-${pkg.version}-macos-${arch}-build-info.json`;
await fs.mkdir(root, { recursive: true });

async function checksum(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (revision.status !== 0) throw new Error("Cannot resolve source commit.");
await fs.copyFile(path.resolve("release", dmg), path.join(root, dmg));
await fs.writeFile(
  path.join(root, buildInfoName),
  JSON.stringify(
    {
      version: pkg.version,
      sourceCommit: revision.stdout.trim(),
      buildToolsCommit: process.env.TRONCUT_BUILD_TOOLS_SHA || null,
      platform: "macos",
      arch,
      signed: false,
      notarized: false,
      localValidation: "not-run",
    },
    null,
    2,
  ) + "\n",
);

const names = [dmg, buildInfoName];
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
console.log(JSON.stringify({ root, assets: manifest }, null, 2));
