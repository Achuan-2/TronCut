import path from "node:path";
import {
  createProject,
  defaultTransform,
  type Asset,
  type Clip,
  type Project,
  newText,
  uid,
} from "../shared/model";

type Json = Record<string, any>;
function number(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function parameter(p: Json, name: string, fallback: number): number {
  const v = p[name];
  return number(
    typeof v === "object" && v
      ? (v.defaultValue ?? v.keyframes?.[0]?.value ?? v.value)
      : v,
    fallback,
  );
}
/** A conservative import: recognizable flat media only. Never silently flatten nested groups. */
export function importCamtasia(data: unknown, file: string): Project {
  const source = data as Json;
  if (
    !source ||
    !Array.isArray(source.sourceBin) ||
    !source.timeline?.sceneTrack?.scenes ||
    !Number.isFinite(Number(source.editRate)) ||
    Number(source.editRate) <= 0
  )
    throw new Error(
      "未识别的 Camtasia 项目结构，需要 sourceBin、editRate 与 timeline.sceneTrack.scenes",
    );
  const project = createProject(
    source.title || path.basename(file, ".tscproj"),
  );
  const rate = Number(source.editRate),
    report: string[] = [];
  project.canvas.width = Math.min(
    7680,
    Math.max(16, number(source.width, 1920)),
  );
  project.canvas.height = Math.min(
    4320,
    Math.max(16, number(source.height, 1080)),
  );
  const fpsValue = source.videoFormatFrameRate;
  const fps =
    typeof fpsValue === "string" && fpsValue.includes("/")
      ? Number(fpsValue.split("/")[0]) / Number(fpsValue.split("/")[1])
      : number(fpsValue, 30);
  project.canvas.fps = Math.min(120, Math.max(1, Math.round(fps)));
  const sourceMap = new Map<string, Asset>();
  for (const item of source.sourceBin) {
    if (
      typeof item.src !== "string" ||
      /^(https?|data|file):/i.test(item.src)
    ) {
      report.push(`素材 ${item.id} 没有可导入的本地路径`);
      continue;
    }
    const name = path.basename(item.src.replace(/\\/g, "/")),
      ext = path.extname(name).toLowerCase();
    if (
      ![
        ".mp4",
        ".mov",
        ".mkv",
        ".avi",
        ".webm",
        ".m4v",
        ".wav",
        ".mp3",
        ".m4a",
        ".aac",
        ".flac",
        ".ogg",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
      ].includes(ext)
    ) {
      report.push(
        `${name} 为专有或未支持的素材格式，需先在 Camtasia 导出为 MP4/WAV`,
      );
      continue;
    }
    const tracks = item.sourceTracks ?? [],
      rect = item.rect ?? [0, 0, 1920, 1080];
    const kind: Asset["kind"] = /\.(png|jpe?g|webp|gif)$/i.test(name)
      ? "image"
      : /\.(wav|mp3|m4a|aac|flac|ogg)$/i.test(name)
        ? "audio"
        : "video";
    const asset: Asset = {
      id: uid(),
      name,
      path: path.resolve(
        path.dirname(file),
        item.src.replace(/[\\/]/g, path.sep),
      ),
      kind,
      duration: 0,
      width:
        kind === "audio" ? 0 : Math.max(1, number(rect[2]) - number(rect[0])),
      height:
        kind === "audio" ? 0 : Math.max(1, number(rect[3]) - number(rect[1])),
      hasAudio: kind === "audio" || tracks.some((t: Json) => t.type === 2),
    };
    project.assets.push(asset);
    sourceMap.set(String(item.id), asset);
  }
  project.tracks = [];
  let sceneOffset = 0;
  for (const [
    sceneIndex,
    scene,
  ] of source.timeline.sceneTrack.scenes.entries()) {
    if (!Array.isArray(scene.csml?.tracks)) {
      report.push(`场景 ${sceneIndex + 1} 缺少轨道`);
      continue;
    }
    let sceneEnd = 0;
    for (const [index, track] of scene.csml.tracks.entries()) {
      const trackId = `camtasia-${index}`;
      if (!project.tracks.some((t) => t.id === trackId))
        project.tracks.unshift({
          id: trackId,
          name: track.name || `轨道 ${index + 1}`,
          hidden: false,
          muted: false,
          locked: false,
        });
      for (const media of track.medias ?? []) {
        const start = Math.max(0, number(media.start ?? media._start) / rate),
          duration = number(media.duration ?? media._duration) / rate;
        if (duration <= 0 || duration > 86400) {
          report.push(`片段 ${media.id} 的时长无效`);
          continue;
        }
        sceneEnd = Math.max(sceneEnd, start + duration);
        if (
          media._type === "Group" ||
          media._type === "StitchedMedia" ||
          media.medias?.length
        ) {
          report.push(`片段 ${media.id} 是嵌套/拼接组，本版保留原数据但不转换`);
          continue;
        }
        const p = media.parameters ?? {},
          asset = sourceMap.get(String(media.src));
        const content = media.text ?? media.attributes?.text;
        let clip: Clip;
        if (media._type === "Callout" && typeof content === "string")
          clip = newText(trackId, start + sceneOffset, 0, content);
        else if (asset) {
          const sourceDuration =
            number(media.mediaDuration, duration * rate) / rate;
          const speed = Math.min(8, Math.max(0.25, sourceDuration / duration));
          clip = {
            id: uid(),
            trackId,
            assetId: asset.id,
            kind: media._type === "AMFile" ? "audio" : asset.kind,
            name: asset.name,
            start: start + sceneOffset,
            duration,
            sourceIn: Math.max(0, number(media.mediaStart) / rate),
            speed,
            transform: { ...defaultTransform },
            keyframes: [],
            volume: 1,
            podcast: false,
          };
          asset.duration = Math.max(
            asset.duration,
            clip.sourceIn + duration * speed,
          );
        } else {
          report.push(
            `片段 ${media.id}（${media._type}）没有可转换的素材/文字`,
          );
          continue;
        }
        clip.duration = duration;
        clip.transform = {
          x: 0.5 + parameter(p, "translation0", 0) / project.canvas.width,
          y: 0.5 - parameter(p, "translation1", 0) / project.canvas.height,
          scale: Math.max(0.05, Math.min(8, parameter(p, "scale0", 1))),
          opacity: Math.max(0, Math.min(1, parameter(p, "opacity", 1))),
        };
        // Camtasia VMFile and AMFile refer to separate source tracks, even when they share an MP4.
        clip.volume =
          media._type === "VMFile"
            ? 0
            : Math.max(0, Math.min(4, parameter(p, "volume", 1)));
        if (
          media.effects?.length ||
          Object.values(p).some(
            (v) => typeof v === "object" && v && "keyframes" in v,
          )
        )
          report.push(`片段 ${media.id} 的专有效果/动画未转换`);
        project.clips.push(clip);
      }
    }
    sceneOffset += sceneEnd;
  }
  if (!project.tracks.length) project.tracks = createProject().tracks;
  project.camtasiaOriginal = data;
  project.importReport = [
    `已转换 ${project.assets.length} 个素材引用、${project.clips.length} 个片段。原始项目完整保留在 camtasiaOriginal。`,
    ...report,
  ];
  return project;
}
