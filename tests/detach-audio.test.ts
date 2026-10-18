import { describe, expect, it } from "vitest";
import { createProject, newText, validateProject } from "../shared/model";
import { detachableVideos, detachVideoAudio } from "../shared/detach-audio";

function fixture() {
  const project = createProject();
  project.assets = [
    {
      id: "media",
      name: "录屏",
      path: "screen.mp4",
      kind: "video",
      duration: 30,
      width: 320,
      height: 180,
      hasAudio: true,
    },
  ];
  project.clips = [
    {
      ...newText("video", 4),
      kind: "video",
      assetId: "media",
      duration: 3,
      sourceIn: 2,
      speed: 2,
      volume: 0.7,
      podcast: true,
      fadeIn: 0.4,
      fadeOut: 0.5,
      stitch: [
        { sourceIn: 2, duration: 3 },
        { sourceIn: 10, duration: 7 },
      ],
    },
  ];
  return project;
}
describe("拆分视频和音频", () => {
  it("复用源文件并保留时间、变速、拼接及音量，视频动画和效果保持原样", () => {
    const project = fixture();
    const result = detachVideoAudio(project, [project.clips[0].id]);
    const video = result.clips[0],
      audio = result.clips[1];
    expect(video).toEqual({ ...project.clips[0], audioDetached: true });
    expect(audio).toMatchObject({
      kind: "audio",
      assetId: "media",
      start: 4,
      duration: 3,
      sourceIn: 2,
      speed: 2,
      volume: 0.7,
      podcast: true,
      fadeIn: 0.4,
      fadeOut: 0.5,
      stitch: video.stitch,
    });
    expect(audio.trackId).not.toBe(video.trackId);
    expect(audio.audioDetached).toBeUndefined();
    expect(result.assets).toBe(project.assets);
    expect(result.tracks[2].id).toBe(audio.trackId);
    expect(project.clips[0].audioDetached).toBeUndefined();
    expect(detachVideoAudio(result, [video.id])).toBe(result);
    expect(validateProject(result)).toBeDefined();
  });
  it("无声音、音频片段、离线和锁定轨道不允许拆分", () => {
    for (const condition of [
      "no-audio",
      "audio",
      "offline",
      "locked",
    ] as const) {
      const project = fixture();
      if (condition === "no-audio") project.assets[0].hasAudio = false;
      if (condition === "audio") project.clips[0].kind = "audio";
      if (condition === "offline") project.assets[0].missing = true;
      if (condition === "locked") project.tracks[1].locked = true;
      expect(detachableVideos(project, [project.clips[0].id])).toEqual([]);
      expect(detachVideoAudio(project, [project.clips[0].id])).toBe(project);
    }
  });
  it("同源轨多个片段共用一条新音轨，并保留轨道静音与独奏设置", () => {
    const project = fixture();
    project.tracks[1].muted = true;
    project.tracks[1].solo = true;
    project.clips.push({ ...project.clips[0], id: "next", start: 10 });
    const result = detachVideoAudio(
      project,
      project.clips.map((clip) => clip.id),
    );
    expect(result.tracks).toHaveLength(4);
    expect(result.clips[2].trackId).toBe(result.clips[3].trackId);
    expect(result.tracks[2]).toMatchObject({ muted: true, solo: true });
  });
});
