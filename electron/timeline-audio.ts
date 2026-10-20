import fs from "node:fs/promises";
import path from "node:path";
import { type Project, projectDuration } from "../shared/model";
import { audioFilters } from "./export";
import { findBinary, runProcess } from "./process";
import { isTrackActive } from "../shared/tracks";
import { stitchInputFilters } from "./stitch-input";
import { normalizesClip } from "../shared/loudness";
import { prepareNormalizedAudio } from "./loudness";

/** Render the same audible tracks as video export, in project time for ASR. */
export async function renderTimelineAudio(
  project: Project,
  target: string,
  workDir: string,
  signal: AbortSignal,
  resources?: string,
) {
  const duration = projectDuration(project);
  const clips = project.clips.flatMap((clip) => {
    const track = project.tracks.find((item) => item.id === clip.trackId);
    const asset = project.assets.find((item) => item.id === clip.assetId);
    return track &&
      isTrackActive(project.tracks, track.id) &&
      !track.muted &&
      ["audio", "video"].includes(clip.kind) &&
      clip.volume > 0 &&
      !clip.audioDetached &&
      asset?.hasAudio
      ? [{ clip, asset }]
      : [];
  });
  if (duration <= 0 || !clips.length)
    throw new Error("时间线上没有可识别的声音，请添加音视频或取消轨道静音");
  await fs.mkdir(workDir, { recursive: true });
  const binary = findBinary("ffmpeg", resources);
  const filtersAvailable = await runProcess(
    binary,
    ["-hide_banner", "-filters"],
    { signal },
  );
  const rubberband = /\brubberband\b/.test(filtersAvailable);
  const args = [
    "-y",
    "-hide_banner",
    "-filter_complex_threads",
    "1",
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=48000:cl=stereo:d=${duration}`,
  ];
  const filters: string[] = [];
  const labels = ["[0:a]"];
  for (const [index, { clip, asset }] of clips.entries()) {
    const normalized = normalizesClip(project, clip)
      ? await prepareNormalizedAudio(asset, clip.podcast, resources, signal)
      : null;
    args.push("-i", normalized?.path ?? asset.path);
    const audioClip = normalized ? { ...clip, podcast: false } : clip;
    const label = `audio${index}`;
    const source = clip.stitch ? `stitchaudio${index}` : `${index + 1}:a`;
    if (clip.stitch)
      filters.push(...stitchInputFilters(clip, `${index + 1}:a`, source, true));
    filters.push(
      `[${source}]atrim=start=${clip.stitch ? 0 : clip.sourceIn}:duration=${clip.duration * clip.speed},` +
        `asetpts=PTS-STARTPTS,${audioFilters(audioClip, rubberband).join(",")},` +
        `atrim=duration=${clip.duration},adelay=${Math.round(clip.start * 1000)}:all=1[${label}]`,
    );
    labels.push(`[${label}]`);
  }
  filters.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0,` +
      `alimiter=limit=0.95,atrim=duration=${duration}[audio]`,
  );
  const graph = path.join(workDir, "timeline-audio.ffscript");
  await fs.writeFile(graph, filters.join(";\n"), "utf8");
  const version = await runProcess(binary, ["-version"], { signal });
  const major = Number(version.match(/ffmpeg version (?:n)?(\d+)\./)?.[1] ?? 7);
  args.push(
    major >= 7 ? "-/filter_complex" : "-filter_complex_script",
    graph,
    "-map",
    "[audio]",
    "-vn",
    "-t",
    String(duration),
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    target,
  );
  await runProcess(binary, args, { signal });
  return duration;
}
