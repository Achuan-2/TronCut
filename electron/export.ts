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
  >,
  key: keyof Transform,
  clock = "t",
): string {
  const frames = [...clip.keyframes].sort((a, b) => a.time - b.time);
  const baseValue =
    clip.transform[key] ?? (key === "rotation" ? (clip.rotation ?? 0) : 0);
  const frameValue = (value: Transform) => value[key] ?? baseValue;
  if (!frames.length) return String(baseValue);
  if (frames[0].time > 0) frames.unshift({ time: 0, value: clip.transform });
  const origin = clip.start - (clip.animationOffset ?? 0);
  let result = String(frameValue(frames.at(-1)!.value));
  for (let i = frames.length - 1; i > 0; i--) {
    const a = frames[i - 1],
      b = frames[i],
      p = `clip((${clock}-${origin + a.time})/${Math.max(0.00001, b.time - a.time)},0,1)`;
    const ease = `((${p})*(${p})*(3-2*(${p})))`;
    result = `if(lt(${clock},${origin + b.time}),${frameValue(a.value)}+(${frameValue(b.value) - frameValue(a.value)})*${ease},${result})`;
  }
  return `if(lt(${clock},${origin + frames[0].time}),${frameValue(frames[0].value)},${result})`;
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
  resourcesPath: string | undefined,
  signal: AbortSignal,
): Promise<string[]> {
  const software = ["-c:v", "libx264", "-preset", "fast", "-crf", "20"];
  if (project.exportSettings?.encoder === "software") return software;
  const candidates =
    process.platform === "darwin"
      ? [["-c:v", "h264_videotoolbox", "-b:v", "12M"]]
      : process.platform === "win32"
        ? [
            ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "22", "-b:v", "0"],
            ["-c:v", "h264_qsv", "-preset", "fast", "-global_quality", "22"],
            [
              "-c:v",
              "h264_amf",
              "-quality",
              "balanced",
              "-qp_i",
              "22",
              "-qp_p",
              "24",
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
): Promise<{ width: number; height: number }> {
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
  const width = Math.max(16, (info.width ?? 16) + margin * 2),
    height = Math.max(
      16,
      (info.height ?? style.fontSize * lines.length) + margin * 2,
    );
  const alpha = await sharp(text).extractChannel(3).toBuffer();
  const coloredText = (color: string) =>
    sharp({
      create: {
        width: info.width!,
        height: info.height!,
        channels: 3,
        background: color,
      },
    })
      .joinChannel(alpha)
      .png()
      .toBuffer();
  const colored = await coloredText(style.color);
  // Composite offset alpha masks to form a readable outline around each glyph.
  const layers: sharp.OverlayOptions[] = [];
  if (style.outlineWidth > 0) {
    const radius = Math.ceil(style.outlineWidth);
    const outlined = await coloredText(style.outline);
    for (let angle = 0; angle < 360; angle += 30)
      layers.push({
        input: outlined,
        left: margin + Math.round(Math.cos((angle * Math.PI) / 180) * radius),
        top: margin + Math.round(Math.sin((angle * Math.PI) / 180) * radius),
      });
  }
  layers.push({ input: colored, left: margin, top: margin });
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
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error("时间线为空");
  if (project.canvas.width % 2 || project.canvas.height % 2)
    throw new Error("H.264 导出要求画布宽高为偶数");
  await fs.mkdir(workDir, { recursive: true });
  const partial = path.join(
    path.dirname(target),
    `.framecraft-${Date.now()}.partial.mp4`,
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
    `color=c=${background}:s=${width}x${height}:r=${fps}:d=${duration}`,
    "-f",
    "lavfi",
    "-i",
    `anullsrc=r=48000:cl=stereo:d=${duration}`,
  ];
  const filters: string[] = [],
    audioLabels: string[] = ["[1:a]"];
  let base = "0:v",
    input = 2,
    layer = 0;
  const ordered = [...project.tracks]
    .reverse()
    .flatMap((track) =>
      project.clips
        .filter((c) => c.trackId === track.id)
        .map((clip) => ({ clip, track })),
    );
  for (const { clip, track } of ordered) {
    if (track.hidden) continue;
    if (signal.aborted) throw new Error("任务已取消");
    const asset = project.assets.find((a) => a.id === clip.assetId);
    if (asset?.missing) throw new Error(`素材离线：${asset.name}`);
    const index = input++;
    let intrinsicWidth = asset?.width ?? 600,
      intrinsicHeight = asset?.height ?? 300;
    if (clip.kind === "text" || clip.kind === "shape") {
      const image = path.join(workDir, `${layer}.png`),
        size = await rasterize(clip, image);
      intrinsicWidth = size.width;
      intrinsicHeight = size.height;
      // Finite sources avoid relying only on downstream trim to stop loops.
      // Decode static images on one thread: FFmpeg 9 frame-threaded PNG inputs
      // can stall in multi-overlay graphs with delayed/truncated sources.
      args.push(
        "-loop",
        "1",
        "-framerate",
        String(fps),
        "-t",
        String(clip.sourceIn + clip.duration * clip.speed),
        "-threads",
        "1",
        "-i",
        image,
      );
    } else if (clip.kind === "image")
      args.push(
        "-loop",
        "1",
        "-framerate",
        String(fps),
        "-t",
        String(clip.sourceIn + clip.duration * clip.speed),
        "-threads",
        "1",
        "-i",
        asset!.path,
      );
    else args.push("-i", asset!.path);
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
      const cropWidth =
        intrinsicWidth -
        Math.floor(intrinsicWidth * crop.left) -
        Math.floor(intrinsicWidth * crop.right);
      const cropHeight =
        intrinsicHeight -
        Math.floor(intrinsicHeight * crop.top) -
        Math.floor(intrinsicHeight * crop.bottom);
      const scale = expression(clip, "scale");
      const transform = `scale=w='max(2,trunc(${cropWidth * fit}*(${scale})/2)*2)':h='max(2,trunc(${cropHeight * fit}*(${scale})/2)*2)':eval=frame`;
      const alphaAnimated = clip.keyframes.some(
        (k) => k.value.opacity !== clip.transform.opacity,
      );
      let alpha = alphaAnimated
        ? `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${expression(clip, "opacity", "T")})'`
        : `colorchannelmixer=aa=${clip.transform.opacity}`;
      const { incoming, outgoing } = fadeDurations(clip);
      if (incoming || outgoing) {
        const fade = `min(1,min(${incoming ? `(T-${clip.start})/${incoming}` : "1"},${outgoing ? `(${clip.start + clip.duration}-T)/${outgoing}` : "1"}))`;
        alpha = `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${expression(clip, "opacity", "T")})*max(0,${fade})'`;
      }
      const visualEffects = visualFilters(
        clip,
        intrinsicWidth,
        intrinsicHeight,
      );
      const rotation = clip.transform.rotation ?? clip.rotation ?? 0;
      const animatedRotation = clip.keyframes.some(
        (frame) => (frame.value.rotation ?? rotation) !== rotation,
      );
      const rotate = animatedRotation
        ? [
            `rotate=a='(${expression(clip, "rotation")})*PI/180':ow='ceil(sqrt(iw*iw+ih*ih)/2)*2':oh='ceil(sqrt(iw*iw+ih*ih)/2)*2':c=black@0`,
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
        );
        if (cursor) {
          args.push(...cursor.args);
          input += 2;
          filters.push(
            `[${source}]trim=start=${clip.sourceIn}:duration=${clip.duration * clip.speed},setpts=(PTS-STARTPTS)/${clip.speed}+${clip.start}/TB,format=rgba,${cursor.filters[0]}`,
          );
          filters.push(...cursor.filters.slice(1));
          source = cursor.label;
        }
      }
      const timing =
        source === `${index}:v`
          ? `trim=start=${clip.sourceIn}:duration=${clip.duration * clip.speed},setpts=(PTS-STARTPTS)/${clip.speed}+${clip.start}/TB,`
          : "";
      filters.push(
        `[${source}]${timing}format=rgba,${[...visualEffects, transform, "setsar=1", ...rotate, alpha].join(",")}[${visual}]`,
      );
      filters.push(
        `[${base}][${visual}]overlay=x='${width}*(${expression(clip, "x")})-overlay_w/2':y='${height}*(${expression(clip, "y")})-overlay_h/2':enable='gte(t,${clip.start})*lt(t,${clip.start + clip.duration})':eof_action=pass:repeatlast=0[${output}]`,
      );
      base = output;
    }
    if (
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
  await fs.writeFile(graph, filters.join(";\n"));
  await fs.appendFile(graph, `;\n[${base}]format=yuv420p[video]`);
  const version = await runProcess(
    findBinary("ffmpeg", resourcesPath),
    ["-version"],
    { timeout: 10000 },
  );
  const major = Number(version.match(/ffmpeg version (?:n)?(\d+)\./)?.[1] ?? 7);
  const encoder = await chooseEncoder(project, resourcesPath, signal);
  args.push(
    major >= 7 ? "-/filter_complex" : "-filter_complex_script",
    graph,
    "-map",
    "[video]",
    "-map",
    "[audio]",
    "-t",
    String(duration),
    "-r",
    String(fps),
    ...encoder,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
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
      if (signal.aborted || encoder[1] === "libx264") throw error;
      const index = args.indexOf("-c:v");
      args.splice(
        index,
        encoder.length,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
      );
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
