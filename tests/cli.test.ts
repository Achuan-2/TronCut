import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeCli, runCli } from "../electron/cli";
import {
  addCaptionCues,
  editCliProject,
  sourceCuesToTimeline,
} from "../electron/cli-project";
import {
  cliPlanSchema,
  editSchema,
  narrationSchema,
  transcriptionSchema,
} from "../shared/cli";
import { createProject, defaultTransform } from "../shared/model";
import { openProject } from "../electron/project-store";
import { probeMedia } from "../electron/media";
import { runProcess, findBinary } from "../electron/process";

function context(root: string) {
  return {
    userData: path.join(root, "profile"),
    workers: path.resolve("workers/onnx"),
    resources: path.resolve("resources"),
    version: "test",
    signal: new AbortController().signal,
    progress: () => {},
  };
}

describe("Codex CLI 工程与命令协议", () => {
  it("CLI 字幕与编辑器共用默认字号和位置，并保留显式设置", () => {
    const cues = [{ start: 0, end: 2, text: "默认字幕" }];
    const project = addCaptionCues(createProject(), cues);
    expect(project.clips[0].style).toMatchObject({
      fontSize: 40,
      outlineWidth: 7,
      fillEnabled: false,
    });
    expect(project.clips[0].transform).toMatchObject({ x: 0.5, y: 0.92 });
    const custom = addCaptionCues(createProject(), cues, {
      y: 0.8,
      fontSize: 50,
    });
    expect(custom.clips[0].style!.fontSize).toBe(50);
    expect(custom.clips[0].transform.y).toBe(0.8);
  });

  it("拒绝未知计划字段、重叠文案、无效裁剪与锁定轨道编辑", () => {
    expect(transcriptionSchema.parse({}).engine).toBe("qwen3-asr");
    expect(transcriptionSchema.safeParse({ device: "cuda" }).success).toBe(
      false,
    );
    expect(transcriptionSchema.safeParse({ device: "invalid" }).success).toBe(
      false,
    );
    expect(
      cliPlanSchema.safeParse({
        version: 1,
        cuts: [{ input: "a.mp4" }],
        surprise: "ignored",
        output: { project: "a.troncut" },
      }).success,
    ).toBe(false);
    expect(
      narrationSchema.safeParse({
        segments: [
          { start: 0, end: 3, text: "A" },
          { start: 2, end: 4, text: "B" },
        ],
      }).success,
    ).toBe(false);
    const project = createProject();
    project.assets = [
      {
        id: "a",
        name: "a",
        path: "a.mp4",
        kind: "video",
        duration: 10,
        width: 320,
        height: 180,
        hasAudio: true,
      },
    ];
    project.clips = [
      {
        id: "clip",
        assetId: "a",
        trackId: "video",
        name: "clip",
        kind: "video",
        start: 5,
        sourceIn: 2,
        duration: 4,
        speed: 1,
        volume: 1,
        podcast: false,
        transform: { ...defaultTransform },
        keyframes: [{ time: 2, value: { ...defaultTransform, x: 0.8 } }],
      },
    ];
    const sped = editCliProject(project, [
      editSchema.parse({ type: "speed", clipId: "clip", speed: 2 }),
    ]);
    expect(sped.clips[0].duration).toBe(2);
    expect(sped.clips[0].keyframes[0].time).toBe(1);
    const trimmed = editCliProject(project, [
      editSchema.parse({
        type: "trim",
        clipId: "clip",
        sourceIn: 3,
        sourceOut: 5,
      }),
    ]);
    expect(trimmed.clips[0]).toMatchObject({
      duration: 2,
      sourceIn: 3,
      animationOffset: 1,
    });
    expect(() =>
      editCliProject(project, [
        editSchema.parse({
          type: "trim",
          clipId: "clip",
          sourceIn: 2,
          sourceOut: 12,
        }),
      ]),
    ).toThrow("超出了");
    project.tracks.find((track) => track.id === "video")!.locked = true;
    expect(() =>
      editCliProject(project, [
        editSchema.parse({ type: "remove", clipIds: ["clip"] }),
      ]),
    ).toThrow("锁定");
    expect(
      sourceCuesToTimeline(
        [{ start: 1, end: 4, text: "真实字幕" }],
        sped.clips[0],
      ),
    ).toEqual([{ start: 5, end: 6, text: "真实字幕" }]);
  });

  it("结果文件不会覆盖输入，错误也返回单个 JSON 和非零退出码", async () => {
    const root = path.resolve(`test-output/cli-protocol-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const input = path.join(root, "源文件.mp4");
    await fs.writeFile(input, "original");
    let stdout = "";
    const code = await runCli(
      ["inspect", "--input", input, "--result", input, "--overwrite"],
      context(root),
      {
        stdout: (text) => {
          stdout += text;
          return true;
        },
        stderr: () => true,
      },
    );
    expect(code).toBe(1);
    expect(JSON.parse(stdout).ok).toBe(false);
    expect(await fs.readFile(input, "utf8")).toBe("original");
    await expect(
      executeCli(["inspect", "--software"], context(root)),
    ).rejects.toThrow("不支持");
    const result = path.join(root, "result.json");
    stdout = "";
    expect(
      await runCli(["help", "--result", result], context(root), {
        stdout: (text) => {
          stdout += text;
          return true;
        },
        stderr: () => true,
      }),
    ).toBe(0);
    expect(JSON.parse(stdout).protocol).toBe("troncut-cli-v1");
    expect(JSON.parse(await fs.readFile(result, "utf8"))).toEqual(
      JSON.parse(stdout),
    );
  });

  it("真实无声素材可剪辑、抽帧、请求文案，字幕和变速按工程导出", async () => {
    const root = path.resolve(`test-output/cli-integration-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const input = path.join(root, "无声 素材.mp4");
    await runProcess(findBinary("ffmpeg"), [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:r=15",
      "-t",
      "3",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      input,
    ]);
    const planFile = path.join(root, "plan.json");
    const plan = {
      version: 1,
      cuts: [
        { input: "无声 素材.mp4", sourceIn: 0.5, sourceOut: 2.5, speed: 2 },
      ],
      output: { project: "saved/project.troncut", video: "saved/video.mp4" },
    };
    await fs.writeFile(planFile, JSON.stringify(plan));
    const ctx = context(root);
    const waiting = await executeCli(
      ["run", "--plan", planFile, "--max-frames", "2"],
      ctx,
    );
    expect(waiting.status).toBe("needs_script");
    expect(
      await fs.access(path.join(root, "saved/video.mp4")).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    const reopened = await openProject(
      path.join(root, "saved/project.troncut"),
    );
    expect(reopened.clips[0]).toMatchObject({
      sourceIn: 0.5,
      duration: 1,
      speed: 2,
    });
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(root, "saved/storyboard/frames.json"),
        "utf8",
      ),
    );
    expect(manifest.duration).toBe(1);
    expect(manifest.frames).toHaveLength(1);
    expect((await fs.stat(manifest.frames[0].path)).size).toBeGreaterThan(100);
    const edits = path.join(root, "edits.json"),
      edited = path.join(root, "edited/project.troncut");
    await fs.writeFile(
      edits,
      JSON.stringify([
        {
          type: "text",
          text: "红色画面",
          start: 0,
          end: 1,
          style: { fontSize: 18, outlineWidth: 1 },
        },
      ]),
    );
    await executeCli(
      [
        "edit",
        "--project",
        path.join(root, "saved/project.troncut"),
        "--edits",
        edits,
        "--output",
        edited,
      ],
      ctx,
    );
    const output = path.join(root, "edited/video.mp4");
    await executeCli(
      ["export", "--project", edited, "--output", output, "--software"],
      ctx,
    );
    expect((await probeMedia(output)).duration).toBeCloseTo(1, 1);
    await expect(
      executeCli(["export", "--project", edited, "--output", output], ctx),
    ).rejects.toThrow("输出已存在");
    await expect(
      executeCli(
        ["export", "--input", input, "--output", input, "--overwrite"],
        ctx,
      ),
    ).rejects.toThrow("覆盖源素材");
  });
});

it("已有取消标记时不启动任务并返回 130", async () => {
  const root = path.resolve(`test-output/cli-cancel-${Date.now()}`);
  await fs.mkdir(root, { recursive: true });
  const cancel = path.join(root, "cancel");
  await fs.writeFile(cancel, "cancel");
  let stdout = "";
  expect(
    await runCli(["help", "--cancel-file", cancel], context(root), {
      stdout: (text) => {
        stdout += text;
        return true;
      },
      stderr: () => true,
    }),
  ).toBe(130);
  expect(JSON.parse(stdout).error.code).toBe("CANCELLED");
});
