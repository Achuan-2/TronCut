import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  type Clip,
  type Project,
  type Transform,
  projectDuration,
} from "../shared/model";
import { findBinary, runProcess } from "./process";
import { defaultCrop, fadeDurations, visualFilters } from "../shared/effects";
import { cursorFilters } from "./cursor-export";
import { loopImageInput } from "./loop-image";
import { easingExpression } from "../shared/easing";
import {
  contentFilters,
  axisRotationFilters,
  mediaFrameFilters,
  animatedViewportFilters,
} from "./visual-transform";
import {
  hasVisualAnimation,
  visualDefaults,
  visualKeys,
} from "../shared/visual-state";
import { frameSnapshot } from "../shared/frame-snapshot";
import { objectBehaviorExpressions } from "./behavior-export";
import { rasterizeBehaviorText } from "./behavior-text-export";
import { textFillRectangle } from "./text-fill";
import { outlinedText } from "./text-outline";
import { textFrameSize, textFillGeometry } from "../shared/text";
import { isTrackActive } from "../shared/tracks";
import {
  exportDimensions,
  exportQualities,
  resolvedExportSettings,
  videoFormatSchema,
  type ExportSettings,
} from "../shared/export-settings";
import {
  transitionRange,
  transitionOffsetExpression,
} from "../shared/transitions";

// Avoid lookahead buffering in short, delayed overlay graphs. Hardware failure
// fallback and explicitly requested software encoding use identical settings.
function softwareEncoder(settings: Required<ExportSettings>) {
  const quality = exportQualities[settings.quality];
  if (settings.format === "webm")
    return [
      "-c:v",
      "libvpx-vp9",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
      "-row-mt",
      "1",
      "-lag-in-frames",
      "0",
      "-crf",
      String(quality.vp9),
      "-b:v",
      "0",
    ];
  return [
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    String(quality.h264),
    "-tune",
    "zerolatency",
  ];
}

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function expression(
  clip: Pick<
    Clip,
    "transform" | "keyframes" | "start" | "animationOffset" | "rotation"
  > &
    Partial<
      Pick<Clip, "crop" | "contentTransform" | "behaviors" | "kind" | "text">
    >,
  key: keyof Transform,
  clock = "t",
): string {
  const base = baseExpression(clip, key, clock);
  if (
    !clip.behaviors?.some((behavior) => behavior.enabled) ||
    !["x", "y", "scale", "opacity", "rotation"].includes(key)
  )
    return base;
  const motion = objectBehaviorExpressions(
    { ...clip, kind: clip.kind ?? "image" },
    clock,
  );
  if (key === "x" || key === "y") return `(${base}+0.08*(${motion[key]}))`;
  if (key === "scale" || key === "opacity") return `(${base}*(${motion[key]}))`;
  return `(${base}+(${motion.rotation}))`;
}
function baseExpression(
  clip: Pick<
    Clip,
    "transform" | "keyframes" | "start" | "animationOffset" | "rotation"
  > &
    Partial<Pick<Clip, "crop" | "contentTransform">>,
  key: keyof Transform,
  clock: string,
): string {
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  const baseValue =
    clip.transform[key] ??
    (key === "rotation"
      ? (clip.rotation ?? 0)
      : visualKeys.includes(key as (typeof visualKeys)[number])
        ? visualDefaults(clip)[key as (typeof visualKeys)[number]]
        : 0);
  const frameValue = (value: Transform) => value[key] ?? baseValue;
  if (!frames.length) return String(baseValue);
  if (frames[0].time > 0) frames.unshift({ time: 0, value: clip.transform });
  if (
    frames.every(
      (frame) => frameValue(frame.value) === frameValue(frames[0].value),
    )
  )
    return String(frameValue(frames[0].value));
  const origin = clip.start - (clip.animationOffset ?? 0);
  let result = String(frameValue(frames.at(-1)!.value));
  for (let i = frames.length - 1; i > 0; i--) {
    const a = frames[i - 1],
      b = frames[i],
      p = `clip((${clock}-${origin + a.time})/${Math.max(0.00001, b.time - a.time)},0,1)`;
    const ease = easingExpression(p, b.easing);
    result = `if(lt(${clock},${origin + b.time}),${frameValue(a.value)}+(${frameValue(b.value) - frameValue(a.value)})*${ease},${result})`;
  }
  const value = `if(lt(${clock},${origin + frames[0].time}),${frameValue(frames[0].value)},${result})`;
  return key === "opacity"
    ? `clip(${value},0,1)`
    : key === "scale" || key === "contentScale"
      ? `max(0.05,${value})`
      : value;
}
export function audioFilters(clip: Clip, rubberband: boolean): string[] {
  const filters: string[] = [];
  if (clip.speed !== 1) {
    if (rubberband) filters.push(`rubberband=tempo=${clip.speed}:pitch=1`);
    else {
      let tempo = clip.speed;
      while (tempo > 2) {
        filters.push("atempo=2");
        tempo /= 2;
      }
      while (tempo < 0.5) {
        filters.push("atempo=0.5");
        tempo /= 0.5;
      }
      filters.push(`atempo=${tempo}`);
    }
  }
  if (clip.podcast)
    filters.push(
      "highpass=f=80",
      "afftdn=nf=-25",
      "equalizer=f=3000:t=q:w=1:g=2",
      "acompressor=threshold=0.125:ratio=3:attack=5:release=100",
      "loudnorm=I=-16:TP=-1.5:LRA=7",
    );
  filters.push(`volume=${clip.volume}`, "aresample=48000");
  const { incoming, outgoing } = fadeDurations(clip);
  if (incoming) filters.push(`afade=t=in:st=0:d=${incoming}`);
  if (outgoing)
    filters.push(`afade=t=out:st=${clip.duration - outgoing}:d=${outgoing}`);
  return filters;
}
async function chooseEncoder(
  project: Project,
  settings: Required<ExportSettings>,
  resourcesPath: string | undefined,
  signal: AbortSignal,
): Promise<string[]> {
  const software = softwareEncoder(settings);
  if (settings.encoder === "software" || settings.format === "webm")
    return software;
  const quality = exportQualities[settings.quality];
  const qp = String(quality.h264);
  const output = exportDimensions(project.canvas, settings.resolution);
  const pixelRate = output.width * output.height * project.canvas.fps;
  const bitrate = `${Math.max(500, Math.round(quality.mbps * 1000 * pixelRate / (1920 * 1080 * 30)))}k`;
  const candidates =
    process.platform === "darwin"
      ? [["-c:v", "h264_videotoolbox", "-b:v", bitrate]]
      : process.platform === "win32"
        ? [
            ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", qp, "-b:v", "0"],
            ["-c:v", "h264_qsv", "-preset", "fast", "-global_quality", qp],
            [
              "-c:v",
              "h264_amf",
              "-quality",
              "balanced",
              "-qp_i",
              qp,
              "-qp_p",
              String(quality.h264 + 2),
            ],
          ]
        : [];
  // Listing an encoder is insufficient: driver/runtime initialization can still fail.
  for (const candidate of candidates) {
    if (signal.aborted) throw new Error("任务已取消");
    try {
      await runProcess(
        findBinary("ffmpeg", resourcesPath),
        [
          "-hide_banner",
          "-f",
          "lavfi",
          "-i",
          "color=s=320x180:r=30:d=0.1",
          ...candidate,
          "-pix_fmt",
          "yuv420p",
          "-f",
          "null",
          "-",
        ],
        { signal, timeout: 6000 },
      );
      return candidate;
    } catch {
      /* Try the next supported GPU; software is always available. */
    }
  }
  return software;
}
async function rasterize(
  clip: Clip,
  target: string,
): Promise<{ width: number; height: number; input?: string }> {
  if (clip.kind === "shape") {
    const body =
      clip.shape === "ellipse"
        ? '<ellipse cx="300" cy="150" rx="296" ry="146"/>'
        : clip.shape === "arrow"
          ? '<path d="M0 110H420V20L600 150L420 280V190H0Z"/>'
          : '<rect x="4" y="4" width="592" height="292" rx="24"/>';
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><g fill="${clip.fill ?? "#71e6b5"}">${body}</g></svg>`,
      ),
    )
      .png()
      .toFile(target);
    return { width: 600, height: 300 };
  }
  const style = clip.style!,
    lines = (clip.text ?? "").split("\n"),
    margin = style.outlineWidth * 2 + 12;
  // Pango measures actual glyphs, so Chinese text does not get clipped by a character-count estimate.
  const text = await sharp({
    text: {
      text: xml(clip.text ?? "") || " ",
      font: `${style.fontFamily} Bold ${style.fontSize}`,
      rgba: true,
      spacing: 0,
      align: "centre",
      dpi: 72,
    },
  })
    .png()
    .toBuffer();
  const info = await sharp(text).metadata();
  const box = textFrameSize(clip, info.width ?? 16);
  const background = textFillGeometry(style, box);
  const width = Math.ceil(
      Math.max(16, (info.width ?? 16) + margin * 2, background.width),
    ),
    height = Math.ceil(
      Math.max(
        16,
        (info.height ?? style.fontSize * lines.length) + margin * 2,
        background.height,
      ),
    );
  const layers: sharp.OverlayOptions[] = [];
  const fill = textFillRectangle(clip, box, { width, height });
  if (fill)
    layers.push({
      input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${fill}</svg>`,
      ),
      left: 0,
      top: 0,
    });
  const textLeft = Math.floor((width - info.width!) / 2),
    textTop = Math.floor((height - info.height!) / 2);
  const padding = Math.ceil(style.outlineWidth) + 2;
  layers.push({
    input: await outlinedText(
      text,
      style.color,
      style.outline,
      style.outlineWidth,
      padding,
    ),
    left: textLeft - padding,
    top: textTop - padding,
  });
  await sharp({
    create: { width, height, channels: 4, background: "#00000000" },
  })
    .composite(layers)
    .png()
    .toFile(target);
  return { width, height };
}
export async function exportVideo(
  project: Project,
  target: string,
  workDir: string,
  rubberband: boolean,
  signal: AbortSignal,
  progress: (percent: number) => void,
  resourcesPath?: string,
): Promise<void> {
  return renderProject(
    project,
    target,
    workDir,
    rubberband,
    signal,
    progress,
    resourcesPath,
  );
}

/** Render a single composition frame without encoding a temporary video. */
export async function exportFrame(
  project: Project,
  time: number,
  target: string,
  workDir: string,
  signal: AbortSignal,
  resourcesPath?: string,
  endpointClipId?: string,
): Promise<void> {
  return renderProject(
    frameSnapshot(project, time, endpointClipId),
    target,
    workDir,
    false,
    signal,
    () => {},
    resourcesPath,
    true,
  );
}

async function renderProject(
  project: Project,
  target: string,
  workDir: string,
  rubberband: boolean,
  signal: AbortSignal,
  progress: (percent: number) => void,
  resourcesPath?: string,
  still = false,
): Promise<void> {
  const duration = still ? 1 / project.canvas.fps : projectDuration(project);
  if (duration <= 0) throw new Error("时间线为空");
  const settings = resolvedExportSettings(project.exportSettings);
  const extension = videoFormatSchema.safeParse(
    path.extname(target).slice(1).toLowerCase(),
  );
  // The target extension is authoritative for CLI callers as well as the dialog.
  if (extension.success) settings.format = extension.data;
  await fs.mkdir(workDir, { recursive: true });
  const partial = path.join(
    path.dirname(target),
    `.framecraft-${Date.now()}.partial.${still ? "png" : settings.format}`,
  );
  const { width, height, fps, background } = project.canvas;
  const args = [
    "-y",
    "-hide_banner",
    "-filter_complex_threads",
    "1",
    "-f",
    "lavfi",
    "-i",
    `color=c=${background}:s=${width}x${height}:r=${fps}:d=${duration}${still || width % 2 || height % 2 ? ",format=rgba" : ""}`,
  ];
  if (!still)
    args.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${duration}`);
  const filters: string[] = [],
    audioLabels: string[] = still ? [] : ["[1:a]"];
  let base = "0:v",
    input = still ? 1 : 2,
    layer = 0;
  const ordered = [...project.tracks]
    .reverse()
    .flatMap((track) =>
      project.clips
        .filter((c) => c.trackId === track.id)
        .map((clip) => ({ clip, track })),
    );
  for (const { clip, track } of ordered) {
    if (!isTrackActive(project.tracks, track.id)) continue;
    if (signal.aborted) throw new Error("任务已取消");
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (asset?.missing) throw new Error(`素材离线：${asset.name}`);
    const index = input++;
    // Seeking the decoder directly makes a late-timeline capture fast. Image
    // inputs start at zero; their source timestamp only matters to cursor data.
    const animatedText =
      clip.kind === "text" &&
      !!clip.behaviors?.some(
        (behavior) =>
          behavior.enabled &&
          [behavior.incoming, behavior.during, behavior.outgoing].some(
            (phase) => phase.type !== "whole" && phase.style !== "none",
          ),
      );
    const sourceIn = still || animatedText ? 0 : clip.sourceIn;
    let sourceSeek = clip.sourceIn;
    if (
      still &&
      clip.kind === "video" &&
      asset &&
      sourceSeek >= asset.duration
    ) {
      // An edited endpoint can be exactly at EOF. Use the last decoded source
      // timestamp instead of assuming the video's frame rate equals the project.
      const timestamps = await runProcess(
        findBinary("ffprobe", resourcesPath),
        [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-read_intervals",
          `${Math.max(0, asset.duration - 1)}%`,
          "-show_frames",
          "-show_entries",
          "frame=best_effort_timestamp_time",
          "-of",
          "csv=p=0",
          asset.path,
        ],
        { signal, timeout: 30000 },
      );
      const last = timestamps
        .trim()
        .split(/\r?\n/)
        .map((line) => Number.parseFloat(line))
        .filter(Number.isFinite)
        .at(-1);
      if (last === undefined)
        throw new Error(`无法读取视频末帧：${asset.name}`);
      sourceSeek = last;
    }
    let intrinsicWidth = asset?.width ?? 600,
      intrinsicHeight = asset?.height ?? 300;
    if (clip.kind === "text" || clip.kind === "shape") {
      const image = path.join(workDir, `${layer}.png`);
      const size = animatedText
        ? await rasterizeBehaviorText(clip, workDir, layer, fps, still, signal)
        : await rasterize(clip, image);
      intrinsicWidth = size.width;
      intrinsicHeight = size.height;
      if (animatedText)
        args.push("-f", "concat", "-safe", "0", "-i", size.input!);
      else
        args.push(
          ...loopImageInput(image, fps, sourceIn + clip.duration * clip.speed),
        );
    } else if (clip.kind === "image")
      args.push(
        ...loopImageInput(
          asset!.path,
          fps,
          sourceIn + clip.duration * clip.speed,
        ),
      );
    // Multiple retimed overlays can also stall frame-threaded video decoding.
    // Keep decoding deterministic; the output encoder still chooses its own threads.
    else
      args.push(
        "-threads",
        "1",
        ...(still ? ["-ss", String(sourceSeek)] : []),
        "-i",
        asset!.path,
      );
    if (clip.kind !== "audio") {
      const visual = `v${layer}`,
        output = `mix${layer}`;
      const fit = ["text", "shape"].includes(clip.kind)
        ? 1
        : Math.min(
            width / Math.max(1, intrinsicWidth),
            height / Math.max(1, intrinsicHeight),
          );
      const crop = clip.crop ?? defaultCrop;
      const animatedViewport = hasVisualAnimation(clip);
      const cropWidth =
        intrinsicWidth -
        (animatedViewport ? 0 : Math.floor(intrinsicWidth * crop.left)) -
        (animatedViewport ? 0 : Math.floor(intrinsicWidth * crop.right));
      const cropHeight =
        intrinsicHeight -
        (animatedViewport ? 0 : Math.floor(intrinsicHeight * crop.top)) -
        (animatedViewport ? 0 : Math.floor(intrinsicHeight * crop.bottom));
      const range = transitionRange(project, clip);
      // Paired transitions hold boundary poses and source frames outside the clip.
      const clock = (name: string) =>
        range.before || range.after
          ? `clip(${name},${clip.start},${clip.start + clip.duration})`
          : name;
      const pose = (key: keyof Transform, name = "t") =>
        expression(clip, key, clock(name));
      const scale = pose("scale");
      const transform = `scale=w='max(2,trunc(${cropWidth * fit}*(${scale})/2)*2)':h='max(2,trunc(${cropHeight * fit}*(${scale})/2)*2)':eval=frame`;
      const alphaAnimated =
        !!clip.behaviors?.some((behavior) => behavior.enabled) ||
        clip.keyframes.some((k) => k.value.opacity !== clip.transform.opacity);
      let alpha = alphaAnimated
        ? `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${pose("opacity", "T")})'`
        : `colorchannelmixer=aa=${clip.transform.opacity}`;
      const { incoming, outgoing } = fadeDurations(clip);
      if (incoming || outgoing) {
        const fade = `min(1,min(${incoming ? `(${clock("T")}-${clip.start})/${incoming}` : "1"},${outgoing ? `(${clip.start + clip.duration}-${clock("T")})/${outgoing}` : "1"}))`;
        alpha = `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${pose("opacity", "T")})*max(0,${fade})'`;
      }
      const visualEffects = visualFilters(
        animatedViewport ? { ...clip, crop: undefined } : clip,
        intrinsicWidth,
        intrinsicHeight,
      );
      const rotation = clip.transform.rotation ?? clip.rotation ?? 0;
      const animatedRotation =
        !!clip.behaviors?.some((behavior) => behavior.enabled) ||
        clip.keyframes.some(
          (frame) => (frame.value.rotation ?? rotation) !== rotation,
        );
      const hasAxisRotation = [
        clip.transform,
        ...clip.keyframes.map((frame) => frame.value),
      ].some((value) => value.rotationX || value.rotationY);
      const rotate = hasAxisRotation
        ? axisRotationFilters({
            x: pose("rotationX", "T"),
            y: pose("rotationY", "T"),
            z: pose("rotation", "T"),
          })
        : animatedRotation
          ? [
              `rotate=a='(${pose("rotation")})*PI/180':ow='ceil(sqrt(iw*iw+ih*ih)/2)*2':oh='ceil(sqrt(iw*iw+ih*ih)/2)*2':c=black@0`,
            ]
          : rotation
            ? [
                `rotate=${(rotation * Math.PI) / 180}:ow=rotw(${(rotation * Math.PI) / 180}):oh=roth(${(rotation * Math.PI) / 180}):c=none`,
              ]
            : [];
      let source = `${index}:v`;
      if (asset?.cursor) {
        const cursor = await cursorFilters(
          asset,
          clip,
          fps,
          layer,
          workDir,
          input,
          signal,
          still,
        );
        if (cursor) {
          args.push(...cursor.args);
          input += 2;
          filters.push(
            `[${source}]trim=start=${sourceIn}:duration=${clip.duration * clip.speed},setpts=(PTS-STARTPTS)/${clip.speed}+${clip.start}/TB,format=rgba,${cursor.filters[0]}`,
          );
          filters.push(...cursor.filters.slice(1));
          source = cursor.label;
        }
      }
      const padding =
        range.before || range.after
          ? `setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=${range.before}:stop_mode=clone:stop_duration=${range.after},setpts=PTS+${range.start}/TB,`
          : "";
      const timing =
        source === `${index}:v`
          ? `trim=start=${sourceIn}:duration=${clip.duration * clip.speed},setpts=(PTS-STARTPTS)/${clip.speed}${padding ? "," + padding : `+${clip.start}/TB,`}`
          : padding;
      const frameFilters = mediaFrameFilters(
        clip,
        fit,
        animatedViewport ? (key) => pose(key, "T") : undefined,
      );
      filters.push(
        `[${source}]${timing}${animatedText ? `fps=${fps},` : ""}format=rgba,${[...(animatedViewport ? animatedViewportFilters((key) => pose(key, "T")) : contentFilters(clip)), ...visualEffects, ...frameFilters, transform, "setsar=1", ...rotate, alpha].join(",")}[${visual}]`,
      );
      // Composite text before chroma subsampling so rounded fills and glyphs
      // retain the same pixel position in video and frame captures.
      filters.push(
        `[${base}][${visual}]overlay=x='${width}*((${pose("x")})+(${transitionOffsetExpression(project, clip)}))-overlay_w/2':y='${height}*(${pose("y")})-overlay_h/2':enable='gte(t,${range.start})*lt(t,${range.end})':eof_action=pass:repeatlast=0${still || clip.kind === "text" ? ":format=auto" : ""}[${output}]`,
      );
      base = output;
    }
    if (
      !still &&
      asset?.hasAudio &&
      clip.kind !== "image" &&
      !track.muted &&
      clip.volume > 0
    ) {
      const label = `a${layer}`;
      filters.push(
        `[${index}:a]atrim=start=${clip.sourceIn}:duration=${clip.duration * clip.speed},asetpts=PTS-STARTPTS,${audioFilters(clip, rubberband).join(",")},adelay=${Math.round(clip.start * 1000)}:all=1[${label}]`,
      );
      audioLabels.push(`[${label}]`);
    }
    layer++;
  }
  if (!still)
    filters.push(
      `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95,atrim=duration=${duration}[audio]`,
    );
  if (project.camera) {
    const camera = { ...project.camera, start: 0 };
    const clock = `on/${fps}`;
    // Apply the camera to the composed scene, including captions and recorded
    // cursors. zoompan crops at source resolution instead of scaling huge frames.
    filters.push(
      `[${base}]zoompan=z='${expression(camera, "scale", clock)}':x='iw*(${expression(camera, "x", clock)})-iw/zoom/2':y='ih*(${expression(camera, "y", clock)})-ih/zoom/2':d=1:s=${width}x${height}:fps=${fps}[camera]`,
    );
    base = "camera";
  }
  const graph = path.join(workDir, "graph.txt");
  if (!still) {
    const output = exportDimensions(project.canvas, settings.resolution);
    if (output.width !== width || output.height !== height) {
      filters.push(
        `[${base}]scale=${output.width}:${output.height}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2:color=${background},setsar=1[resized]`,
      );
      base = "resized";
    }
  }
  filters.push(`[${base}]format=${still ? "rgb24" : "yuv420p"}[video]`);
  await fs.writeFile(graph, filters.join(";\n"));
  const version = await runProcess(
    findBinary("ffmpeg", resourcesPath),
    ["-version"],
    { timeout: 10000 },
  );
  const major = Number(version.match(/ffmpeg version (?:n)?(\d+)\./)?.[1] ?? 7);
  const encoder = still
    ? ["-c:v", "png"]
    : await chooseEncoder(project, settings, resourcesPath, signal);
  args.push(
    major >= 7 ? "-/filter_complex" : "-filter_complex_script",
    graph,
    "-map",
    "[video]",
    ...(still ? [] : ["-map", "[audio]"]),
    "-t",
    String(duration),
    "-r",
    String(fps),
    ...encoder,
    ...(still
      ? ["-frames:v", "1", "-update", "1"]
      : [
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          settings.format === "webm" ? "libopus" : "aac",
          "-b:a",
          exportQualities[settings.quality].audio,
          ...(["mp4", "mov"].includes(settings.format)
            ? ["-movflags", "+faststart"]
            : []),
        ]),
    "-progress",
    "pipe:1",
    partial,
  );
  try {
    const processOptions = {
      signal,
      cwd: workDir,
      onLine: (line: string) => {
        if (line.startsWith("out_time_us="))
          progress(
            Math.min(99, (Number(line.slice(12)) / 1e6 / duration) * 100),
          );
      },
    };
    try {
      await runProcess(
        findBinary("ffmpeg", resourcesPath),
        args,
        processOptions,
      );
    } catch (error) {
      if (
        still ||
        signal.aborted ||
        ["libx264", "libvpx-vp9"].includes(encoder[1])
      )
        throw error;
      const index = args.indexOf("-c:v");
      args.splice(index, encoder.length, ...softwareEncoder(settings));
      progress(0);
      await runProcess(
        findBinary("ffmpeg", resourcesPath),
        args,
        processOptions,
      );
    }
    await fs.rename(partial, target);
    progress(100);
  } finally {
    await fs.rm(partial, { force: true });
  }
}
