import { build } from "esbuild";
import "./icons.mjs";
await build({
  entryPoints: ["electron/main.ts"],
  outfile: "dist-electron/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron", "sharp"],
  sourcemap: true,
});
await build({
  entryPoints: ["electron/preload.ts", "electron/countdown-preload.ts", "electron/recording-controls-preload.ts", "electron/capture-region-preload.ts"],
  outdir: "dist-electron",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
