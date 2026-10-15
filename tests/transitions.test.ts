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
  updateTransition,
} from "../shared/transitions";
import { exportVideo } from "../electron/export";
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

describe("Smooth Slide 转换", () => {
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

  it("拆分只保留原片头与片尾转换，工程 schema 可以往返", () => {
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
