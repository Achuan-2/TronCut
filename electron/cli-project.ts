import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { type CliPlan, type Edit, type NarrationScript } from "../shared/cli";
import {
  type Project,
  type Clip,
  createProject,
  defaultTransform,
  uid,
  newText,
  newTrack,
  validateProject,
  projectDuration,
} from "../shared/model";
import { type Cue } from "../shared/subtitles";
import { captionDefaults } from "../shared/captions";
import { isTrackActive } from "../shared/tracks";
import {
  captionProcessingSchema,
  segmentCaptionCues,
} from "../shared/caption-processing";
import { setClipSpeed, supportsClipSpeed } from "../shared/clip-speed";
import { deleteClips } from "../shared/timeline";
import { probeMedia } from "./media";
import { openProject } from "./project-store";
import { transcribeProject } from "./transcription";
import { synthesizeSpeech } from "./synthesis";

export interface CliContext {
  resources: string;
  workers: string;
  userData: string;
  version: string;
  signal: AbortSignal;
  progress: (percent: number, label: string) => void;
}

function mediaClip(
  asset: Project["assets"][number],
  trackId: string,
  start: number,
  sourceIn: number,
  duration: number,
  speed = 1,
  volume = 1,
): Clip {
  return {
    id: uid(),
    assetId: asset.id,
    trackId,
    kind: asset.kind,
    name: asset.name,
    start,
    sourceIn,
    duration,
    speed,
    volume,
    podcast: false,
    transform: { ...defaultTransform },
    keyframes: [],
  };
}

export function validateSourceRanges(project: Project) {
  for (const clip of project.clips) {
    const asset = project.assets.find((asset) => asset.id === clip.assetId);
    if (
      asset &&
      ["video", "audio"].includes(clip.kind) &&
      clip.sourceIn + clip.duration * clip.speed > asset.duration + 0.05
    )
      throw new Error(`片段 ${clip.id} 超出了源素材时长`);
    if (asset?.missing) throw new Error(`素材离线：${asset.path}`);
  }
  return validateProject(project);
}

export async function buildCliProject(
  plan: CliPlan,
  base: string,
  context: CliContext,
) {
  let project = plan.project
    ? await openProject(path.resolve(base, plan.project))
    : createProject(plan.name);
  if (plan.cuts) {
    let cursor = 0;
    const known = new Map<string, Project["assets"][number]>();
    for (const cut of plan.cuts) {
      const file = path.resolve(base, cut.input);
      let asset = known.get(file);
      if (!asset) {
        asset = await probeMedia(file, context.resources);
        known.set(file, asset);
        project.assets.push(asset);
      }
      if (project.clips.length === 0 && asset.kind === "video")
        project.canvas = {
          ...project.canvas,
          width: Math.max(16, Math.round(asset.width / 2) * 2),
          height: Math.max(16, Math.round(asset.height / 2) * 2),
        };
      const end = cut.sourceOut ?? asset.duration;
      if (
        end <= cut.sourceIn ||
        (asset.kind !== "image" && end > asset.duration + 0.05)
      )
        throw new Error(`裁剪区间无效：${file}`);
      const start = cut.start ?? cursor;
      const clip = mediaClip(
        asset,
        asset.kind === "audio" ? "audio" : "video",
        start,
        cut.sourceIn,
        (end - cut.sourceIn) / cut.speed,
        cut.speed,
        cut.volume,
      );
      if (
        project.clips.some(
          (other) =>
            other.trackId === clip.trackId &&
            other.start < start + clip.duration &&
            other.start + other.duration > start,
        )
      )
        throw new Error("同一源素材轨道的剪辑区间不能重叠");
      project.clips.push(clip);
      cursor = Math.max(cursor, start + clip.duration);
    }
  }
  project.canvas = { ...project.canvas, ...plan.canvas };
  return editCliProject(project, plan.edits);
}

export function editCliProject(input: Project, edits: Edit[]) {
  let project = structuredClone(input);
  for (const edit of edits) {
    if (edit.type === "text") {
      if (edit.end <= edit.start)
        throw new Error("文本结束时间必须大于开始时间");
      const track = newTrack(project.tracks.length);
      project.tracks.unshift(track);
      const clip = newText(track.id, edit.start, 0, edit.text);
      clip.duration = edit.end - edit.start;
      clip.transform = { ...clip.transform, ...edit.transform };
      clip.style = { ...clip.style!, ...edit.style };
      project.clips.push(clip);
      continue;
    }
    const ids = edit.type === "remove" ? edit.clipIds : [edit.clipId];
    for (const id of ids) {
      const clip = project.clips.find((clip) => clip.id === id);
      if (!clip) throw new Error(`片段不存在：${id}`);
      if (project.tracks.find((track) => track.id === clip.trackId)?.locked)
        throw new Error(`片段所在轨道已锁定：${id}`);
    }
    if (edit.type === "remove") {
      project = deleteClips(project, ids, edit.ripple);
      continue;
    }
    project.clips = project.clips.map((clip) => {
      if (clip.id !== edit.clipId) return clip;
      if (edit.type === "move") return { ...clip, start: edit.start };
      if (edit.type === "volume") return { ...clip, volume: edit.volume };
      if (!supportsClipSpeed(clip))
        throw new Error("裁剪与变速只适用于音视频片段");
      if (edit.type === "speed") return setClipSpeed(clip, edit.speed);
      if (edit.sourceOut <= edit.sourceIn)
        throw new Error("裁剪结束时间必须大于开始时间");
      return {
        ...clip,
        sourceIn: edit.sourceIn,
        duration: (edit.sourceOut - edit.sourceIn) / clip.speed,
        animationOffset:
          (clip.animationOffset ?? 0) +
          (edit.sourceIn - clip.sourceIn) / clip.speed,
      };
    });
  }
  return validateSourceRanges(project);
}

export function sourceCuesToTimeline(cues: Cue[], clip: Clip): Cue[] {
  const sourceEnd = clip.sourceIn + clip.duration * clip.speed;
  return cues.flatMap((cue) => {
    const start = Math.max(cue.start, clip.sourceIn),
      end = Math.min(cue.end, sourceEnd);
    return end > start
      ? [
          {
            start: clip.start + (start - clip.sourceIn) / clip.speed,
            end: clip.start + (end - clip.sourceIn) / clip.speed,
            text: cue.text,
          },
        ]
      : [];
  });
}

export function addCaptionCues(
  input: Project,
  cues: Cue[],
  style: { y: number; fontSize?: number } = { y: captionDefaults.y },
) {
  if (!cues.length) return input;
  const project = structuredClone(input),
    track = newTrack(project.tracks.length);
  track.captionTrack = true;
  project.tracks.unshift(track);
  for (const cue of cues) {
    const clip = newText(track.id, cue.start, 0, cue.text);
    clip.caption = true;
    clip.duration = cue.end - cue.start;
    clip.transform.y = style.y;
    clip.style!.fontSize = style.fontSize ?? captionDefaults.fontSize;
    clip.style!.outlineWidth = captionDefaults.outlineWidth;
    clip.style!.fillEnabled = captionDefaults.fillEnabled;
    project.clips.push(clip);
  }
  return validateProject(project);
}

export async function transcribeCliProject(
  project: Project,
  options: NonNullable<Exclude<CliPlan["transcribe"], false>>,
  context: CliContext,
  style: CliPlan["captions"],
) {
  if (
    options.clipIds?.some((id) => !project.clips.some((clip) => clip.id === id))
  )
    throw new Error("指定转录片段不存在");
  const input = options.clipIds
    ? {
        ...project,
        clips: project.clips.filter((clip) =>
          options.clipIds!.includes(clip.id),
        ),
      }
    : project;
  const tempRoot = path.join(context.userData, "cli-temp");
  await fs.mkdir(tempRoot, { recursive: true });
  const temp = await fs.mkdtemp(path.join(tempRoot, "asr-"));
  try {
    const recognized = await transcribeProject(
      input,
      options.engine,
      options.language,
      options,
      { ...context, temp },
      context.signal,
      context.progress,
    );
    const cues = segmentCaptionCues(
      recognized,
      captionProcessingSchema.parse({}),
    );
    return { project: addCaptionCues(project, cues, style), cues };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      (!error.message.includes("转录没有产生有效字幕") &&
        !error.message.includes("时间线上没有可识别的声音"))
    )
      throw error;
    return { project, cues: [] };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

export async function narrateCliProject(
  input: Project,
  script: NarrationScript,
  context: CliContext,
  style: CliPlan["captions"],
) {
  const duration = projectDuration(input);
  if (script.segments.some((segment) => segment.end > duration + 0.05))
    throw new Error("文案段超出了画面时长，请先调整脚本时间或延长画面");
  let project = structuredClone(input);
  if (script.muteOriginal)
    project.clips = project.clips.map((clip) =>
      ["video", "audio"].includes(clip.kind) ? { ...clip, volume: 0 } : clip,
    );
  const track = newTrack(project.tracks.length);
  project.tracks.unshift(track);
  const cues: Cue[] = [];
  for (const segment of script.segments) {
    const asset = await synthesizeSpeech(
      {
        text: segment.text,
        engine: script.engine,
        voice: script.voice,
        speed: script.speed,
        modelDir: script.modelDir,
        offline: script.offline,
        captionChars: script.captionChars,
        device: "cpu",
      },
      context,
      context.signal,
      context.progress,
    );
    const slot = segment.end - segment.start;
    const fitSpeed = Math.max(1, asset.duration / slot);
    if (fitSpeed > script.maxFitSpeed)
      throw new Error(
        `文案过长：${segment.start}–${segment.end} 秒区间需要 ${fitSpeed.toFixed(2)} 倍语速，请缩短文稿或延长画面`,
      );
    const clip = mediaClip(
      asset,
      track.id,
      segment.start,
      0,
      Math.min(slot, asset.duration / fitSpeed),
      fitSpeed,
    );
    project.assets.push(asset);
    project.clips.push(clip);
    const metadata = JSON.parse(
      await fs.readFile(
        path.join(path.dirname(asset.path), "narration.json"),
        "utf8",
      ),
    );
    const chunks = z
      .array(
        z.object({
          start: z.number().finite().nonnegative(),
          end: z.number().finite().positive(),
          text: z.string().min(1),
        }),
      )
      .min(1)
      .parse(metadata.runtime?.segments);
    for (const chunk of chunks) {
      const start = segment.start + chunk.start / script.speed / fitSpeed;
      const end = Math.min(
        segment.start + clip.duration,
        segment.start + chunk.end / script.speed / fitSpeed,
      );
      if (end > start) cues.push({ start, end, text: chunk.text });
    }
  }
  project = addCaptionCues(project, cues, style);
  return { project: validateSourceRanges(project), cues };
}

export async function addCliMusic(
  input: Project,
  entries: CliPlan["music"],
  base: string,
  context: CliContext,
) {
  const project = structuredClone(input),
    duration = projectDuration(project);
  for (const entry of entries) {
    const asset = await probeMedia(
      path.resolve(base, entry.input),
      context.resources,
    );
    if (!asset.hasAudio) throw new Error("背景音乐文件没有音频");
    const length =
      entry.duration ??
      Math.min(asset.duration - entry.sourceIn, duration - entry.start);
    if (length <= 0) throw new Error("背景音乐区间无效");
    const track = newTrack(project.tracks.length);
    project.tracks.unshift(track);
    project.assets.push(asset);
    project.clips.push(
      mediaClip(
        asset,
        track.id,
        entry.start,
        entry.sourceIn,
        length,
        1,
        entry.volume,
      ),
    );
  }
  return validateSourceRanges(project);
}

export function projectCues(project: Project): Cue[] {
  const visible = new Set(
    project.tracks
      .filter((track) => isTrackActive(project.tracks, track.id))
      .map((track) => track.id),
  );
  return project.clips
    .filter((clip) => clip.caption && visible.has(clip.trackId))
    .map((clip) => ({
      start: clip.start,
      end: clip.start + clip.duration,
      text: clip.text ?? "",
    }));
}
