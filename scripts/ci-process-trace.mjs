// Trace media subprocesses only; never log environment variables or credentials.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const spawn = childProcess.spawn;
childProcess.spawn = function (binary, args, options) {
  const child = spawn.call(this, binary, args, options);
  if (!/^ff(mpeg|probe)(\.exe)?$/i.test(path.basename(String(binary))))
    return child;
  const label = `${path.basename(String(binary))} (${child.pid})`;
  console.log(`[media] ${label} ${JSON.stringify(args)}`);
  let tail = "";
  child.stderr?.on("data", (chunk) => {
    tail = (tail + chunk).slice(-3000);
  });
  const timer = setInterval(() => {
    console.log(`[media] ${label} still running; stderr: ${tail}`);
  }, 15000);
  timer.unref();
  child.once("error", () => clearInterval(timer));
  child.once("close", (code) => {
    clearInterval(timer);
    console.log(`[media] ${label} exited ${code}; stderr: ${tail}`);
  });
  return child;
};
syncBuiltinESMExports();
