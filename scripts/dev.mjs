import { spawn } from "node:child_process";
import { createServer } from "vite";
import "./build-electron.mjs";
import electron from "electron";
const server = await createServer();
await server.listen();
const env = { ...process.env, FRAMECRAFT_DEV_URL: "http://127.0.0.1:5173" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env,
  windowsHide: true,
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
process.on("SIGINT", () => child.kill());
