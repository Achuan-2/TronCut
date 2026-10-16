import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  protocol,
  session,
  screen,
  safeStorage,
  shell,
} from "electron";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  type Asset,
  type Project,
  uid,
  validateProject,
  projectDuration,
} from "../shared/model";
import { parseSrt, toSrt } from "../shared/subtitles";
import { capabilities, probeMedia } from "./media";
import { findBinary, runProcess } from "./process";
import { openProject, saveProject } from "./project-store";
import { importCamtasia } from "./camtasia";
import { audioFilters, exportVideo, exportFrame } from "./export";
import { speechEngineSchema, speechOptionsSchema } from "../shared/asr";
import { transcribeProject, transcribeAsset } from "./transcription";
import { synthesizeSpeech } from "./synthesis";
import { SpeechVoicePreviews } from "./speech-preview";
import { windowsSpeechVoices } from "./windows-speech";
import { ttsOptionsSchema } from "../shared/tts";
import { onnxModelSchema } from "../shared/onnx";
import { downloadOnnxModel } from "./onnx";
import { closeOnnxSessions } from "./onnx-session";
import { ClonedVoices, validateVoiceReference } from "./cloned-voices";
import { createClonedVoiceSchema } from "../shared/cloned-voices";
import { mediaThumbnail } from "./thumbnails";
import { serveMediaFile } from "./media-protocol";
import { NativeRecording } from "./native-recording";
import { RecordingBorder } from "./recording-border";
import { copyClipClipboard, importClipboardMedia } from "./clipboard-media";
import { importMediaPaths } from "./import-media";
import { RecentProjects } from "./recent-projects";
import { runCli } from "./cli";
import { PreferencesStore } from "./preferences";
import { preferencesUpdateSchema, aiProviderUpdateSchema } from "../shared/preferences";
import { captionProcessingSchema, cueSchema } from "../shared/caption-processing";
import { processCaptionCues } from "./caption-processing";
import { requestAi, listAiModels } from "./ai";
import { RecordingStyleStore } from "./recording-style";
import { videoExportRequestSchema } from "../shared/export-settings";
import { assertExportTarget, videoExportTarget } from "./video-export-target";
import { editCommands, editCommandEnabled, editMenuStateSchema, textEditSchema } from "../shared/edit-menu";
import {
  recordingBackgroundSchema,
  recordingSettingsSchema,
} from "../shared/recording";

const cliIndex = process.argv.indexOf("--cli");
const cliMode = cliIndex >= 0;
if (cliMode) app.commandLine.appendSwitch("disable-gpu");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "framecraft-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
if (!app.isPackaged || process.env.FRAMECRAFT_SMOKE)
  app.setPath(
    "userData",
    path.resolve(process.env.FRAMECRAFT_USER_DATA || ".framecraft-dev"),
  );
let window: BrowserWindow;
const windowState = () => ({
  maximized: window.isMaximized(),
  fullscreen: window.isFullScreen(),
});
let projectFile: string | null = null;
const recentProjects = new RecentProjects(path.join(app.getPath("userData"), "recent-projects.json"));
const preferences = new PreferencesStore(path.join(app.getPath("userData"), "preferences.json"), safeStorage);
const recordingStyle = new RecordingStyleStore(app.getPath("userData"));
async function rememberProject(project: Project, file: string) {
  let thumbnail: string | null = null;
  const visible = new Set(project.tracks.filter((track) => !track.hidden).map((track) => track.id));
  const clip = project.clips.find((clip) => visible.has(clip.trackId) && ["image", "video"].includes(clip.kind));
  const asset = project.assets.find((asset) => asset.id === clip?.assetId && !asset.missing);
  if (asset) thumbnail = await mediaThumbnail(asset, false, path.join(app.getPath("userData"), "thumbnails"), process.resourcesPath).catch(() => null);
  // Recent-project metadata must not turn a successfully opened/saved project into an error.
  await recentProjects.remember(project, file, thumbnail ?? undefined).catch(() => {});
}
let projectDirty = false;
let pendingProject =
  process.argv.find((argument) => /\.(troncut|framecraft)$/i.test(argument)) ??
  null;
app.on("open-file", (event, file) => {
  event.preventDefault();
  pendingProject = file;
  if (window && !window.isDestroyed())
    window.webContents.send("shortcut", "openPending");
});
let captureSelection: { id: string; systemAudio: boolean } | null = null;
let task: AbortController | null = null;
let nativeRecording: NativeRecording | null = null;
const recordingBorder = new RecordingBorder();
function requestRecordingStop() {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
    window.webContents.send("shortcut", "stopRecording");
}
const assets = new Map<string, Asset>();
const speechVoicePreviews = new SpeechVoicePreviews();
const clonedVoices = new ClonedVoices(app.getPath("userData"));
const temporaryReferences = new Set<string>();
const approvedPaths = new Set<string>();
const recordings = new Map<
  string,
  { file: string; handle: FileHandle; bytes: number; kind: string }
>();
const register = (asset: Asset) => {
  assets.set(asset.id, asset);
  approvedPaths.add(path.resolve(asset.path));
  return asset;
};
const registerProject = (project: Project) => {
  project.assets.forEach(register);
  return project;
};
const assetById = (id: unknown) => {
  const asset = assets.get(z.string().parse(id));
  if (!asset) throw new Error("素材未授权或已移除");
  return asset;
};
function authorizedProject(input: unknown): Project {
  const project = validateProject(input);
  for (const asset of project.assets) {
    assetById(asset.id);
    if (!approvedPaths.has(path.resolve(asset.path)))
      throw new Error("素材路径不能通过界面直接改写，请重新导入素材");
  }
  return project;
}
function handle(channel: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("非法 IPC 来源");
    return callback(...args);
  });
}
const notify = (percent: number, label: string) => {
  if (!window.isDestroyed())
    window.webContents.send("task:progress", { percent, label });
};
async function chooseFile(
  title: string,
  extensions: string[],
): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    title,
    properties: ["openFile"],
    filters: [{ name: title, extensions }],
  });
  return result.canceled ? null : result.filePaths[0];
}
function installHandlers() {
  handle("preferences:get", () => preferences.get());
  handle("preferences:save", (input: unknown) => preferences.save(preferencesUpdateSchema.parse(input)));
  handle("preferences:folder", async () => {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    const error = await shell.openPath(app.getPath("userData"));
    if (error) throw new Error(error);
  });
  handle("preferences:ai:models", async (input: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const provider = aiProviderUpdateSchema.parse(input);
    task = new AbortController();
    try { return await listAiModels(await preferences.resolveProvider(provider), task.signal); }
    finally { task = null; }
  });
  handle("preferences:ai:test", async (input: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    task = new AbortController();
    try {
      const settings = await preferences.resolveAi(preferencesUpdateSchema.parse(input));
      notify(0, "正在测试 AI 连接");
      await requestAi(settings, "Reply with OK.", "Connection test", task.signal);
    } finally { task = null; }
  });
  handle("subtitles:refine", async (input: unknown, inputOptions: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const cues = z.array(cueSchema).max(10000).parse(input);
    const options = captionProcessingSchema.parse(inputOptions);
    task = new AbortController();
    try {
      notify(0, "正在处理字幕");
      return await processCaptionCues(cues, options, () => preferences.resolveAi(), task.signal, notify);
    } finally { task = null; }
  });
  handle("window:state", windowState);
  handle("recording:settings", async () => (await preferences.get()).recording);
  handle("recording:settings:save", async (input: unknown) =>
    (await preferences.save({ recording: recordingSettingsSchema.parse(input) })).recording,
  );
  handle("recording:background", async (width: unknown, height: unknown, preset: unknown) =>
    register(await recordingStyle.background(
      z.number().int().min(16).max(7680).parse(width),
      z.number().int().min(16).max(4320).parse(height),
      recordingBackgroundSchema.parse(preset),
    )),
  );
  handle("window:minimize", () => window.minimize());
  handle("window:maximize", () => {
    if (window.isFullScreen()) window.setFullScreen(false);
    else if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  // Use the normal close event so dirty projects and active recordings still
  // receive the same exit confirmation as the system close button.
  handle("window:close", () => window.close());
  handle("window:menu", (input: unknown, inputX: unknown, inputY: unknown) => {
    const name = z.enum(["edit", "view"]).parse(input);
    const bounds = window.getContentBounds();
    const x = Math.round(Math.min(bounds.width, Math.max(0, z.number().finite().parse(inputX))));
    const y = Math.round(Math.min(bounds.height, Math.max(0, z.number().finite().parse(inputY))));
    const label = name === "edit" ? "编辑" : "视图";
    Menu.getApplicationMenu()?.items.find((item) => item.label === label)?.submenu?.popup({ window, x, y });
  });
  handle("window:edit-menu", (input: unknown) => {
    const state = editMenuStateSchema.parse(input);
    for (const command of editCommands) {
      const item = Menu.getApplicationMenu()?.getMenuItemById(`edit-${command.id}`);
      if (item) item.enabled = editCommandEnabled(command.id, state);
    }
  });
  handle("window:edit-text", (input: unknown) => {
    const command = textEditSchema.parse(input);
    if (command === "delete") window.webContents.delete();
    else window.webContents[command]();
  });
  handle("clipboard:clips", (token: unknown) =>
    copyClipClipboard(z.string().uuid().parse(token)),
  );
  handle("media:clipboard", async () => {
    const result = await importClipboardMedia(
      path.join(app.getPath("userData"), "pasted-media"),
      process.resourcesPath,
    );
    return { ...result, assets: result.assets.map(register) };
  });
  handle("media:import-paths", async (input: unknown) => {
    const files = z.array(z.string().min(1).max(32768)).max(128).parse(input);
    return (await importMediaPaths(files, process.resourcesPath)).map(register);
  });
  handle(
    "capture:native:available",
    async () =>
      process.platform === "win32" &&
      (await fs.access(findBinary("wgc-capture", process.resourcesPath)).then(
        () => true,
        () => false,
      )) &&
      (await fs
        .access(findBinary("cursor-sampler", process.resourcesPath))
        .then(
          () => true,
          () => false,
        )),
  );
  handle(
    "capture:native:start",
    async (sourceId: unknown, inputFps: unknown, audio: unknown) => {
      if (process.platform !== "win32")
        throw new Error("该原生录制引擎仅支持 Windows");
      if (nativeRecording || recordings.size)
        throw new Error("已有录制正在运行");
      const id = z.string().parse(sourceId),
        fps = z.number().int().min(15).max(120).parse(inputFps);
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
      });
      const source = sources.find((s) => s.id === id);
      if (!source) throw new Error("录制来源已经关闭，请重新选择");
      const display =
        screen
          .getAllDisplays()
          .find((d) => String(d.id) === source.display_id) ??
        screen.getPrimaryDisplay();
      const bounds = screen.dipToScreenRect(null, display.bounds);
      const recording = new NativeRecording();
      nativeRecording = recording;
      try {
        await recordingBorder.start(
          id, bounds, process.resourcesPath, requestRecordingStop,
        );
        await recording.start(
          {
            sourceId: id,
            sourceType: id.startsWith("window:") ? "window" : "display",
            displayId: display.id,
            displayX: bounds.x,
            displayY: bounds.y,
            displayW: bounds.width,
            displayH: bounds.height,
            hasDisplayBounds: true,
            fps,
            captureSystemAudio: z.boolean().parse(audio),
          },
          path.join(app.getPath("userData"), "recordings"),
          process.resourcesPath,
          bounds,
          () => {
            void recordingBorder.stop();
            requestRecordingStop();
          },
        );
      } catch (error) {
        await recordingBorder.stop();
        recording.abort();
        nativeRecording = null;
        throw error;
      }
    },
  );
  handle("capture:native:pause", (paused: unknown) =>
    nativeRecording?.pause(z.boolean().parse(paused)),
  );
  handle("capture:native:stop", async () => {
    await recordingBorder.stop();
    if (!nativeRecording) throw new Error("原生录制未启动");
    const recording = nativeRecording;
    try {
      return register(await recording.stop(process.resourcesPath));
    } finally {
      nativeRecording = null;
    }
  });
  handle("project:initial", async () => {
    if (!pendingProject) return null;
    const file = pendingProject;
    pendingProject = null;
    const project = registerProject(await openProject(file));
    projectFile = file;
    await rememberProject(project, file);
    return { project, file };
  });
  handle("project:dirty", (dirty: unknown) => {
    projectDirty = z.boolean().parse(dirty);
  });
  handle("audio:preview", async (input: unknown, inputId: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const project = authorizedProject(input),
      clipId = z.string().parse(inputId);
    const clip = project.clips.find((c) => c.id === clipId);
    if (!clip?.assetId) throw new Error("请选中有声音的媒体片段");
    const asset = assetById(clip.assetId);
    if (!asset.hasAudio) throw new Error("该素材没有音频");
    const folder = path.join(app.getPath("userData"), "audio-preview");
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, `${uid()}.wav`);
    task = new AbortController();
    try {
      const info = await capabilities(process.resourcesPath);
      notify(0, "正在处理试听音频（最多 15 秒）");
      await runProcess(
        findBinary("ffmpeg", process.resourcesPath),
        [
          "-y",
          "-ss",
          String(clip.sourceIn),
          "-t",
          String(Math.min(15, clip.duration) * clip.speed),
          "-i",
          asset.path,
          "-vn",
          "-af",
          [...audioFilters(clip, info.rubberband), "alimiter=limit=0.95"].join(
            ",",
          ),
          "-ar",
          "48000",
          "-c:a",
          "pcm_s16le",
          file,
        ],
        { signal: task.signal },
      );
      const preview = register(await probeMedia(file, process.resourcesPath));
      return `framecraft-media://asset/${preview.id}`;
    } finally {
      task = null;
    }
  });
  handle("project:new", async () => {
    projectFile = null;
    await fs.rm(path.join(app.getPath("userData"), "recovery.json"), {
      force: true,
    });
  });
  handle("project:recovery:write", async (input: unknown) => {
    const project = authorizedProject(input);
    const file = path.join(app.getPath("userData"), "recovery.json");
    await fs.writeFile(
      `${file}.tmp`,
      JSON.stringify({ project, file: projectFile }),
    );
    await fs.rename(`${file}.tmp`, file);
  });
  handle("project:recovery:read", async () => {
    try {
      const result = JSON.parse(
        await fs.readFile(
          path.join(app.getPath("userData"), "recovery.json"),
          "utf8",
        ),
      );
      const project = validateProject(result.project);
      for (const asset of project.assets)
        asset.missing = !(await fs.access(asset.path).then(
          () => true,
          () => false,
        ));
      projectFile = typeof result.file === "string" ? result.file : null;
      return { project: registerProject(project), file: projectFile };
    } catch {
      return null;
    }
  });
  handle("project:recovery:info", async () => {
    try {
      const file = path.join(app.getPath("userData"), "recovery.json");
      const result = JSON.parse(await fs.readFile(file, "utf8"));
      const project = validateProject(result.project);
      return { name: project.name, file: typeof result.file === "string" ? result.file : null,
        modifiedAt: (await fs.stat(file)).mtimeMs, duration: projectDuration(project) };
    } catch { return null; }
  });
  handle("project:recent", async () => {
    const entries = await recentProjects.list();
    if (entries.length) return entries;
    // Older versions only kept the last project's path in recovery. Import that
    // existing saved project into history without selecting or restoring it.
    try {
      const recovery = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "recovery.json"), "utf8"));
      if (typeof recovery.file === "string") await rememberProject(await openProject(recovery.file), recovery.file);
    } catch { /* No saved project to migrate. */ }
    return recentProjects.list();
  });
  handle("project:recent:open", async (input: unknown) => {
    const file = z.string().min(1).max(32768).parse(input);
    if (!(await recentProjects.list()).some((entry) => entry.file === file)) throw new Error("项目不在最近项目列表中，请使用打开项目");
    const project = registerProject(await openProject(file));
    projectFile = file;
    await rememberProject(project, file);
    return { project, file };
  });
  handle("media:import", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "导入素材",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "媒体",
          extensions: [
            "mp4",
            "mov",
            "mkv",
            "webm",
            "avi",
            "m4v",
            "wav",
            "mp3",
            "m4a",
            "flac",
            "ogg",
            "png",
            "jpg",
            "jpeg",
            "webp",
            "gif",
          ],
        },
      ],
    });
    if (result.canceled) return [];
    const imported: Asset[] = [];
    for (const file of result.filePaths)
      imported.push(register(await probeMedia(file, process.resourcesPath)));
    return imported;
  });
  handle("media:url", (id: unknown) => {
    const asset = assetById(id);
    return `framecraft-media://asset/${encodeURIComponent(asset.id)}`;
  });
  handle("media:thumbnail", (id: unknown, waveform: unknown) =>
    mediaThumbnail(
      assetById(id),
      z.boolean().parse(waveform),
      path.join(app.getPath("userData"), "thumbnails"),
      process.resourcesPath,
    ),
  );
  handle("media:relink", async (id: unknown, requiredDuration: unknown) => {
    const original = assetById(id);
    const file = await chooseFile(`重新链接：${original.name}`, ["*"]);
    if (!file) return null;
    const replacement = await probeMedia(file, process.resourcesPath);
    if (replacement.kind !== original.kind)
      throw new Error("替换素材的类型必须与原素材一致");
    if (
      replacement.kind !== "image" &&
      replacement.duration + 0.05 <
        z.number().finite().nonnegative().parse(requiredDuration)
    )
      throw new Error("替换素材短于工程使用的源区间，请选择完整素材");
    return register({ ...replacement, id: original.id });
  });
  handle("project:open", async () => {
    const file = await chooseFile("打开 TronCut 工程", [
      "troncut",
      "framecraft",
      "json",
    ]);
    if (!file) return null;
    const project = registerProject(await openProject(file));
    projectFile = file;
    await rememberProject(project, file);
    return { project, file };
  });
  handle("project:save", async (input: unknown, saveAs: unknown) => {
    const project = authorizedProject(input);
    let file = projectFile;
    if (!file || saveAs === true) {
      const result = await dialog.showOpenDialog(window, {
        title: "选择工程存放位置（将自动新建工程文件夹并收集素材）",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      const folderName = project.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
      let root = path.join(result.filePaths[0], folderName);
      let suffix = 2;
      while (
        await fs.access(root).then(
          () => true,
          () => false,
        )
      )
        root = path.join(result.filePaths[0], `${folderName}-${suffix++}`);
      file = path.join(root, `${folderName}.troncut`);
    }
    const icon = app.isPackaged
      ? path.join(process.resourcesPath, "project.ico")
      : path.resolve("resources/icon.ico");
    const saved = registerProject(await saveProject(project, file, icon));
    projectFile = file;
    await rememberProject(saved, file);
    await fs.rm(path.join(app.getPath("userData"), "recovery.json"), {
      force: true,
    });
    return { project: saved, file };
  });
  handle("project:camtasia", async () => {
    const file = await chooseFile(
      "导入 Camtasia 工程（Mac 请选 cmproj 内的 project.tscproj）",
      ["tscproj"],
    );
    if (!file) return null;
    const project = importCamtasia(
      JSON.parse(await fs.readFile(file, "utf8")),
      file,
    );
    for (let i = 0; i < project.assets.length; i++) {
      const asset = project.assets[i];
      try {
        project.assets[i] = {
          ...(await probeMedia(asset.path, process.resourcesPath)),
          id: asset.id,
        };
      } catch (err) {
        asset.missing = true;
        project.importReport!.push(
          `素材离线或无法解码：${asset.name}；${String(err).slice(0, 160)}`,
        );
      }
    }
    projectFile = null;
    return registerProject(validateProject(project));
  });
  handle("subtitles:import", async () => {
    const file = await chooseFile("导入字幕", ["srt", "vtt"]);
    if (!file) return null;
    const cues = parseSrt(await fs.readFile(file, "utf8"));
    if (!cues.length) throw new Error("字幕文件没有有效的时间码与正文");
    return cues;
  });
  handle("subtitles:export", async (input: unknown) => {
    const cues = z
      .array(
        z.object({
          start: z.number().finite().nonnegative(),
          end: z.number().finite().positive(),
          text: z.string().max(10000),
        }),
      )
      .max(100000)
      .parse(input);
    const result = await dialog.showSaveDialog(window, {
      title: "导出字幕",
      defaultPath: "字幕.srt",
      filters: [{ name: "SRT", extensions: ["srt"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, toSrt(cues), "utf8");
    return result.filePath;
  });
  handle("video:frame", async (input: unknown, at: unknown, endpoint: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const project = authorizedProject(input);
    const time = z.number().finite().nonnegative().parse(at);
    const endpointClipId = z.string().max(128).optional().parse(endpoint);
    const folder = path.join(app.getPath("userData"), "frames");
    await fs.mkdir(folder, { recursive: true });
    const target = path.join(folder, `frame-${uid()}.png`);
    const temp = await fs.mkdtemp(
      path.join(app.getPath("temp"), "troncut-frame-"),
    );
    const controller = new AbortController();
    task = controller;
    try {
      await exportFrame(
        project,
        time,
        target,
        temp,
        controller.signal,
        process.resourcesPath,
        endpointClipId,
      );
      const asset = await probeMedia(target, process.resourcesPath);
      asset.name = `当前帧 ${time.toFixed(2)}s.png`;
      return register(asset);
    } catch (error) {
      await fs.rm(target, { force: true });
      throw error;
    } finally {
      task = null;
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
  handle("video:export:directory", () =>
    projectFile ? path.dirname(projectFile) : app.getPath("videos"),
  );
  handle("video:export:choose-directory", async (input: unknown) => {
    const defaultPath = z.string().max(32768).parse(input);
    const result = await dialog.showOpenDialog(window, {
      title: "选择视频导出位置",
      defaultPath:
        defaultPath || (projectFile ? path.dirname(projectFile) : app.getPath("videos")),
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  handle("video:export", async (input: unknown, inputRequest: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const project = authorizedProject(input);
    const request = videoExportRequestSchema.parse(inputRequest);
    const target = videoExportTarget(request);
    task = new AbortController();
    let temp: string | undefined;
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await assertExportTarget(project, target, projectFile);
      try {
        const stat = await fs.stat(target);
        if (!stat.isFile())
          throw new Error("导出目标已被文件夹占用，请更换文件名");
        const result = await dialog.showMessageBox(window, {
          type: "question",
          title: "替换已有视频",
          message: "文件已存在，是否替换？",
          detail: target,
          buttons: ["取消", "替换"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (result.response !== 1) return null;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const info = await capabilities(process.resourcesPath);
      if (!info.ffmpeg)
        throw new Error("未找到 FFmpeg/FFprobe，请在设置中配置");
      temp = await fs.mkdtemp(
        path.join(app.getPath("temp"), "framecraft-export-"),
      );
      await exportVideo(
        { ...project, exportSettings: request.settings },
        target,
        temp,
        info.rubberband,
        task.signal,
        (p) => notify(p, "正在导出视频"),
        process.resourcesPath,
      );
      return target;
    } finally {
      task = null;
      if (temp) await fs.rm(temp, { recursive: true, force: true });
    }
  });
  handle("task:cancel", () => {
    task?.abort();
  });
  handle("audio:windows-voices", () => windowsSpeechVoices(app.isPackaged
    ? path.join(process.resourcesPath, "workers", "onnx")
    : path.resolve("workers/onnx")));
  handle("audio:voice-preview", async (input: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const options = ttsOptionsSchema.parse(input);
    task = new AbortController();
    try {
      return register(await speechVoicePreviews.create(options, {
        userData: app.getPath("userData"),
        workers: app.isPackaged
          ? path.join(process.resourcesPath, "workers", "onnx")
          : path.resolve("workers/onnx"),
        resources: process.resourcesPath,
      }, task.signal, notify));
    } finally {
      task = null;
    }
  });
  handle("audio:voice-preview:release", async (input: unknown) => {
    const asset = await speechVoicePreviews.release(z.string().max(128).parse(input));
    if (asset) {
      assets.delete(asset.id);
      approvedPaths.delete(path.resolve(asset.path));
    }
  });
  handle("audio:synthesize", async (input: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const options = ttsOptionsSchema.parse(input);
    task = new AbortController();
    try {
      return register(await synthesizeSpeech(options, {
        userData: app.getPath("userData"),
        workers: app.isPackaged
          ? path.join(process.resourcesPath, "workers", "onnx")
          : path.resolve("workers/onnx"),
        resources: process.resourcesPath,
      }, task.signal, notify));
    } finally {
      task = null;
    }
  });
  handle("audio:reference", async () => {
    const file = await chooseFile("选择克隆参考音频（3–30 秒）", ["wav", "mp3", "m4a", "flac", "ogg", "aac", "webm"]);
    if (!file) return null;
    const asset = await probeMedia(file, process.resourcesPath);
    validateVoiceReference(asset);
    temporaryReferences.add(asset.id);
    return register(asset);
  });
  handle("audio:reference:release", async (input: unknown) => {
    const id = z.string().uuid().parse(input);
    if (!temporaryReferences.has(id)) return;
    const asset = assets.get(id);
    if (!asset) return;
    const recordingsRoot = path.resolve(app.getPath("userData"), "recordings");
    if (path.dirname(path.resolve(asset.path)) === recordingsRoot && path.basename(asset.path).startsWith("voice-reference-"))
      await fs.rm(asset.path, { force: true });
    temporaryReferences.delete(id);
    assets.delete(id);
    if (![...assets.values()].some((item) => path.resolve(item.path) === path.resolve(asset.path)))
      approvedPaths.delete(path.resolve(asset.path));
  });
  handle("audio:reference:transcribe", async (input: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const asset = assetById(input);
    validateVoiceReference(asset);
    task = new AbortController();
    const temp = await fs.mkdtemp(path.join(app.getPath("temp"), "troncut-reference-"));
    try {
      const cues = await transcribeAsset(asset, "sensevoice", "auto", { device: "cpu" }, {
        userData: app.getPath("userData"),
        workers: app.isPackaged ? path.join(process.resourcesPath, "workers", "onnx") : path.resolve("workers/onnx"),
        resources: process.resourcesPath, temp,
      }, task.signal, notify);
      return cues.map((cue) => cue.text).join("");
    } finally { task = null; await fs.rm(temp, { recursive: true, force: true }); }
  });
  handle("audio:cloned-voices:list", () => clonedVoices.list());
  handle("audio:cloned-voices:delete", async (input: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    await clonedVoices.remove(z.string().uuid().parse(input));
  });
  handle("audio:cloned-voices:create", async (input: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const options = createClonedVoiceSchema.parse(input);
    const reference = assetById(options.referenceAssetId);
    task = new AbortController();
    try {
      return await clonedVoices.create(options, reference, {
        userData: app.getPath("userData"),
        workers: app.isPackaged ? path.join(process.resourcesPath, "workers", "onnx") : path.resolve("workers/onnx"),
        resources: process.resourcesPath,
      }, task.signal, notify);
    } finally { task = null; }
  });
  handle("app:capabilities", () => capabilities(process.resourcesPath));
  handle("speech:downloadModel", async (input: unknown) => {
    if (task) throw new Error("已有后台任务正在执行");
    const engine = onnxModelSchema.parse(input);
    task = new AbortController();
    const temp = await fs.mkdtemp(path.join(app.getPath("temp"), "troncut-model-"));
    try {
      return await downloadOnnxModel(engine, {
        userData: app.getPath("userData"),
        workers: app.isPackaged ? path.join(process.resourcesPath, "workers", "onnx") : path.resolve("workers/onnx"),
        resources: process.resourcesPath,
        temp,
      }, task.signal, notify);
    } finally {
      task = null;
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
  handle("app:selectBinary", async (value: unknown) => {
    const name = z.enum(["ffmpeg", "ffprobe", "videocaptioner"]).parse(value);
    const file = await chooseFile(
      `选择 ${name} 可执行文件`,
      process.platform === "win32" ? ["exe"] : ["*"],
    );
    if (file) {
      process.env[`FRAMECRAFT_${name.toUpperCase()}`] = file;
      await fs.writeFile(
        path.join(app.getPath("userData"), "engines.json"),
        JSON.stringify(
          Object.fromEntries(
            ["FFMPEG", "FFPROBE", "VIDEOCAPTIONER"].map((n) => [
              n,
              process.env[`FRAMECRAFT_${n}`] ?? "",
            ]),
          ),
          null,
          2,
        ),
      );
    }
  });
  handle(
    "subtitles:transcribe",
    async (
      inputProject: unknown,
      inputEngine: unknown,
      inputLanguage: unknown,
      inputOptions: unknown,
    ) => {
      if (task) throw new Error("已有后台任务正在执行");
      const project = authorizedProject(inputProject);
      const engine = speechEngineSchema.parse(inputEngine);
      const language = z
        .enum(["auto", "zh", "en", "ja", "ko", "yue"])
        .parse(inputLanguage);
      const options = speechOptionsSchema.parse(inputOptions ?? {});
      task = new AbortController();
      const temp = await fs.mkdtemp(
        path.join(app.getPath("temp"), "framecraft-asr-"),
      );
      try {
        const processing = options.processing ?? (await preferences.get()).captions;
        const cues = await transcribeProject(
          project,
          engine,
          language,
          { ...options, processing },
          {
            userData: app.getPath("userData"),
            workers: app.isPackaged
              ? path.join(process.resourcesPath, "workers", "onnx")
              : path.resolve("workers/onnx"),
            temp,
            resources: process.resourcesPath,
          },
          task.signal,
          (percent, label) => notify(percent * 0.8, label),
        );
        const result = await processCaptionCues(cues, processing, () => preferences.resolveAi(), task.signal,
          (percent, label) => notify(80 + percent * 0.2, label));
        notify(100, "字幕生成完成");
        return result;
      } finally {
        task = null;
        await fs.rm(temp, { recursive: true, force: true });
      }
    },
  );
  handle("capture:sources", async () =>
    (
      await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 300, height: 180 },
      })
    ).map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    })),
  );
  handle("capture:select", async (id: unknown, systemAudio: unknown) => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
    });
    const selected = z.string().parse(id);
    if (!sources.some((s) => s.id === selected))
      throw new Error("录屏目标已经关闭，请重新选择");
    captureSelection = {
      id: selected,
      systemAudio: z.boolean().parse(systemAudio),
    };
  });
  handle("recording:start", async (kind: unknown) => {
    const label = z.enum(["screen", "camera", "microphone", "voice-reference"]).parse(kind);
    const id = uid(),
      folder = path.join(app.getPath("userData"), "recordings");
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, `${label}-${id}.raw.webm`),
      handle = await fs.open(file, "wx");
    try {
      if (label === "screen" && process.platform === "win32") {
        if (!captureSelection) throw new Error("请先选择录屏目标");
        const selectedId = captureSelection.id;
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
        });
        const source = sources.find((s) => s.id === selectedId);
        if (!source) throw new Error("录屏目标已经关闭，请重新选择");
        const display = screen.getAllDisplays()
          .find((d) => String(d.id) === source.display_id) ?? screen.getPrimaryDisplay();
        await recordingBorder.start(
          source.id, screen.dipToScreenRect(null, display.bounds),
          process.resourcesPath, requestRecordingStop,
        );
      }
      recordings.set(id, { file, handle, bytes: 0, kind: label });
    } catch (error) {
      await recordingBorder.stop();
      await handle.close();
      await fs.rm(file, { force: true });
      throw error;
    }
    return id;
  });
  handle("recording:chunk", async (id: unknown, input: unknown) => {
    const rec = recordings.get(z.string().parse(id));
    if (
      !rec ||
      !(input instanceof Uint8Array) ||
      input.byteLength > 32 * 1024 * 1024
    )
      throw new Error("无效录屏数据块");
    const chunk = Buffer.from(input);
    let offset = 0;
    while (offset < chunk.byteLength) {
      const { bytesWritten } = await rec.handle.write(
        chunk,
        offset,
        chunk.length - offset,
        null,
      );
      offset += bytesWritten;
    }
    rec.bytes += chunk.byteLength;
  });
  handle("recording:stop", async (inputId: unknown, inputDuration: unknown) => {
    const id = z.string().parse(inputId),
      duration = z.number().finite().positive().parse(inputDuration),
      rec = recordings.get(id);
    if (!rec) throw new Error("录屏会话不存在");
    if (rec.kind === "screen") await recordingBorder.stop();
    recordings.delete(id);
    await rec.handle.close();
    if (!rec.bytes) throw new Error("录屏没有产生数据");
    const output = rec.file.replace(".raw.webm", ".webm");
    // Remux writes duration metadata without re-encoding and keeps the raw file on failure.
    await runProcess(findBinary("ffmpeg", process.resourcesPath), [
      "-y",
      "-i",
      rec.file,
      "-t",
      String(duration),
      "-c",
      "copy",
      output,
    ]);
    const asset = register(await probeMedia(output, process.resourcesPath));
    if (path.basename(rec.file).startsWith("voice-reference-")) temporaryReferences.add(asset.id);
    await fs.rm(rec.file, { force: true });
    return asset;
  });
  handle("recording:abort", async (inputId: unknown) => {
    const id = z.string().parse(inputId),
      rec = recordings.get(id);
    if (rec) {
      if (rec.kind === "screen") await recordingBorder.stop();
      recordings.delete(id);
      await rec.handle.close();
      await fs.rm(rec.file, { force: true });
    }
  });
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#151719",
    title: "TronCut",
    frame: false,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "project.ico")
      : path.resolve("resources/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const notifyWindowState = () => window.webContents.send("window:state", windowState());
  window.on("maximize", notifyWindowState);
  window.on("unmaximize", notifyWindowState);
  window.on("enter-full-screen", notifyWindowState);
  window.on("leave-full-screen", notifyWindowState);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("render-process-gone", () => {
    void recordingBorder.stop();
    nativeRecording?.abort();
  });
  window.webContents.on("will-navigate", (event, url) => {
    const current = window.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
  window.on("close", (event) => {
    if (
      process.env.FRAMECRAFT_SMOKE ||
      (!projectDirty && !recordings.size && !nativeRecording && !task)
    )
      return;
    const choice = dialog.showMessageBoxSync(window, {
      type: "question",
      buttons: ["取消", "退出"],
      defaultId: 0,
      cancelId: 0,
      title: "退出 TronCut",
      message:
        recordings.size || nativeRecording
          ? "录制尚未结束，退出会保留未完成录制文件。"
          : "请先保存工程。确定退出 TronCut？",
    });
    if (choice === 0) event.preventDefault();
  });
  const shortcut = (command: string) =>
    window.webContents.send("shortcut", command);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: "TronCut",
              submenu: [{ role: "about" as const }, { role: "quit" as const }],
            },
          ]
        : []),
      {
        label: "文件",
        submenu: [
          {
            label: "新建工程",
            accelerator: "CmdOrCtrl+N",
            click: () => shortcut("new"),
          },
          {
            label: "打开工程",
            accelerator: "CmdOrCtrl+O",
            click: () => shortcut("open"),
          },
          {
            label: "保存工程",
            accelerator: "CmdOrCtrl+S",
            click: () => shortcut("save"),
          },
          {
            label: "另存为",
            accelerator: "CmdOrCtrl+Shift+S",
            click: () => shortcut("saveAs"),
          },
          { type: "separator" },
          {
            label: "导入素材",
            accelerator: "CmdOrCtrl+I",
            click: () => shortcut("import"),
          },
          { label: "导入 Camtasia 工程", click: () => shortcut("camtasia") },
          {
            label: "导出视频",
            accelerator: "CmdOrCtrl+E",
            click: () => shortcut("export"),
          },
        ],
      },
      {
        label: "编辑",
        submenu: editCommands.flatMap((command, index) => [
          ...(index && editCommands[index - 1].group !== command.group ? [{ type: "separator" as const }] : []),
          { id: `edit-${command.id}`, label: command.label,
            // Single-key timeline shortcuts must not intercept typing into text fields.
            accelerator: command.shortcut,
            registerAccelerator: command.shortcut.includes("CmdOrCtrl"),
            click: () => shortcut(command.id),
          },
        ]),
      },
      {
        label: "视图",
        submenu: [{ role: "togglefullscreen" }, { role: "toggleDevTools" }],
      },
    ]),
  );
  window.setMenuBarVisibility(false);
  const devUrl = process.env.FRAMECRAFT_DEV_URL;
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, "../dist/index.html"));
}
app
  .whenReady()
  .then(async () => {
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    try {
      const config = JSON.parse(
        await fs.readFile(
          path.join(app.getPath("userData"), "engines.json"),
          "utf8",
        ),
      );
      for (const name of ["FFMPEG", "FFPROBE", "VIDEOCAPTIONER"])
        if (typeof config[name] === "string" && config[name])
          process.env[`FRAMECRAFT_${name}`] = config[name];
    } catch {
      /* First launch uses bundled engines or PATH. */
    }
    if (cliMode) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      const code = await runCli(process.argv.slice(cliIndex + 1), {
        userData: app.getPath("userData"),
        resources: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../resources"),
        workers: app.isPackaged ? path.join(process.resourcesPath, "workers/onnx") : path.resolve(__dirname, "../workers/onnx"),
        version: app.getVersion(), signal: controller.signal,
      });
      await closeOnnxSessions();
      app.exit(code);
      return;
    }
    protocol.handle("framecraft-media", (request) => {
      const id = decodeURIComponent(new URL(request.url).pathname.slice(1)),
        asset = assets.get(id);
      if (!asset) return new Response("素材不存在", { status: 404 });
      return serveMediaFile(request, asset.path);
    });
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback) =>
        callback(
          contents === window?.webContents &&
            ["media", "display-capture", "fullscreen"].includes(permission),
        ),
    );
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({
            types: ["screen", "window"],
          });
          const source = sources.find((s) => s.id === captureSelection?.id);
          if (!source) {
            callback({});
            return;
          }
          callback({
            video: source,
            ...(captureSelection?.systemAudio
              ? { audio: "loopback" as const }
              : {}),
          });
        } catch {
          callback({});
        }
      },
    );
    installHandlers();
    await createWindow();
    globalShortcut.register("CommandOrControl+Shift+F9", () =>
      window.webContents.send("shortcut", "stopRecording"),
    );
  })
  .catch((error) => {
    if (cliMode) {
      process.stdout.write(JSON.stringify({ ok: false, error: { code: "STARTUP_ERROR", message: String(error) } }) + "\n");
      app.exit(1);
      return;
    }
    dialog.showErrorBox("TronCut 启动失败", String(error));
    app.quit();
  });
app.on("window-all-closed", () => {
  void recordingBorder.stop();
  task?.abort();
  nativeRecording?.abort();
  globalShortcut.unregisterAll();
  app.quit();
});
let closingOnnx = false;
app.on("will-quit", (event) => {
  void recordingBorder.stop();
  if (closingOnnx) return;
  event.preventDefault();
  closingOnnx = true;
  task?.abort();
  // Windows are already closed at will-quit; exit after the worker handles close.
  void closeOnnxSessions().finally(() => app.exit(0));
});
