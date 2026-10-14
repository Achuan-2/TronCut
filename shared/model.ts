import { z } from "zod";
import { ttsOptionsSchema } from "./tts";
import { animationEasings } from "./easing";

const finite = z.number().finite();
const identifier = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,128}$/, "ID 只能包含字母、数字、下划线和连字符");
export const cursorRecordingSchema = z.object({
  samples: z
    .array(
      z.object({
        time: finite.nonnegative(),
        x: finite,
        y: finite,
        visible: z.boolean(),
        click: z.boolean(),
      }),
    )
    .max(500000),
});
export const cursorStyleSchema = z.object({
  style: z.enum(["arrow", "circle", "cross", "hidden"]),
  size: finite.min(8).max(160),
  color: z.string().regex(/^#[\da-f]{6}$/i),
  clicks: z.boolean(),
  smooth: z.boolean(),
});
export const transformSchema = z.object({
  rotation: finite.min(-3600).max(3600).optional(),
  rotationX: finite.min(-3600).max(3600).optional(),
  rotationY: finite.min(-3600).max(3600).optional(),
  x: finite.min(-4).max(4),
  y: finite.min(-4).max(4),
  scale: finite.min(0.05).max(8),
  opacity: finite.min(0).max(1),
});
const cameraTransformSchema = transformSchema
  .omit({ rotation: true, rotationX: true, rotationY: true })
  .extend({
    x: finite.min(0).max(1),
    y: finite.min(0).max(1),
    scale: finite.min(1).max(8),
    opacity: z.literal(1),
  });
export const cameraSchema = z.object({
  transform: cameraTransformSchema,
  keyframes: z
    .array(
      z.object({ time: finite.nonnegative(), value: cameraTransformSchema }),
    )
    .max(10000),
});
export const styleSchema = z.object({
  fontSize: finite.min(8).max(300),
  color: z.string().regex(/^#[\da-f]{6}$/i),
  outline: z.string().regex(/^#[\da-f]{6}$/i),
  outlineWidth: finite.min(0).max(20),
  fontFamily: z.string().max(100),
});
export const projectSchema = z.object({
  format: z.enum(["troncut", "framecraft"]),
  version: z.literal(1),
  id: identifier,
  name: z.string().min(1).max(200),
  canvas: z.object({
    width: z.number().int().min(16).max(7680),
    height: z.number().int().min(16).max(4320),
    fps: z.number().int().min(1).max(120),
    background: z.string().regex(/^#[\da-f]{6}$/i),
  }),
  camera: cameraSchema.optional(),
  assets: z
    .array(
      z.object({
        id: identifier,
        name: z.string(),
        path: z.string(),
        kind: z.enum(["video", "audio", "image"]),
        duration: finite.nonnegative(),
        width: finite.nonnegative(),
        height: finite.nonnegative(),
        hasAudio: z.boolean(),
        missing: z.boolean().optional(),
        cursor: cursorRecordingSchema.optional(),
        cursorPath: z.string().optional(),
        narration: ttsOptionsSchema.optional(),
      }),
    )
    .max(10000),
  tracks: z
    .array(
      z.object({
        id: identifier,
        name: z.string(),
        hidden: z.boolean(),
        muted: z.boolean(),
        locked: z.boolean(),
      }),
    )
    .max(128),
  clips: z
    .array(
      z.object({
        id: identifier,
        trackId: identifier,
        assetId: identifier.optional(),
        kind: z.enum(["video", "audio", "image", "text", "shape"]),
        name: z.string(),
        start: finite.nonnegative(),
        duration: finite.positive().max(86400),
        sourceIn: finite.nonnegative(),
        speed: finite.min(0.25).max(8),
        transform: transformSchema,
        animationOffset: finite.min(-86400).max(86400).optional(),
        keyframes: z
          .array(
            z.object({
              time: finite.nonnegative(),
              value: transformSchema,
              easing: z.enum(animationEasings).optional(),
              animation: z.literal(true).optional(),
              zoomPan: cameraTransformSchema.optional(),
            }),
          )
          .max(10000),
        text: z.string().max(10000).optional(),
        caption: z.boolean().optional(),
        style: styleSchema.optional(),
        textBox: z
          .object({
            width: finite.min(16).max(32768),
            height: finite.min(16).max(32768),
          })
          .optional(),
        autoResizeText: z.boolean().optional(),
        volume: finite.min(0).max(4),
        podcast: z.boolean(),
        shape: z.enum(["rectangle", "ellipse", "arrow"]).optional(),
        fill: z
          .string()
          .regex(/^#[\da-f]{6}$/i)
          .optional(),
        groupId: identifier.optional(),
        rotation: finite.min(-3600).max(3600).optional(),
        contentTransform: z
          .object({
            x: finite.min(-4).max(4),
            y: finite.min(-4).max(4),
            scale: finite.min(0.05).max(8),
          })
          .optional(),
        crop: z
          .object({
            left: finite.min(0).max(0.95),
            top: finite.min(0).max(0.95),
            right: finite.min(0).max(0.95),
            bottom: finite.min(0).max(0.95),
          })
          .refine(
            (c) => c.left + c.right < 0.99 && c.top + c.bottom < 0.99,
            "裁切后必须保留有效画面",
          )
          .optional(),
        effects: z
          .object({
            brightness: finite.min(0).max(2),
            contrast: finite.min(0).max(2),
            saturation: finite.min(0).max(3),
            blur: finite.min(0).max(20),
            grayscale: z.boolean(),
            flipX: z.boolean(),
            flipY: z.boolean(),
          })
          .optional(),
        fadeIn: finite.min(0).max(86400).optional(),
        fadeOut: finite.min(0).max(86400).optional(),
        cursorStyle: cursorStyleSchema.optional(),
      }),
    )
    .max(100000),
  markers: z.array(
    z.object({ id: identifier, time: finite.nonnegative(), label: z.string() }),
  ),
  exportSettings: z
    .object({ encoder: z.enum(["auto", "software"]) })
    .optional(),
  importReport: z.array(z.string()).optional(),
  camtasiaOriginal: z.unknown().optional(),
});
export type Project = z.infer<typeof projectSchema>;
export type Clip = Project["clips"][number];
export type Asset = Project["assets"][number];
export type Transform = z.infer<typeof transformSchema>;
export type TextStyle = z.infer<typeof styleSchema>;
export function trackName(index: number, count: number): string {
  return `轨道${count - index}`;
}
export function newTrack(count: number): Project["tracks"][number] {
  return {
    id: uid(),
    name: `轨道${count + 1}`,
    hidden: false,
    muted: false,
    locked: false,
  };
}
export function numberTracks(tracks: Project["tracks"]): Project["tracks"] {
  if (
    tracks.every(
      (track, index) => track.name === trackName(index, tracks.length),
    )
  )
    return tracks;
  return tracks.map((track, index) => ({
    ...track,
    name: trackName(index, tracks.length),
  }));
}
export const uid = () => crypto.randomUUID();
export const defaultTransform: Transform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  opacity: 1,
};
export const textPresets: { name: string; style: TextStyle }[] = [
  {
    name: "黑边白字",
    style: {
      fontSize: 68,
      color: "#ffffff",
      outline: "#111111",
      outlineWidth: 4,
      fontFamily: "Microsoft YaHei",
    },
  },
  {
    name: "白边黑字",
    style: {
      fontSize: 68,
      color: "#16181c",
      outline: "#ffffff",
      outlineWidth: 4,
      fontFamily: "Microsoft YaHei",
    },
  },
  {
    name: "黑边黄字",
    style: {
      fontSize: 68,
      color: "#ffe465",
      outline: "#111111",
      outlineWidth: 5,
      fontFamily: "Microsoft YaHei",
    },
  },
  {
    name: "简洁标题",
    style: {
      fontSize: 86,
      color: "#ffffff",
      outline: "#000000",
      outlineWidth: 0,
      fontFamily: "Microsoft YaHei",
    },
  },
  {
    name: "薄荷强调",
    style: {
      fontSize: 68,
      color: "#71e6b5",
      outline: "#122e26",
      outlineWidth: 4,
      fontFamily: "Microsoft YaHei",
    },
  },
  {
    name: "浅紫花字",
    style: {
      fontSize: 68,
      color: "#d3bcff",
      outline: "#392558",
      outlineWidth: 4,
      fontFamily: "Microsoft YaHei",
    },
  },
];
export function createProject(name = "未命名工程"): Project {
  return {
    format: "troncut",
    version: 1,
    id: uid(),
    name,
    canvas: { width: 1920, height: 1080, fps: 30, background: "#101319" },
    assets: [],
    tracks: [
      {
        id: "titles",
        name: "轨道3",
        hidden: false,
        muted: false,
        locked: false,
      },
      {
        id: "video",
        name: "轨道2",
        hidden: false,
        muted: false,
        locked: false,
      },
      {
        id: "audio",
        name: "轨道1",
        hidden: false,
        muted: false,
        locked: false,
      },
    ],
    clips: [],
    markers: [],
  };
}
export function validateProject(data: unknown): Project {
  const project = projectSchema.parse(data);
  // Legacy track kinds are ignored by the schema. Keep IDs/order and all clip
  // references while migrating names to the common numbered-track layout.
  project.tracks = numberTracks(project.tracks);
  for (const [name, items] of [
    ["素材", project.assets],
    ["轨道", project.tracks],
    ["片段", project.clips],
  ] as const) {
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new Error(`${name} ID 重复`);
  }
  for (const clip of project.clips) {
    if (!project.tracks.some((t) => t.id === clip.trackId))
      throw new Error(`片段 ${clip.name} 引用了不存在的轨道`);
    if (clip.assetId && !project.assets.some((a) => a.id === clip.assetId))
      throw new Error(`片段 ${clip.name} 引用了不存在的素材`);
    if (["video", "audio", "image"].includes(clip.kind) && !clip.assetId)
      throw new Error(`片段 ${clip.name} 缺少素材`);
  }
  return project;
}
export function projectDuration(project: Project): number {
  return Math.max(0, ...project.clips.map((c) => c.start + c.duration));
}
export function newText(
  trackId: string,
  start: number,
  preset = 0,
  text = "在这里输入文字",
): Clip {
  return {
    id: uid(),
    trackId,
    kind: "text",
    name: text.slice(0, 24),
    text,
    start,
    duration: 5,
    sourceIn: 0,
    speed: 1,
    volume: 1,
    podcast: false,
    transform: { ...defaultTransform },
    keyframes: [],
    style: { ...textPresets[preset].style },
  };
}
