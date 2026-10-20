import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { createBehavior } from "../shared/behaviors";
import { exportFrame, exportVideo } from "../electron/export";
import { findBinary, runProcess } from "../electron/process";

it("铰链真实视频可见正反回摆，四个方向固定边缘且尾段收稳", async () => {
  const root = path.resolve(`test-output/media-hinge-export-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.png");
  await sharp({
    create: { width: 80, height: 80, channels: 3, background: "white" },
  })
    .png()
    .toFile(source);
  const movie = path.join(root, "source.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-loop",
    "1",
    "-i",
    source,
    "-t",
    "6",
    "-r",
    "24",
    "-pix_fmt",
    "yuv420p",
    movie,
  ]);
  const times = [0.1, 0.3, 0.5, 1, 1.5, 2.1, 4.8];
  const results = [];
  const contact = [];
  for (const [row, direction] of (
    ["left", "right", "top", "bottom"] as const
  ).entries()) {
    const project = createProject(`铰链-${direction}`);
    const kind: "video" | "image" = row % 2 ? "video" : "image";
    project.canvas = {
      width: 320,
      height: 180,
      fps: 30,
      background: "#000000",
    };
    project.exportSettings = { encoder: "software" };
    project.assets = [
      {
        id: "source",
        name: "source",
        path: kind === "image" ? source : movie,
        kind,
        width: 80,
        height: 80,
        duration: kind === "image" ? 0 : 6,
        hasAudio: false,
      },
    ];
    const clip = {
      ...newText(project.tracks[0].id, 0),
      kind,
      assetId: "source",
      duration: 5,
      start: row * 0.4,
      speed: kind === "video" ? 1.2 : 1,
    };
    clip.transform.scale = 0.6;
    const behavior = createBehavior("media-hinge", 5, "image")!;
    behavior.incoming.direction = behavior.outgoing.direction = direction;
    clip.behaviors = [behavior];
    project.clips = [clip];
    await fs.writeFile(
      path.join(root, `${direction}.troncut`),
      JSON.stringify(
        {
          ...project,
          assets: project.assets.map((asset) => ({
            ...asset,
            path: path.basename(asset.path),
          })),
        },
        null,
        2,
      ),
    );
    const output = path.join(root, `${direction}.mp4`);
    await exportVideo(
      project,
      output,
      path.join(root, `render-${direction}`),
      false,
      AbortSignal.timeout(60000),
      () => {},
    );
    const samples = [];
    for (const [col, time] of times.entries()) {
      const frame = path.join(root, `${direction}-${time}.png`);
      await runProcess(findBinary("ffmpeg"), [
        "-y",
        "-ss",
        String(time + clip.start),
        "-i",
        output,
        "-frames:v",
        "1",
        frame,
      ]);
      const { data, info } = await sharp(frame)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let left = info.width,
        right = -1,
        top = info.height,
        bottom = -1;
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++) {
          if (data[(y * info.width + x) * info.channels] < 180) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      samples.push({
        time,
        left,
        right,
        top,
        bottom,
        width: right - left + 1,
        height: bottom - top + 1,
      });
      const label = Buffer.from(
        `<svg width="320" height="180"><text x="5" y="16" fill="yellow" font-size="12">${direction} ${time}s</text></svg>`,
      );
      contact.push({
        input: await sharp(frame)
          .composite([{ input: label }])
          .png()
          .toBuffer(),
        left: col * 320,
        top: row * 180,
      });
    }
    const cross = ["top", "bottom"].includes(direction) ? "width" : "height";
    const axis = cross === "width" ? "height" : "width";
    const anchor =
      direction === "left"
        ? "left"
        : direction === "right"
          ? "right"
          : direction === "top"
            ? "top"
            : "bottom";
    const settled = samples[5];
    expect(
      samples[2][cross],
      `${direction}: near free edge expands on overshoot`,
    ).toBeGreaterThan(settled[cross] * 1.14);
    expect(samples[0][axis]).toBeLessThan(settled[axis] * 0.5);
    expect(
      samples[3][axis],
      `${direction}: opposite swing after overshoot`,
    ).toBeLessThan(settled[axis] * 0.99);
    expect(
      samples[4][cross],
      `${direction}: smaller second return`,
    ).toBeLessThan(samples[2][cross] * 0.9);
    for (const sample of samples)
      expect(
        Math.abs(sample[anchor] - settled[anchor]),
        `${direction}/${sample.time}: fixed edge`,
      ).toBeLessThanOrEqual(2);
    if (direction === "bottom") {
      for (const time of [0.5, 1, 4.8]) {
        const snapshot = path.join(root, `snapshot-${time}.png`);
        await exportFrame(
          project,
          clip.start + time,
          snapshot,
          path.join(root, `snapshot-${time}`),
          AbortSignal.timeout(15000),
        );
        const { data, info } = await sharp(snapshot)
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        let left = info.width,
          right = -1,
          top = info.height,
          bottom = -1;
        for (let y = 0; y < info.height; y++)
          for (let x = 0; x < info.width; x++) {
            if (data[(y * info.width + x) * info.channels] < 180) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        const expected = samples.find((sample) => sample.time === time)!;
        for (const [key, actual] of Object.entries({
          left,
          right,
          top,
          bottom,
        }))
          expect(
            Math.abs(actual - expected[key as keyof typeof expected]),
            `snapshot/${time}/${key}`,
          ).toBeLessThanOrEqual(2);
      }
    }
    results.push({ direction, start: clip.start, kind, samples });
  }
  await sharp({
    create: {
      width: 320 * times.length,
      height: 180 * 4,
      channels: 3,
      background: "black",
    },
  })
    .composite(contact)
    .png()
    .toFile(path.join(root, "contact.png"));
  await fs.writeFile(
    path.join(root, "measurements.json"),
    JSON.stringify({ root, times, results }, null, 2),
  );
  console.log(`铰链视频证据：${root}`);
}, 180000);
