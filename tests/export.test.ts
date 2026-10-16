import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  createProject,
  newText,
  defaultTransform,
  type Clip,
} from "../shared/model";
import { animation } from "../shared/editor";
import { probeMedia, capabilities } from "../electron/media";
import { runProcess, findBinary } from "../electron/process";
import { exportVideo } from "../electron/export";
import {
  openProject,
  resolveContained,
  saveProject,
} from "../electron/project-store";

describe("真实视频与工程往返", () => {
  it("Windows 工程文件夹图标写入后可以再次保存，隐藏 desktop.ini 不阻止正文保存", async () => {
    const root = path.resolve(`test-output/repeated-save-${Date.now()}`);
    const file = path.join(root, "repeat.troncut"),
      p = createProject("第一次保存");
    const icon =
      process.platform === "win32"
        ? path.resolve("resources/icon.ico")
        : undefined;
    await saveProject(p, file, icon);
    await saveProject({ ...p, name: "第二次保存" }, file, icon);
    expect((await openProject(file)).name).toBe("第二次保存");
    if (icon) {
      const desktopIni = path.join(root, "desktop.ini");
      const expected = `\uFEFF[.ShellClassInfo]\r\nIconResource=${icon},0\r\n`;
      expect(await fs.readFile(desktopIni, "utf16le")).toBe(expected);
      expect(await fs.readdir(root)).not.toContain("project.ico");

      await runProcess("attrib", ["-s", "-h", desktopIni]);
      await fs.writeFile(
        desktopIni,
        "\uFEFF[.ShellClassInfo]\r\nIconResource=project.ico,0\r\n",
        "utf16le",
      );
      await fs.copyFile(icon, path.join(root, "project.ico"));
      await runProcess("attrib", ["+s", "+h", desktopIni]);
      await saveProject(p, file, icon);
      expect(await fs.readFile(desktopIni, "utf16le")).toBe(expected);
      expect(await fs.readdir(root)).not.toContain("project.ico");

      await runProcess("attrib", ["-s", "-h", desktopIni]);
      const custom = "\uFEFF[.ShellClassInfo]\r\nIconResource=custom.ico,0\r\n";
      await fs.writeFile(desktopIni, custom, "utf16le");
      await runProcess("attrib", ["+s", "+h", desktopIni]);
      await saveProject(p, file, icon);
      expect(await fs.readFile(desktopIni, "utf16le")).toBe(custom);
    }
  });
  it("随附纯文字示例可以打开并保持字幕位于中央", async () => {
    const p = await openProject(path.resolve("examples/文字视频.framecraft"));
    expect(p.clips).toHaveLength(3);
    expect(p.clips.every((c) => c.caption && c.transform.y === 0.5)).toBe(true);
  });
  it("拒绝路径逃逸", () => {
    expect(() =>
      resolveContained(path.resolve("project"), "../private"),
    ).toThrow("越出");
    expect(() =>
      resolveContained(path.resolve("project"), path.resolve("outside")),
    ).toThrow("相对");
  });
  it("合成不同轨道，变速音频、中文花字、透明动画和画面位置", async () => {
    const info = await capabilities();
    expect(info.ffmpeg, "必须有可用 ffmpeg 与 ffprobe 才能执行集成验证").toBe(
      true,
    );
    const root = path.resolve("test-output");
    await fs.mkdir(root, { recursive: true });
    const video = path.join(root, "源视频.mp4");
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=15:d=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      video,
    ]);
    const asset = await probeMedia(video),
      p = createProject("集成测试");
    p.canvas = { width: 320, height: 180, fps: 15, background: "#101319" };
    p.assets = [asset];
    const clip: Clip = {
      id: "clip",
      assetId: asset.id,
      trackId: "video",
      kind: "video",
      name: asset.name,
      start: 0,
      duration: 1,
      sourceIn: 0,
      speed: 2,
      volume: 0.6,
      podcast: true,
      transform: { ...defaultTransform },
      keyframes: [],
    };
    const text = newText("titles", 0, 2, "中文花字");
    text.duration = 1;
    text.style!.fontSize = 22;
    text.style!.outlineWidth = 2;
    p.clips = [clip, animation(text, "fade", 0)];
    const target = path.join(root, "export.mp4");
    await exportVideo(
      p,
      target,
      path.join(root, "render"),
      info.rubberband,
      new AbortController().signal,
      () => {},
    );
    const output = await probeMedia(target);
    expect(output.hasAudio).toBe(true);
    expect(output.width).toBe(320);
    expect(output.height).toBe(180);
    expect(output.duration).toBeCloseTo(1, 1);
    const frame = path.join(root, "export-frame.png");
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-ss",
      "0.8",
      "-i",
      target,
      "-frames:v",
      "1",
      frame,
    ]);
    const { data } = await sharp(frame)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(new Set(data).size).toBeGreaterThan(100);
    const file = path.join(root, "portable", "test.framecraft");
    const saved = await saveProject(p, file);
    const disk = JSON.parse(await fs.readFile(file, "utf8"));
    expect(disk.assets[0].path.startsWith("media/")).toBe(true);
    const reopened = await openProject(file);
    expect(reopened.clips).toEqual(saved.clips);
    expect(reopened.assets[0].missing).toBe(false);
    expect(await fs.readFile(reopened.assets[0].path)).toEqual(
      await fs.readFile(video),
    );
    const moved = path.join(root, "moved-project");
    await fs.mkdir(moved, { recursive: true });
    await fs.cp(path.dirname(file), moved, { recursive: true });
    expect(
      (await openProject(path.join(moved, "test.framecraft"))).assets[0]
        .missing,
    ).toBe(false);
  });
  it("只有声音或全隐藏轨道时仍可导出背景画面", async () => {
    const p = createProject("空画面");
    p.canvas = { width: 160, height: 90, fps: 10, background: "#203020" };
    const text = newText("titles", 0);
    text.duration = 0.5;
    p.clips = [text];
    p.tracks[0].hidden = true;
    const output = path.resolve("test-output/hidden.mp4");
    await exportVideo(
      p,
      output,
      path.resolve("test-output/hidden-render"),
      false,
      new AbortController().signal,
      () => {},
    );
    expect((await probeMedia(output)).duration).toBeCloseTo(0.5, 1);
  });
});
