import { z } from "zod";
import { cursorStyleSchema, recordingSettingsSchema } from "./recording-settings";
import { ttsOptionsSchema } from "./tts";
import { animationEasings } from "./easing";
import { behaviorSchema } from "./behaviors";
import { transitionSchema } from "./transitions";
import { exportSettingsSchema } from "./export-settings";
import { visualEffectsSchema } from "./visual-effects";
import { effectWindowSchema, effectOriginSchema } from "./effect-timing";
import { annotationShapeSchema, shapeStyleSchema, drawingSchema, annotationEffectSchema } from "./annotation-style";

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
        cursorType: z.enum(["arrow", "text", "pointer", "crosshair", "open-hand", "closed-hand", "resize-ew", "resize-ns", "not-allowed"]).optional(),
      }),
    )
    .max(500000),
});
export { cursorStyleSchema } from "./recording-settings";
export const transformSchema = z.object({
  maskX: finite.min(-1).max(2).optional(),
  maskY: finite.min(-1).max(2).optional(),
  maskWidth: finite.min(0.01).max(3).optional(),
  maskHeight: finite.min(0.01).max(3).optional(),
  maskRotation: finite.min(-3600).max(3600).optional(),
  maskOpacity: finite.min(0).max(1).optional(),
  maskFeather: finite.min(-100).max(100).optional(),
  maskRadius: finite.min(0).max(500).optional(),
  rotation: finite.min(-3600).max(3600).optional(),
  rotationX: finite.min(-3600).max(3600).optional(),
  rotationY: finite.min(-3600).max(3600).optional(),
  skew: finite.min(-80).max(80).optional(),
  z: finite.min(-10000).max(1000).optional(),
  contentX: finite.min(-4).max(4).optional(),
  contentY: finite.min(-4).max(4).optional(),
  contentScale: finite.min(0.05).max(8).optional(),
  cropLeft: finite.min(0).max(0.95).optional(),
  cropTop: finite.min(0).max(0.95).optional(),
  cropRight: finite.min(0).max(0.95).optional(),
  cropBottom: finite.min(0).max(0.95).optional(),
  x: finite.min(-4).max(4),
  y: finite.min(-4).max(4),
  scale: finite.min(0.05).max(8),
  scaleX: finite.min(0.05).max(8).optional(),
  scaleY: finite.min(0.05).max(8).optional(),
  opacity: finite.min(0).max(1),
});
const cameraTransformSchema = transformSchema
  .pick({ x: true, y: true, scale: true, opacity: true })
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
  fill: z
    .string()
    .regex(/^#[\da-f]{6}$/i)
    .optional(),
  fillOpacity: finite.min(0).max(1).optional(),
  fillEnabled: z.boolean().optional(),
  fillPaddingX: finite.min(0).max(200).optional(),
  fillPaddingY: finite.min(0).max(200).optional(),
  fillRadius: finite.min(0).max(200).optional(),
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
        solo: z.boolean().optional(),
        customName: z.boolean().optional(),
        captionTrack: z.boolean().optional(),
        height: z.number().int().min(32).max(360).optional(),
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
        // Source-time ranges form one virtual media stream. sourceIn addresses
        // that stream; ranges retain cuts without restoring discarded footage.
        stitch: z
          .array(z.object({
            sourceIn: finite.nonnegative(),
            duration: finite.positive().max(86400),
          }))
          .min(2).max(10000).optional(),
        speed: finite.min(0.25).max(8),
        speedEffect: z.boolean().optional(),
        loop: z.boolean().optional(),
        visualEffects: visualEffectsSchema.optional(),
        behaviors: z.array(behaviorSchema).max(32).optional(),
        transitions: z
          .object({
            incoming: transitionSchema.optional(),
            outgoing: transitionSchema.optional(),
          })
          .optional(),
        transform: transformSchema,
        animationOffset: finite.min(-86400).max(86400).optional(),
        keyframes: z
          .array(
            z.object({
              time: finite.nonnegative(),
              value: transformSchema,
              easing: z.enum(animationEasings).optional(),
              animation: z.literal(true).optional(),
              recordingZoom: z.literal(true).optional(),
              recordingSegment: z.number().int().positive().optional(),
              recordingMotion: z.enum(["zoom-in", "zoom-out", "pan"]).optional(),
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
        lockAspectRatio: z.boolean().optional(),
        volume: finite.min(0).max(4),
        podcast: z.boolean(),
        shape: annotationShapeSchema.optional(),
        shapeStyle: shapeStyleSchema.optional(),
        shapeSize: z.object({ width: finite.min(1).max(32768), height: finite.min(1).max(32768) }).optional(),
        drawing: drawingSchema.optional(),
        annotationEffect: annotationEffectSchema.optional(),
        fill: z
          .string()
          .regex(/^#[\da-f]{6}$/i)
          .optional(),
        groupId: identifier.optional(),
        recording: recordingSettingsSchema.optional(),
        recordingRole: z.enum(["screen", "background", "camera", "microphone"]).optional(),
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
        fadeTiming: effectOriginSchema.optional(),
        cursorStyle: cursorStyleSchema.optional(),
        mediaFrame: z.object({
          window: effectWindowSchema.optional(),
          timing: effectOriginSchema.optional(),
          radius: finite.min(0).max(200),
          unit: z.enum(["px", "percent"]).optional(),
          enabled: z.boolean().optional(),
          corners: z.object({
            topLeft: z.boolean(), topRight: z.boolean(),
            bottomRight: z.boolean(), bottomLeft: z.boolean(),
          }).optional(),
        }).refine((frame) => frame.unit !== "percent" || frame.radius <= 100, {
          message: "圆角百分比不能超过 100%",
        }).optional(),
      }),
    )
    .max(100000),
  markers: z.array(
    z.object({
      id: identifier,
      time: finite.nonnegative(),
      label: z.string(),
      duration: finite.min(0).max(86400).optional(),
      comments: z.string().max(10000).optional(),
      color: z.string().regex(/^#[\da-f]{6}$/i).optional(),
    }),
  ),
  exportSettings: exportSettingsSchema.optional(),
  importReport: z.array(z.string()).optional(),
  camtasiaOriginal: z.unknown().optional(),
});
export type Project = z.infer<typeof projectSchema>;
export type Clip = Project["clips"][number];
export type Marker = Project["markers"][number];
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
      (track, index) =>
        track.customName || track.name === trackName(index, tracks.length),
    )
  )
    return tracks;
  return tracks.map((track, index) => ({
    ...track,
    name: track.customName ? track.name : trackName(index, tracks.length),
  }));
}
export const uid = () => crypto.randomUUID();
export const defaultTransform: Transform = {
  x: 0.5,
  y: 0.5,
  scale: 1,
  opacity: 1,
};
export const textFillDefaults = {
  fillEnabled: false,
  fill: "#000000",
  fillOpacity: 0.75,
  fillPaddingX: 12,
  fillPaddingY: 6,
  fillRadius: 6,
} as const;
export const textPresets: { name: string; style: TextStyle }[] = [
  {
    name: "黑边白字",
    style: {
      fontSize: 68,
      ...textFillDefaults,
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
      ...textFillDefaults,
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
      ...textFillDefaults,
      outline: "#111111",
      outlineWidth: 5,
      fontFamily: "Microsoft YaHei",
    },
  },
  {
    name: "简洁标题",
    style: {
      fontSize: 86,
      ...textFillDefaults,
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
      ...textFillDefaults,
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
      ...textFillDefaults,
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
    if (clip.stitch) {
      const length = clip.stitch.reduce((sum, part) => sum + part.duration, 0);
      const asset = project.assets.find((item) => item.id === clip.assetId);
      if (
        !["video", "audio"].includes(clip.kind) || !asset || clip.loop ||
        clip.sourceIn + clip.duration * clip.speed > length + 1e-6 ||
        clip.stitch.some((part) => part.sourceIn + part.duration > asset.duration + 1e-6)
      )
        throw new Error(`片段 ${clip.name} 的拼接源区间无效`);
    }
  }
  return project;
}
export function projectDuration(project: Project): number {
  let duration = 0;
  for (const clip of project.clips)
    duration = Math.max(duration, clip.start + clip.duration);
  return duration;
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
