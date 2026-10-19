import { trimClip } from "../shared/clip-trim";
import {
  TimelineRangeHandles,
  TimelineRangeOverlay,
} from "./TimelineRangeSelection";
import {
  libraryAssetMime,
  libraryAssetDragSchema,
  type LibraryAssetDrag,
} from "../shared/asset-libraries";
import {
  type CSSProperties,
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
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
  Flag,
  ChevronDown,
  Camera,
  ChevronUp,
  MonitorDot,
} from "lucide-react";
import {
  type Clip,
  type Marker,
  type Project,
  projectDuration,
  uid,
  newTrack,
} from "../shared/model";
import {
  createMarker,
  markerEnd,
  markerFrameTime,
  putMarker,
  removeMarker,
} from "../shared/markers";
import TimelineMarkers from "./TimelineMarkers";
import MarkerDialog from "./MarkerDialog";
import { snapTime, splitClip, transformAt } from "../shared/editor";
import { editableCanvasIds } from "../shared/canvas-actions";
import { mediaSegments, stitchBoundaries } from "../shared/media-segments";
import {
  moveClips,
  splitSelection,
  selectionWithGroups,
  clipsInTimelineRange,
  editableIds,
} from "../shared/timeline";
import { MediaThumbnail } from "./MediaThumbnail";
import { TimelineAnimations } from "./TimelineAnimations";
import {
  animationRanges,
  drawingAnimationRanges,
  type AnimationRange,
} from "../shared/animation-ranges";
import { useEditorPlayhead, type Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import { hasClipSpeed, supportsClipSpeed } from "../shared/clip-speed";
import { supportsMediaFrame } from "../shared/media-frame";
import {
  supportsVisualEffect,
  visualEffectFromDragTypes,
  type VisualEffectId,
} from "../shared/visual-effect-drag";
import TimelineSpeedEffect from "./TimelineSpeedEffect";
import TimelineVisualEffect from "./TimelineVisualEffect";
import { visualEffectEntries } from "../shared/visual-effect-range";
import TimelineBehaviorEffect from "./TimelineBehaviorEffect";
import BehaviorContextMenu from "./BehaviorContextMenu";
import { hasBehaviors, supportsBehaviors } from "../shared/behaviors";
import { annotationMime, parseAnnotation } from "../shared/annotations";
import TimelineTransitions from "./TimelineTransitions";
import {
  transitionMime,
  transitionDropTarget,
  transitionTargets,
  transitionTypeSchema,
  type TransitionTarget,
} from "../shared/transitions";
import {
  captionTrackSelection,
  convertCaptionsToText,
  mergeWithPreviousCaption,
  previousCaption,
} from "../shared/captions";
import {
  defaultTrackHeight,
  displayTrackName,
  isTrackActive,
  minTrackHeight,
  maxTrackHeight,
  setTrackHeight,
  toggleTrack,
} from "../shared/tracks";
import TrackResizeHandle from "./TrackResizeHandle";
import TrackContextMenu, { type TrackMenuPosition } from "./TrackContextMenu";
import ClipContextMenu, { type ClipCommand } from "./ClipContextMenu";
import { useViewportZoom } from "./useViewportZoom";
import { useRAFThrottle } from "./hooks/useRAFThrottle";
import { usePerformanceMonitor } from "./hooks/usePerformanceMonitor";
import {
  animationMime,
  customAnimationId,
  animationDropTarget,
} from "../shared/animation-drag";
import { projectIndex } from "../shared/project-index";
import {
  recordingGroups,
  trimRecordingObject,
} from "../shared/recording-objects";
import { groupName, groupedTimeline, rootGroupId } from "../shared/clip-groups";
import GroupTimelineNavigation from "./GroupTimelineNavigation";
import TimelineGroupClip from "./TimelineGroupClip";
import {
  constrainTimelineMove,
  timelineTrimBounds,
} from "../shared/timeline-collision";
import {
  timelineZoomMax,
  timelineFitZoom,
  timelineZoomFromPercent,
  timelineZoomPercent,
  timelineZoomScroll,
  timelineRulerStep,
  timelineRulerLabel,
} from "../shared/timeline-scale";

interface Drag {
  id: string;
  mode: "move" | "left" | "right";
  x: number;
  original: Clip;
  delta: number;
  trackId: string;
  ids: string[];
}
interface Marquee {
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  baseIds: string[];
}

function TimelinePlayheadCursor({
  editor,
  zoom,
}: {
  editor: Editor;
  zoom: number;
}) {
  const playhead = useEditorPlayhead(editor);
  const style = { transform: `translateX(${playhead * zoom}px)` };
  return (
    <div className="playhead" style={style}>
      <i />
    </div>
  );
}

function TimelineAddAnimationButton({
  editor,
  project,
  editableSelection,
  animationIds,
}: {
  editor: Editor;
  project: Project;
  editableSelection: Clip[];
  animationIds: Set<string>;
}) {
  const playhead = useEditorPlayhead(editor);
  const enabled = editableSelection.some(
    (clip) =>
      animationIds.has(clip.id) &&
      clip.kind !== "audio" &&
      !project.tracks.find((track) => track.id === clip.trackId)?.hidden &&
      playhead >= clip.start &&
      playhead <= clip.start + clip.duration,
  );
  return (
    <button
      className="keyframe-add"
      title={`为选中的对象添加默认 ${editor.preferences.timing.animation} 秒动画`}
      disabled={!enabled}
      onClick={() => editor.addSelectedAnimation()}
    >
      <Diamond size={15} />
      添加动画
    </button>
  );
}

export default function Timeline({
  editor,
  onCopyAnimation,
  onDropFiles,
  onDropLibraryAsset,
  onCaptureFrame,
  onCommand,
  dropDisabled = false,
}: {
  editor: Editor;
  onCopyAnimation: (
    clipId: string,
    range: AnimationRange,
    cut?: boolean,
  ) => void;
  onDropFiles: (files: File[], time: number, trackId?: string) => void;
  onDropLibraryAsset: (
    asset: LibraryAssetDrag,
    time: number,
    trackId?: string,
  ) => void;
  onCaptureFrame: () => void;
  onCommand: (command: ClipCommand) => void;
  dropDisabled?: boolean;
}) {
  // Performance monitoring in development
  usePerformanceMonitor("Timeline");

  const { project, apply, seek, selected, selectedId, select } = editor;
  const timeline = useMemo(
    () => groupedTimeline(project),
    [project.clips, project.tracks, project.groups],
  );
  const timelineTracks = timeline.tracks;
  const recordingObjects = useMemo(
    () => recordingGroups(project),
    [project.clips],
  );
  const assetsById = useMemo(
    () => new Map(project.assets.map((asset) => [asset.id, asset])),
    [project.assets],
  );
  const [zoom, setZoom] = useState(65),
    [snap, setSnap] = useState(true),
    [drag, setDrag] = useState<Drag | null>(null),
    [context, setContext] = useState<{
      x: number;
      y: number;
      id: string;
      stitchTime?: number;
    } | null>(null);

  // RAF-throttled drag updates for smooth 60fps performance
  const scheduleDragUpdate = useRAFThrottle<Drag | null>(setDrag);
  const panel = useRef<HTMLElement>(null);
  useEffect(
    () => setSnap(editor.preferences.program.snapping),
    [editor.preferences.program.snapping, project.id],
  );
  const zoomAnchor = useRef<number | null>(null);
  const [viewport, setViewport] = useState({
    left: 0,
    width: 0,
    top: 0,
    height: 300,
  });
  const scroll = useRef<HTMLDivElement>(null),
    duration = useMemo(
      () =>
        project.markers.reduce(
          (end, marker) => Math.max(end, markerEnd(marker) + 5),
          Math.max(20, projectDuration(project) + 5),
        ),
      [project.clips, project.markers],
    ),
    // The overlay handles no longer extend the scroll pane's intrinsic width.
    width = duration * zoom + 19;
  const [rangeHandleContainer, setRangeHandleContainer] =
    useState<HTMLDivElement | null>(null);
  const syncRangeHandles = useCallback((element: HTMLDivElement) => {
    if (!rangeHandleContainer) return;
    // Match native scrolling immediately; React's viewport update can follow.
    rangeHandleContainer.style.transform = `translateX(${-element.scrollLeft}px)`;
    rangeHandleContainer.parentElement!.style.width = `${element.clientWidth}px`;
  }, [rangeHandleContainer]);
  const revealRangeTime = useCallback((time: number) => {
    const element = scroll.current;
    if (!element) return;
    const x = time * zoom;
    if (x - 19 < element.scrollLeft)
      element.scrollLeft = Math.max(0, x - 19);
    else if (x + 19 > element.scrollLeft + element.clientWidth)
      element.scrollLeft = x + 19 - element.clientWidth;
    syncRangeHandles(element);
  }, [zoom, syncRangeHandles]);
  const minimumZoom = timelineFitZoom(duration, viewport.width);
  const maximumZoom = Math.max(minimumZoom, timelineZoomMax);
  const changeZoom = useCallback((next: number) => {
    const element = scroll.current;
    next = Math.max(minimumZoom, Math.min(maximumZoom, next));
    if (next === zoom) return;
    if (element) {
      zoomAnchor.current = timelineZoomScroll(
        editor.playback.getSnapshot(),
        zoom,
        next,
        element.scrollLeft,
        element.clientWidth,
      );
    }
    setZoom(next);
  }, [minimumZoom, maximumZoom, zoom, editor.playback]);
  useViewportZoom(panel, (factor) => changeZoom(zoom * factor));
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    if (scroll.current && anchor !== null) {
      scroll.current.scrollLeft = anchor;
      zoomAnchor.current = null;
    }
  }, [zoom]);
  useLayoutEffect(() => {
    if (zoom < minimumZoom || zoom > maximumZoom) changeZoom(zoom);
  }, [minimumZoom, maximumZoom, zoom, changeZoom]);
  useLayoutEffect(() => {
    const element = scroll.current;
    if (element && editor.timelineFocus) {
      element.scrollLeft = Math.max(
        0,
        editor.timelineFocus.time * zoom - element.clientWidth / 2,
      );
    }
  }, [editor.timelineFocus]);
  const [trackMenu, setTrackMenu] = useState<TrackMenuPosition | null>(null);
  const [markerEditor, setMarkerEditor] = useState<Marker | null>(null);
  const [markerRange, setMarkerRange] = useState<{
    pointerId: number;
    start: number;
    end: number;
  } | null>(null);
  useEffect(() => {
    setMarkerEditor(null);
    setMarkerRange(null);
  }, [project.id]);
  useEffect(() => {
    if (!markerRange) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMarkerRange(null);
    };
    window.addEventListener("keydown", cancel, true);
    return () => window.removeEventListener("keydown", cancel, true);
  }, [markerRange?.pointerId]);
  const editMarker = (marker: Marker) => {
    editor.setPlaying(false);
    setMarkerEditor(marker);
  };
  const addMarker = (start: number, end = start) =>
    editMarker(
      createMarker(
        markerFrameTime(Math.min(start, end), project.canvas.fps),
        `标记 ${project.markers.length + 1}`,
        markerFrameTime(Math.abs(end - start), project.canvas.fps),
      ),
    );
  const [fileDrop, setFileDrop] = useState<{
    time: number;
    trackId?: string;
  } | null>(null);
  const [expandedEffects, setExpandedEffects] = useState<
    Record<string, boolean>
  >({});
  const [speedDraft, setSpeedDraft] = useState<Clip | null>(null);
  const [visualDraft, setVisualDraft] = useState<Clip | null>(null);
  const activeVisual = editor.selectedVisualEffect;
  const [activeSpeed, setActiveSpeed] = useState<string | null>(null);
  const [effectDrop, setEffectDrop] = useState<string | null>(null);
  const [animationDrop, setAnimationDrop] = useState<{
    clipId: string;
    start: number;
    end: number;
  } | null>(null);
  useEffect(() => {
    if (!animationDrop && !effectDrop) return;
    const clear = () => {
      setAnimationDrop(null);
      setEffectDrop(null);
    };
    window.addEventListener("dragend", clear, true);
    window.addEventListener("drop", clear, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragend", clear, true);
      window.removeEventListener("drop", clear, true);
      window.removeEventListener("blur", clear);
    };
  }, [animationDrop?.clipId, effectDrop]);
  const animationAtPointer = (
    clip: Clip,
    event: React.DragEvent<HTMLDivElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const localTime = Math.max(
      0,
      Math.min(clip.duration, (event.clientX - bounds.left) / zoom),
    );
    return dropDisabled
      ? null
      : animationDropTarget(
          project,
          clip.id,
          clip.start + localTime,
          editor.preferences.timing.animation,
        );
  };
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const marqueeMoved = useRef(false);

  // RAF-throttled marquee updates for smooth selection
  const scheduleMarqueeUpdate = useRAFThrottle<Marquee | null>(setMarquee);
  const [transitionDrop, setTransitionDrop] = useState<TransitionTarget | null>(
    null,
  );
  const transitionHighlights = transitionDrop
    ? transitionTargets(transitionDrop)
    : [];
  const knownEffects = useRef(new Set<string>());
  useEffect(() => {
    const entries = project.clips.flatMap((clip) =>
      [
        ...(hasClipSpeed(clip) ? ["speed"] : []),
        ...(clip.behaviors ?? []).map((behavior) => `behavior:${behavior.id}`),
        ...visualEffectEntries(clip).map(({ id }) => `visual:${id}`),
      ].map((effect) => ({ key: `${clip.id}:${effect}`, clipId: clip.id })),
    );
    const added = entries.filter(({ key }) => !knownEffects.current.has(key));
    knownEffects.current = new Set(entries.map(({ key }) => key));
    if (added.length)
      setExpandedEffects((previous) => ({
        ...previous,
        ...Object.fromEntries(added.map(({ clipId }) => [clipId, true])),
      }));
  }, [project.clips]);
  const [trackHeightDraft, setTrackHeightDraft] = useState<{
    projectId: string;
    trackId: string;
    height: number;
  } | null>(null);
  const trackLayouts = useMemo(() => {
    const rows = new Map<string, number>();
    for (const clip of timeline.clips) {
      if (timeline.groups.has(clip.id)) continue;
      if (expandedEffects[clip.id]) {
        const count =
          Number(hasClipSpeed(clip)) +
          (clip.behaviors?.length ?? 0) +
          visualEffectEntries(clip).length;
        rows.set(clip.trackId, Math.max(rows.get(clip.trackId) ?? 0, count));
      }
    }
    return timelineTracks.map((track) => {
      const baseHeight = Math.max(
        minTrackHeight,
        trackHeightDraft?.projectId === project.id &&
          trackHeightDraft.trackId === track.id
          ? trackHeightDraft.height
          : (track.height ?? defaultTrackHeight),
      );
      const compact = baseHeight < 56;
      const clipInset = compact ? 4 : 9;
      return {
        baseHeight,
        minHeight: minTrackHeight,
        compact,
        clipInset,
        contentHeight: baseHeight - 2 * clipInset - 4,
        height: baseHeight + 24 * (rows.get(track.id) ?? 0),
      };
    });
  }, [
    project.id,
    project.clips,
    project.tracks,
    timeline,
    timelineTracks,
    expandedEffects,
    trackHeightDraft,
  ]);
  const trackHeights = trackLayouts.map((layout) => layout.height);
  const changeTrackZoom = (factor: number) => {
    // Commit all lanes together so one zoom click is one undo step.
    apply((project) =>
      timelineTracks.reduce(
        (next, track, index) =>
          setTrackHeight(
            next,
            track.id,
            Math.max(
              trackLayouts[index].minHeight,
              trackLayouts[index].baseHeight * factor,
            ),
          ),
        project,
      ),
    );
  };
  const layoutKey = trackHeights.join(",");
  const trackTop = (id: string) => {
    const index = timelineTracks.findIndex((track) => track.id === id);
    return trackHeights
      .slice(0, Math.max(0, index))
      .reduce((sum, height) => sum + height, 0);
  };
  const marqueeSelection = (next: Marquee) => {
    const left = Math.min(next.startX, next.x);
    const right = Math.max(next.startX, next.x);
    const top = Math.min(next.startY, next.y);
    const bottom = Math.max(next.startY, next.y);
    const trackIds = timelineTracks.flatMap((track, index) => {
      const inset = trackLayouts[index].clipInset;
      const clipTop = 36 + trackTop(track.id) + inset - 1;
      const clipBottom = 36 + trackTop(track.id) + trackHeights[index] - inset;
      return clipTop <= bottom && clipBottom >= top ? [track.id] : [];
    });
    const hits = clipsInTimelineRange(
      { ...project, clips: timeline.clips },
      left / zoom,
      right / zoom,
      trackIds,
    );
    return [
      ...new Set([...next.baseIds, ...selectionWithGroups(project, hits)]),
    ];
  };
  const selectSpeed = (id: string) => {
    editor.clearKeyframeEdit();
    editor.setPlaying(false);
    select(id);
    editor.setSelectedVisualEffect(null);
    setActiveSpeed(id);
  };
  useEffect(() => {
    if (editor.selectedBehavior)
      setExpandedEffects((previous) => ({
        ...previous,
        [editor.selectedBehavior!.clipId]: true,
      }));
  }, [editor.selectedBehavior?.clipId, editor.selectedBehavior?.behaviorId]);
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
  const editableSelection = useMemo(() => {
    const ids = new Set(editor.selectedIds);
    const lockedTracks = new Set(
      project.tracks.filter((track) => track.locked).map((track) => track.id),
    );
    return project.clips.filter(
      (clip) => ids.has(clip.id) && !lockedTracks.has(clip.trackId),
    );
  }, [project.clips, project.tracks, editor.selectedIds]);
  const animationIds = useMemo(
    () => editableCanvasIds(project, editor.selectedIds),
    [project.clips, project.tracks, editor.selectedIds],
  );
  const deleteSelection = (ripple = false) => {
    if (editor.deleteTimeSelection(ripple)) {
      setDeleteMenu(false);
      return;
    }
    if (editor.selectedTransition) {
      editor.updateTransition(editor.selectedTransition, null);
      setDeleteMenu(false);
      return;
    }
    if (editor.selectedBehavior) {
      editor.removeBehavior(
        editor.selectedBehavior.clipId,
        editor.selectedBehavior.behaviorId,
      );
      setDeleteMenu(false);
      return;
    }
    editor.deleteSelectedClips(ripple);
    setDeleteMenu(false);
  };
  const selectedTrackId = selected && (
    timeline.clips.find((clip) =>
      timeline.groups.get(clip.id)?.members.some((member) => member.id === selected.id),
    )?.trackId ?? selected.trackId
  );
  useEffect(() => {
    if (trackHeightDraft?.projectId === project.id) return;
    const element = scroll.current;
    const index = timelineTracks.findIndex(
      (track) => track.id === selectedTrackId,
    );
    if (!element || index < 0) return;
    const height = trackHeights[index];
    const top = 36 + trackTop(selectedTrackId!);
    if (top < element.scrollTop + 36) element.scrollTop = Math.max(0, top - 36);
    else if (top + height > element.scrollTop + element.clientHeight)
      element.scrollTop = top + height - element.clientHeight;
  }, [selectedTrackId, project.tracks.length, layoutKey, trackHeightDraft]);
  const trackOffsets = useMemo(() => {
    let top = 36;
    return trackHeights.map((height) => {
      const offset = top;
      top += height;
      return offset;
    });
  }, [layoutKey]);
  const rulerStep = timelineRulerStep(zoom, project.canvas.fps);
  const rulerTicks = useMemo(() => {
    const count = Math.ceil((viewport.width + 400) / zoom / rulerStep) + 1;
    const start = Math.max(
      0,
      Math.floor((viewport.left - 200) / zoom / rulerStep),
    );
    return Array.from({ length: count }, (_, i) => (start + i) * rulerStep)
      .filter((time) => time * zoom < Math.max(viewport.width, width) - 60);
  }, [viewport.left, viewport.width, zoom, rulerStep, width]);
  const visibleClips = useMemo(() => {
    const index = projectIndex({ clips: timeline.clips });
    return new Map(
      timelineTracks.map((track, indexInView) => {
        // Keep track shells at their real heights so scrolling, selection and
        // drops retain their geometry, but don't mount offscreen SVG editors.
        const outside =
          trackOffsets[indexInView] + trackHeights[indexInView] < viewport.top - 100 ||
          trackOffsets[indexInView] > viewport.top + viewport.height + 100;
        const pinned = drag?.ids.some(
          (id) => index.clipsById.get(id)?.trackId === track.id,
        );
        return [
          track.id,
          outside && !pinned
            ? []
            : index
                .visible(
                  track.id,
                  (viewport.left - 200) / zoom,
                  (viewport.left + viewport.width + 200) / zoom,
                  drag?.ids,
                )
                .filter((clip) => !timeline.hidden.has(clip.id)),
        ];
      }),
    );
  }, [project.clips, project.tracks, timeline, viewport, zoom, drag?.ids, trackOffsets]);
  const selectedIdSet = useMemo(
    () => new Set(editor.selectedIds),
    [editor.selectedIds],
  );
  useLayoutEffect(() => {
    const element = scroll.current;
    const labels = headers.current;
    if (!element || !labels) return;
    const syncGeometry = () => {
      syncRangeHandles(element);
      // The clip pane's horizontal scrollbar shortens its vertical viewport.
      // Reserve the same space on the labels so both scroll ranges stay equal.
      labels.style.paddingBottom = `${element.offsetHeight - element.clientHeight}px`;
      labels.scrollTop = element.scrollTop;
      setViewport({
        left: element.scrollLeft,
        width: element.clientWidth,
        top: element.scrollTop,
        height: element.clientHeight,
      });
    };
    syncGeometry();
    const observer = new ResizeObserver(syncGeometry);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layoutKey, width, syncRangeHandles]);
  const locked =
    selected && project.tracks.find((t) => t.id === selected.trackId)?.locked;
  function selectedCaptions(id: string) {
    const ids = editor.selectedIds.includes(id) ? editor.selectedIds : [id];
    return project.clips.filter(
      (clip) => clip.caption && ids.includes(clip.id),
    );
  }
  function convertCaptionSelection(id: string) {
    const result = convertCaptionsToText(
      project,
      selectedCaptions(id).map((clip) => clip.id),
    );
    apply(result.project);
    editor.selectMany(result.ids);
  }
  function mergeCaption(id: string) {
    const result = mergeWithPreviousCaption(project, id);
    apply(result.project);
    if (result.selectedId) select(result.selectedId);
  }
  function dragClip(d: Drag): Clip {
    const c = d.original,
      asset = c.assetId ? assetsById.get(c.assetId) : undefined,
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
      const wanted = Math.max(
        c.start - earliest,
        snap ? snapTime(t, snapProject, c.id, 8 / zoom) : t,
      );
      const offset = constrainTimelineMove(
        project, d.ids, wanted - c.start,
        d.ids.length === 1 ? d.trackId : undefined,
      );
      return {
        ...c,
        trackId: d.trackId,
        start: c.start + offset,
      };
    }
    if (d.mode === "left") {
      const wanted = snap
        ? snapTime(c.start + d.delta, project, c.id, 8 / zoom) - c.start
        : d.delta;
      return trimClip(
        c, asset, "left",
        Math.max(wanted, timelineTrimBounds(project, c.id).start - c.start),
        project.canvas.fps,
      );
    }
    const wanted = snap
      ? snapTime(c.start + c.duration + d.delta, project, c.id, 8 / zoom) -
        c.start
      : c.duration + d.delta;
    return trimClip(
      c, asset, "right",
      Math.min(wanted, timelineTrimBounds(project, c.id).end - c.start),
      project.canvas.fps,
    );
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
      ref={panel}
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
            title="在播放头处拆分（Ctrl/⌘+K）"
            disabled={!selected || !!locked}
            onClick={() =>
              selected &&
              apply((p) =>
                splitSelection(p, editor.selectedIds, editor.playhead),
              )
            }
          >
            <Scissors size={17} />
          </button>
          <div className="delete-control" ref={deleteControl}>
            <button
              title={editor.timelineRange
                ? "删除所选范围（Delete）"
                : "删除片段（Delete）"}
              disabled={!editableSelection.length && !editor.timelineRange}
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
              disabled={!editableSelection.length && !editor.timelineRange}
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
                    disabled={!editableSelection.length && !editor.timelineRange}
                    onClick={() => deleteSelection()}
                  >
                    <Trash2 size={14} />
                    删除<span className="menu-shortcut">Delete</span>
                  </button>
                  <button
                    role="menuitem"
                    disabled={!editableSelection.length && !editor.timelineRange}
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
          <TimelineAddAnimationButton
            editor={editor}
            project={project}
            editableSelection={editableSelection}
            animationIds={animationIds}
          />
          <button
            title="将当前画面截为图片并插入新轨道"
            disabled={dropDisabled}
            onClick={onCaptureFrame}
          >
            <Camera size={17} />
            截取当前帧
          </button>
          <button
            title="添加区域标记（Shift+拖动标尺）"
            onClick={() => {
              const clips = project.clips.filter((clip) =>
                editor.selectedIds.includes(clip.id),
              );
              const start = clips.length
                ? Math.min(...clips.map((clip) => clip.start))
                : editor.playhead;
              const end = clips.length
                ? Math.max(...clips.map((clip) => clip.start + clip.duration))
                : editor.playhead + 1;
              addMarker(start, end);
            }}
          >
            <Flag size={16} />
            区域标记
          </button>
        </div>
        <div className="tool-group">
          <button
            className={`auto-animation ${editor.autoAnimate ? "enabled" : ""}`}
            onClick={() => editor.setAutoAnimate(!editor.autoAnimate)}
            title="启用后，修改位置、缩放、不透明度或遮罩区域，会在播放头处生成关键帧"
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
          <button title="缩小时间线" onClick={() => changeZoom(zoom / 1.3)}>
            <ZoomOut size={16} />
          </button>
          <input
            aria-label="时间线缩放"
            title="以播放头为中心缩放：Ctrl/⌘ + 加减号，或 Ctrl/⌘ + 滚轮；最小档显示完整时间轴"
            aria-valuetext={`显示完整时间轴的 ${Number(Math.min(100, minimumZoom / zoom * 100).toFixed(2))}%`}
            data-pixels-per-second={zoom}
            data-min-zoom={minimumZoom}
            type="range"
            min={0}
            max={100}
            step="any"
            value={timelineZoomPercent(zoom, minimumZoom)}
            onChange={(e) => changeZoom(
              timelineZoomFromPercent(Number(e.target.value), minimumZoom),
            )}
          />
          <button title="放大时间线" onClick={() => changeZoom(zoom * 1.3)}>
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
      <GroupTimelineNavigation editor={editor} />
      <div className="timeline-body">
        <div className="timeline-ruler-overlay">
          <div className="timeline-range-handle-scroll" ref={setRangeHandleContainer} />
        </div>
        <div
          className="track-headers"
          ref={headers}
          onScroll={(event) => {
            if (scroll.current)
              scroll.current.scrollTop = event.currentTarget.scrollTop;
          }}
        >
          <div className="ruler-label track-header-toolbar">
            <span title={`共 ${timelineTracks.length} 条轨道`}>
              {timelineTracks.length} 轨
            </span>
            <div
              className="track-header-tools"
              role="group"
              aria-label="轨道操作"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                title="缩小轨道高度"
                aria-label="缩小轨道高度"
                disabled={
                  !trackLayouts.some(
                    (layout) => layout.baseHeight > layout.minHeight,
                  )
                }
                onClick={() => changeTrackZoom(1 / 1.25)}
              >
                <ZoomOut size={15} />
              </button>
              <button
                type="button"
                title="放大轨道高度"
                aria-label="放大轨道高度"
                disabled={
                  !trackLayouts.some(
                    (layout) => layout.baseHeight < maxTrackHeight,
                  )
                }
                onClick={() => changeTrackZoom(1.25)}
              >
                <ZoomIn size={15} />
              </button>
              <button
                type="button"
                className="track-add"
                title="添加轨道"
                aria-label="添加轨道"
                disabled={project.tracks.length >= 128}
                onClick={() =>
                  apply((project) => ({
                    ...project,
                    tracks: [
                      newTrack(project.tracks.length),
                      ...project.tracks,
                    ],
                  }))
                }
              >
                <Plus size={17} />
              </button>
            </div>
          </div>
          {timelineTracks.map((track, index) => (
            <div
              className={`track-header ${trackLayouts[index].compact ? "compact-track" : ""} ${track.locked ? "locked" : ""} ${track.captionTrack ? "caption-track" : ""} ${track.solo ? "solo-track" : ""} ${project.tracks.some((item) => item.solo) && !track.solo ? "inactive-solo-track" : ""}`}
              key={`${project.id}-${track.id}`}
              data-track-id={track.id}
              style={{ height: trackHeights[index] }}
              onContextMenu={(event) => {
                event.preventDefault();
                setContext(null);
                setTrackMenu({
                  trackId: track.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onClick={(event) => {
                if (
                  track.captionTrack &&
                  !(event.target as HTMLElement).closest("button")
                )
                  editor.selectCaptionTrack(track.id, editor.playhead);
              }}
            >
              <div>
                <span
                  className="track-name"
                  title={displayTrackName(timelineTracks, track.id)}
                >
                  {displayTrackName(timelineTracks, track.id)}
                </span>
                {track.solo && (
                  <span className="track-solo-badge" title="独奏轨道">
                    S
                  </span>
                )}
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
                    onClick={() => apply((p) => toggleTrack(p, track.id, key))}
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
              <TrackResizeHandle
                name={displayTrackName(timelineTracks, track.id)}
                height={trackLayouts[index].baseHeight}
                minHeight={trackLayouts[index].minHeight}
                preview={(height) =>
                  setTrackHeightDraft(
                    height === null
                      ? null
                      : { projectId: project.id, trackId: track.id, height },
                  )
                }
                commit={(height) =>
                  apply((project) => setTrackHeight(project, track.id, height))
                }
              />
            </div>
          ))}
        </div>
        <div
          className="timeline-scroll"
          ref={scroll}
          onClick={(event) => {
            if (event.target === event.currentTarget) select(null);
          }}
          onDragOver={(event) => {
            if (
              !event.dataTransfer.types.includes("Files") &&
              !event.dataTransfer.types.includes(libraryAssetMime)
            ) return;
            event.preventDefault();
            const trackId = (event.target as HTMLElement).closest<HTMLElement>(
              ".track-lane",
            )?.dataset.track;
            const destination = project.tracks.find(
              (track) => track.id === trackId,
            );
            const blocked = destination?.locked || destination?.captionTrack;
            event.dataTransfer.dropEffect =
              dropDisabled || blocked ? "none" : "copy";
            if (dropDisabled || blocked) {
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
            const libraryData = event.dataTransfer.getData(libraryAssetMime);
            if (!event.dataTransfer.files.length && !libraryData) return;
            event.preventDefault();
            event.stopPropagation();
            setFileDrop(null);
            if (dropDisabled) return;
            const trackId = (event.target as HTMLElement).closest<HTMLElement>(
              ".track-lane",
            )?.dataset.track;
            if (
              project.tracks.find((track) => track.id === trackId)?.captionTrack ||
              project.tracks.find((track) => track.id === trackId)?.locked
            )
              return;
            const seconds =
              (event.clientX -
                event.currentTarget.getBoundingClientRect().left +
                event.currentTarget.scrollLeft) /
              zoom;
            const time = Math.max(
              0,
              Math.round(seconds * project.canvas.fps) / project.canvas.fps,
            );
            if (libraryData) {
              try {
                const result = libraryAssetDragSchema.safeParse(
                  JSON.parse(libraryData),
                );
                if (result.success)
                  onDropLibraryAsset(result.data, time, trackId);
              } catch {
                // Ignore invalid external drag data.
              }
              return;
            }
            onDropFiles(
              Array.from(event.dataTransfer.files),
              time,
              trackId,
            );
          }}
          onScroll={(event) => {
            syncRangeHandles(event.currentTarget);
            setViewport({
              left: event.currentTarget.scrollLeft,
              width: event.currentTarget.clientWidth,
              top: event.currentTarget.scrollTop,
              height: event.currentTarget.clientHeight,
            });
            if (headers.current)
              headers.current.scrollTop = event.currentTarget.scrollTop;
          }}
        >
          <div
            className={`timeline-content ${marquee ? "marquee-active" : ""}`}
            style={{
              width,
              minHeight: trackHeights.reduce((sum, height) => sum + height, 36),
            }}
            onPointerDown={(event) => {
              if (
                event.button !== 0 ||
                !(event.target as HTMLElement).closest(".track-lane") ||
                (event.target as HTMLElement).closest(
                  ".timeline-clip, .timeline-transition, .transition-drop-edge, button, input",
                )
              )
                return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const next = {
                pointerId: event.pointerId,
                startX: event.clientX - bounds.left,
                startY: event.clientY - bounds.top,
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
                baseIds:
                  event.ctrlKey || event.metaKey || event.shiftKey
                    ? editor.selectedIds
                    : [],
              };
              marqueeMoved.current = false;
              setMarquee(next);
            }}
            onPointerMove={(event) => {
              if (!marquee || marquee.pointerId !== event.pointerId) return;
              const bounds = event.currentTarget.getBoundingClientRect();
              const next = {
                ...marquee,
                x: Math.max(0, event.clientX - bounds.left),
                y: Math.max(36, event.clientY - bounds.top),
              };
              if (
                Math.abs(next.x - next.startX) >= 4 ||
                Math.abs(next.y - next.startY) >= 4
              ) {
                // Keep ordinary clicks on their lane; capture only once a
                // marquee drag starts, otherwise the lane never gets its click.
                event.currentTarget.setPointerCapture(event.pointerId);
                marqueeMoved.current = true;
                editor.selectMany(marqueeSelection(next));
              }
              scheduleMarqueeUpdate(next);
            }}
            onPointerUp={(event) => {
              if (!marquee || marquee.pointerId !== event.pointerId) return;
              scheduleMarqueeUpdate(null);
              if (marqueeMoved.current)
                window.setTimeout(() => {
                  marqueeMoved.current = false;
                }, 0);
            }}
            onPointerCancel={() => {
              marqueeMoved.current = false;
              scheduleMarqueeUpdate(null);
            }}
            onPointerLeave={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId))
                scheduleMarqueeUpdate(null);
            }}
          >
            <div
              className="ruler"
              title="拖动定位；Shift+拖动添加区域标记"
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                const time = markerFrameTime(
                  timeFromEvent(event),
                  project.canvas.fps,
                );
                if (event.shiftKey)
                  setMarkerRange({
                    pointerId: event.pointerId,
                    start: time,
                    end: time,
                  });
                seek(timeFromEvent(event));
                editor.setPlaying(false);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (markerRange?.pointerId === event.pointerId) {
                  setMarkerRange({
                    ...markerRange,
                    end: markerFrameTime(
                      timeFromEvent(event),
                      project.canvas.fps,
                    ),
                  });
                } else if (event.buttons === 1) seek(timeFromEvent(event));
              }}
              onPointerUp={(event) => {
                if (markerRange?.pointerId !== event.pointerId) return;
                const end = markerFrameTime(
                  timeFromEvent(event),
                  project.canvas.fps,
                );
                if (
                  Math.abs(end - markerRange.start) >=
                  1 / project.canvas.fps - 1e-8
                )
                  addMarker(markerRange.start, end);
                setMarkerRange(null);
              }}
              onPointerCancel={() => setMarkerRange(null)}
              onLostPointerCapture={() => setMarkerRange(null)}
            >
              {rulerTicks.map((t) => (
                <span key={t} style={{ left: t * zoom }}>
                  {timelineRulerLabel(t, project.canvas.fps, rulerStep)}
                </span>
              ))}
              <TimelineMarkers
                editor={editor}
                zoom={zoom}
                snap={snap}
                onEdit={editMarker}
              />
              {markerRange && (
                <div
                  className="marker-range-draft"
                  style={{
                    left: Math.min(markerRange.start, markerRange.end) * zoom,
                    width: Math.max(
                      2,
                      Math.abs(markerRange.end - markerRange.start) * zoom,
                    ),
                  }}
                />
              )}
              <TimelineRangeHandles
                editor={editor}
                zoom={zoom}
                maxTime={duration}
                handleContainer={rangeHandleContainer}
                onRevealTime={revealRangeTime}
              />
            </div>
            {fileDrop && (
              <div
                className="external-drop-marker"
                style={{ left: fileDrop.time * zoom }}
              >
                <span>{timeLabel(fileDrop.time)} · 添加素材</span>
              </div>
            )}
            {timelineTracks.map((track, trackIndex) => (
              <div
                key={track.id}
                className={`track-lane ${trackLayouts[trackIndex].compact ? "compact-track" : ""} ${!isTrackActive(project.tracks, track.id) ? "hidden-track" : ""} ${fileDrop?.trackId === track.id ? "external-drop-target" : ""}`}
                data-track={track.id}
                onContextMenu={(event) => {
                  if (event.target !== event.currentTarget) return;
                  event.preventDefault();
                  setContext(null);
                  setTrackMenu({
                    trackId: track.id,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                style={
                  {
                    backgroundSize: `${zoom * rulerStep}px 100%`,
                    height: trackHeights[trackIndex],
                    "--track-content-height": `${trackLayouts[trackIndex].contentHeight}px`,
                  } as CSSProperties
                }
                onClick={(event) => {
                  if (event.target === event.currentTarget) {
                    if (marqueeMoved.current) {
                      marqueeMoved.current = false;
                      return;
                    }
                    const time = timeFromEvent(event);
                    if (track.captionTrack)
                      editor.selectCaptionTrack(track.id, time);
                    else select(null);
                    seek(time);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (
                    e.dataTransfer.types.includes("troncut-effect") ||
                    e.dataTransfer.types.includes("troncut-behavior") ||
                    e.dataTransfer.types.includes(animationMime) ||
                    e.dataTransfer.types.includes(transitionMime)
                  )
                    e.dataTransfer.dropEffect = "none";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (
                    e.dataTransfer.files.length ||
                    e.dataTransfer.types.includes(libraryAssetMime)
                  ) return;
                  if (track.locked) return;
                  const template = parseAnnotation(
                    e.dataTransfer.getData(annotationMime),
                  );
                  if (template) {
                    e.stopPropagation();
                    const time = Math.max(
                      0,
                      Math.round(
                        ((e.clientX -
                          e.currentTarget.getBoundingClientRect().left) /
                          zoom) *
                          project.canvas.fps,
                      ) / project.canvas.fps,
                    );
                    editor.addAnnotation(template, time, track.id);
                    return;
                  }
                  const asset = assetsById.get(
                    e.dataTransfer.getData("framecraft-asset"),
                  );
                  if (!asset) return;
                  const start =
                    (e.clientX - e.currentTarget.getBoundingClientRect().left) /
                    zoom;
                  const clip: Clip = {
                    id: uid(),
                    trackId: track.id,
                    kind: asset.kind,
                    ...(asset.animated ? { loop: true } : {}),
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
                {visibleClips
                  .get(
                    // Every track has a cached result, including empty tracks.
                    track.id,
                  )!
                  .map((original) => {
                    const group = timeline.groups.get(original.id);
                    if (group)
                      return (
                        <TimelineGroupClip
                          key={original.id}
                          editor={editor}
                          clip={original}
                          group={group}
                          zoom={zoom}
                          snap={snap}
                          top={trackLayouts[trackIndex].clipInset}
                          height={trackLayouts[trackIndex].contentHeight}
                          onContextMenu={(x, y, id) => {
                            setTrackMenu(null);
                            setContext({ x, y, id });
                          }}
                        />
                      );
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
                          : speedDraft?.id === original.id
                            ? speedDraft
                            : visualDraft?.id === original.id
                              ? visualDraft
                              : original;
                    const isRecording =
                      !!c.groupId &&
                      recordingObjects.get(c.groupId)?.id === c.id;
                    const hasTransformAnimation = animationRanges(c).length > 0;
                    const hasDrawingAnimation =
                      drawingAnimationRanges(c).length > 0;
                    return (
                      <Fragment key={c.id}>
                        <div
                          data-clip-id={c.id}
                          className={`timeline-clip ${c.kind} ${isRecording ? "recording-object" : ""} ${c.caption ? "caption" : ""} ${hasTransformAnimation || hasDrawingAnimation ? "has-animation" : ""} ${hasTransformAnimation && hasDrawingAnimation ? "has-drawing-and-transform" : ""} ${selectedIdSet.has(c.id) ? "selected" : ""} ${track.locked ? "locked" : ""} ${effectDrop === c.id ? "effect-drop-target" : ""} ${transitionHighlights.some((item) => item.clipId === c.id) ? "transition-drop-target" : ""}`}
                          style={{
                            left: c.start * zoom,
                            width: Math.max(4, c.duration * zoom),
                            top:
                              trackLayouts[trackIndex].clipInset -
                              (selectedIdSet.has(c.id) ? 1 : 0),
                            height:
                              trackLayouts[trackIndex].contentHeight +
                              2 +
                              (selectedIdSet.has(c.id) ? 2 : 0) +
                              (expandedEffects[c.id]
                                ? 24 *
                                  (Number(hasClipSpeed(c)) +
                                    (c.behaviors?.length ?? 0) +
                                    visualEffectEntries(c).length)
                                : 0),
                            translate:
                              drag?.id === c.id
                                ? `0 ${trackTop(drag.trackId) - trackTop(original.trackId)}px`
                                : undefined,
                          }}
                          onDragOver={(event) => {
                            if (
                              event.dataTransfer.types.includes(animationMime)
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              const target = animationAtPointer(c, event);
                              event.dataTransfer.dropEffect = target
                                ? "copy"
                                : "none";
                              setAnimationDrop(
                                target
                                  ? {
                                      clipId: c.id,
                                      start: target.start,
                                      end: target.end,
                                    }
                                  : null,
                              );
                              setEffectDrop(target ? c.id : null);
                              return;
                            }
                            if (
                              event.dataTransfer.types.includes(transitionMime)
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              const bounds =
                                event.currentTarget.getBoundingClientRect();
                              const target = transitionDropTarget(
                                project,
                                c,
                                event.clientX - bounds.left,
                                bounds.width,
                              );
                              event.dataTransfer.dropEffect = target
                                ? "copy"
                                : "none";
                              setTransitionDrop(target);
                              return;
                            }
                            if (
                              event.dataTransfer.types.includes(
                                "troncut-behavior",
                              )
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              const allowed =
                                !track.locked && supportsBehaviors(c);
                              event.dataTransfer.dropEffect = allowed
                                ? "copy"
                                : "none";
                              setEffectDrop(allowed ? c.id : null);
                              return;
                            }
                            if (
                              !event.dataTransfer.types.includes(
                                "troncut-effect",
                              )
                            )
                              return;
                            event.preventDefault();
                            event.stopPropagation();
                            const allowed =
                              !track.locked &&
                              supportsVisualEffect(
                                c,
                                visualEffectFromDragTypes(
                                  event.dataTransfer.types,
                                ),
                              );
                            event.dataTransfer.dropEffect = allowed
                              ? "copy"
                              : "none";
                            setEffectDrop(allowed ? c.id : null);
                          }}
                          onDragLeave={(event) => {
                            if (
                              !event.currentTarget.contains(
                                event.relatedTarget as Node | null,
                              )
                            ) {
                              setEffectDrop(null);
                              setTransitionDrop(null);
                              setAnimationDrop(null);
                            }
                          }}
                          onDrop={(event) => {
                            if (
                              event.dataTransfer.types.includes(animationMime)
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              setAnimationDrop(null);
                              setEffectDrop(null);
                              if (
                                event.dataTransfer.getData(animationMime) !==
                                customAnimationId
                              )
                                return;
                              const target = animationAtPointer(c, event);
                              if (target)
                                editor.addCustomAnimation(
                                  target.clipId,
                                  target.end,
                                );
                              return;
                            }
                            if (
                              event.dataTransfer.types.includes(transitionMime)
                            ) {
                              event.preventDefault();
                              event.stopPropagation();
                              setTransitionDrop(null);
                              const type = transitionTypeSchema.safeParse(
                                event.dataTransfer.getData(transitionMime),
                              );
                              if (!type.success) return;
                              const bounds =
                                event.currentTarget.getBoundingClientRect();
                              const target = transitionDropTarget(
                                project,
                                c,
                                event.clientX - bounds.left,
                                bounds.width,
                              );
                              if (target) editor.addTransition(target, type.data);
                              return;
                            }
                            const behavior =
                              event.dataTransfer.getData("troncut-behavior");
                            if (behavior) {
                              event.preventDefault();
                              event.stopPropagation();
                              setEffectDrop(null);
                              if (!track.locked && supportsBehaviors(c)) {
                                editor.addBehavior(behavior, c.id);
                                setExpandedEffects((previous) => ({
                                  ...previous,
                                  [c.id]: true,
                                }));
                              }
                              return;
                            }
                            const effect =
                              event.dataTransfer.getData("troncut-effect");
                            if (!effect) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setEffectDrop(null);
                            if (track.locked) return;
                            if (
                              effect !== "clip-speed" &&
                              effect !== "rounded-corners"
                            ) {
                              if (supportsVisualEffect(c, effect))
                                editor.addVisualEffect(
                                  effect as VisualEffectId,
                                  c.id,
                                );
                              return;
                            }
                            if (effect === "rounded-corners") {
                              if (supportsMediaFrame(c))
                                editor.addRoundedCorners(c.id);
                              return;
                            }
                            if (!supportsClipSpeed(c)) return;
                            editor.addSpeedEffect(c.id);
                            setActiveSpeed(c.id);
                            setExpandedEffects((previous) => ({
                              ...previous,
                              [c.id]: true,
                            }));
                          }}
                          onPointerDown={(event) => {
                            if (event.button !== 0 || track.locked) return;
                            event.stopPropagation();
                            editor.clearKeyframeEdit();
                            editor.setSelectedVisualEffect(null);
                            if (
                              editor.selectedBehavior?.clipId === c.id ||
                              editor.selectedTransition?.clipId === c.id
                            )
                              select(c.id);
                            if (
                              event.ctrlKey ||
                              event.metaKey ||
                              event.shiftKey
                            ) {
                              select(c.id, true);
                              return;
                            }
                            const ids = selectedIdSet.has(c.id)
                              ? editor.selectedIds
                              : c.caption
                                ? captionTrackSelection(project, c.id)
                                : selectionWithGroups(project, [c.id]);
                            if (!selectedIdSet.has(c.id)) select(c.id);
                            else if (c.caption)
                              editor.selectMany([
                                ...ids.filter((id) => id !== c.id),
                                c.id,
                              ]);
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
                            // The translated clip stays under its original lane
                            // in the DOM. Hit-testing it would alternate between
                            // that lane and the destination on every pointer move.
                            const hit = Array.from(
                              scroll.current?.querySelectorAll<HTMLElement>(
                                ".track-lane",
                              ) ?? [],
                            ).find((lane) => {
                              const bounds = lane.getBoundingClientRect();
                              return (
                                event.clientY >= bounds.top &&
                                event.clientY < bounds.bottom
                              );
                            });
                            const target = project.tracks.find(
                              (t) => t.id === hit?.dataset.track,
                            );
                            scheduleDragUpdate({
                              ...drag,
                              delta: (event.clientX - drag.x) / zoom,
                              trackId:
                                drag.mode === "move" &&
                                drag.ids.length === 1 &&
                                target &&
                                !target.locked &&
                                (c.caption
                                  ? target.captionTrack
                                  : !target.captionTrack)
                                  ? target.id
                                  : drag.trackId,
                            });
                          }}
                          onPointerUp={() => {
                            if (
                              drag &&
                              (drag.delta !== 0 ||
                                drag.trackId !== drag.original.trackId)
                            ) {
                              const next = dragClip(drag);
                              if (drag.mode === "move" && drag.ids.length > 1)
                                apply((p) =>
                                  moveClips(
                                    p,
                                    drag.ids,
                                    next.start - drag.original.start,
                                  ),
                                );
                              else if (
                                drag.original.recording &&
                                drag.original.groupId
                              )
                                apply((p) =>
                                  trimRecordingObject(p, drag.original, next),
                                );
                              else editor.updateClip(drag.id, next);
                            }
                            setDrag(null);
                          }}
                          onPointerCancel={() => setDrag(null)}
                          onDoubleClick={(event) => {
                            const groupId = rootGroupId(project, c.groupId);
                            if (groupId) {
                              event.stopPropagation();
                              setDrag(null);
                              editor.switchTimeline(groupId);
                              return;
                            }
                            if (c.kind !== "text" || track.locked) return;
                            event.stopPropagation();
                            setDrag(null);
                            editor.beginTextEdit(c.id);
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            editor.setPlaying(false);
                            if (editor.editingTextId)
                              editor.endTextEdit(editor.editingTextId);
                            const previous = editor.selectedIds;
                            select(c.id);
                            if (previous.includes(c.id))
                              editor.selectMany(previous);
                            setTrackMenu(null);
                            setContext({
                              x: event.clientX,
                              y: event.clientY,
                              id: c.id,
                            });
                          }}
                        >
                          {animationDrop?.clipId === c.id && (
                            <div
                              className="animation-drop-preview"
                              data-start={animationDrop.start}
                              data-end={animationDrop.end}
                              style={{
                                left: (animationDrop.start - c.start) * zoom,
                                width: Math.max(
                                  2,
                                  (animationDrop.end - animationDrop.start) *
                                    zoom,
                                ),
                              }}
                            >
                              <span>
                                动画终点 {timeLabel(animationDrop.end)}
                              </span>
                            </div>
                          )}
                          <div
                            className="clip-content"
                            style={{
                              height: trackLayouts[trackIndex].contentHeight,
                            }}
                          >
                            <span
                              className="trim-handle left"
                              data-trim="left"
                            />
                            <div className="clip-label">
                              {isRecording ? (
                                <MonitorDot
                                  size={15}
                                  className="recording-object-icon"
                                  role="img"
                                  aria-label="录屏组合"
                                />
                              ) : c.kind === "text" ? (
                                <Type size={13} />
                              ) : c.kind === "audio" ? (
                                <Volume2 size={13} />
                              ) : (
                                <span className="clip-media-icon">▣</span>
                              )}
                              <span
                                title={
                                  isRecording
                                    ? `录屏组合 · ${groupName(project, c.groupId!)}`
                                    : c.kind === "text"
                                      ? c.text
                                      : c.name
                                }
                              >
                                {c.groupId && !isRecording ? "▧ " : ""}
                                {isRecording
                                  ? groupName(project, c.groupId!)
                                  : c.kind === "text"
                                    ? c.text?.replace(/\s+/g, " ").trim() || c.name
                                    : c.name}
                              </span>
                              {c.speed !== 1 && (
                                <b>{Number(c.speed.toFixed(2))}×</b>
                              )}
                            </div>
                            {c.kind !== "text" && (
                              <div className="clip-detail">
                                {`${timeLabel(c.duration)}${c.stitch ? ` · ${mediaSegments(c).length} 段拼接` : ""}${c.podcast ? " · 播客人声" : ""}`}
                              </div>
                            )}
                            {editor.preferences.program.waveforms &&
                              !c.audioDetached &&
                              c.assetId &&
                              assetsById.get(c.assetId)?.hasAudio &&
                              (() => {
                                const asset = assetsById.get(c.assetId!)!;
                                return (
                                  <div className="clip-waveform">
                                    {mediaSegments(c).map((part, index) => (
                                      <div
                                        className="stitch-waveform-range"
                                        key={index}
                                        style={{
                                          left: part.start * zoom,
                                          width: part.duration / c.speed * zoom,
                                        }}
                                      >
                                        <MediaThumbnail
                                          asset={asset}
                                          waveform
                                          style={{
                                            width: `${Math.max(c.duration, asset.duration / c.speed) * zoom}px`,
                                            left: `${(-part.sourceIn / c.speed) * zoom}px`,
                                          }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                );
                              })()}
                            {stitchBoundaries(c).map((time) => (
                              <button
                                key={time}
                                type="button"
                                className="stitch-seam"
                                aria-label={`拼接点 ${timeLabel(c.start + time)}`}
                                title="拼接点；右键移除这一处拼接"
                                style={{ left: time * zoom }}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                  editor.setPlaying(false);
                                  select(c.id);
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  editor.setPlaying(false);
                                  select(c.id);
                                  setContext({
                                    x: event.clientX, y: event.clientY,
                                    id: c.id, stitchTime: time,
                                  });
                                }}
                              />
                            ))}
                            {(["transform", "drawing"] as const)
                              .filter(
                                (channel) =>
                                  channel === "transform" ||
                                  hasDrawingAnimation,
                              )
                              .map((channel) => (
                                <TimelineAnimations
                                  key={channel}
                                  channel={channel}
                                  clip={c}
                                  editor={editor}
                                  viewportStart={(viewport.left - 200) / zoom}
                                  viewportEnd={
                                    (viewport.left + viewport.width + 200) /
                                    zoom
                                  }
                                  zoom={zoom}
                                  fps={project.canvas.fps}
                                  selected={selectedIdSet.has(c.id)}
                                  selectedFrame={
                                    channel === "drawing"
                                      ? editor.selectedDrawing?.clipId === c.id
                                        ? editor.selectedDrawing
                                        : null
                                      : editor.selectedKeyframe?.clipId === c.id
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
                                      drawing: clip.drawing,
                                    }))
                                  }
                                  locate={(time, side, kind) => {
                                    if (track.locked) {
                                      editor.setPlaying(false);
                                      select(c.id);
                                      seek(time);
                                    } else if (kind === "drawing")
                                      editor.editDrawing(
                                        c.id,
                                        time - c.start,
                                        side,
                                      );
                                    else
                                      editor.editKeyframe(
                                        c.id,
                                        time - c.start,
                                        side,
                                      );
                                  }}
                                />
                              ))}
                            <span
                              className="trim-handle right"
                              data-trim="right"
                            />
                          </div>
                          {(hasClipSpeed(c) ||
                            hasBehaviors(c) ||
                            visualEffectEntries(c).length > 0) && (
                            <button
                              className="clip-effects-toggle"
                              type="button"
                              aria-label={
                                expandedEffects[c.id]
                                  ? "收起片段效果"
                                  : "展开片段效果"
                              }
                              aria-expanded={!!expandedEffects[c.id]}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation();
                                setExpandedEffects((previous) => ({
                                  ...previous,
                                  [c.id]: !previous[c.id],
                                }));
                                select(c.id);
                              }}
                            >
                              {expandedEffects[c.id] ? (
                                <ChevronUp size={12} />
                              ) : (
                                <ChevronDown size={12} />
                              )}
                            </button>
                          )}
                          {expandedEffects[c.id] && (
                            <div
                              className="clip-effects-tray"
                              aria-label="片段效果"
                            >
                              {hasClipSpeed(c) && (
                                <TimelineSpeedEffect
                                  clip={c}
                                  zoom={zoom}
                                  fps={project.canvas.fps}
                                  locked={track.locked}
                                  selected={
                                    activeSpeed === c.id &&
                                    selectedId === c.id &&
                                    !editor.selectedBehavior &&
                                    !editor.selectedTransition &&
                                    !editor.selectedKeyframe
                                  }
                                  select={() => selectSpeed(c.id)}
                                  preview={setSpeedDraft}
                                  commit={(next) =>
                                    editor.updateClip(next.id, next)
                                  }
                                />
                              )}
                              {c.behaviors?.map((behavior) => (
                                <TimelineBehaviorEffect
                                  key={behavior.id}
                                  clip={c}
                                  behavior={behavior}
                                  locked={track.locked}
                                  editor={editor}
                                />
                              ))}
                              {visualEffectEntries(c).map(({ id, name }) => (
                                <TimelineVisualEffect
                                  key={id}
                                  clip={c}
                                  id={id}
                                  name={name}
                                  zoom={zoom}
                                  fps={project.canvas.fps}
                                  locked={track.locked}
                                  selected={
                                    selectedId === c.id &&
                                    activeVisual?.clipId === c.id &&
                                    activeVisual.id === id &&
                                    !editor.selectedBehavior &&
                                    !editor.selectedTransition &&
                                    !editor.selectedKeyframe
                                  }
                                  select={() => {
                                    select(c.id);
                                    editor.clearKeyframeEdit();
                                    editor.setPlaying(false);
                                    setActiveSpeed(null);
                                    editor.setSelectedVisualEffect({
                                      clipId: c.id,
                                      id,
                                    });
                                  }}
                                  preview={setVisualDraft}
                                  commit={(next) =>
                                    editor.updateClip(next.id, next)
                                  }
                                />
                              ))}
                            </div>
                          )}
                          <TimelineTransitions
                            clip={c}
                            zoom={zoom}
                            editor={editor}
                            locked={track.locked}
                          />
                          {transitionHighlights
                            .filter((item) => item.clipId === c.id)
                            .map((item) => (
                              <div
                                key={item.side}
                                className={`transition-drop-edge ${item.side}`}
                              />
                            ))}
                        </div>
                      </Fragment>
                    );
                  })}
              </div>
            ))}
            {marquee && marqueeMoved.current && (
              <div
                className="timeline-marquee"
                style={{
                  left: Math.min(marquee.startX, marquee.x),
                  top: Math.min(marquee.startY, marquee.y),
                  width: Math.abs(marquee.x - marquee.startX),
                  height: Math.abs(marquee.y - marquee.startY),
                }}
              />
            )}
            <TimelinePlayheadCursor
              editor={editor}
              zoom={zoom}
            />
            <TimelineRangeOverlay editor={editor} zoom={zoom} />
          </div>
        </div>
      </div>
      <div className="timeline-footer">
        <span>
          空格 播放 / 暂停<span className="separator-dot">·</span>Ctrl/⌘+K 拆分
          <span className="separator-dot">·</span>右键动画 编辑动画
          <span className="separator-dot">·</span>Shift+拖动标尺 区域标记
        </span>
        <span>
          {editor.timelineRange && (
            <>范围 {timeLabel(editor.timelineRange.start)} – {timeLabel(editor.timelineRange.end)} · </>
          )}
          {timeline.clips.length} 个片段 · 已选{" "}
          {
            timeline.clips.filter((clip) =>
              editor.selectedIds.includes(clip.id),
            ).length
          }{" "}
          · {timeLabel(projectDuration(project))}
        </span>
      </div>
      {markerEditor && (
        <MarkerDialog
          key={`${project.id}-${markerEditor.id}`}
          marker={markerEditor}
          fps={project.canvas.fps}
          existing={project.markers.some(
            (marker) => marker.id === markerEditor.id,
          )}
          onClose={() => setMarkerEditor(null)}
          onSave={(marker) => {
            apply((project) => putMarker(project, marker));
            setMarkerEditor(null);
          }}
          onDelete={() => {
            apply((project) => removeMarker(project, markerEditor.id));
            setMarkerEditor(null);
          }}
        />
      )}
      {context &&
        (() => {
          const clip = project.clips.find((item) => item.id === context.id);
          if (!clip) return null;
          const editable = editableIds(project, editor.selectedIds);
          const selectionLocked = !editor.selectedIds.every((id) =>
            editable.has(id),
          );
          if (clip.caption) {
            const captionLocked = !!project.tracks.find(
              (track) => track.id === clip.trackId,
            )?.locked;
            return (
              <ClipContextMenu
                editor={editor}
                menu={{ ...context, clipId: context.id }}
                onClose={() => setContext(null)}
                onCommand={onCommand}
                portalTarget={panel.current}
                surface="timeline"
              >
                <hr />
                <button
                  onClick={() => {
                    setContext(null);
                    editor.selectMany(
                      project.clips
                        .filter((item) => item.caption)
                        .map((item) => item.id),
                    );
                  }}
                >
                  选择全部字幕
                </button>
                <button
                  disabled={captionLocked}
                  onClick={() => {
                    setContext(null);
                    editor.seek(clip.start);
                    editor.beginTextEdit(clip.id);
                  }}
                >
                  编辑字幕文本
                </button>
                <button
                  disabled={captionLocked || !previousCaption(project, clip.id)}
                  onClick={() => {
                    setContext(null);
                    mergeCaption(clip.id);
                  }}
                >
                  与上一字幕合并
                </button>
                <button
                  disabled={
                    captionLocked ||
                    editor.playhead <= clip.start ||
                    editor.playhead >= clip.start + clip.duration
                  }
                  onClick={() => {
                    setContext(null);
                    apply((current) =>
                      splitClip(current, clip.id, editor.playhead),
                    );
                  }}
                >
                  拆分字幕
                </button>
                <button
                  disabled={captionLocked}
                  onClick={() => {
                    setContext(null);
                    editor.updateClip(clip.id, {
                      text: "",
                      name: "空白字幕",
                    });
                  }}
                >
                  清除字幕文本
                </button>
                <button
                  disabled={captionLocked}
                  onClick={() => {
                    setContext(null);
                    convertCaptionSelection(clip.id);
                  }}
                >
                  转换为普通文本
                </button>
              </ClipContextMenu>
            );
          }
          return (
            <ClipContextMenu
              editor={editor}
              menu={{ ...context, clipId: context.id }}
              onClose={() => setContext(null)}
              onCommand={onCommand}
              portalTarget={panel.current}
              surface="timeline"
            >
              <hr />
              <button
                disabled={
                  !editor.hasBehaviorClipboard() ||
                  !!project.tracks.find(
                    (track) =>
                      track.id ===
                      project.clips.find((clip) => clip.id === context.id)
                        ?.trackId,
                  )?.locked
                }
                onClick={() => {
                  setContext(null);
                  editor.pasteBehavior(context.id);
                }}
              >
                粘贴效果
              </button>
              <button
                disabled={
                  selectionLocked ||
                  editor.playhead <= clip.start ||
                  editor.playhead >= clip.start + clip.duration
                }
                onClick={() => {
                  setContext(null);
                  apply((p) =>
                    splitSelection(
                      p,
                      editor.selectedIds.includes(context.id)
                        ? editor.selectedIds
                        : [context.id],
                      editor.playhead,
                    ),
                  );
                }}
              >
                <Scissors size={14} />
                在播放头拆分
                <span className="menu-shortcut">Ctrl/⌘+K</span>
              </button>
            </ClipContextMenu>
          );
        })()}
      <BehaviorContextMenu editor={editor} />
      <TrackContextMenu
        editor={editor}
        menu={trackMenu}
        onClose={() => setTrackMenu(null)}
      />
    </section>
  );
}
