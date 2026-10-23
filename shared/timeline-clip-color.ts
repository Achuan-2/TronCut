import type { Project } from "./model";
import { editableIds, selectionWithGroups } from "./timeline";

export const timelineClipColors = [
  { name: "红色", color: "#ba5555" },
  { name: "橙色", color: "#ca8546" },
  { name: "黄色", color: "#d3b653" },
  { name: "绿色", color: "#52845e" },
  { name: "青色", color: "#458e91" },
  { name: "蓝色", color: "#527db6" },
  { name: "紫色", color: "#8b68b3" },
  { name: "粉色", color: "#bb7398" },
  { name: "棕色", color: "#987659" },
  { name: "灰色", color: "#7b8389" },
] as const;

export const isTimelineClipColor = (color: string) =>
  /^#[\da-f]{6}$/i.test(color);

/** Color is timeline metadata; media appearance and animation stay intact. */
export function setTimelineClipColor(
  project: Project,
  ids: readonly string[],
  color?: string,
): Project {
  if (color !== undefined && !isTimelineClipColor(color)) return project;
  color = color?.toLowerCase();
  const selected = selectionWithGroups(project, ids);
  const editable = editableIds(project, selected);
  if (!selected.length || selected.some((id) => !editable.has(id)))
    return project;
  let changed = false;
  const clips = project.clips.map((clip) => {
    if (!editable.has(clip.id) || clip.timelineColor === color) return clip;
    changed = true;
    if (color !== undefined) return { ...clip, timelineColor: color };
    const { timelineColor: _color, ...rest } = clip;
    return rest;
  });
  return changed ? { ...project, clips } : project;
}

/** Pick the higher-contrast foreground, including very light custom colors. */
export function timelineClipTextColor(color: string) {
  const rgb = [1, 3, 5]
    .map((start) => parseInt(color.slice(start, start + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.0556
    ? "#ffffff"
    : "#111111";
}
