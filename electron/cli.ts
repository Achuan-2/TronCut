import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import {
  cliHelp,
  cliPlanSchema,
  editSchema,
  narrationSchema,
  transcriptionSchema,
} from "../shared/cli";
import { type Project, projectDuration, uid } from "../shared/model";
import { toSrt } from "../shared/subtitles";
import { captionDefaults } from "../shared/captions";
import { onnxModelSchema } from "../shared/onnx";
import { exportFrame, exportVideo } from "./export";
import { capabilities, probeMedia } from "./media";
import { downloadOnnxModel } from "./onnx";
import { openProject, saveProject } from "./project-store";
import {
  type CliContext,
  buildCliProject,
  editCliProject,
  addCliMusic,
  narrateCliProject,
  transcribeCliProject,
  projectCues,
  validateSourceRanges,
} from "./cli-project";

const optionDefinitions = {
  input: { type: "string" },
  project: { type: "string" },
  plan: { type: "string" },
  edits: { type: "string" },
  script: { type: "string" },
  output: { type: "string" },
  srt: { type: "string" },
  result: { type: "string" },
  engine: { type: "string" },
  device: { type: "string" },
  language: { type: "string" },
  "model-dir": { type: "string" },
  clips: { type: "string" },
  "cancel-file": { type: "string" },
  interval: { type: "string" },
  "max-frames": { type: "string" },
  prompt: { type: "string" },
  offline: { type: "boolean" },
  overwrite: { type: "boolean" },
  software: { type: "boolean" },
  help: { type: "boolean" },
  version: { type: "boolean" },
  json: { type: "boolean" },
} as const;
type Options = ReturnType<typeof parseOptions>["values"];
function parseOptions(args: string[]) {
  return parseArgs({
    args,
    options: optionDefinitions,
    allowPositionals: true,
    strict: true,
  });
}
async function readJson(file: string) {
  return JSON.parse(await fs.readFile(path.resolve(file), "utf8"));
}
function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`需要 --${name}`);
  return path.resolve(value);
}

async function outputFile(
  file: string,
  overwrite: boolean,
  inputs: string[] = [],
) {
  const target = path.resolve(file);
  if ((await fs.lstat(target).catch(() => null))?.isSymbolicLink())
    throw new Error(`输出不能是符号链接：${target}`);
  const canonical = async (file: string) => {
    const absolute = path.resolve(file);
    const resolved = await fs
      .realpath(absolute)
      .catch(async () =>
        path.join(
          await fs
            .realpath(path.dirname(absolute))
            .catch(() => path.dirname(absolute)),
          path.basename(absolute),
        ),
      );
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const targetKey = await canonical(target);
  if ((await Promise.all(inputs.map(canonical))).includes(targetKey))
    throw new Error(`输出不能覆盖源素材：${target}`);
  if (
    !overwrite &&
    (await fs.access(target).then(
      () => true,
      () => false,
    ))
  )
    throw new Error(`输出已存在：${target}；如需替换请使用 --overwrite`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  return target;
}

async function inWorkDir<T>(
  context: CliContext,
  run: (folder: string) => Promise<T>,
): Promise<T> {
  const root = path.join(context.userData, "cli-temp");
  await fs.mkdir(root, { recursive: true });
  const folder = await fs.mkdtemp(path.join(root, "task-"));
  try {
    return await run(folder);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
}

async function inputProject(options: Options, context: CliContext) {
  if (options.project && options.input)
    throw new Error("--project 和 --input 只能选择一个");
  if (options.project)
    return validateSourceRanges(
      await openProject(path.resolve(options.project)),
    );
  const input = required(options.input, "input 或 --project");
  return buildCliProject(
    cliPlanSchema.parse({
      version: 1,
      cuts: [{ input }],
      output: { project: "unused.troncut" },
    }),
    process.cwd(),
    context,
  );
}

export async function prepareFrames(
  project: Project,
  folder: string,
  context: CliContext,
  options: {
    interval: number;
    maxFrames: number;
    overwrite: boolean;
    prompt?: string;
  },
) {
  const duration = projectDuration(project);
  if (
    !duration ||
    !project.clips.some((clip) => ["video", "image"].includes(clip.kind))
  )
    throw new Error("抽帧需要包含画面的非空工程");
  const interval = z.number().finite().positive().parse(options.interval);
  const maximum = z.number().int().min(1).max(200).parse(options.maxFrames);
  const inputs = project.assets.map((asset) => asset.path);
  const directory = path.resolve(folder),
    manifest = await outputFile(
      path.join(directory, "frames.json"),
      options.overwrite,
      inputs,
    );
  const count = Math.min(maximum, Math.max(1, Math.ceil(duration / interval)));
  const frames: { time: number; path: string }[] = [];
  await inWorkDir(context, async (workDir) => {
    for (let index = 0; index < count; index++) {
      const time = Math.min(
        duration - 1 / project.canvas.fps,
        (index * duration) / count,
      );
      const target = await outputFile(
        path.join(directory, `frame-${String(index + 1).padStart(4, "0")}.jpg`),
        options.overwrite,
        inputs,
      );
      const temporary = path.join(workDir, "frame.png");
      context.progress(
        (100 * index) / count,
        `抽帧 ${index + 1}/${count}：${time.toFixed(3)} 秒`,
      );
      await exportFrame(
        project,
        Math.max(0, time),
        temporary,
        workDir,
        context.signal,
        context.resources,
      );
      await sharp(temporary)
        .resize({ width: 960, withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toFile(target);
      frames.push({ time: Math.max(0, time), path: target });
    }
  });
  const template = await outputFile(
    path.join(directory, "script-template.json"),
    options.overwrite,
    inputs,
  );
  const guide = await outputFile(
    path.join(directory, "script-guide.md"),
    options.overwrite,
    inputs,
  );
  await fs.writeFile(
    manifest,
    JSON.stringify(
      {
        duration,
        canvas: project.canvas,
        frames,
        timeBasis: "edited-project-seconds",
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    template,
    JSON.stringify(
      { engine: "kokoro-onnx", voice: "10", segments: [] },
      null,
      2,
    ),
  );
  await fs.writeFile(
    guide,
    `# 根据画面生成解说\n\n阅读 frames.json 的图片，按编辑后时间线（总长 ${duration.toFixed(3)} 秒）生成中文文案。${options.prompt ? `\n\n用户要求：${options.prompt}` : ""}\n\n只描述实际画面能够支持的内容；抽帧之间未观察到的操作细节不要编造。把配音写成简短、自然的句子，按 start/end/text 写入 script-template.json 的 segments。时间段按顺序且不重叠，每段 end 不超过总时长；留出足够朗读时间。然后调用 TronCut CLI 的 narrate，或把脚本放入 run 计划的 narration 字段。CLI 会生成实际音频、按真实音频分段时间添加字幕，并保存可编辑工程。\n`,
  );
  return { directory, manifest, template, guide, duration, frames };
}

async function saveOutputs(
  project: Project,
  outputs: { project: string; video?: string; srt?: string },
  context: CliContext,
  options: Options,
) {
  validateSourceRanges(project);
  const inputs = project.assets.map((asset) => asset.path);
  const projectFile = await outputFile(
    outputs.project,
    Boolean(options.overwrite),
    inputs,
  );
  const srt = outputs.srt
    ? await outputFile(outputs.srt, Boolean(options.overwrite), inputs)
    : undefined;
  const video = outputs.video
    ? await outputFile(outputs.video, Boolean(options.overwrite), inputs)
    : undefined;
  if (
    new Set(
      [projectFile, srt, video]
        .filter(Boolean)
        .map((file) =>
          process.platform === "win32" ? file!.toLowerCase() : file,
        ),
    ).size !== [projectFile, srt, video].filter(Boolean).length
  )
    throw new Error("工程、字幕和视频输出路径不能相同");
  const saved = await saveProject(project, projectFile);
  if (srt) await fs.writeFile(srt, toSrt(projectCues(saved)), "utf8");
  if (video) {
    if (path.extname(video).toLowerCase() !== ".mp4")
      throw new Error("视频输出请使用 .mp4 扩展名");
    if (options.software) saved.exportSettings = { encoder: "software" };
    const engines = await capabilities(context.resources);
    if (!engines.ffmpeg) throw new Error(engines.error || "媒体引擎不可用");
    await inWorkDir(context, (workDir) =>
      exportVideo(
        saved,
        video,
        workDir,
        engines.rubberband,
        context.signal,
        (percent) => context.progress(percent, "导出视频"),
        context.resources,
      ),
    );
  }
  return {
    project: projectFile,
    video,
    srt,
    duration: projectDuration(saved),
    captions: projectCues(saved).length,
    assets: saved.assets.length,
  };
}

export async function executeCli(
  args: string[],
  context: CliContext,
): Promise<Record<string, unknown>> {
  const { values: options, positionals } = parseOptions(args);
  const command = positionals[0] ?? "help";
  if (positionals.length > 1)
    throw new Error("命令只能有一个，文件路径请使用命名参数");
  if (options.version) return { version: context.version };
  if (options.help || command === "help")
    return { ...cliHelp, version: context.version };
  if (!(command in cliHelp.commands))
    throw new Error(`未知命令：${command}；使用 help 查看接口`);
  const allowed: Record<string, string[]> = {
    inspect: ["input", "project"],
    frames: ["input", "project", "output", "interval", "max-frames", "prompt"],
    build: ["plan"],
    edit: ["project", "edits", "output", "srt"],
    transcribe: [
      "project",
      "input",
      "output",
      "srt",
      "engine",
      "language",
      "model-dir",
      "device",
      "clips",
      "offline",
    ],
    narrate: ["project", "input", "script", "output", "srt", "offline"],
    export: ["project", "input", "output", "software"],
    run: ["plan", "software", "offline", "interval", "max-frames", "prompt"],
    models: ["engine"],
  };
  const common = [
    "help",
    "version",
    "json",
    "result",
    "overwrite",
    "cancel-file",
  ];
  for (const key of Object.keys(options))
    if (!common.includes(key) && !allowed[command].includes(key))
      throw new Error(`${command} 不支持 --${key}`);
  const configs = [options.plan, options.edits, options.script].filter(
    (file): file is string => Boolean(file),
  );
  if (options.output && command !== "frames")
    await outputFile(options.output, Boolean(options.overwrite), configs);
  if (options.srt)
    await outputFile(options.srt, Boolean(options.overwrite), configs);
  if (command === "models") {
    const engine = onnxModelSchema.parse(options.engine);
    return inWorkDir(context, (temp) =>
      downloadOnnxModel(
        engine,
        { ...context, temp },
        context.signal,
        context.progress,
      ),
    );
  }
  if (command === "inspect") {
    if (options.input)
      return {
        asset: await probeMedia(
          required(options.input, "input"),
          context.resources,
        ),
      };
    const project = await inputProject(options, context);
    return {
      project,
      duration: projectDuration(project),
      captions: projectCues(project),
    };
  }
  if (command === "frames")
    return prepareFrames(
      await inputProject(options, context),
      required(options.output, "output"),
      context,
      {
        interval: Number(options.interval ?? 2),
        maxFrames: Number(options["max-frames"] ?? 40),
        overwrite: Boolean(options.overwrite),
        prompt: options.prompt,
      },
    );
  if (command === "export") {
    const project = await inputProject(options, context);
    const video = await outputFile(
      required(options.output, "output"),
      Boolean(options.overwrite),
      project.assets.map((asset) => asset.path),
    );
    if (path.extname(video).toLowerCase() !== ".mp4")
      throw new Error("视频输出请使用 .mp4 扩展名");
    if (options.software) project.exportSettings = { encoder: "software" };
    const engine = await capabilities(context.resources);
    if (!engine.ffmpeg) throw new Error(engine.error);
    await inWorkDir(context, (workDir) =>
      exportVideo(
        project,
        video,
        workDir,
        engine.rubberband,
        context.signal,
        (percent) => context.progress(percent, "导出视频"),
        context.resources,
      ),
    );
    return { video, duration: projectDuration(project) };
  }
  if (command === "edit" || command === "transcribe" || command === "narrate") {
    const output = required(options.output, "output");
    let project = await inputProject(options, context);
    await outputFile(
      output,
      Boolean(options.overwrite),
      project.assets.map((asset) => asset.path),
    );
    if (command === "edit")
      project = editCliProject(
        project,
        z
          .array(editSchema)
          .parse(await readJson(required(options.edits, "edits"))),
      );
    if (command === "transcribe") {
      const configuration = transcriptionSchema.parse({
        engine: options.engine,
        device: options.device,
        language: options.language,
        modelDir: options["model-dir"],
        offline: options.offline,
        clipIds: options.clips?.split(","),
      });
      const result = await transcribeCliProject(
        project,
        configuration,
        context,
        { y: captionDefaults.y },
      );
      if (!result.cues.length)
        throw new Error(
          "没有识别到语音；无声视频请使用 frames 生成画面索引，再由调用者编写文案并 narrate",
        );
      project = result.project;
    }
    if (command === "narrate") {
      const script = narrationSchema.parse(
        await readJson(required(options.script, "script")),
      );
      script.modelDir = script.modelDir
        ? path.resolve(
            path.dirname(path.resolve(options.script!)),
            script.modelDir,
          )
        : "";
      if (options.offline) script.offline = true;
      project = (
        await narrateCliProject(project, script, context, {
          y: captionDefaults.y,
        })
      ).project;
    }
    return saveOutputs(
      project,
      { project: output, srt: options.srt },
      context,
      options,
    );
  }
  const planFile = required(options.plan, "plan"),
    base = path.dirname(planFile);
  const plan = cliPlanSchema.parse(await readJson(planFile));
  const outputs = {
    project: path.resolve(base, plan.output.project),
    video: plan.output.video
      ? path.resolve(base, plan.output.video)
      : undefined,
    srt: plan.output.srt ? path.resolve(base, plan.output.srt) : undefined,
  };
  let project = await buildCliProject(plan, base, context);
  for (const file of command === "build"
    ? [outputs.project]
    : Object.values(outputs).filter((file): file is string => Boolean(file)))
    await outputFile(file, Boolean(options.overwrite), [
      planFile,
      ...project.assets.map((asset) => asset.path),
      ...plan.music.map((music) => path.resolve(base, music.input)),
    ]);
  if (command === "build")
    return saveOutputs(
      await addCliMusic(project, plan.music, base, context),
      { project: outputs.project },
      context,
      options,
    );
  if (plan.narration) {
    const script = {
      ...plan.narration,
      modelDir: plan.narration.modelDir
        ? path.resolve(base, plan.narration.modelDir)
        : "",
    };
    if (options.offline) script.offline = true;
    project = (await narrateCliProject(project, script, context, plan.captions))
      .project;
  } else if (plan.transcribe !== false && (!plan.project || plan.transcribe)) {
    const configuration = plan.transcribe || transcriptionSchema.parse({});
    if (configuration.modelDir)
      configuration.modelDir = path.resolve(base, configuration.modelDir);
    if (options.offline) configuration.offline = true;
    const transcribed = await transcribeCliProject(
      project,
      configuration,
      context,
      plan.captions,
    );
    if (!transcribed.cues.length) {
      const saved = await saveOutputs(
        project,
        { project: outputs.project },
        context,
        options,
      );
      const storyboard = await prepareFrames(
        project,
        path.join(path.dirname(outputs.project), "storyboard"),
        context,
        {
          interval: Number(options.interval ?? 2),
          maxFrames: Number(options["max-frames"] ?? 40),
          overwrite: Boolean(options.overwrite),
          prompt: options.prompt,
        },
      );
      return {
        status: "needs_script",
        ...saved,
        storyboard,
        next: "读取抽帧并写分段文案，再使用 narrate 或 run。尚未导出视频。",
      };
    }
    project = transcribed.project;
  }
  project = await addCliMusic(project, plan.music, base, context);
  return {
    status: "complete",
    ...(await saveOutputs(project, outputs, context, options)),
  };
}

/** Exactly one result JSON on stdout; progress JSONL goes to stderr. No dialogs. */
export async function runCli(
  args: string[],
  context: Omit<CliContext, "progress">,
  streams = {
    stdout: (text: string) => process.stdout.write(text),
    stderr: (text: string) => process.stderr.write(text),
  },
) {
  const progress = (percent: number, label: string) =>
    streams.stderr(JSON.stringify({ type: "progress", percent, label }) + "\n");
  const cancellation = new AbortController();
  const executionContext = {
    ...context,
    signal: AbortSignal.any([context.signal, cancellation.signal]),
  };
  let watcher: ReturnType<typeof setInterval> | undefined;
  let result: Record<string, unknown>,
    code = 0;
  let resultFile: string | undefined;
  try {
    const { values } = parseOptions(args);
    if (values["cancel-file"]) {
      const file = path.resolve(values["cancel-file"]);
      const check = async () => {
        if (
          await fs.access(file).then(
            () => true,
            () => false,
          )
        )
          cancellation.abort();
      };
      await check();
      watcher = setInterval(() => void check(), 250);
    }
    if (values.result) {
      const reserved = [
        values.input,
        values.project,
        values.plan,
        values.edits,
        values.script,
        values.output,
        values.srt,
      ]
        .filter((file): file is string => Boolean(file))
        .map((file) => path.resolve(file));
      if (values.plan) {
        const plan = cliPlanSchema.parse(await readJson(values.plan));
        const base = path.dirname(path.resolve(values.plan));
        reserved.push(
          ...(plan.cuts?.map((cut) => path.resolve(base, cut.input)) ?? []),
          ...plan.music.map((music) => path.resolve(base, music.input)),
          ...Object.values(plan.output)
            .filter((file): file is string => Boolean(file))
            .map((file) => path.resolve(base, file)),
        );
        if (plan.project) reserved.push(path.resolve(base, plan.project));
      }
      if (values.output && args[0] === "frames") {
        reserved.push(
          ...["frames.json", "script-template.json", "script-guide.md"].map(
            (name) => path.resolve(values.output!, name),
          ),
        );
        if (
          path.dirname(path.resolve(values.result)) ===
            path.resolve(values.output) &&
          /^frame-\d+\.jpg$/i.test(path.basename(values.result))
        )
          throw new Error("结果文件不能覆盖抽帧图片");
      }
      resultFile = await outputFile(
        values.result,
        Boolean(values.overwrite),
        reserved,
      );
    }
    if (executionContext.signal.aborted) throw new Error("任务已取消");
    result = {
      ok: true,
      ...(await executeCli(args, { ...executionContext, progress })),
    };
  } catch (error) {
    code = executionContext.signal.aborted ? 130 : 1;
    result = {
      ok: false,
      error: {
        code: code === 130 ? "CANCELLED" : "CLI_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
  clearInterval(watcher);
  if (resultFile) {
    const temporary = `${resultFile}.${uid()}.tmp`;
    try {
      await fs.writeFile(
        temporary,
        JSON.stringify(result, null, 2) + "\n",
        "utf8",
      );
      await fs.rename(temporary, resultFile);
    } catch (error) {
      code = 1;
      result = {
        ok: false,
        error: { code: "RESULT_WRITE_ERROR", message: String(error) },
      };
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  streams.stdout(JSON.stringify(result, null, 2) + "\n");
  return code;
}
