import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { createProject, newText } from "../shared/model";
import { renderTimelineAudio } from "../electron/timeline-audio";
import { findBinary, runProcess } from "../electron/process";

it("真实时间线混音保留空白、裁剪、变速、叠音和音量，忽略静音与隐藏轨", async () => {
  const root = path.resolve(`test-output/timeline-audio-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const binary = findBinary("ffmpeg");
  const sources: string[] = [];
  for (const frequency of [440, 880, 1760, 220]) {
    const file = path.join(root, `${frequency}.wav`);
    await runProcess(binary, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      `aevalsrc=if(lt(t\\,1)\\,0\\,0.25*sin(2*PI*${frequency}*t)):s=16000:d=4`,
      file,
    ]);
    sources.push(file);
  }
  const project = createProject();
  project.tracks.push({
    id: "hidden",
    name: "隐藏",
    hidden: true,
    muted: false,
    locked: false,
  });
  project.tracks[2].muted = true;
  project.assets = sources.map((file, index) => ({
    id: `a${index}`,
    path: file,
    name: file,
    kind: "audio",
    duration: 4,
    width: 0,
    height: 0,
    hasAudio: true,
  }));
  project.clips = [
    {
      ...newText("titles", 1),
      kind: "audio",
      assetId: "a0",
      sourceIn: 1,
      duration: 1,
      speed: 2,
      volume: 0.5,
    },
    {
      ...newText("video", 1.5),
      kind: "audio",
      assetId: "a1",
      sourceIn: 1,
      duration: 1,
      volume: 0.25,
    },
    {
      ...newText("audio", 0),
      kind: "audio",
      assetId: "a2",
      sourceIn: 1,
      duration: 3,
    },
    {
      ...newText("hidden", 0),
      kind: "audio",
      assetId: "a3",
      sourceIn: 1,
      duration: 3,
    },
  ];
  const mixed = path.join(root, "timeline.wav");
  expect(
    await renderTimelineAudio(
      project,
      mixed,
      root,
      new AbortController().signal,
    ),
  ).toBe(3);
  const raw = path.join(root, "samples.f32");
  await runProcess(binary, ["-y", "-i", mixed, "-f", "f32le", raw]);
  const data = await fs.readFile(raw);
  expect(data.length / 4 / 16000).toBeCloseTo(3, 2);
  const amplitude = (time: number, frequency: number, samples = data) => {
    let real = 0,
      imaginary = 0;
    const count = 1600;
    for (let index = 0; index < count; index++) {
      const value = samples.readFloatLE((Math.round(time * 16000) + index) * 4);
      const phase = (2 * Math.PI * frequency * index) / 16000;
      real += value * Math.cos(phase);
      imaginary += value * Math.sin(phase);
    }
    return (2 * Math.hypot(real, imaginary)) / count;
  };
  expect(amplitude(0.3, 440)).toBeLessThan(0.001);
  const first = amplitude(1.2, 440);
  const second = amplitude(2.2, 880);
  expect(first).toBeGreaterThan(0.04);
  expect(second).toBeGreaterThan(0.02);
  expect(amplitude(1.7, 440)).toBeGreaterThan(0.04);
  expect(amplitude(1.7, 880)).toBeGreaterThan(0.02);
  expect(amplitude(2.7, 440)).toBeLessThan(0.001);
  expect(amplitude(1.7, 1760)).toBeLessThan(0.003);
  expect(amplitude(1.7, 220)).toBeLessThan(0.003);
  const louder = path.join(root, "louder.wav");
  await renderTimelineAudio(
    {
      ...project,
      clips: project.clips.map((clip) => ({
        ...clip,
        volume: clip.volume * 2,
      })),
    },
    louder,
    root,
    new AbortController().signal,
  );
  const louderRaw = path.join(root, "louder.f32");
  await runProcess(binary, ["-y", "-i", louder, "-f", "f32le", louderRaw]);
  const louderData = await fs.readFile(louderRaw);
  expect(amplitude(1.2, 440, louderData) / first).toBeCloseTo(2, 1);
  expect(amplitude(2.2, 880, louderData) / second).toBeCloseTo(2, 1);
});

it("全静音时间线在启动识别前明确提示", async () => {
  await expect(
    renderTimelineAudio(
      createProject(),
      "unused.wav",
      "unused",
      new AbortController().signal,
    ),
  ).rejects.toThrow("时间线上没有可识别的声音");
});
