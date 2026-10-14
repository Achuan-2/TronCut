import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  Plus,
  Type,
  Scissors,
  Magnet,
  ZoomIn,
  ZoomOut,
  Diamond,
  Undo2,
  Redo2,
  Trash2,
  Copy,
  Flag,
  ChevronDown,
  Camera,
} from "lucide-react";
import {
  type Clip,
  projectDuration,
  uid,
  newTrack,
  trackName,
} from "../shared/model";
import { snapTime, splitClip, transformAt } from "../shared/editor";
import {
  deleteClips,
  moveClips,
  splitSelection,
  groupSelection,
  pasteClips,
  selectionWithGroups,
} from "../shared/timeline";
import { MediaThumbnail } from "./MediaThumbnail";
import { TimelineAnimations } from "./TimelineAnimations";
import {
  animationRanges,
  type AnimationRange,
} from "../shared/animation-ranges";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";

interface Drag {
  id: string;
  mode: "move" | "left" | "right";
  x: number;
  original: Clip;
  delta: number;
  trackId: string;
  ids: string[];
}
export default function Timeline({
  editor,
  onCopyAnimation,
  onDropFiles,
  onCaptureFrame,
  dropDisabled = false,
}: {
  editor: Editor;
  onCopyAnimation: (
    clipId: string,
    range: AnimationRange,
    cut?: boolean,
  ) => void;
  onDropFiles: (files: File[], time: number, trackId?: string) => void;
  onCaptureFrame: () => void;
  dropDisabled?: boolean;
}) {
  const { project, apply, playhead, seek, selected, selectedId, select } =
    editor;
  const [zoom, setZoom] = useState(65),
    [snap, setSnap] = useState(true),
    [drag, setDrag] = useState<Drag | null>(null),
    [context, setContext] = useState<{
      x: number;
      y: number;
      id: string;
    } | null>(null);
  const scroll = useRef<HTMLDivElement>(null),
    duration = Math.max(20, projectDuration(project) + 5),
    width = duration * zoom;
  const [fileDrop, setFileDrop] = useState<{
    time: number;
    trackId?: string;
  } | null>(null);
  const headers = useRef<HTMLDivElement>(null);
  const deleteControl = useRef<HTMLDivElement>(null);
  const deletePopup = useRef<HTMLDivElement>(null);
  const [deleteMenu, setDeleteMenu] = useState(false);
  const [deletePosition, setDeletePosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!deleteMenu) return;
    const outside = (event: PointerEvent) => {
      if (
        !deleteControl.current?.contains(event.target as Node) &&
        !deletePopup.current?.contains(event.target as Node)
      )
        setDeleteMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setDeleteMenu(false);
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape, true);
    };
  }, [deleteMenu]);
  const editableSelection = project.clips.filter(
    (clip) =>
      editor.selectedIds.includes(clip.id) &&
      !project.tracks.find((track) => track.id === clip.trackId)?.locked,
  );
  const canAddKeyframe = editableSelection.some(
    (clip) =>
      clip.kind !== "audio" &&
      !project.tracks.find((track) => track.id === clip.trackId)?.hidden &&
      playhead >= clip.start &&
      playhead <= clip.start + clip.duration,
  );
  const deleteSelection = (ripple = false) => {
    apply((project) => deleteClips(project, editor.selectedIds, ripple));
    select(null);
    setDeleteMenu(false);
  };
  useEffect(() => {
    const element = scroll.current;
    const index = project.tracks.findIndex(
      (track) => track.id === selected?.trackId,
    );
    if (!element || index < 0) return;
    const top = 36 + index * 70;
    if (top < element.scrollTop + 36) element.scrollTop = Math.max(0, top - 36);
    else if (top + 70 > element.scrollTop + element.clientHeight)
      element.scrollTop = top + 70 - element.clientHeight;
  }, [selected?.trackId, project.tracks.length]);
  const [viewport, setViewport] = useState({ left: 0, width: 1600 });
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewport({ left: element.scrollLeft, width: element.clientWidth }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const locked =
    selected && project.tracks.find((t) => t.id === selected.trackId)?.locked;
  function remove(id: string) {
    const clip = project.clips.find((c) => c.id === id);
    if (!clip || project.tracks.find((t) => t.id === clip.trackId)?.locked)
      return;
    apply((p) =>
      deleteClips(
        p,
        editor.selectedIds.includes(id) ? editor.selectedIds : [id],
      ),
    );
    select(null);
  }
  function duplicate(id: string) {
    const clip = project.clips.find((c) => c.id === id);
    if (!clip || project.tracks.find((t) => t.id === clip.trackId)?.locked)
      return;
    const copied = project.clips.filter((c) =>
      (editor.selectedIds.includes(id) ? editor.selectedIds : [id]).includes(
        c.id,
      ),
    );
    const result = pasteClips(
      project,
      copied,
      Math.max(...copied.map((c) => c.start + c.duration)),
    );
    apply(result.project);
    editor.selectMany(result.ids);
  }
  function dragClip(d: Drag): Clip {
    const c = d.original,
      asset = project.assets.find((a) => a.id === c.assetId),
      minimum = 1 / project.canvas.fps;
    if (d.mode === "move") {
      const earliest = Math.min(
        ...project.clips
          .filter(
            (clip) =>
              d.ids.includes(clip.id) &&
              !project.tracks.find((t) => t.id === clip.trackId)?.locked,
          )
          .map((clip) => clip.start),
      );
      const t = c.start + Math.max(-earliest, d.delta);
      const snapProject = {
        ...project,
        clips: project.clips.filter((clip) => !d.ids.includes(clip.id)),
      };
      return {
        ...c,
        trackId: d.trackId,
        start: Math.max(
          c.start - earliest,
          snap ? snapTime(t, snapProject, c.id, 8 / zoom) : t,
        ),
      };
    }
    if (d.mode === "left") {
      const wanted = snap
        ? snapTime(c.start + d.delta, project, c.id, 8 / zoom) - c.start
        : d.delta;
      const offset = Math.max(
        -c.start,
        ["video", "audio"].includes(c.kind) ? -c.sourceIn / c.speed : -c.start,
        Math.min(c.duration - minimum, wanted),
      );
      return {
        ...c,
        start: c.start + offset,
        duration: c.duration - offset,
        sourceIn: Math.max(0, c.sourceIn + offset * c.speed),
        animationOffset: (c.animationOffset ?? 0) + offset,
      };
    }
    const wanted = snap
      ? snapTime(c.start + c.duration + d.delta, project, c.id, 8 / zoom) -
        c.start
      : c.duration + d.delta;
    const maxDuration =
      asset && ["video", "audio"].includes(c.kind)
        ? (asset.duration - c.sourceIn) / c.speed
        : 86400;
    const duration = Math.max(minimum, Math.min(maxDuration, wanted));
    return { ...c, duration };
  }
  const timeFromEvent = (
    event:
      React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>,
  ) =>
    Math.max(
      0,
      Math.min(
        duration,
        (event.clientX - event.currentTarget.getBoundingClientRect().left) /
          zoom,
      ),
    );
  return (
    <section
      className={`timeline ${fileDrop ? "file-drag-active" : ""}`}
      onClick={() => context && setContext(null)}
      onContextMenuCapture={(event) => {
        if ((event.target as HTMLElement).closest(".clip-animations"))
          setContext(null);
      }}
    >
      <div className="timeline-toolbar">
        <div className="tool-group">
          <button title="撤销 Ctrl+Z" onClick={editor.undo}>
            <Undo2 size={17} />
          </button>
          <button title="重做 Ctrl+Shift+Z" onClick={editor.redo}>
            <Redo2 size={17} />
          </button>
          <span className="tool-divider" />
          <button
            title="在播放头处拆分（S）"
            disabled={!selected || !!locked}
            onClick={() =>
              selected &&
              apply((p) => splitSelection(p, editor.selectedIds, playhead))
            }
          >
            <Scissors size={17} />
          </button>
          <div className="delete-control" ref={deleteControl}>
            <button
              title="删除片段（Delete）"
              disabled={!editableSelection.length}
              onClick={() => deleteSelection()}
            >
              <Trash2 size={17} />
            </button>
            <button
              className="delete-dropdown"
              aria-label="删除选项"
              title="删除选项"
              aria-haspopup="menu"
              aria-expanded={deleteMenu}
              disabled={!editableSelection.length}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                setDeletePosition({
                  left: Math.max(
                    8,
                    Math.min(bounds.left, window.innerWidth - 245),
                  ),
                  top: Math.min(bounds.bottom + 5, window.innerHeight - 110),
                });
                setDeleteMenu(!deleteMenu);
              }}
            >
              <ChevronDown size={13} />
            </button>
            {deleteMenu &&
              createPortal(
                <div
                  ref={deletePopup}
                  className="context-menu toolbar-delete-menu"
                  style={deletePosition}
                  role="menu"
                  aria-label="删除菜单"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    role="menuitem"
                    disabled={!editableSelection.length}
                    onClick={() => deleteSelection()}
                  >
                    <Trash2 size={14} />
                    删除<span className="menu-shortcut">Delete</span>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!editableSelection.length}
                    onClick={() => deleteSelection(true)}
                  >
                    <Trash2 size={14} />
                    波纹删除<span className="menu-shortcut">Shift+Delete</span>
                  </button>
                </div>,
                document.body,
              )}
          </div>
          <button className="text-add" onClick={() => editor.addText()}>
            <Type size={17} />
            添加文本
          </button>
          <button
            className="keyframe-add"
            title="为选中的对象添加默认1秒动画关键帧"
            disabled={!canAddKeyframe}
            onClick={editor.addSelectedKeyframe}
          >
            <Diamond size={15} />
            添加关键帧
          </button>
          <button
            title="将当前画面截为图片并插入新轨道"
            disabled={dropDisabled}
            onClick={onCaptureFrame}
          >
            <Camera size={17} />
            截取当前帧
          </button>
          <button
            title="添加轨道"
            onClick={() =>
              apply((p) => ({
                ...p,
                tracks: [newTrack(p.tracks.length), ...p.tracks],
              }))
            }
          >
            <Plus size={17} />
          </button>
          <button
            title="添加标记"
            onClick={() =>
              apply((p) => ({
                ...p,
                markers: [
                  ...p.markers,
                  {
                    id: uid(),
                    time: playhead,
                    label: `标记 ${p.markers.length + 1}`,
                  },
                ],
              }))
            }
          >
            <Flag size={16} />
          </button>
        </div>
        <div className="tool-group">
          <button
            className={`auto-animation ${editor.autoAnimate ? "enabled" : ""}`}
            onClick={() => editor.setAutoAnimate(!editor.autoAnimate)}
            title="启用后，修改位置、缩放、不透明度会在播放头处生成关键帧"
          >
            <Diamond
              size={14}
              fill={editor.autoAnimate ? "currentColor" : "none"}
            />
            自动动画
            <span className="toggle-dot" />
          </button>
          <span className="tool-divider" />
          <button
            title="吸附"
            className={snap ? "active-tool" : ""}
            onClick={() => setSnap(!snap)}
          >
            <Magnet size={16} />
          </button>
          <button
            title="缩小时间线"
            onClick={() => setZoom((z) => Math.max(15, z / 1.3))}
          >
            <ZoomOut size={16} />
          </button>
          <input
            aria-label="时间线缩放"
            type="range"
            min="15"
            max="200"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <button
            title="放大时间线"
            onClick={() => setZoom((z) => Math.min(200, z * 1.3))}
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
      <div className="timeline-body">
        <div className="track-headers" ref={headers}>
          <div className="ruler-label">
            时间线 <span>{project.tracks.length} 轨</span>
          </div>
          {project.tracks.map((track, index) => (
            <div
              className={`track-header ${track.locked ? "locked" : ""}`}
              key={track.id}
            >
              <div>
                <span className="track-name">
                  {trackName(index, project.tracks.length)}
                </span>
              </div>
              <div className="track-controls">
                {(["hidden", "muted", "locked"] as const).map((key) => (
                  <button
                    key={key}
                    title={
                      key === "hidden"
                        ? "显示 / 隐藏轨道"
                        : key === "muted"
                          ? "轨道静音"
                          : "锁定 / 解锁轨道"
                    }
                    className={track[key] ? "active-tool" : ""}
                    onClick={() =>
                      apply((p) => ({
                        ...p,
                        tracks: p.tracks.map((t) =>
                          t.id === track.id ? { ...t, [key]: !t[key] } : t,
                        ),
                      }))
                    }
                  >
                    {key === "hidden" ? (
                      track.hidden ? (
                        <EyeOff size={13} />
                      ) : (
                        <Eye size={13} />
                      )
                    ) : key === "muted" ? (
                      track.muted ? (
                        <VolumeX size={13} />
                      ) : (
                        <Volume2 size={13} />
                      )
                    ) : track.locked ? (
                      <Lock size={13} />
                    ) : (
                      <Unlock size={13} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div
          className="timeline-scroll"
          ref={scroll}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return;
            event.preventDefault();
            const trackId = (event.target as HTMLElement).closest<HTMLElement>(
              ".track-lane",
            )?.dataset.track;
            const locked = project.tracks.find(
              (track) => track.id === trackId,
            )?.locked;
            event.dataTransfer.dropEffect =
              dropDisabled || locked ? "none" : "copy";
            if (dropDisabled || locked) {
              setFileDrop(null);
              return;
            }
            const seconds =
              (event.clientX -
                event.currentTarget.getBoundingClientRect().left +
                event.currentTarget.scrollLeft) /
              zoom;
            setFileDrop({
              time: Math.max(
                0,
                Math.round(seconds * project.canvas.fps) / project.canvas.fps,
              ),
              trackId,
            });
          }}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setFileDrop(null);
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.files.length) return;
            event.preventDefault();
            event.stopPropagation();
            setFileDrop(null);
            if (dropDisabled) return;
            const trackId = (event.target as HTMLElement).closest<HTMLElement>(
              ".track-lane",
            )?.dataset.track;
            const seconds =
              (event.clientX -
                event.currentTarget.getBoundingClientRect().left +
                event.currentTarget.scrollLeft) /
              zoom;
            onDropFiles(
              Array.from(event.dataTransfer.files),
              Math.max(
                0,
                Math.round(seconds * project.canvas.fps) / project.canvas.fps,
              ),
              trackId,
            );
          }}
          onScroll={(event) => {
            setViewport({
              left: event.currentTarget.scrollLeft,
              width: event.currentTarget.clientWidth,
            });
            if (headers.current)
              headers.current.scrollTop = event.currentTarget.scrollTop;
          }}
        >
          <div
            className="timeline-content"
            style={{ width, minHeight: project.tracks.length * 70 + 36 }}
          >
            <div
              className="ruler"
              onPointerDown={(event) => {
                seek(timeFromEvent(event));
                editor.setPlaying(false);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) seek(timeFromEvent(event));
              }}
            >
              {Array.from(
                {
                  length:
                    Math.ceil(
                      (viewport.width + 400) / zoom / (zoom < 40 ? 5 : 2),
                    ) + 1,
                },
                (_, i) =>
                  (Math.max(
                    0,
                    Math.floor(
                      (viewport.left - 200) / zoom / (zoom < 40 ? 5 : 2),
                    ),
                  ) +
                    i) *
                  (zoom < 40 ? 5 : 2),
              ).map((t) => (
                <span key={t} style={{ left: t * zoom }}>
                  {timeLabel(t).split(".")[0]}
                </span>
              ))}
              {project.markers.map((m) => (
                <button
                  key={m.id}
                  className="marker"
                  title={`${m.label}（右键删除）`}
                  style={{ left: m.time * zoom }}
                  onClick={(e) => {
                    e.stopPropagation();
                    seek(m.time);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    apply((p) => ({
                      ...p,
                      markers: p.markers.filter((x) => x.id !== m.id),
                    }));
                  }}
                >
                  <Flag size={12} fill="currentColor" />
                </button>
              ))}
              <div className="ruler-playhead" style={{ left: playhead * zoom }}>
                <span />
              </div>
            </div>
            {fileDrop && (
              <div
                className="external-drop-marker"
                style={{ left: fileDrop.time * zoom }}
              >
                <span>{timeLabel(fileDrop.time)} · 添加素材</span>
              </div>
            )}
            {project.tracks.map((track) => (
              <div
                key={track.id}
                className={`track-lane ${track.hidden ? "hidden-track" : ""} ${fileDrop?.trackId === track.id ? "external-drop-target" : ""}`}
                data-track={track.id}
                style={{ backgroundSize: `${zoom * 2}px 100%` }}
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    select(null);
                    seek(timeFromEvent(event));
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files.length) return;
                  if (track.locked) return;
                  const asset = project.assets.find(
                    (a) => a.id === e.dataTransfer.getData("framecraft-asset"),
                  );
                  if (!asset) return;
                  const start =
                    (e.clientX - e.currentTarget.getBoundingClientRect().left) /
                    zoom;
                  const clip: Clip = {
                    id: uid(),
                    trackId: track.id,
                    kind: asset.kind,
                    assetId: asset.id,
                    name: asset.name,
                    start: Math.max(0, start),
                    duration: asset.duration || 5,
                    sourceIn: 0,
                    speed: 1,
                    volume: 1,
                    podcast: false,
                    transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 },
                    keyframes: [],
                  };
                  apply((p) => ({ ...p, clips: [...p.clips, clip] }));
                  select(clip.id);
                }}
              >
                {project.clips
                  .filter(
                    (c) =>
                      c.trackId === track.id &&
                      (drag?.ids.includes(c.id) ||
                        ((c.start + c.duration) * zoom >= viewport.left - 200 &&
                          c.start * zoom <=
                            viewport.left + viewport.width + 200)),
                  )
                  .map((original) => {
                    const leader = drag ? dragClip(drag) : null;
                    const c =
                      drag?.id === original.id
                        ? leader!
                        : drag?.mode === "move" &&
                            drag.ids.includes(original.id) &&
                            !track.locked
                          ? {
                              ...original,
                              start:
                                original.start +
                                Math.max(
                                  -Math.min(
                                    ...project.clips
                                      .filter(
                                        (x) =>
                                          drag.ids.includes(x.id) &&
                                          !project.tracks.find(
                                            (t) => t.id === x.trackId,
                                          )?.locked,
                                      )
                                      .map((x) => x.start),
                                  ),
                                  leader!.start - drag.original.start,
                                ),
                            }
                          : original;
                    return (
                      <div
                        key={c.id}
                        className={`timeline-clip ${c.kind} ${animationRanges(c).length ? "has-animation" : ""} ${editor.selectedIds.includes(c.id) ? "selected" : ""} ${track.locked ? "locked" : ""}`}
                        style={{
                          left: c.start * zoom,
                          width: Math.max(4, c.duration * zoom),
                          translate:
                            drag?.id === c.id
                              ? `0 ${(project.tracks.findIndex((t) => t.id === drag.trackId) - project.tracks.findIndex((t) => t.id === original.trackId)) * 70}px`
                              : undefined,
                        }}
                        onPointerDown={(event) => {
                          if (event.button !== 0 || track.locked) return;
                          event.stopPropagation();
                          editor.clearKeyframeEdit();
                          if (
                            event.ctrlKey ||
                            event.metaKey ||
                            event.shiftKey
                          ) {
                            select(c.id, true);
                            return;
                          }
                          const ids = editor.selectedIds.includes(c.id)
                            ? editor.selectedIds
                            : selectionWithGroups(project, [c.id]);
                          if (!editor.selectedIds.includes(c.id)) select(c.id);
                          const mode = (event.target as HTMLElement).dataset
                            .trim as "left" | "right" | undefined;
                          event.currentTarget.setPointerCapture(
                            event.pointerId,
                          );
                          setDrag({
                            id: c.id,
                            mode: mode ?? "move",
                            x: event.clientX,
                            original,
                            delta: 0,
                            trackId: c.trackId,
                            ids,
                          });
                        }}
                        onPointerMove={(event) => {
                          if (!drag || drag.id !== c.id) return;
                          const hit = document
                            .elementFromPoint(event.clientX, event.clientY)
                            ?.closest<HTMLElement>("[data-track]");
                          const target = project.tracks.find(
                            (t) => t.id === hit?.dataset.track,
                          );
                          setDrag({
                            ...drag,
                            delta: (event.clientX - drag.x) / zoom,
                            trackId:
                              drag.mode === "move" &&
                              drag.ids.length === 1 &&
                              target &&
                              !target.locked
                                ? target.id
                                : drag.trackId,
                          });
                        }}
                        onPointerUp={() => {
                          if (drag) {
                            const next = dragClip(drag);
                            if (drag.mode === "move" && drag.ids.length > 1)
                              apply((p) =>
                                moveClips(
                                  p,
                                  drag.ids,
                                  next.start - drag.original.start,
                                ),
                              );
                            else editor.updateClip(drag.id, next);
                          }
                          setDrag(null);
                        }}
                        onPointerCancel={() => setDrag(null)}
                        onDoubleClick={(event) => {
                          if (c.kind !== "text" || track.locked) return;
                          event.stopPropagation();
                          setDrag(null);
                          editor.beginTextEdit(c.id);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!editor.selectedIds.includes(c.id)) select(c.id);
                          setContext({
                            x: Math.min(event.clientX, window.innerWidth - 210),
                            y: Math.min(
                              event.clientY,
                              window.innerHeight - 280,
                            ),
                            id: c.id,
                          });
                        }}
                      >
                        <span className="trim-handle left" data-trim="left" />
                        <div className="clip-label">
                          {c.kind === "text" ? (
                            <Type size={13} />
                          ) : c.kind === "audio" ? (
                            <Volume2 size={13} />
                          ) : (
                            <span className="clip-media-icon">▣</span>
                          )}
                          <span>
                            {c.groupId ? "▧ " : ""}
                            {c.name}
                          </span>
                          {c.speed !== 1 && <b>{c.speed}×</b>}
                        </div>
                        <div className="clip-detail">
                          {c.kind === "text"
                            ? c.text
                            : `${timeLabel(c.duration)}${c.podcast ? " · 播客人声" : ""}`}
                        </div>
                        {c.assetId &&
                          project.assets.find((a) => a.id === c.assetId)
                            ?.hasAudio &&
                          (() => {
                            const asset = project.assets.find(
                              (a) => a.id === c.assetId,
                            )!;
                            return (
                              <div className="clip-waveform">
                                <MediaThumbnail
                                  asset={asset}
                                  waveform
                                  style={{
                                    width: `${Math.max(c.duration, asset.duration / c.speed) * zoom}px`,
                                    left: `${(-c.sourceIn / c.speed) * zoom}px`,
                                  }}
                                />
                              </div>
                            );
                          })()}
                        <TimelineAnimations
                          clip={c}
                          zoom={zoom}
                          playhead={playhead}
                          fps={project.canvas.fps}
                          selected={editor.selectedIds.includes(c.id)}
                          selectedFrame={
                            editor.selectedKeyframe?.clipId === c.id
                              ? editor.selectedKeyframe
                              : null
                          }
                          locked={track.locked}
                          copy={(range, cut) =>
                            onCopyAnimation(c.id, range, cut)
                          }
                          remove={(range) =>
                            editor.deleteAnimation(c.id, range)
                          }
                          commit={(clip) =>
                            editor.updateClip(c.id, (current) => ({
                              ...current,
                              transform: clip.transform,
                              keyframes: clip.keyframes,
                            }))
                          }
                          locate={(time, side) => {
                            if (track.locked) {
                              editor.setPlaying(false);
                              select(c.id);
                              seek(time);
                            } else
                              editor.editKeyframe(c.id, time - c.start, side);
                          }}
                        />
                        <span className="trim-handle right" data-trim="right" />
                      </div>
                    );
                  })}
              </div>
            ))}
            <div className="playhead" style={{ left: playhead * zoom }}>
              <i />
            </div>
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span>
          空格 播放 / 暂停<span className="separator-dot">·</span>S 拆分
          <span className="separator-dot">·</span>右键动画 编辑动画
        </span>
        <span>
          {project.clips.length} 个片段 · 已选 {editor.selectedIds.length} ·{" "}
          {timeLabel(projectDuration(project))}
        </span>
      </div>
      {context && (
        <div
          className="context-menu"
          style={{ left: context.x, top: context.y }}
          onClick={() => setContext(null)}
        >
          <button
            onClick={() => {
              apply((p) => deleteClips(p, editor.selectedIds, true));
              select(null);
            }}
          >
            <Trash2 size={14} />
            波纹删除选中片段
          </button>
          <button
            onClick={() =>
              apply((p) => groupSelection(p, editor.selectedIds, true))
            }
          >
            解除组合
          </button>
          <button onClick={() => duplicate(context.id)}>
            <Copy size={14} />
            复制片段
          </button>
          <button
            onClick={() => apply((p) => splitClip(p, context.id, playhead))}
          >
            <Scissors size={14} />
            在播放头拆分
          </button>
          <button onClick={() => remove(context.id)}>
            <Trash2 size={14} />
            删除片段
          </button>
        </div>
      )}
    </section>
  );
}
