import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { exportFrame } from "../electron/export";
import { openProject, saveProject } from "../electron/project-store";
import { createProject, newText, validateProject } from "../shared/model";
import { addMediaAssets, availableTrack } from "../shared/editor";
import {
  createGroupScope,
  groupMembers,
  groupedTimeline,
  projectForGroup,
  renameClipGroup,
} from "../shared/clip-groups";
import { groupSelection, moveClips, pasteClips } from "../shared/timeline";
import {
  constrainTimelineMove,
  groupExistingTimelineOverlaps,
  hasProjectTimelineOverlap,
  hasTimelineOverlap,
  timelineRangesOverlap,
  timelineTrimBounds,
} from "../shared/timeline-collision";

function fixture() {
  const project = createProject();
  project.clips = [
    { ...newText("titles", 0), duration: 2 },
    { ...newText("titles", 4), duration: 2 },
    { ...newText("video", 0), duration: 2 },
  ];
  return project;
}

describe("同轨防重叠", () => {
  it("首尾相接和浮点帧边界允许，不限制不同轨道叠加", () => {
    expect(
      timelineRangesOverlap(
        { start: 0, duration: 2 },
        { start: 2, duration: 1 },
      ),
    ).toBe(false);
    expect(
      timelineRangesOverlap(
        { start: 0, duration: 0.1 + 0.2 },
        { start: 0.3, duration: 1 },
      ),
    ).toBe(false);
    expect(hasTimelineOverlap(fixture())).toBe(false);
  });

  it("移动时吸附到最近的空白边界，允许跨过素材放到另一侧", () => {
    const project = fixture();
    const id = project.clips[0].id;
    expect(constrainTimelineMove(project, [id], 3)).toBe(2);
    expect(constrainTimelineMove(project, [id], 5.5)).toBe(6);
    expect(constrainTimelineMove(project, [id], 8)).toBe(8);
    expect(moveClips(project, [id], 3).clips[0].start).toBe(2);
  });

  it("精确填入两段素材之间的空隙，不将相邻禁区误合并", () => {
    const project = fixture();
    project.clips.push({ ...newText("titles", 8), duration: 2 });
    expect(constrainTimelineMove(project, [project.clips[1].id], 2)).toBe(2);
  });

  it("跨轨移动使用目标轨道的占用范围", () => {
    const project = fixture();
    expect(
      constrainTimelineMove(project, [project.clips[1].id], -4, "video"),
    ).toBe(-2);
  });

  it("多选使用同一个移动量，保持跨轨素材同步", () => {
    const project = fixture();
    const ids = [project.clips[0].id, project.clips[2].id];
    const moved = moveClips(project, ids, 3);
    expect(
      moved.clips
        .filter((clip) => ids.includes(clip.id))
        .map((clip) => clip.start),
    ).toEqual([2, 2]);
    expect(hasTimelineOverlap(moved)).toBe(false);
  });

  it("裁剪边界不会跨入前后素材", () => {
    const project = fixture();
    expect(timelineTrimBounds(project, project.clips[0].id)).toEqual({
      start: 0,
      end: 4,
    });
    expect(timelineTrimBounds(project, project.clips[1].id)).toEqual({
      start: 2,
      end: Infinity,
    });
  });

  it("粘贴自动找空白位置，保留多素材间距", () => {
    const project = fixture();
    const copy = pasteClips(project, [project.clips[0], project.clips[2]], 0);
    expect(
      copy.project.clips
        .filter((clip) => copy.ids.includes(clip.id))
        .map((clip) => clip.start),
    ).toEqual([2, 2]);
    expect(hasTimelineOverlap(copy.project)).toBe(false);
  });

  it("组合的整个时间区间被占用，间隙不允许放入组外素材", () => {
    const project = fixture();
    const grouped = groupSelection(
      project,
      project.clips.slice(0, 2).map((clip) => clip.id),
    );
    expect(availableTrack(grouped, 2.5, 1)?.id).not.toBe("titles");
    const image = {
      id: "image",
      name: "图片",
      path: "image.png",
      kind: "image" as const,
      duration: 0,
      width: 10,
      height: 10,
      hasAudio: false,
    };
    const added = addMediaAssets(grouped, [image], 2.5, true, {
      trackId: "titles",
      imageDuration: 1,
    });
    expect(added.clips.at(-1)!.trackId).not.toBe("titles");
    expect(hasTimelineOverlap(added)).toBe(false);
  });
});

describe("已有重叠自动组合", () => {
  it("重叠分轨与组合保存重开后，真实合成画面的像素保持一致", async () => {
    const root = path.resolve(`test-output/overlap-migration-${Date.now()}`);
    await fs.mkdir(root, { recursive: true });
    const project = createProject();
    project.canvas = { width: 80, height: 60, fps: 10, background: "#101319" };
    project.assets = await Promise.all(
      ["#ee3322", "#22cc44"].map(async (color, index) => {
        const file = path.join(root, `source-${index}.png`);
        await sharp({
          create: { width: 80, height: 60, channels: 3, background: color },
        })
          .png()
          .toFile(file);
        return {
          id: `image-${index}`,
          name: `图片 ${index}`,
          path: file,
          kind: "image" as const,
          duration: 0,
          width: 80,
          height: 60,
          hasAudio: false,
        };
      }),
    );
    project.clips = project.assets.map((asset, index) => ({
      ...newText("titles", index),
      kind: "image" as const,
      assetId: asset.id,
      duration: index ? 2 : 4,
      transform: { ...newText("titles", 0).transform, opacity: index ? 0.5 : 1 },
    }));
    const migrated = groupExistingTimelineOverlaps(project);
    const saved = path.join(root, "migrated.troncut");
    await saveProject(migrated, saved);
    const reopened = await openProject(saved);
    for (const time of [0.5, 1.5, 3.5]) {
      const frames: Buffer[] = [];
      for (const [name, source] of [
        ["before", project],
        ["after", reopened],
      ] as const) {
        const file = path.join(root, `${name}-${time}.png`);
        await exportFrame(
          source,
          time,
          file,
          path.join(root, `work-${name}-${time}`),
          new AbortController().signal,
        );
        frames.push(await sharp(file).raw().toBuffer());
      }
      expect(frames[1]).toEqual(frames[0]);
    }
  });

  it("连锁重叠编成一个组，保持内容和源时间并拆分内部轨道", () => {
    const project = fixture();
    project.clips = [0, 1, 2].map((start, index) => ({
      ...newText("titles", start, 0, `素材 ${index}`),
      duration: 2,
      sourceIn: index,
    }));
    const migrated = groupExistingTimelineOverlaps(project);
    expect(groupedTimeline(migrated).clips).toHaveLength(1);
    const group = [...groupedTimeline(migrated).groups.values()][0];
    expect(group.members).toHaveLength(3);
    expect(new Set(group.members.map((clip) => clip.trackId)).size).toBe(3);
    expect(migrated.clips.map(({ trackId, groupId, ...clip }) => clip)).toEqual(
      project.clips.map(({ trackId, groupId, ...clip }) => clip),
    );
    expect(hasProjectTimelineOverlap(migrated)).toBe(false);
    expect(groupExistingTimelineOverlaps(migrated)).toBe(migrated);
    expect(validateProject(migrated).clips).toHaveLength(3);
  });

  it("相接素材与不同轨道不编组；各段独立重叠分别编组", () => {
    const project = fixture();
    project.clips = [
      ...[0, 1, 4, 8, 9].map((start) => ({
        ...newText("titles", start),
        duration: 2,
      })),
      { ...newText("video", 0), duration: 20 },
    ];
    const migrated = groupExistingTimelineOverlaps(project);
    expect(groupedTimeline(migrated).groups.size).toBe(2);
    expect(migrated.clips[2].groupId).toBeUndefined();
    expect(migrated.clips.at(-1)!.groupId).toBeUndefined();
  });

  it("已有组内重叠保留组名，原来后绘制的素材仍位于上层", () => {
    const project = fixture();
    project.clips[1].start = 1;
    const grouped = groupSelection(
      project,
      project.clips.slice(0, 2).map((clip) => clip.id),
    );
    const id = grouped.clips[0].groupId!;
    const migrated = groupExistingTimelineOverlaps(
      renameClipGroup(grouped, id, "已命名组合"),
    );
    expect(migrated.groups?.find((group) => group.id === id)?.name).toBe(
      "已命名组合",
    );
    expect(
      migrated.tracks.findIndex(
        (track) => track.id === migrated.clips[1].trackId,
      ),
    ).toBeLessThan(
      migrated.tracks.findIndex(
        (track) => track.id === migrated.clips[0].trackId,
      ),
    );
    const scope = createGroupScope(migrated, id)!;
    expect(hasTimelineOverlap(projectForGroup(migrated, scope))).toBe(false);
    expect(groupMembers(migrated, id)).toHaveLength(2);
  });

  it("普通素材碰到已有组合时合并为新组合，保留原来的子组合", () => {
    const project = fixture();
    const grouped = groupSelection(
      project,
      project.clips.slice(0, 2).map((clip) => clip.id),
    );
    const id = grouped.clips[0].groupId!;
    grouped.clips.push({ ...newText("titles", 2.5), duration: 1 });
    const migrated = groupExistingTimelineOverlaps(grouped);
    expect(groupedTimeline(migrated).groups.size).toBe(1);
    expect(
      migrated.groups?.find((group) => group.id === id)?.parentId,
    ).toBeTruthy();
    expect(hasProjectTimelineOverlap(migrated)).toBe(false);
  });
});
