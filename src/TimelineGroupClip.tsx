import { useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { type Clip } from "../shared/model";
import { type TimelineGroup } from "../shared/clip-groups";
import {
  moveClips,
  moveClipGroup,
  selectionWithGroups,
} from "../shared/timeline";
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
  const drag = useRef<{
    x: number;
    ids: string[];
    delta: number;
    trackId: string;
    single: boolean;
  } | null>(null);
  const [draft, setDraft] = useState({ delta: 0, y: 0 });
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
        left: (clip.start + draft.delta) * zoom,
        width: Math.max(4, clip.duration * zoom),
        top: top - Number(selected),
        height: height + 2 + 2 * Number(selected),
        translate: `0 ${draft.y}px`,
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
        drag.current = {
          x: event.clientX,
          ids,
          delta: 0,
          trackId: clip.trackId,
          single:
            ids.length === group.members.length &&
            ids.every((id) => group.members.some((member) => member.id === id)),
        };
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
        const lanes = Array.from(
          event.currentTarget
            .closest(".timeline-scroll")
            ?.querySelectorAll<HTMLElement>(".track-lane") ?? [],
        );
        const lane = lanes.find((lane) => {
          const bounds = lane.getBoundingClientRect();
          return event.clientY >= bounds.top && event.clientY < bounds.bottom;
        });
        const targetId = lane?.dataset.track ?? gesture.trackId;
        if (gesture.single) {
          const next = moveClipGroup(
            editor.project,
            group.id,
            time - clip.start,
            targetId,
          );
          const nextMembers = next.clips.filter((member) =>
            gesture.ids.includes(member.id),
          );
          gesture.delta =
            Math.min(...nextMembers.map((member) => member.start)) - clip.start;
          gesture.trackId = next.clips.find(
            (member) => member.id === clip.id,
          )!.trackId;
        } else {
          gesture.delta = constrainTimelineMove(
            editor.project,
            gesture.ids,
            Math.max(-earliest, time - clip.start),
          );
        }
        const origin = lanes.find(
          (lane) => lane.dataset.track === clip.trackId,
        );
        const destination = lanes.find(
          (lane) => lane.dataset.track === gesture.trackId,
        );
        setDraft({
          delta: gesture.delta,
          y:
            origin && destination
              ? destination.getBoundingClientRect().top -
                origin.getBoundingClientRect().top
              : 0,
        });
      }}
      onPointerUp={() => {
        const gesture = drag.current;
        if (gesture && (gesture.delta || gesture.trackId !== clip.trackId))
          editor.apply((project) =>
            gesture.single
              ? moveClipGroup(project, group.id, gesture.delta, gesture.trackId)
              : moveClips(project, gesture.ids, gesture.delta),
          );
        drag.current = null;
        setDraft({ delta: 0, y: 0 });
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDraft({ delta: 0, y: 0 });
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
