import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Clip,
} from "../shared/model";
import { splitClip } from "../shared/editor";
import { frameSnapshot } from "../shared/frame-snapshot";
import {
  addTransition,
  normalizeTransitions,
  pairedTransition,
  transitionDropTarget,
  transitionOffset,
  transitionRange,
  transitionTransform,
  transitionVisual,
  transitionPresets,
  transitionBlur,
  updateTransition,
} from "../shared/transitions";
import { exportFrame, exportVideo } from "../electron/export";
import { findBinary, runProcess } from "../electron/process";
import { openProject, saveProject } from "../electron/project-store";

function adjacentProject() {
  const project = createProject("转换测试");
  const clip = (id: string, start: number): Clip => ({
    id,
    trackId: "video",
    kind: "image",
    assetId: id,
    name: id,
    start,
    duration: 1,
    sourceIn: 0,
    speed: 1,
    transform: { ...defaultTransform },
    keyframes: [],
    volume: 1,
    podcast: false,
  });
  project.clips = [clip("red", 0), clip("blue", 1)];
  project.assets = ["red", "blue"].map((id) => ({
    id,
    name: id,
    path: `${id}.png`,
    kind: "image" as const,
    duration: 0,
    width: 160,
    height: 90,
    hasAudio: false,
  }));
  return project;
}

describe("转换效果", () => {
  it("横扫实际渲染只模糊水平方向，保留垂直细节", async () => {
    const root = path.resolve(
      `test-output/transition-directional-blur-${Date.now()}`,
    );
    await fs.mkdir(root, { recursive: true });
    let project = adjacentProject();
    project.canvas = { width: 160, height: 90, fps: 20, background: "#000000" };
    project.clips = [project.clips[0]];
    project.assets = [project.assets[0]];
    const source = path.join(root, "stripes.png");
    const pixels = Buffer.alloc(160 * 90 * 3);
    for (let y = 0; y < 90; y++)
      for (let x = 0; x < 160; x++) {
        const value = Math.floor((y < 45 ? x : y) / 2) % 2 ? 255 : 0;
        pixels.fill(value, (y * 160 + x) * 3, (y * 160 + x + 1) * 3);
      }
    await sharp(pixels, { raw: { width: 160, height: 90, channels: 3 } })
      .png()
      .toFile(source);
    project.assets[0].path = source;
    project = addTransition(
      project,
      { clipId: "red", side: "incoming" },
      0.5,
      "whip-pan",
    );
    const output = path.join(root, "blur.png");
    await exportFrame(
      project,
      0.25,
      output,
      path.join(root, "frame"),
      new AbortController().signal,
    );
    const frame = await sharp(output).removeAlpha().raw().toBuffer();
    const gradient = (top: number, horizontal: boolean) => {
      let total = 0;
      for (let y = top; y < top + 20; y++)
        for (let x = 100; x < 140; x++) {
          const index = (y * 160 + x) * 3;
          total += Math.abs(
            frame[index] - frame[index + (horizontal ? 3 : 160 * 3)],
          );
        }
      return total / 800;
    };
    expect(gradient(10, true)).toBeLessThan(8);
    expect(gradient(55, false)).toBeGreaterThan(65);
  });

  it("横扫的方向模糊随速度增强，端点清晰，反转不改变强度，禁用后移除", () => {
    let project = addTransition(
      adjacentProject(),
      { clipId: "red", side: "outgoing", neighborId: "blue" },
      1,
      "whip-pan",
    );
    for (const clip of project.clips) {
      expect(transitionBlur(project, clip, 0.5)).toBe(0);
      expect(transitionBlur(project, clip, 0.75)).toBeCloseTo(0.01);
      expect(transitionBlur(project, clip, 1)).toBeCloseTo(0.04);
      expect(transitionBlur(project, clip, 1.25)).toBeCloseTo(0.01);
      expect(transitionBlur(project, clip, 1.5)).toBe(0);
    }
    project = updateTransition(
      project,
      { clipId: "red", side: "outgoing" },
      { reverse: true },
    );
    expect(transitionBlur(project, project.clips[0], 1)).toBeCloseTo(0.04);
    project = updateTransition(
      project,
      { clipId: "red", side: "outgoing" },
      { enabled: false },
    );
    expect(transitionBlur(project, project.clips[0], 1)).toBe(0);
    expect(transitionBlur(project, project.clips[1], 1)).toBe(0);
  });

  it.each(transitionPresets)("$name 支持保存、接点同步和禁用", ({ type }) => {
    let project = addTransition(
      adjacentProject(),
      {
        clipId: "red",
        side: "outgoing",
        neighborId: "blue",
      },
      0.8,
      type,
    );
    project = validateProject(JSON.parse(JSON.stringify(project)));
    expect(project.clips[0].transitions?.outgoing?.type).toBe(type);
    expect(project.clips[1].transitions?.incoming?.type).toBe(type);
    project = updateTransition(
      project,
      { clipId: "red", side: "outgoing" },
      { type: "fade", enabled: false },
    );
    expect(project.clips[1].transitions?.incoming).toMatchObject({
      type: "fade",
      enabled: false,
    });
    expect(
      transitionTransform(project, project.clips[1], defaultTransform, 1),
    ).toEqual(defaultTransform);
  });

  it.each([false, true])(
    "叠化按实际图层顺序混合，避免背景变暗，倒序=%s",
    (reordered) => {
      let project = adjacentProject();
      if (reordered) project.clips.reverse();
      project = addTransition(
        project,
        { clipId: "red", side: "outgoing", neighborId: "blue" },
        1,
        "fade",
      );
      const snapshot = frameSnapshot(project, 1);
      expect(snapshot.clips.map((clip) => clip.transform.opacity)).toEqual([
        1, 0.5,
      ]);
      // Preview uses derived clip objects rather than the original references.
      expect(
        transitionVisual(project, { ...project.clips[1] }, 1).opacity,
      ).toBe(0.5);
      expect(snapshot.clips.map((clip) => clip.transform.x)).toEqual([
        0.5, 0.5,
      ]);
    },
  );

  it("放大叠加原有缩放，横扫快速穿过接点后收稳，反转改变方向", () => {
    let project = addTransition(
      adjacentProject(),
      { clipId: "red", side: "incoming" },
      0.5,
      "zoom",
    );
    const clip = project.clips[0];
    const zoomed = transitionTransform(
      project,
      clip,
      { ...defaultTransform, scale: 2 },
      0.25,
    );
    expect(zoomed.scale).toBeCloseTo(1.72);
    expect(zoomed.opacity).toBe(0.5);
    project = updateTransition(
      project,
      { clipId: "red", side: "incoming" },
      { reverse: true },
    );
    expect(transitionVisual(project, project.clips[0], 0.25).scale).toBeCloseTo(
      1.14,
    );
    project = addTransition(
      adjacentProject(),
      { clipId: "red", side: "incoming" },
      0.5,
      "whip-pan",
    );
    expect(transitionVisual(project, project.clips[0], 0.125)).toMatchObject({
      x: 0.9375,
      scaleX: 1.12,
    });
    expect(transitionVisual(project, project.clips[0], 0.5)).toEqual({
      x: 0,
      scale: 1,
      scaleX: 1,
      opacity: 1,
    });
    project = updateTransition(
      project,
      { clipId: "red", side: "incoming" },
      { reverse: true },
    );
    expect(transitionOffset(project, project.clips[0], 0.125)).toBe(-0.9375);
  });
  it.each(
    transitionPresets.flatMap((preset) =>
      [false, true].map((reverse) => ({ ...preset, reverse })),
    ),
  )(
    "$name 视频导出与冻结截帧在转场多处一致，反转=$reverse",
    async ({ type, reverse }) => {
      const root = path.resolve(
        `test-output/transition-parity-${type}-${reverse}-${Date.now()}`,
      );
      await fs.mkdir(root, { recursive: true });
      let project = adjacentProject();
      project.canvas = {
        width: 160,
        height: 90,
        fps: 20,
        background: "#000000",
      };
      project.exportSettings = { encoder: "software" };
      for (const asset of project.assets) {
        const image = path.join(root, `${asset.id}.png`);
        await sharp({
          create: {
            width: 160,
            height: 90,
            channels: 3,
            background: asset.id === "red" ? "#f00000" : "#0050f0",
          },
        })
          .composite([
            {
              input: Buffer.from(
                '<svg width="160" height="90"><rect x="50" y="25" width="60" height="40" fill="white"/></svg>',
              ),
            },
          ])
          .png()
          .toFile(image);
        asset.path = path.join(root, `${asset.id}.mp4`);
        asset.kind = "video";
        asset.duration = 1;
        await runProcess(findBinary("ffmpeg"), [
          "-y",
          "-loglevel",
          "error",
          "-loop",
          "1",
          "-i",
          image,
          "-t",
          "1",
          "-r",
          "20",
          "-pix_fmt",
          "yuv420p",
          asset.path,
        ]);
      }
      project.clips = project.clips.map((clip) => ({ ...clip, kind: "video" }));
      project = addTransition(
        project,
        { clipId: "red", side: "outgoing", neighborId: "blue" },
        1,
        type,
      );
      project = updateTransition(
        project,
        { clipId: "blue", side: "incoming" },
        { reverse },
      );
      const movie = path.join(root, "transition.mp4");
      const signal = new AbortController().signal;
      await exportVideo(
        project,
        movie,
        path.join(root, "render"),
        false,
        signal,
        () => {},
      );
      for (const time of [0.6, 0.8, 1, 1.2, 1.4]) {
        const expected = path.join(root, `expected-${time}.png`);
        const actual = path.join(root, `actual-${time}.png`);
        await exportFrame(
          project,
          time,
          expected,
          path.join(root, `frame-${time}`),
          signal,
        );
        await runProcess(findBinary("ffmpeg"), [
          "-y",
          "-loglevel",
          "error",
          "-ss",
          String(time),
          "-i",
          movie,
          "-frames:v",
          "1",
          actual,
        ]);
        const a = await sharp(actual).removeAlpha().raw().toBuffer();
        const b = await sharp(expected).removeAlpha().raw().toBuffer();
        const error =
          a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) /
          a.length;
        expect(error, `${type} reverse=${reverse} t=${time}`).toBeLessThan(12);
        if (time === 1 && !reverse) {
          let dark = 0;
          for (let i = 0; i < a.length; i += 3)
            if (a[i] < 25 && a[i + 1] < 25 && a[i + 2] < 25) dark++;
          expect(dark).toBeLessThan(200);
        }
      }
    },
    30_000,
  );

  it("识别片头、片尾、中部两端和相邻接点放置", () => {
    const project = adjacentProject();
    const red = project.clips[0];
    expect(transitionDropTarget(project, red, 10, 300)).toEqual({
      clipId: "red",
      side: "incoming",
    });
    const middle = transitionDropTarget(project, red, 150, 300);
    expect(middle).toEqual({
      clipId: "red",
      side: "outgoing",
      both: true,
    });
    const both = addTransition(project, middle!);
    expect(both.clips[0].transitions).toMatchObject({
      incoming: { type: "smooth-slide" },
      outgoing: { type: "smooth-slide" },
    });
    expect(transitionDropTarget(project, red, 296, 300)).toEqual({
      clipId: "red",
      side: "outgoing",
      neighborId: "blue",
    });
    project.tracks.find((track) => track.id === "video")!.locked = true;
    expect(transitionDropTarget(project, red, 10, 300)).toBeNull();
  });

  it("接点两端共享参数、删除和启用状态，移动后自动转为两个独立转换", () => {
    let project = adjacentProject();
    project = addTransition(project, {
      clipId: "red",
      side: "outgoing",
      neighborId: "blue",
    });
    const pairId = project.clips[0].transitions!.outgoing!.pairId;
    expect(pairId).toBeTruthy();
    expect(project.clips[1].transitions!.incoming!.pairId).toBe(pairId);
    expect(pairedTransition(project, project.clips[0], "outgoing")?.id).toBe(
      "blue",
    );

    project = updateTransition(
      project,
      { clipId: "blue", side: "incoming" },
      {
        duration: 0.8,
        enabled: false,
        reverse: true,
      },
    );
    for (const transition of [
      project.clips[0].transitions!.outgoing!,
      project.clips[1].transitions!.incoming!,
    ])
      expect(transition).toMatchObject({
        duration: 0.8,
        enabled: false,
        reverse: true,
      });

    project.clips[1] = { ...project.clips[1], start: 1.2 };
    project = normalizeTransitions(project);
    expect(project.clips[0].transitions!.outgoing!.pairId).toBeUndefined();
    expect(project.clips[1].transitions!.incoming!.pairId).toBeUndefined();

    project = updateTransition(
      project,
      { clipId: "red", side: "outgoing" },
      null,
    );
    expect(project.clips[0].transitions).toBeUndefined();
    expect(project.clips[1].transitions!.incoming).toBeTruthy();
  });

  it("接点转换延展首尾画面，预览运动和截帧保持一致", () => {
    const project = addTransition(adjacentProject(), {
      clipId: "red",
      side: "outgoing",
      neighborId: "blue",
    });
    expect(transitionRange(project, project.clips[0])).toMatchObject({
      start: 0,
      end: 1.5,
      after: 0.5,
    });
    expect(transitionRange(project, project.clips[1])).toMatchObject({
      start: 0.5,
      end: 2,
      before: 0.5,
    });
    expect(transitionOffset(project, project.clips[0], 1)).toBeCloseTo(-0.5);
    expect(transitionOffset(project, project.clips[1], 1)).toBeCloseTo(0.5);
    const snapshot = frameSnapshot(project, 1);
    expect(snapshot.clips).toHaveLength(2);
    expect(snapshot.clips.map((clip) => clip.transform.x)).toEqual([0, 1]);
    expect(snapshot.clips.every((clip) => !clip.transitions)).toBe(true);
  });

  it("拆分只保留原片头与片尾转换，项目 schema 可以往返", () => {
    let project = addTransition(adjacentProject(), {
      clipId: "red",
      side: "incoming",
      both: true,
    });
    const split = splitClip(project, "red", 0.5);
    expect(split.clips[0].transitions?.incoming).toBeTruthy();
    expect(split.clips[0].transitions?.outgoing).toBeUndefined();
    expect(split.clips[1].transitions?.incoming).toBeUndefined();
    expect(split.clips[1].transitions?.outgoing).toBeTruthy();
    project = validateProject(JSON.parse(JSON.stringify(project)));
    expect(project.clips[0].transitions?.incoming?.type).toBe("smooth-slide");
  });

  it("真实导出在接点平滑并排滑动且不出现黑缝，保存后参数保持", async () => {
    const root = path.resolve(`test-output/transitions-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const red = path.join(root, "red.png"),
      blue = path.join(root, "blue.png");
    await sharp({
      create: { width: 160, height: 90, channels: 3, background: "#f00000" },
    })
      .png()
      .toFile(red);
    await sharp({
      create: { width: 160, height: 90, channels: 3, background: "#0050f0" },
    })
      .png()
      .toFile(blue);
    let project = adjacentProject();
    project.canvas = { width: 160, height: 90, fps: 20, background: "#000000" };
    project.exportSettings = { encoder: "software" };
    project.assets = [
      {
        id: "red",
        name: "red",
        path: red,
        kind: "image",
        duration: 0,
        width: 160,
        height: 90,
        hasAudio: false,
      },
      {
        id: "blue",
        name: "blue",
        path: blue,
        kind: "image",
        duration: 0,
        width: 160,
        height: 90,
        hasAudio: false,
      },
    ];
    project = addTransition(project, {
      clipId: "red",
      side: "outgoing",
      neighborId: "blue",
    });
    const file = path.join(root, "project.troncut");
    await saveProject(project, file);
    const reopened = await openProject(file);
    expect(reopened.clips[0].transitions!.outgoing).toMatchObject({
      type: "smooth-slide",
      duration: 1,
      reverse: false,
    });

    const movie = path.join(root, "transition.mp4");
    await exportVideo(
      reopened,
      movie,
      path.join(root, "render"),
      false,
      new AbortController().signal,
      () => {},
    );
    const frame = path.join(root, "middle.png");
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "1",
      "-i",
      movie,
      "-frames:v",
      "1",
      frame,
    ]);
    const { data, info } = await sharp(frame)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let redPixels = 0,
      bluePixels = 0,
      darkPixels = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i] > 150 && data[i + 2] < 80) redPixels++;
      if (data[i + 2] > 150 && data[i] < 80) bluePixels++;
      if (data[i] < 25 && data[i + 1] < 25 && data[i + 2] < 25) darkPixels++;
    }
    expect(redPixels).toBeGreaterThan(6000);
    expect(bluePixels).toBeGreaterThan(6000);
    expect(darkPixels).toBeLessThan(200);
  }, 30_000);
});
