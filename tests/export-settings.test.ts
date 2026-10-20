import { expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import {
  createProject,
  defaultTransform,
  validateProject,
  type Clip,
} from "../shared/model";
import {
  defaultExportSettings,
  defaultExportFileName,
  exportDimensions,
  resolvedExportSettings,
  videoExportRequestSchema,
} from "../shared/export-settings";
import {
  assertExportTarget,
  videoExportTarget,
} from "../electron/video-export-target";
import { exportVideo, exportFrame } from "../electron/export";
import { probeMedia } from "../electron/media";
import { findBinary, runProcess } from "../electron/process";
import { saveProject, openProject } from "../electron/project-store";

it("导出保持横屏、竖屏和非标准比例，输出偶数尺寸；兼容旧项目并校验文件名", () => {
  expect(resolvedExportSettings({ encoder: "software" })).toEqual({
    ...defaultExportSettings,
    encoder: "software",
  });
  expect(exportDimensions({ width: 1920, height: 1080 }, "720p")).toEqual({
    width: 1280,
    height: 720,
  });
  expect(exportDimensions({ width: 1080, height: 1920 }, "1080p")).toEqual({
    width: 1080,
    height: 1920,
  });
  expect(exportDimensions({ width: 1600, height: 1200 }, "1080p")).toEqual({
    width: 1440,
    height: 1080,
  });
  expect(exportDimensions({ width: 333, height: 191 }, "source")).toEqual({
    width: 334,
    height: 192,
  });
  expect(defaultExportFileName("导出/测试:*?")).toBe("导出_测试___");
  for (const fileName of ["../source", "CON", "video.", "  ", "x/y", "x\\y"])
    expect(
      videoExportRequestSchema.safeParse({
        directory: "D:/Video",
        fileName,
        settings: defaultExportSettings,
      }).success,
    ).toBe(false);
  const project = createProject();
  project.exportSettings = {
    ...defaultExportSettings,
    format: "webm",
    resolution: "720p",
    quality: "compact",
  };
  expect(validateProject(project).exportSettings).toEqual(
    project.exportSettings,
  );
});

it("保存目标校验拒绝覆盖源素材及 Windows 不同大小写路径", async () => {
  const root = path.resolve(`test-output/export-target-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, "source.mp4");
  await fs.writeFile(file, "keep source");
  const project = createProject();
  project.assets = [
    {
      id: "source",
      path: file,
      name: "source.mp4",
      kind: "video",
      width: 320,
      height: 180,
      duration: 1,
      hasAudio: false,
    },
  ];
  await expect(assertExportTarget(project, file)).rejects.toThrow("不能覆盖");
  if (process.platform === "win32")
    await expect(
      assertExportTarget(project, file.toUpperCase()),
    ).rejects.toThrow("不能覆盖");
  await expect(
    assertExportTarget(project, path.join(root, "copy.mp4")),
  ).resolves.toBeUndefined();
  expect(
    videoExportTarget({
      directory: root,
      fileName: "成片.mp4",
      settings: { ...defaultExportSettings, format: "webm" },
    }),
  ).toBe(path.join(root, "成片.webm"));
  expect(() =>
    videoExportTarget({
      directory: "relative",
      fileName: "clip",
      settings: defaultExportSettings,
    }),
  ).toThrow("完整文件夹路径");
  expect(await fs.readFile(file, "utf8")).toBe("keep source");
});

it("四种格式真实输出匹配容器和音视频编码；分辨率与质量生效，保留画布及导出偏好", async () => {
  const root = path.resolve(`test-output/export-settings-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const source = path.join(root, "source.mp4");
  await runProcess(findBinary("ffmpeg"), [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=10:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    source,
  ]);
  const asset = await probeMedia(source);
  const project = createProject("导出选项");
  project.canvas = { width: 320, height: 180, fps: 10, background: "#132211" };
  project.assets = [asset];
  const clip: Clip = {
    id: "video-clip",
    assetId: asset.id,
    trackId: "video",
    name: "video",
    kind: "video",
    start: 0,
    duration: 1,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: defaultTransform,
    keyframes: [],
  };
  project.clips = [clip];
  const original = JSON.stringify(project);
  const sizes: number[] = [];
  for (const format of ["mp4", "mov", "mkv", "webm"] as const) {
    const settings = {
      encoder: "software" as const,
      format,
      resolution: "480p" as const,
      quality: "standard" as const,
    };
    const output = path.join(root, `video.${format}`);
    await exportVideo(
      { ...project, exportSettings: settings },
      output,
      path.join(root, format),
      false,
      new AbortController().signal,
      () => { },
    );
    const info = JSON.parse(
      await runProcess(findBinary("ffprobe"), [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        output,
      ]),
    );
    expect(info.format.format_name).toContain(
      format === "webm" || format === "mkv" ? "matroska" : format,
    );
    const video = info.streams.find(
      (s: { codec_type: string }) => s.codec_type === "video",
    );
    const audio = info.streams.find(
      (s: { codec_type: string }) => s.codec_type === "audio",
    );
    expect([video.width, video.height]).toEqual([854, 480]);
    expect(video.codec_name).toBe(format === "webm" ? "vp9" : "h264");
    expect(audio.codec_name).toBe(format === "webm" ? "opus" : "aac");
    expect(Number(info.format.duration)).toBeCloseTo(1, 1);
    if (format === "mp4") sizes.push((await fs.stat(output)).size);
  }
  const compact = path.join(root, "compact.mp4");
  await exportVideo(
    {
      ...project,
      exportSettings: {
        encoder: "software",
        quality: "compact",
        resolution: "480p",
      },
    },
    compact,
    path.join(root, "compact"),
    false,
    new AbortController().signal,
    () => { },
  );
  expect((await fs.stat(compact)).size).toBeLessThan(sizes[0] * 0.9);
  expect(
    await fs.readFile(path.join(root, "compact", "graph.txt"), "utf8"),
  ).toContain("scale=854:480");
  expect(JSON.stringify(project)).toBe(original);
  project.exportSettings = {
    ...defaultExportSettings,
    format: "webm",
    resolution: "720p",
    quality: "compact",
  };
  const archive = path.join(root, "project", "export.troncut");
  await saveProject(project, archive);
  expect((await openProject(archive)).exportSettings).toEqual(
    project.exportSettings,
  );
}, 90000);

it("奇数画布在最终输出补为偶数尺寸，截帧规格不受视频设置影响", async () => {
  const root = path.resolve(`test-output/export-odd-${Date.now()}`);
  const project = createProject();
  project.canvas = { width: 161, height: 91, fps: 10, background: "#132211" };
  project.clips = [
    {
      id: "shape",
      trackId: "video",
      kind: "shape",
      name: "shape",
      start: 0,
      duration: 0.2,
      sourceIn: 0,
      speed: 1,
      volume: 1,
      podcast: false,
      fill: "#00ff00",
      transform: { ...defaultTransform, scale: 0.5 },
      keyframes: [],
    },
  ];
  project.exportSettings = { encoder: "software" };
  await fs.mkdir(root, { recursive: true });
  const target = path.join(root, "odd.mp4");
  await exportVideo(
    project,
    target,
    path.join(root, "render"),
    false,
    new AbortController().signal,
    () => { },
  );
  expect(await probeMedia(target)).toMatchObject({ width: 162, height: 92 });
  project.exportSettings.resolution = "720p";
  const still = path.join(root, "snapshot.png");
  await exportFrame(
    project,
    0.1,
    still,
    path.join(root, "snapshot"),
    new AbortController().signal,
  );
  expect(await probeMedia(still)).toMatchObject({ width: 161, height: 91 });
});
