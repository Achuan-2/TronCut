import { uid, type Marker, type Project } from "./model";

export const markerColors = [
  { name: "绿色", value: "#66d99a" },
  { name: "红色", value: "#f47479" },
  { name: "橙色", value: "#f4a460" },
  { name: "黄色", value: "#e6c66f" },
  { name: "青色", value: "#60cbd9" },
  { name: "蓝色", value: "#73a5f5" },
  { name: "紫色", value: "#ba94ea" },
  { name: "白色", value: "#dbe5e0" },
] as const;
// Existing point markers used yellow and retain that color on reopen.
export const legacyMarkerColor = "#e6c66f";
export const markerEnd = (marker: Marker) =>
  marker.time + (marker.duration ?? 0);
export const markerFrameTime = (time: number, fps: number) =>
  Math.max(0, Math.round(time * fps) / fps);

export function markerTextColor(color: string) {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance < 0.179 ? "#ffffff" : "#142019";
}

export function createMarker(
  time: number,
  label: string,
  duration = 0,
): Marker {
  return {
    id: uid(),
    time,
    label,
    duration,
    comments: "",
    color: markerColors[0].value,
  };
}

export function putMarker(project: Project, marker: Marker): Project {
  const existing = project.markers.find((item) => item.id === marker.id);
  if (existing && JSON.stringify(existing) === JSON.stringify(marker))
    return project;
  return {
    ...project,
    markers: existing
      ? project.markers.map((item) => (item.id === marker.id ? marker : item))
      : [...project.markers, marker],
  };
}

export function removeMarker(project: Project, id: string): Project {
  if (!project.markers.some((marker) => marker.id === id)) return project;
  return {
    ...project,
    markers: project.markers.filter((marker) => marker.id !== id),
  };
}

export type MarkerDragMode = "move" | "start" | "end";

/** Keep range length when moving and keep at least one frame when trimming. */
export function dragMarker(
  marker: Marker,
  mode: MarkerDragMode,
  delta: number,
  fps: number,
): Marker {
  const end = markerEnd(marker);
  if (mode === "move")
    return { ...marker, time: markerFrameTime(marker.time + delta, fps) };
  if (mode === "start") {
    const time = Math.min(
      Math.max(0, end - 1 / fps),
      Math.max(end - 86400, markerFrameTime(marker.time + delta, fps)),
    );
    return { ...marker, time, duration: end - time };
  }
  return {
    ...marker,
    duration: Math.min(
      86400,
      Math.max(1 / fps, markerFrameTime(end + delta, fps) - marker.time),
    ),
  };
}
