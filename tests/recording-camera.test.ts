import { expect, it } from "vitest";
import { cameraMask, cameraClipPath } from "../shared/camera-style";
import {
  recordingSettingsSchema,
  defaultRecordingSettings,
} from "../shared/recording-settings";
import { addRecordedAssets } from "../shared/recording";
import { createProject, validateProject, type Asset } from "../shared/model";
import { groupSelection, splitSelection, moveClips } from "../shared/timeline";
import { trimClip } from "../shared/clip-trim";
import { visualFilters } from "../shared/effects";

const asset: Asset = {
  id: "screen",
  name: "录屏",
  path: "screen.mp4",
  kind: "video",
  width: 1920,
  height: 1080,
  hasAudio: false,
  duration: 10,
};

it("旧录屏配置补上摄像头默认值，预设蒙版保持正圆并可调整位置", () => {
  const old = { ...defaultRecordingSettings } as Partial<
    typeof defaultRecordingSettings
  >;
  delete old.camera;
  delete old.cameraStyle;
  expect(recordingSettingsSchema.parse(old).cameraStyle).toEqual({
    preset: "rectangle",
    maskX: 0.5,
    maskY: 0.5,
    maskSize: 0.9,
    mirror: false,
  });
  const style = {
    preset: "circle" as const,
    maskX: 0.4,
    maskY: 0.6,
    maskSize: 0.8,
    mirror: false,
  };
  const mask = cameraMask(style, 1920, 1080);
  expect(mask.width * 1920).toBeCloseTo(mask.height * 1080);
  expect(mask).toMatchObject({ x: 0.4, y: 0.6, shape: "ellipse", feather: 0 });
  expect(cameraClipPath(style, 1920, 1080)).toBe(
    "ellipse(22.5% 40% at 40% 60%)",
  );
});

it("摄像头导入为独立图层且保留可编辑蒙版，录屏移动拆分不影响它", () => {
  const camera = { ...asset, id: "camera" };
  const project = validateProject(
    addRecordedAssets(
      createProject(),
      [
        { asset, kind: "screen" },
        { asset: camera, kind: "camera" },
      ],
      {
        ...defaultRecordingSettings,
        camera: true,
        background: false,
        cameraStyle: {
          preset: "circle",
          maskX: 0.3,
          maskY: 0.6,
          maskSize: 0.7,
          mirror: true,
        },
      },
      0,
    ),
  );
  const [screen, webcam] = project.clips;
  expect(webcam.groupId).toBeUndefined();
  expect(webcam.visualEffects?.mask).toMatchObject({
    shape: "ellipse",
    x: 0.3,
    y: 0.6,
  });
  expect(webcam.effects).toMatchObject({ flipX: true });
  expect(visualFilters(webcam, asset.width, asset.height)).toContain("hflip");
  expect(
    splitSelection(project, [screen.id], 5).clips.filter(
      (clip) => clip.assetId === "camera",
    ),
  ).toEqual([webcam]);
  expect(
    moveClips(project, [screen.id], 4).clips.find(
      (clip) => clip.id === webcam.id,
    ),
  ).toEqual(webcam);
});

it("录屏取消组合并拆分后，循环背景两侧可延长且不改变播放速度", () => {
  const bg = { ...asset, id: "bg", duration: 2 };
  const project = addRecordedAssets(
    createProject(),
    [{ asset, kind: "screen" }],
    { ...defaultRecordingSettings, autoZoom: false },
    3,
    bg,
  );
  const released = groupSelection(project, [project.clips[0].id], true);
  const backdrop = released.clips.find((clip) => clip.assetId === "bg")!;
  const split = splitSelection(released, [backdrop.id], 8);
  const right = split.clips.find(
    (clip) => clip.assetId === "bg" && clip.start === 8,
  )!;
  const longer = trimClip(right, bg, "right", 30, 30);
  expect(longer).toMatchObject({
    loop: true,
    duration: 30,
    speed: 1,
    sourceIn: 5,
  });
  const left = trimClip(longer, bg, "left", -8, 30);
  expect(left).toMatchObject({ start: 0, duration: 38, sourceIn: 1, speed: 1 });
  const limited = trimClip(project.clips[0], asset, "right", 30, 30);
  expect(limited.duration).toBe(10);
});
