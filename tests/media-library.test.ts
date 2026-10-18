import { describe, expect, it } from "vitest";
import {
  createProject,
  newText,
  validateProject,
  type Asset,
} from "../shared/model";
import {
  assetClips,
  mediaReplacementError,
  replaceSelectedMedia,
  requiredMediaDuration,
  updateLibraryAsset,
} from "../shared/media-library";

function fixture() {
  const project = createProject();
  const source: Asset = {
    id: "old",
    name: "旧视频",
    kind: "video",
    path: "old.mp4",
    duration: 20,
    width: 320,
    height: 180,
    hasAudio: true,
  };
  const replacement = { ...source, id: "new", name: "新视频", path: "new.mp4" };
  project.assets = [source, replacement];
  project.clips = [
    {
      ...newText("video", 1),
      id: "selected",
      kind: "video",
      assetId: source.id,
      sourceIn: 3,
      speed: 2,
      duration: 4,
      keyframes: [{ time: 0, value: { x: 0.4, y: 0.5, scale: 1, opacity: 1 } }],
      effects: {
        brightness: 1,
        contrast: 1,
        saturation: 1,
        blur: 0,
        grayscale: false,
        flipX: true,
        flipY: false,
      },
    },
    {
      ...newText("titles", 10),
      id: "other",
      kind: "video",
      assetId: source.id,
      groupId: "nested",
    },
  ];
  return { project, source, replacement };
}
describe("媒体库操作", () => {
  it("替换仅影响选中片段的素材和名称，保留剪辑、动画、效果及其他引用", () => {
    const { project, replacement } = fixture();
    const next = replaceSelectedMedia(project, ["selected"], replacement);
    expect(next.clips[0]).toEqual({
      ...project.clips[0],
      assetId: "new",
      name: "新视频",
    });
    expect(next.clips[1]).toBe(project.clips[1]);
    expect(project.clips[0].assetId).toBe("old");
    expect(validateProject(next)).toBeDefined();
  });
  it("没有选择、类型不匹配、离线、锁定和素材不足时阻止替换", () => {
    const { project, replacement } = fixture();
    expect(mediaReplacementError(project, [], replacement)).toContain("先选择");
    expect(
      mediaReplacementError(project, ["selected"], {
        ...replacement,
        kind: "image",
      }),
    ).toContain("类型");
    expect(
      mediaReplacementError(project, ["selected"], {
        ...replacement,
        missing: true,
      }),
    ).toContain("离线");
    expect(() =>
      replaceSelectedMedia(project, ["selected"], {
        ...replacement,
        duration: 10,
      }),
    ).toThrow("源区间");
    project.tracks.find((track) => track.id === "video")!.locked = true;
    expect(mediaReplacementError(project, ["selected"], replacement)).toContain(
      "解锁",
    );
  });
  it("时长检查保留完整拼接源区间，循环片段不要求素材覆盖整个时间线时长", () => {
    const { project } = fixture();
    const clip = {
      ...project.clips[0],
      sourceIn: 2,
      duration: 2,
      speed: 1,
      stitch: [
        { sourceIn: 10, duration: 3 },
        { sourceIn: 18, duration: 3 },
      ],
    };
    expect(requiredMediaDuration([clip])).toBe(21);
    expect(requiredMediaDuration([{ ...clip, loop: true }])).toBe(0);
  });
  it("更新全局素材及组内引用，旧素材快照保留以便撤销", () => {
    const { project, replacement } = fixture();
    project.assets.pop();
    const next = updateLibraryAsset(project, "old", replacement);
    expect(next.assets).toEqual([replacement]);
    expect(assetClips(next, "new").map((clip) => clip.id)).toEqual([
      "selected",
      "other",
    ]);
    expect(next.clips[1].groupId).toBe("nested");
    expect(next.clips[0].keyframes).toBe(project.clips[0].keyframes);
    expect(assetClips(project, "old")).toHaveLength(2);
    expect(validateProject(next)).toBeDefined();
  });
  it("删除素材同时移除全部引用，保留其他素材、片段时间和硬盘路径", () => {
    const { project, source, replacement } = fixture();
    project.clips.push({
      ...project.clips[1],
      id: "keep",
      assetId: "new",
      start: 20,
    });
    const next = updateLibraryAsset(project, "old");
    expect(next.assets).toEqual([replacement]);
    expect(next.clips).toEqual([project.clips[2]]);
    expect(source.path).toBe("old.mp4");
    expect(project.clips).toHaveLength(3);
    expect(validateProject(next)).toBeDefined();
  });
  it("删除或更新被锁定片段使用的素材时整次操作失败", () => {
    const { project, replacement } = fixture();
    project.tracks.find((track) => track.id === "titles")!.locked = true;
    expect(() => updateLibraryAsset(project, "old")).toThrow("锁定");
    expect(() => updateLibraryAsset(project, "old", replacement)).toThrow(
      "锁定",
    );
    expect(project.assets).toHaveLength(2);
  });
});
