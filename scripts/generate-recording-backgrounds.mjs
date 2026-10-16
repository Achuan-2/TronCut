// Rebuild the bundled, seamless recording backgrounds with:
//   node scripts/generate-recording-backgrounds.mjs [preset ...]
// Geometry is procedural; no third-party artwork or network access is needed.
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = path.join(root, "public/recording/wallpapers");
const width = 1920,
  height = 1080,
  fps = 30,
  duration = 6;
const tau = Math.PI * 2;
const line = (x1, y1, x2, y2) =>
  `M${x1.toFixed(3)} ${y1.toFixed(3)}L${x2.toFixed(3)} ${y2.toFixed(3)}`;
const strokes = (d) =>
  `<path d="${d}" fill="none" stroke="#383838" stroke-width="2.2"/>`;
const dot = (x, y, radius = 2.4, shade = 72) =>
  `<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${radius.toFixed(3)}" fill="rgb(${shade},${shade},${shade})"/>`;

const backgrounds = {
  "perspective-grid": (phase) => {
    let d = "";
    // A vanishing point above the frame preserves the original full-canvas grid.
    for (let x = -140; x <= 2060; x += 110)
      d += line(x, 0, 960 + (x - 960) * 2.2, height);
    // Travel toward the viewer at constant speed in depth. An integer cell
    // shift reproduces the same rows, so the loop never resets or reverses.
    for (let row = -1; row <= 11; row++) {
      const y = 900 * (1.09 ** (row + phase) - 1);
      d += line(0, y, width, y);
    }
    return strokes(d);
  },
  "moving-grid": (phase) => {
    const step = 96,
      offset = phase * step;
    let d = "";
    for (let x = -step; x <= width + step; x += step)
      d += line(x + offset, 0, x + offset, height);
    for (let y = -step; y <= height + step; y += step)
      d += line(0, y + offset, width, y + offset);
    return strokes(d);
  },
  "moving-dots": (phase) => {
    const step = 64,
      offset = phase * step;
    let dots = "";
    for (let y = -step; y <= height + step; y += step)
      for (let x = -step; x <= width + step; x += step)
        dots += dot(x + offset, y + offset);
    return dots;
  },
  "wave-dots": (phase) => {
    let dots = "";
    for (let y = -56; y <= height + 56; y += 56) {
      for (let x = -56; x <= width + 56; x += 56) {
        const wave = Math.sin(x / 180 + y / 240 - phase * tau);
        dots += dot(
          x + 5 * Math.cos(y / 190 - phase * tau),
          y + 18 * wave,
          2.4 + 0.5 * wave,
          Math.round(64 + 16 * wave),
        );
      }
    }
    return dots;
  },
};

const requested = process.argv.slice(2);
const presets = requested.length ? requested : Object.keys(backgrounds);
for (const preset of presets)
  if (!Object.hasOwn(backgrounds, preset))
    throw new Error(`Unknown background: ${preset}`);
await fs.mkdir(folder, { recursive: true });
const bundled = path.join(
  root,
  "resources/bin",
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
const ffmpeg =
  process.env.FRAMECRAFT_FFMPEG ||
  (await fs.access(bundled).then(
    () => bundled,
    () => "ffmpeg",
  ));

for (const preset of presets) {
  const target = path.join(folder, `${preset}.mp4`);
  const temporary = path.join(folder, `${preset}.tmp.mp4`);
  const child = spawn(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "rawvideo",
      "-pixel_format",
      "rgb24",
      "-video_size",
      `${width}x${height}`,
      "-framerate",
      String(fps),
      "-i",
      "pipe:0",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      temporary,
    ],
    { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8000);
  });
  // Attach rejection handlers before rendering so an encoder failure cannot
  // leave a pending pipe write or an unhandled promise rejection.
  const completed = once(child, "close");
  void completed.catch(() => {});
  const pipeError = new Promise((_, reject) =>
    child.stdin.once("error", reject),
  );
  void pipeError.catch(() => {});
  try {
    for (let frame = 0; frame < fps * duration; frame++) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#000"/>${backgrounds[preset](frame / (fps * duration))}</svg>`;
      const rgb = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer();
      if (!child.stdin.write(rgb))
        await Promise.race([
          once(child.stdin, "drain"),
          pipeError,
          completed.then(() => {
            throw new Error(stderr || "Encoder exited early");
          }),
        ]);
    }
    child.stdin.end();
    const [code] = await completed;
    if (code !== 0) throw new Error(`FFmpeg failed (${code}): ${stderr}`);
    await fs.rename(temporary, target);
    console.log(
      `${preset}: ${((await fs.stat(target)).size / 1024).toFixed(0)} KiB`,
    );
  } finally {
    if (child.exitCode === null) child.kill();
    await fs.rm(temporary, { force: true });
  }
}
