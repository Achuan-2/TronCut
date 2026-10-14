import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const cancelFile = path.join(os.tmpdir(), `troncut-cli-${randomUUID()}.cancel`);
const cliArgs = process.argv.slice(2);
const explicitCancel =
  cliArgs
    .find((arg) => arg.startsWith("--cancel-file="))
    ?.slice("--cancel-file=".length) ??
  (cliArgs.includes("--cancel-file")
    ? cliArgs[cliArgs.indexOf("--cancel-file") + 1]
    : undefined);
const effectiveArgs = explicitCancel
  ? cliArgs
  : [...cliArgs, "--cancel-file", cancelFile];
const child = spawn(electron, [root, "--cli", ...effectiveArgs], {
  env,
  stdio: "inherit",
  windowsHide: true,
});
child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.on("exit", async (code) => {
  await fs.rm(cancelFile, { force: true });
  process.exitCode = code ?? 1;
});
// Windows kill(SIGINT) would force-kill Electron and leave FFmpeg/uv running.
const cancel = () => {
  void fs
    .writeFile(explicitCancel ?? cancelFile, "cancel")
    .catch((error) => process.stderr.write(`${error.message}\n`));
};
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
