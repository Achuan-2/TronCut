import { useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { type Clip } from "../shared/model";
import { type TimelineGroup } from "../shared/clip-groups";
import { moveClips, selectionWithGroups } from "../shared/timeline";
import { snapTime } from "../shared/editor";
import type { Editor } from "./useEditor";
import { constrainTimelineMove } from "../shared/timeline-collision";

export default function TimelineGroupClip({
  editor,
  clip,
  group,
  zoom,
  snap,
  top,
  height,
  onContextMenu,
}: {
  editor: Editor;
  clip: Clip;
  group: TimelineGroup;
  zoom: number;
  snap: boolean;
  top: number;
  height: number;
  onContextMenu: (x: number, y: number, id: string) => void;
}) {
  const drag = useRef<{ x: number; ids: string[]; delta: number } | null>(null);
  const [delta, setDelta] = useState(0);
  const selected = group.members.some((member) =>
    editor.selectedIds.includes(member.id),
  );
  const locked = group.members.some(
    (member) =>
      editor.project.tracks.find((track) => track.id === member.trackId)
        ?.locked,
  );
  return (
    <div
      data-clip-id={clip.id}
      data-group-id={group.id}
      className={`timeline-clip clip-group ${selected ? "selected" : ""} ${locked ? "locked" : ""}`}
      title={`${group.name} · ${group.members.length} 个媒体 · 双击打开组`}
      style={{
        left: (clip.start + delta) * zoom,
        width: Math.max(4, clip.duration * zoom),
        top: top - Number(selected),
        height: height + 2 + 2 * Number(selected),
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        editor.clearKeyframeEdit();
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          editor.select(clip.id, true);
          return;
        }
        const ids = selected
          ? editor.selectedIds
          : selectionWithGroups(editor.project, [clip.id]);
        if (!selected) editor.select(clip.id);
        if (locked) return;
        drag.current = { x: event.clientX, ids, delta: 0 };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const gesture = drag.current;
        if (!gesture) return;
        const members = editor.project.clips.filter((member) =>
          gesture.ids.includes(member.id),
        );
        const earliest = Math.min(...members.map((member) => member.start));
        const wanted =
          clip.start + Math.max(-earliest, (event.clientX - gesture.x) / zoom);
        const time = snap
          ? snapTime(
              wanted,
              {
                ...editor.project,
                clips: editor.project.clips.filter(
                  (member) => !gesture.ids.includes(member.id),
                ),
              },
              clip.id,
              8 / zoom,
            )
          : wanted;
        gesture.delta = constrainTimelineMove(
          editor.project,
          gesture.ids,
          Math.max(-earliest, time - clip.start),
        );
        setDelta(gesture.delta);
      }}
      onPointerUp={() => {
        const gesture = drag.current;
        if (gesture?.delta)
          editor.apply((project) =>
            moveClips(project, gesture.ids, gesture.delta),
          );
        drag.current = null;
        setDelta(0);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDelta(0);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        editor.switchTimeline(group.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        editor.setPlaying(false);
        if (!selected) editor.select(clip.id);
        onContextMenu(event.clientX, event.clientY, clip.id);
      }}
    >
      <div className="clip-group-label">
        <FolderOpen size={15} />
        <span>{group.name}</span>
        <span className="clip-group-count">
          （{group.members.length} 个媒体）
        </span>
      </div>
    </div>
  );
}
