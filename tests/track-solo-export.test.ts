import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createProject, newText } from "../shared/model";
import { moveTrack, renameTrack, toggleTrack } from "../shared/tracks";
import { exportFrame, exportVideo } from "../electron/export";
import { openProject, saveProject } from "../electron/project-store";
import { findBinary, runProcess } from "../electron/process";
import { renderTimelineAudio } from "../electron/timeline-audio";

it("真实导出与截帧遵循轨道顺序和独奏，保存重开保留名称与状态", async () => {
  const root = path.resolve(`test-output/track-solo-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  let project = createProject("轨道操作");
  project.canvas = { width: 160, height: 90, fps: 10, background: "#000000" };
  project.exportSettings = { encoder: "software" };
  project.clips = [
    {
      ...newText("titles", 0),
      kind: "shape",
      shape: "rectangle",
      fill: "#0000ff",
      duration: 0.5,
    },
    {
      ...newText("video", 0),
      kind: "shape",
      shape: "rectangle",
      fill: "#ff0000",
      duration: 0.5,
    },
  ];
  const center = async (file: string) => [
    ...(await sharp(file)
      .extract({ left: 80, top: 45, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ];
  const capture = async (input: typeof project, name: string) => {
    const file = path.join(root, `${name}.png`);
    await exportFrame(
      input,
      0.2,
      file,
      path.join(root, name),
      AbortSignal.timeout(60000),
    );
    return center(file);
  };
  expect((await capture(project, "top-blue"))[2]).toBeGreaterThan(240);
  project = moveTrack(project, "titles", "bottom");
  expect((await capture(project, "moved-red"))[0]).toBeGreaterThan(240);
  project = renameTrack(
    toggleTrack(project, "titles", "solo"),
    "titles",
    "独奏画面",
  );
  const file = path.join(root, "solo.troncut");
  await saveProject(project, file);
  const reopened = await openProject(file);
  expect(reopened.tracks.find((track) => track.id === "titles")).toMatchObject({
    name: "独奏画面",
    solo: true,
    customName: true,
  });
  expect((await capture(reopened, "solo-blue"))[2]).toBeGreaterThan(240);
  const video = path.join(root, "solo.mp4"),
    frame = path.join(root, "video.png");
  await exportVideo(
    reopened,
    video,
    path.join(root, "render"),
    false,
    AbortSignal.timeout(20000),
    () => {},
  );
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-i",
    video,
    "-frames:v",
    "1",
    frame,
  ]);
  const pixel = await center(frame);
  expect(pixel[2]).toBeGreaterThan(230);
  expect(pixel[0]).toBeLessThan(20);
}, 30000);

it("独奏轨道的真实语音识别混音排除其他声音，取消后可恢复", async () => {
  const root = path.resolve(`test-output/track-solo-audio-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  let project = createProject();
  for (const [index, frequency] of [440, 880].entries()) {
    const source = path.join(root, `${frequency}.wav`);
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${frequency}:sample_rate=16000:duration=0.5`,
      source,
    ]);
    project.assets.push({
      id: String(index),
      name: source,
      path: source,
      kind: "audio",
      width: 0,
      height: 0,
      duration: 0.5,
      hasAudio: true,
    });
    project.clips.push({
      ...newText(project.tracks[index].id, 0),
      kind: "audio",
      assetId: String(index),
      duration: 0.5,
    });
  }
  const amplitude = (samples: Buffer, frequency: number) => {
    let real = 0,
      imaginary = 0;
    for (let i = 0; i < 1600; i++) {
      const value = samples.readFloatLE((1600 + i) * 4),
        angle = (2 * Math.PI * frequency * i) / 16000;
      real += value * Math.cos(angle);
      imaginary += value * Math.sin(angle);
    }
    return (2 * Math.hypot(real, imaginary)) / 1600;
  };
  project = toggleTrack(project, "titles", "solo");
  for (const solo of [true, false]) {
    const wav = path.join(root, `${solo}.wav`),
      raw = path.join(root, `${solo}.f32`);
    await renderTimelineAudio(project, wav, root, AbortSignal.timeout(60000));
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-i",
      wav,
      "-f",
      "f32le",
      raw,
    ]);
    const data = await fs.readFile(raw);
    expect(amplitude(data, 440)).toBeGreaterThan(0.05);
    if (solo) expect(amplitude(data, 880)).toBeLessThan(0.002);
    else expect(amplitude(data, 880)).toBeGreaterThan(0.05);
    project = toggleTrack(project, "titles", "solo");
  }
}, 30000);
