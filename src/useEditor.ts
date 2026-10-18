import {
  addMediaFrame as addFrameEffect,
  supportsMediaFrame,
} from "../shared/media-frame";
import {
  addVisualEffect as addVisualEffectToClip,
  isAdditionalVisualEffect,
} from "../shared/visual-effects";
import type { VisualEffectId } from "../shared/visual-effect-drag";
import { animateMask } from "../shared/mask-animation";
import type { MaskGeometry } from "../shared/mask-state";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type SetStateAction,
} from "react";
import {
  createProject,
  type Project,
  type Clip,
  newText,
  defaultTransform,
  type Asset,
  type Transform,
  type CharacterStyle,
  newTrack,
  numberTracks,
  projectDuration,
} from "../shared/model";
import {
  addMediaAssets,
  availableTrack,
  setTransform,
  setKeyframeTransform,
  transformAt,
} from "../shared/editor";
import {
  deleteClips,
  findClipAtPlayhead,
  selectionWithGroups,
} from "../shared/timeline";
import { recordingMaster } from "../shared/recording-objects";
import {
  captionTrackSelection,
  updateCaptionAppearance,
  type CaptionAppearance,
} from "../shared/captions";
import {
  addTransition as addProjectTransition,
  updateTransition as updateProjectTransition,
  normalizeTransitions,
  type TransitionSelection,
  type TransitionTarget,
  type Transition,
} from "../shared/transitions";
import { setVideoZoomPan } from "../shared/video-zoom-pan";
import { type ContentTransform } from "../shared/crop";
import { animateContent, animateCrop } from "../shared/crop-animation";
import type { Crop } from "../shared/crop";
import { fitUpdatedText, textBoxFor } from "./text";
import { applyCharacterStyle, reconcileTextRuns, type TextRange } from "../shared/rich-text";
import {
  editableCanvasIds,
  fitFrameTransform,
  pasteClipProperties as applyClipProperties,
} from "../shared/canvas-actions";
import { defaultCrop } from "../shared/effects";
import { visualClipAt } from "../shared/visual-state";
import {
  addClipSpeed,
  removeClipSpeed,
  setClipSpeed,
  setSpeedDuration,
  supportsClipSpeed,
} from "../shared/clip-speed";
import { annotationClip, type AnnotationTemplate } from "../shared/annotations";
import {
  animationEditTarget,
  animationRanges,
  drawingAnimationRanges,
  type AnimationRange,
} from "../shared/animation-ranges";
import {
  snapshotAnimation,
  addAnimationKeyframe,
  removeAnimation,
  pasteAnimation,
  type CopiedAnimation,
} from "../shared/animation-edit";
import { uid } from "../shared/model";
import {
  defaultEditorPreferences,
  type EditorPreferences,
} from "../shared/editor-preferences";
import {
  behaviorFromPreset,
  supportsBehaviors,
  fitBehaviorDuration,
  type Behavior,
} from "../shared/behaviors";
import {
  stepFrameTime,
  mediaBoundaryTime,
  type PlaybackDirection,
} from "../shared/playback";
import { usePresetLibrary } from "./usePresetLibrary";
import { animationDropTarget } from "../shared/animation-drag";
import { shapeSize } from "../shared/annotation-style";
import type { DrawingStroke } from "../shared/annotation-style";
import {
  drawingStrokesToCanvas,
  fitFreehandStrokes,
  freehandAnnotation,
  type PenSettings,
} from "../shared/freehand";
import { createPlaybackStore } from "./playback-store";
import { stitchClips, stitchSelectionError, unstitchClips } from "../shared/stitch";
import {
  createGroupScope,
  groupName,
  mergeGroupProject,
  projectForGroup,
  renameClipGroup,
  type GroupScope,
} from "../shared/clip-groups";
import {
  groupExistingTimelineOverlaps,
  hasProjectTimelineOverlap,
  timelineLayoutChanged,
} from "../shared/timeline-collision";

export function demoProject(): Project {
  const project = createProject("我的第一个视频");
  const title = newText("titles", 0, 3, "把想法，变成作品。");
  title.duration = 8;
  title.style!.fontSize = 96;
  title.transform.y = 0.43;
  title.keyframes = [
    { time: 0, value: { ...title.transform, y: 0.49, opacity: 0 } },
    { time: 0.8, value: title.transform },
  ];
  project.tracks.unshift({
    id: "subtitle-demo",
    name: "副标题",
    hidden: false,
    muted: false,
    locked: false,
  });
  const subtitle = newText("subtitle-demo", 0.4, 0, "录制 · 剪辑 · 表达");
  subtitle.style!.fontSize = 32;
  subtitle.style!.color = "#a4b1ba";
  subtitle.style!.outlineWidth = 0;
  subtitle.transform.y = 0.59;
  subtitle.duration = 7.6;
  project.clips = [title, subtitle];
  project.canvas.background = "#142821";
  return { ...project, tracks: numberTracks(project.tracks) };
}
export function useEditor(
  preferences: EditorPreferences = defaultEditorPreferences,
) {
  const presetLibrary = usePresetLibrary();
  const defaults = useRef(preferences);
  defaults.current = preferences;
  const playback = useMemo(() => createPlaybackStore(1.2), []);
  const playhead = playback.getSnapshot();
  const [documentProject, setDocumentProject] = useState<Project>(() =>
    createProject(),
  );
  const [groupScope, setGroupScope] = useState<GroupScope | null>(null);
  const scopeRef = useRef(groupScope);
  scopeRef.current = groupScope;
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const timelinePositions = useRef(new Map<string, number>());
  const groupScopes = useRef(new Map<string, GroupScope>());
  // Editing uses a local timeline; saving and exporting use the full document.
  const project = useMemo(
    () => projectForGroup(documentProject, groupScope),
    [documentProject, groupScope],
  );
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [textSelection, setTextSelection] = useState<(TextRange & { clipId: string }) | null>(null);
  const [zoomPanDraft, setZoomPanDraft] = useState<Transform | null>(null);
  const [canvasMode, setCanvasMode] = useState<"select" | "crop" | "draw">(
    "select",
  );
  const [penToolRequest, setPenToolRequest] = useState(0);
  const [penSettings, setPenSettings] = useState<PenSettings>({
    color: "#ff2020",
    width: 8,
    brush: "round",
    animate: true,
    duration: 1,
  });
  const [penDraft, setPenDraft] = useState<DrawingStroke[]>([]);
  const [penTargetId, setPenTargetId] = useState<string | null>(null);
  const penStart = useRef<number | null>(null);
  useEffect(() => {
    if (canvasMode !== "draw") {
      setPenDraft([]);
      setPenTargetId(null);
      penStart.current = null;
    }
  }, [canvasMode]);
  const [clipProperties, setClipProperties] = useState<Clip | null>(null);
  type KeyframeSelection = {
    clipId: string;
    time: number;
    side: "start" | "end";
    // The clicked endpoint can edit an earlier frame across a hold.
    localTime: number;
  };
  const [keyframeSelection, setKeyframeSelection] =
    useState<KeyframeSelection | null>(null);
  const [drawingSelection, setDrawingSelection] =
    useState<KeyframeSelection | null>(null);
  const keyframeRef = useRef<KeyframeSelection | null>(null);
  const animationClipboard = useRef<{
    token: string;
    value: CopiedAnimation;
  } | null>(null);
  const clearKeyframeEdit = useCallback(() => {
    keyframeRef.current = null;
    setKeyframeSelection(null);
    setDrawingSelection(null);
  }, []);
  const [selection, selectMany] = useState<string[]>([]);
  const [editAllCaptions, setEditAllCaptionsState] = useState(true);
  const [transitionSelection, setTransitionSelection] =
    useState<TransitionSelection | null>(null);
  const [behaviorSelection, setBehaviorSelection] = useState<{
    clipId: string;
    behaviorId: string;
  } | null>(null);
  const behaviorClipboard = useRef<Behavior | null>(null);
  const behaviorClipboardToken = useRef<string | null>(null);
  const [behaviorMenu, showBehaviorMenu] = useState<{
    x: number;
    y: number;
    clipId: string;
    behaviorId: string;
    locked: boolean;
  } | null>(null);
  const clipsById = useMemo(
    () => new Map(project.clips.map((clip) => [clip.id, clip])),
    [project.clips],
  );
  const selectedIds = useMemo(
    () => selection.filter((id) => clipsById.has(id)),
    [selection, clipsById],
  );
  const lastSelectedId = selectedIds.at(-1);
  const selectedId = lastSelectedId
    ? (recordingMaster(project, lastSelectedId)?.id ?? lastSelectedId)
    : null;
  const setEditAllCaptions = useCallback(
    (all: boolean) => {
      setEditAllCaptionsState(all);
      const project = current.current;
      if (
        selectedId &&
        project.clips.find((clip) => clip.id === selectedId)?.caption
      ) {
        clearKeyframeEdit();
        selectMany(captionTrackSelection(project, selectedId, all));
      }
    },
    [selectedId, clearKeyframeEdit],
  );
  const select = useCallback(
    (id: string | null, additive = false) => {
      setTextSelection((selection) => selection?.clipId === id ? selection : null);
      setBehaviorSelection(null);
      setTransitionSelection(null);
      if (id && !additive && keyframeRef.current?.clipId === id) return;
      clearKeyframeEdit();
      if (!id) {
        selectMany([]);
        return;
      }
      const clip = current.current.clips.find((clip) => clip.id === id);
      const group =
        clip?.caption && !additive
          ? captionTrackSelection(current.current, id, editAllCaptions)
          : selectionWithGroups(current.current, [id]);
      selectMany((previous) =>
        additive
          ? previous.includes(id)
            ? previous.filter((x) => !group.includes(x))
            : [...new Set([...previous, ...group])]
          : group,
      );
    },
    [clearKeyframeEdit, editAllCaptions],
  );
  const seek = useCallback(
    (next: SetStateAction<number>) => {
      clearKeyframeEdit();
      playback.set(next);
    },
    [clearKeyframeEdit, playback],
  );
  // Playback advances dozens of times per second. It only moves the clock and
  // must not pay for interactive seek cleanup on every frame.
  const advancePlayback = useCallback((next: number) => {
    playback.set(next);
  }, [playback]);
  const [playing, setPlayingState] = useState(false);
  const [narrationRecording, setNarrationRecording] = useState<{
    muted: boolean;
  } | null>(null);
  const setPlaying = useCallback(
    (next: boolean) => {
      if (next) clearKeyframeEdit();
      setPlayingState(next);
    },
    [clearKeyframeEdit],
  );
  const [dirty, setDirty] = useState(false);
  const [timelineConflict, setTimelineConflict] = useState(0);
  const [autoAnimate, setAutoAnimate] = useState(false);
  const [timelineFocus, setTimelineFocus] = useState<{ time: number } | null>(null);

  useEffect(() => {
    if (!preferences.program.selectionFollowsPlayhead) return;
    const follow = () => {
      if (editingTextId) return;
      const clip = findClipAtPlayhead(project, playback.getSnapshot());
      if (!clip) {
        if (selectedIds.length > 0) select(null);
        return;
      }
      const targetGroup = selectionWithGroups(project, [clip.id]);
      const isSame =
        selectedIds.length === targetGroup.length &&
        targetGroup.every((id) => selectedIds.includes(id));
      if (!isSame) select(clip.id);
    };
    follow();
    return playback.subscribe(follow);
  }, [
    preferences.program.selectionFollowsPlayhead,
    playback,
    project,
    editingTextId,
    selectedIds,
    select,
  ]);

  const past = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    documentCurrent = useRef(documentProject),
    current = useRef(project);
  documentCurrent.current = documentProject;
  current.current = project;
  const apply = useCallback(
    (next: Project | ((project: Project) => Project)) => {
      const before = current.current,
        result = typeof next === "function" ? next(before) : next;
      const tracks = numberTracks(result.tracks);
      const fittedClips = result.clips.map(fitBehaviorDuration);
      const clips = fittedClips.some(
        (clip, index) => clip !== result.clips[index],
      )
        ? fittedClips
        : result.clips;
      const after = normalizeTransitions(
        tracks === result.tracks && clips === result.clips
          ? result
          : { ...result, tracks, clips },
      );
      if (after === before) return;
      const documentBefore = documentCurrent.current;
      const documentAfter = scopeRef.current
        ? mergeGroupProject(documentBefore, scopeRef.current, after)
        : after;
      if (
        timelineLayoutChanged(documentBefore, documentAfter) &&
        hasProjectTimelineOverlap(documentAfter)
      ) {
        setTimelineConflict((count) => count + 1);
        return;
      }
      if (scopeRef.current)
        scopeRef.current.trackIds = [
          ...new Set([
            ...scopeRef.current.trackIds,
            ...after.tracks.map((track) => track.id),
          ]),
        ];
      past.current = [...past.current.slice(-99), documentBefore];
      future.current = [];
      documentCurrent.current = documentAfter;
      current.current = projectForGroup(documentAfter, scopeRef.current);
      setDocumentProject(documentAfter);
      setDirty(true);
    },
    [],
  );
  const switchTimeline = useCallback(
    (id: string | null) => {
      const document = documentCurrent.current;
      const next = id
        ? createGroupScope(document, id) ?? groupScopes.current.get(id)
        : null;
      if (id && !next) return;
      timelinePositions.current.set(
        scopeRef.current?.id ?? "main",
        playback.getSnapshot(),
      );
      if (next) {
        groupScopes.current.set(next.id, next);
        setOpenGroups((groups) =>
          groups.includes(next.id) ? groups : [...groups, next.id],
        );
      }
      scopeRef.current = next ?? null;
      current.current = projectForGroup(document, next ?? null);
      setGroupScope(next ?? null);
      setEditingTextId(null);
      setZoomPanDraft(null);
      setTimelineFocus(null);
      setPlaying(false);
      select(null);
      seek(Math.min(
        projectDuration(current.current),
        timelinePositions.current.get(id ?? "main") ?? 0,
      ));
    },
    [playback, select, seek, setPlaying],
  );
  const closeGroup = useCallback(
    (id: string) => {
      if (scopeRef.current?.id === id) switchTimeline(null);
      setOpenGroups((groups) => groups.filter((group) => group !== id));
      groupScopes.current.delete(id);
      timelinePositions.current.delete(id);
    },
    [switchTimeline],
  );
  useEffect(() => {
    const exists = (id: string) =>
      documentProject.groups?.some((group) => group.id === id) ||
      documentProject.clips.some((clip) => clip.groupId === id);
    if (groupScope && !exists(groupScope.id)) switchTimeline(null);
    setOpenGroups((groups) =>
      groups.every(exists) ? groups : groups.filter(exists),
    );
  }, [documentProject, groupScope, switchTimeline]);
  const renameGroup = useCallback((id: string, name: string) => {
    const before = documentCurrent.current;
    const after = renameClipGroup(before, id, name);
    if (before === after) return;
    past.current = [...past.current.slice(-99), before];
    future.current = [];
    documentCurrent.current = after;
    current.current = projectForGroup(after, scopeRef.current);
    setDocumentProject(after);
    setDirty(true);
  }, []);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const deleteSelectedClips = useCallback(
    (ripple = false) => {
      const before = current.current;
      const next = deleteClips(before, selectedIds, ripple);
      if (next === before) return;
      apply(next);
      select(null);
      if (ripple) {
        // Use clips actually removed, including recording objects and excluding
        // locked tracks. Multiple deletions focus the earliest splice.
        const remaining = new Set(next.clips.map((clip) => clip.id));
        const time = Math.min(
          projectDuration(next),
          before.clips.reduce(
            (start, clip) =>
              remaining.has(clip.id) ? start : Math.min(start, clip.start),
            Infinity,
          ),
        );
        setPlaying(false);
        seek(time);
        // A new request also reveals repeated deletions at the same splice.
        setTimelineFocus({ time });
      }
    },
    [apply, selectedIds, select, setPlaying, seek],
  );
  const stitchSelectedClips = useCallback(() => {
    const before = current.current;
    const error = stitchSelectionError(before, selectedIds);
    if (error) return error;
    const first = before.clips
      .filter((clip) => selectedIds.includes(clip.id))
      .sort((a, b) => a.start - b.start)[0];
    setPlaying(false);
    apply(stitchClips(before, selectedIds));
    select(first.id);
    return null;
  }, [apply, selectedIds, select, setPlaying]);
  const unstitchSelectedClips = useCallback(
    (seam?: number, clipId?: string) => {
      const before = current.current;
      const ids = clipId ? [clipId] : selectedIds;
      const next = unstitchClips(before, ids, seam);
      if (next === before) return;
      const previous = new Set(before.clips.map((clip) => clip.id));
      setPlaying(false);
      apply(next);
      select(null);
      selectMany(next.clips
        .filter((clip) => ids.includes(clip.id) || !previous.has(clip.id))
        .map((clip) => clip.id));
    },
    [apply, selectedIds, select, setPlaying],
  );
  const replace = useCallback((next: Project, unsaved = false) => {
    const migrated = groupExistingTimelineOverlaps(next);
    unsaved ||= migrated !== next;
    next = migrated;
    next = { ...next, tracks: numberTracks(next.tracks) };
    past.current = [];
    future.current = [];
    current.current = next;
    documentCurrent.current = next;
    setDocumentProject(next);
    scopeRef.current = null;
    setGroupScope(null);
    setOpenGroups([]);
    setRenamingGroup(null);
    groupScopes.current.clear();
    timelinePositions.current.clear();
    setEditingTextId(null);
    setZoomPanDraft(null);
    setTimelineFocus(null);
    setClipProperties(null);
    setCanvasMode(defaults.current.program.defaultTool);
    select(null);
    seek(0);
    setPlaying(false);
    setDirty(unsaved);
  }, []);
  const markSaved = useCallback((saved: Project) => {
    documentCurrent.current = saved;
    current.current = projectForGroup(saved, scopeRef.current);
    setDocumentProject(saved);
    setDirty(false);
  }, []);
  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous) {
      future.current.push(documentCurrent.current);
      documentCurrent.current = previous;
      if (scopeRef.current) {
        // History can restore a group moved on the main timeline. Rebase its
        // local origin before projecting, so earlier media is never clamped away.
        const scope = createGroupScope(previous, scopeRef.current.id);
        if (scope) {
          scopeRef.current = scope;
          setGroupScope(scope);
        }
      }
      current.current = projectForGroup(previous, scopeRef.current);
      setDocumentProject(previous);
      setDirty(true);
    }
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next) {
      past.current.push(documentCurrent.current);
      documentCurrent.current = next;
      if (scopeRef.current) {
        const scope = createGroupScope(next, scopeRef.current.id);
        if (scope) {
          scopeRef.current = scope;
          setGroupScope(scope);
        }
      }
      current.current = projectForGroup(next, scopeRef.current);
      setDocumentProject(next);
      setDirty(true);
    }
  }, []);
  const updateClip = useCallback(
    (id: string, updater: Partial<Clip> | ((clip: Clip) => Clip)) => {
      const selected = current.current.clips.find((c) => c.id === id);
      if (
        !selected ||
        current.current.tracks.find((t) => t.id === selected.trackId)?.locked
      )
        return;
      apply((p) => ({
        ...p,
        clips: p.clips.map((c) =>
          c.id === id
            ? fitUpdatedText(
                c,
                reconcileTextRuns(
                  c,
                  typeof updater === "function" ? updater(c) : { ...c, ...updater },
                ),
              )
            : c,
        ),
      }));
    },
    [apply],
  );
  const updateTextAppearance = useCallback(
    (
      id: string,
      patch: CaptionAppearance,
      options: { preserveFontSize?: boolean; characterPatch?: CharacterStyle } = {},
    ) => {
      apply((project) => {
        const target = project.clips.find((clip) => clip.id === id);
        if (
          !target ||
          project.tracks.find((track) => track.id === target.trackId)?.locked
        )
          return project;
        const next = target.caption
          ? updateCaptionAppearance(project, id, patch, editAllCaptions)
          : {
              ...project,
              clips: project.clips.map((clip) =>
                clip.id === id
                  ? {
                      ...clip,
                      ...patch,
                      transform: { ...clip.transform, ...patch.transform },
                    }
                  : clip,
              ),
            };
        if (next === project) return project;
        return {
          ...next,
          clips: next.clips.map((clip, index) => {
            const before = project.clips[index];
            if (clip === before) return clip;
            const fitted = fitUpdatedText(
              before,
              options.characterPatch
                ? applyCharacterStyle(clip, null, options.characterPatch)
                : clip,
            );
            return options.preserveFontSize && before.style && fitted.style
              ? {
                  ...fitted,
                  style: { ...fitted.style, fontSize: before.style.fontSize },
                }
              : fitted;
          }),
        };
      });
    },
    [apply, editAllCaptions],
  );
  const updateCharacterStyle = useCallback(
    (id: string, patch: CharacterStyle) => {
      const target = current.current.clips.find((clip) => clip.id === id);
      if (!target) return;
      const range = textSelection?.clipId === id && textSelection.end > textSelection.start
        ? textSelection : null;
      if (range) {
        // A local geometry edit must not refit and resize the unselected text.
        const changesMetrics = patch.fontSize !== undefined ||
          patch.fontFamily !== undefined || patch.outlineWidth !== undefined;
        updateClip(id, (clip) => ({
          ...applyCharacterStyle(clip, range, patch),
          ...(changesMetrics ? { autoResizeText: false } : {}),
        }));
      } else {
        updateTextAppearance(
          id,
          { style: { ...target.style!, ...patch } },
          { characterPatch: patch },
        );
      }
    },
    [textSelection, updateClip, updateTextAppearance],
  );
  const selectCaptionTrack = useCallback(
    (trackId: string, time?: number) => {
      const clips = current.current.clips.filter(
        (clip) => clip.caption && clip.trackId === trackId,
      );
      const active =
        clips.find(
          (clip) =>
            time !== undefined &&
            clip.start <= time &&
            time < clip.start + clip.duration,
        ) ?? clips[0];
      select(active?.id ?? null);
    },
    [select],
  );
  const updateContentTransform = useCallback(
    (id: string, patch: Partial<ContentTransform>) => {
      const frame = keyframeRef.current;
      updateClip(id, (clip) =>
        animateContent(clip, patch, {
          time: playback.getSnapshot() - clip.start,
          auto: autoAnimate,
          duration: defaults.current.timing.animation,
          endpoint: frame?.clipId === id ? frame : undefined,
        }),
      );
    },
    [updateClip, playback, autoAnimate],
  );
  const updateMask = useCallback(
    (id: string, patch: Partial<MaskGeometry>) => {
      const frame = keyframeRef.current;
      updateClip(id, (clip) =>
        animateMask(clip, patch, {
          time: playback.getSnapshot() - clip.start,
          auto: autoAnimate,
          duration: defaults.current.timing.animation,
          endpoint: frame?.clipId === id ? frame : undefined,
        }),
      );
    },
    [updateClip, playback, autoAnimate],
  );
  const updateCrop = useCallback(
    (id: string, crop: Crop, resetContent = false) => {
      const frame = keyframeRef.current;
      updateClip(id, (clip) => {
        const project = current.current;
        const asset = project.assets.find((asset) => asset.id === clip.assetId);
        if (!asset) return clip;
        const fit = Math.min(
          project.canvas.width / Math.max(1, asset.width),
          project.canvas.height / Math.max(1, asset.height),
        );
        return animateCrop(
          clip,
          crop,
          { width: asset.width * fit, height: asset.height * fit },
          project.canvas,
          {
            time: playback.getSnapshot() - clip.start,
            auto: autoAnimate,
            duration: defaults.current.timing.animation,
            endpoint: frame?.clipId === id ? frame : undefined,
          },
          resetContent,
        );
      });
    },
    [updateClip, playback, autoAnimate],
  );
  const editKeyframe = useCallback(
    (
      clipId: string,
      localTime: number,
      side: "start" | "end",
      keepSelection = false,
    ) => {
      setBehaviorSelection(null);
      setTransitionSelection(null);
      const clip = current.current.clips.find((clip) => clip.id === clipId);
      const track = current.current.tracks.find(
        (track) => track.id === clip?.trackId,
      );
      if (
        !clip ||
        !track ||
        track.locked ||
        track.hidden ||
        localTime < 0 ||
        localTime > clip.duration
      )
        return;
      const target = animationEditTarget(
        clip,
        localTime + (clip.animationOffset ?? 0),
        side,
      );
      const time = target.time;
      const frame = clip.keyframes.find(
        (frame) => Math.abs(frame.time - time) < 1e-6,
      );
      if (
        !frame &&
        !(
          time === 0 &&
          clip.keyframes.length &&
          clip.keyframes.every((frame) => frame.time > 0)
        )
      )
        return;
      const selection = {
        clipId,
        time: frame?.time ?? 0,
        side: target.side,
        localTime,
      };
      setDrawingSelection(null);
      keyframeRef.current = selection;
      setKeyframeSelection(selection);
      // Recording zooms animate the content inside a fixed video frame.
      // Expose those same crop/pan controls when selecting their endpoints.
      if (frame?.recordingZoom) setCanvasMode("crop");
      selectMany((previous) =>
        keepSelection
          ? [...previous.filter((id) => id !== clipId), clipId]
          : [clipId],
      );
      setPlayingState(false);
      playback.set(clip.start + localTime);
    },
    [playback],
  );
  const editDrawing = useCallback(
    (clipId: string, localTime: number, side: "start" | "end") => {
      const clip = current.current.clips.find((clip) => clip.id === clipId);
      const track = current.current.tracks.find(
        (track) => track.id === clip?.trackId,
      );
      if (
        !clip ||
        !track ||
        track.locked ||
        track.hidden ||
        !drawingAnimationRanges(clip).some(
          (range) =>
            Math.abs((side === "start" ? range.start : range.end) - localTime) <
            1e-6,
        )
      )
        return;
      clearKeyframeEdit();
      setBehaviorSelection(null);
      setTransitionSelection(null);
      setDrawingSelection({
        clipId,
        time: localTime + (clip.animationOffset ?? 0),
        localTime,
        side,
      });
      selectMany([clipId]);
      setPlayingState(false);
      playback.set(clip.start + localTime);
    },
    [clearKeyframeEdit, playback],
  );
  const updateTransform = useCallback(
    (id: string, patch: Partial<Transform>, clipPatch: Partial<Clip> = {}) => {
      const frame = keyframeRef.current;
      const clip = current.current.clips.find((clip) => clip.id === id);
      if (clip?.caption && frame?.clipId !== id) {
        const sampled = transformAt(
          clip,
          playback.getSnapshot() - clip.start,
        );
        updateTextAppearance(id, {
          ...(clipPatch.style ? { style: clipPatch.style } : {}),
          ...(clipPatch.textBox ? { textBox: clipPatch.textBox } : {}),
          transform: {
            ...patch,
            ...(patch.x === undefined
              ? {}
              : { x: clip.transform.x + patch.x - sampled.x }),
            ...(patch.y === undefined
              ? {}
              : { y: clip.transform.y + patch.y - sampled.y }),
          },
        });
        return;
      }
      updateClip(id, (clip) => {
        const source = { ...clip, ...clipPatch };
        return frame?.clipId === id
          ? setKeyframeTransform(
              source,
              patch,
              frame.time,
              frame.side === "start",
            )
          : setTransform(
              source,
              patch,
              playback.getSnapshot() - clip.start,
              autoAnimate,
              defaults.current.timing.animation,
            );
      });
    },
    [updateClip, updateTextAppearance, playback, autoAnimate],
  );
  const copyClipProperties = useCallback(
    (id: string) => {
      const source = current.current.clips.find((clip) => clip.id === id);
      if (!source) return;
      const value = transformAt(
        source,
        playback.getSnapshot() - source.start,
      );
      setClipProperties(
        structuredClone({ ...visualClipAt(source, value), transform: value }),
      );
    },
    [playback],
  );
  const pasteClipProperties = useCallback(
    (ids: readonly string[]) => {
      if (clipProperties)
        apply((project) =>
          applyClipProperties(project, ids, clipProperties, keyframeRef.current ?? undefined),
        );
    },
    [apply, clipProperties],
  );
  const fitClipsToCanvas = useCallback(
    (ids: readonly string[]) => {
      apply((project) => {
        const targets = editableCanvasIds(project, ids);
        if (
          !project.clips.some(
            (clip) => targets.has(clip.id) && clip.kind !== "audio",
          )
        )
          return project;
        return {
          ...project,
          clips: project.clips.map((clip) => {
            if (!targets.has(clip.id) || clip.kind === "audio") return clip;
            const value = transformAt(
              clip,
              playback.getSnapshot() - clip.start,
            );
            const sampled = visualClipAt(clip, value);
            const asset = project.assets.find(
              (asset) => asset.id === clip.assetId,
            );
            const ratio = asset
              ? Math.min(
                  project.canvas.width / Math.max(1, asset.width),
                  project.canvas.height / Math.max(1, asset.height),
                )
              : 1;
            const crop = sampled.crop ?? defaultCrop;
            const size =
              clip.kind === "text"
                ? textBoxFor(clip)
                : asset
                  ? {
                      width: asset.width * ratio * (1 - crop.left - crop.right),
                      height:
                        asset.height * ratio * (1 - crop.top - crop.bottom),
                    }
                  : shapeSize(clip);
            return setTransform(
              clip,
              fitFrameTransform(value, size, project.canvas, clip.rotation),
              playback.getSnapshot() - clip.start,
              autoAnimate,
              defaults.current.timing.animation,
            );
          }),
        };
      });
    },
    [apply, playback, autoAnimate],
  );
  const addCustomAnimation = useCallback(
    (clipId: string, time = playback.getSnapshot()) => {
      const project = current.current;
      const target = animationDropTarget(
        project,
        clipId,
        time,
        defaults.current.timing.animation,
      );
      if (!target) return false;
      if (
        target.result.clip !==
        project.clips.find((clip) => clip.id === target.clipId)
      ) {
        apply({
          ...project,
          clips: project.clips.map((clip) =>
            clip.id === target.clipId ? target.result.clip : clip,
          ),
        });
      }
      select(target.clipId);
      editKeyframe(target.clipId, target.result.time, "end", true);
      return true;
    },
    [playback, apply, select, editKeyframe],
  );
  const addSelectedAnimation = useCallback(() => {
    const project = current.current;
    const targets = editableCanvasIds(project, selectedIds);
    const frame = keyframeRef.current;
    const results = project.clips
      .filter(
        (clip) =>
          targets.has(clip.id) &&
          !project.tracks.find((track) => track.id === clip.trackId)?.locked &&
          !project.tracks.find((track) => track.id === clip.trackId)?.hidden,
      )
      .map((clip) =>
        addAnimationKeyframe(
          clip,
          frame?.clipId === clip.id && frame.side === "end"
            ? frame.time - (clip.animationOffset ?? 0)
            : playback.getSnapshot() - clip.start,
          project.canvas.fps,
          defaults.current.timing.animation,
        ),
      )
      .filter((result) => result !== null);
    if (!results.length) return false;
    const changes = new Map(
      results.map((result) => [result.clip.id, result.clip]),
    );
    if (
      project.clips.some(
        (clip) => changes.has(clip.id) && changes.get(clip.id) !== clip,
      )
    )
      apply({
        ...project,
        clips: project.clips.map((clip) => changes.get(clip.id) ?? clip),
      });
    const focused =
      results.find((result) => result.clip.id === selectedId) ??
      results.at(-1)!;
    // Reusing the selected end must preserve the clicked start's playhead.
    if (
      frame?.clipId !== focused.clip.id ||
      frame.side !== "end" ||
      Math.abs(
        frame.time - (focused.clip.animationOffset ?? 0) - focused.time,
      ) >= 1e-6
    )
      editKeyframe(focused.clip.id, focused.time, "end", true);
    return true;
  }, [selectedIds, selectedId, playback, apply, editKeyframe]);
  const addText = useCallback(
    (preset = 0, text?: string) => {
      const p = current.current;
      // Keep new text above existing visual layers when the top track is busy.
      let track = availableTrack(
        {
          tracks: p.tracks.filter((track) => !track.captionTrack).slice(0, 1),
          clips: p.clips,
        },
        playback.getSnapshot(),
        defaults.current.timing.text,
      );
      const tracks = [...p.tracks];
      if (!track) {
        track = newTrack(tracks.length);
        tracks.unshift(track);
      }
      const clip = newText(track.id, playback.getSnapshot(), preset, text);
      clip.duration = defaults.current.timing.text;
      apply({ ...p, tracks, clips: [...p.clips, clip] });
      select(clip.id);
    },
    [apply, playback],
  );
  const addAnnotation = useCallback(
    (
      template: AnnotationTemplate,
      time = playback.getSnapshot(),
      trackId?: string,
      position?: { x: number; y: number },
    ) => {
      const p = current.current;
      const duration = Math.max(
        defaults.current.timing.annotation,
        template.kind === "shape" && template.drawing?.enabled
          ? template.drawing.delay + template.drawing.duration
          : 0,
      );
      const preferred = trackId
        ? p.tracks.filter(
            (track) => track.id === trackId && !track.captionTrack,
          )
        : p.tracks.filter((track) => !track.captionTrack).slice(0, 1);
      let track = availableTrack(
        { tracks: preferred, clips: p.clips },
        time,
        duration,
      );
      const tracks = [...p.tracks];
      if (!track) {
        track = newTrack(tracks.length);
        tracks.unshift(track);
      }
      const clip = annotationClip(template, track.id, time);
      clip.duration = duration;
      if (clip.kind === "shape" && clip.shape !== "freehand")
        clip.transform.scale = Math.max(
          0.05,
          Math.min(
            1,
            (p.canvas.width * 0.4) / shapeSize(clip).width,
            (p.canvas.height * 0.4) / shapeSize(clip).height,
          ),
        );
      if (position) clip.transform = { ...clip.transform, ...position };
      apply({ ...p, tracks, clips: [...p.clips, clip] });
      setPlaying(false);
      select(clip.id);
      if (clip.shape !== "freehand") setCanvasMode("select");
    },
    [apply, playback, select, setPlaying],
  );
  const addPenStroke = (stroke: DrawingStroke) => {
    penStart.current ??= playback.getSnapshot();
    setPenDraft((strokes) => [...strokes, stroke]);
  };
  const finishDrawing = () => {
    const target = penTargetId
      ? current.current.clips.find((clip) => clip.id === penTargetId)
      : undefined;
    if (target && penDraft.length) {
      const canvas = current.current.canvas;
      updateClip(target.id, (clip) =>
        fitFreehandStrokes(
          clip,
          penDraft,
          canvas,
          Math.max(0, Math.min(clip.duration, playhead - clip.start)),
          penSettings.width,
        ),
      );
    } else {
      const result = freehandAnnotation(penDraft, penSettings, project.canvas);
      if (result)
        addAnnotation(
          result.template,
          penStart.current ?? playback.getSnapshot(),
          undefined,
          result.position,
        );
    }
    setCanvasMode("select");
  };
  const activatePen = () => {
    setPlaying(false);
    if (editingTextId) endTextEdit(editingTextId);
    setPenToolRequest((value) => value + 1);
    if (canvasMode === "draw") return;
    setCanvasMode("draw");
    const target = selectedId
      ? current.current.clips.find((clip) => clip.id === selectedId)
      : undefined;
    const track = target
      ? current.current.tracks.find((item) => item.id === target.trackId)
      : undefined;
    if (
      target?.kind === "shape" &&
      target.shape === "freehand" &&
      target.drawing &&
      !track?.locked &&
      !track?.hidden
    ) {
      const time =
        playhead >= target.start && playhead < target.start + target.duration
          ? playhead
          : target.start;
      if (time !== playhead) seek(time);
      setPenDraft(
        drawingStrokesToCanvas(
          target,
          current.current.canvas,
          Math.max(0, Math.min(target.duration, time - target.start)),
        ),
      );
      setPenTargetId(target.id);
      penStart.current = null;
    } else {
      setPenDraft([]);
      setPenTargetId(null);
      penStart.current = null;
    }
  };
  const addRoundedCorners = useCallback(
    (id?: string) => {
      const project = current.current;
      const ids = id ? [id] : selectedIds;
      const clips = project.clips.map((clip) =>
        ids.includes(clip.id) &&
        !project.tracks.find((track) => track.id === clip.trackId)?.locked
          ? addFrameEffect(clip)
          : clip,
      );
      if (clips.some((clip, index) => clip !== project.clips[index]))
        apply({ ...project, clips });
      if (
        id &&
        project.clips.some((clip) => clip.id === id && supportsMediaFrame(clip))
      )
        select(id);
      clearKeyframeEdit();
      setPlaying(false);
    },
    [apply, selectedIds, select, clearKeyframeEdit, setPlaying],
  );
  const addSpeedEffect = useCallback(
    (id?: string) => {
      const p = current.current;
      const ids = id ? [id] : selectedIds;
      const clips = p.clips.map((clip) =>
        ids.includes(clip.id) &&
        !p.tracks.find((track) => track.id === clip.trackId)?.locked
          ? addClipSpeed(clip)
          : clip,
      );
      if (clips.some((clip, index) => clip !== p.clips[index]))
        apply({ ...p, clips });
      if (
        id &&
        p.clips.some((clip) => clip.id === id && supportsClipSpeed(clip))
      )
        select(id);
      clearKeyframeEdit();
      setPlaying(false);
    },
    [apply, selectedIds, select, clearKeyframeEdit, setPlaying],
  );
  const addVisualEffect = useCallback(
    (effect: VisualEffectId, id?: string) => {
      if (effect === "clip-speed") return addSpeedEffect(id);
      if (effect === "rounded-corners") return addRoundedCorners(id);
      if (!isAdditionalVisualEffect(effect)) return;
      const p = current.current;
      const ids = id ? [id] : selectedIds;
      const clips = p.clips.map((clip) =>
        ids.includes(clip.id) &&
        !p.tracks.find((track) => track.id === clip.trackId)?.locked
          ? addVisualEffectToClip(clip, effect)
          : clip,
      );
      if (clips.some((clip, index) => clip !== p.clips[index]))
        apply({ ...p, clips });
      if (id && clips.some((clip) => clip.id === id && clip.kind !== "audio"))
        select(id);
      clearKeyframeEdit();
      setPlaying(false);
    },
    [
      addSpeedEffect,
      addRoundedCorners,
      selectedIds,
      apply,
      select,
      clearKeyframeEdit,
      setPlaying,
    ],
  );
  const selectTransition = useCallback(
    (selection: TransitionSelection) => {
      select(selection.clipId);
      clearKeyframeEdit();
      setPlaying(false);
      setTransitionSelection(selection);
    },
    [select, clearKeyframeEdit, setPlaying],
  );
  const addTransition = useCallback(
    (target: TransitionTarget) => {
      const before = current.current;
      const next = addProjectTransition(
        before,
        target,
        defaults.current.timing.transition,
      );
      if (next === before) return;
      apply(next);
      selectTransition({ clipId: target.clipId, side: target.side });
    },
    [apply, selectTransition],
  );
  const updateTransition = useCallback(
    (
      selection: TransitionSelection,
      patch: Partial<Omit<Transition, "pairId">> | null,
    ) => {
      apply((p) => updateProjectTransition(p, selection, patch));
      if (patch === null) setTransitionSelection(null);
    },
    [apply],
  );
  const selectBehavior = useCallback(
    (clipId: string, behaviorId: string) => {
      select(clipId);
      clearKeyframeEdit();
      setPlaying(false);
      setBehaviorSelection({ clipId, behaviorId });
    },
    [select, clearKeyframeEdit, setPlaying],
  );
  const addBehavior = useCallback(
    (presetId: string, clipId?: string) => {
      const preset = presetLibrary.findBehavior(presetId);
      if (!preset) return;
      const p = current.current;
      const ids = clipId ? [clipId] : selectedIds;
      let added: { clipId: string; behaviorId: string } | null = null;
      const clips = p.clips.map((clip) => {
        if (
          !ids.includes(clip.id) ||
          !supportsBehaviors(clip) ||
          (clip.behaviors?.length ?? 0) >= 32 ||
          p.tracks.find((track) => track.id === clip.trackId)?.locked
        )
          return clip;
        const behavior = {
          ...behaviorFromPreset(preset, clip.duration, clip.kind),
          name: preset.name,
        };
        added = { clipId: clip.id, behaviorId: behavior.id };
        return { ...clip, behaviors: [...(clip.behaviors ?? []), behavior] };
      });
      if (added) {
        apply({ ...p, clips });
        const target = added as { clipId: string; behaviorId: string };
        selectBehavior(target.clipId, target.behaviorId);
      }
    },
    [apply, selectedIds, selectBehavior, presetLibrary.findBehavior],
  );
  const updateBehavior = useCallback(
    (clipId: string, behaviorId: string, patch: Partial<Behavior>) => {
      updateClip(clipId, (clip) => ({
        ...clip,
        behaviors: clip.behaviors?.map((behavior) =>
          behavior.id === behaviorId ? { ...behavior, ...patch } : behavior,
        ),
      }));
    },
    [updateClip],
  );
  const removeBehavior = useCallback(
    (clipId: string, behaviorId: string) => {
      updateClip(clipId, (clip) => ({
        ...clip,
        behaviors: clip.behaviors?.filter(
          (behavior) => behavior.id !== behaviorId,
        ),
      }));
      setBehaviorSelection(null);
    },
    [updateClip],
  );
  const copyBehavior = useCallback((clipId: string, behaviorId: string) => {
    const value = current.current.clips
      .find((clip) => clip.id === clipId)
      ?.behaviors?.find((behavior) => behavior.id === behaviorId);
    if (value) {
      behaviorClipboard.current = structuredClone(value);
      behaviorClipboardToken.current = uid();
      void window.framecraft
        ?.copyClipClipboard(behaviorClipboardToken.current)
        .catch(() => {});
    }
  }, []);
  const pasteBehavior = useCallback(
    (clipId: string) => {
      const copied = behaviorClipboard.current;
      const clip = current.current.clips.find((clip) => clip.id === clipId);
      if (
        !copied ||
        !clip ||
        !supportsBehaviors(clip) ||
        (clip.behaviors?.length ?? 0) >= 32 ||
        current.current.tracks.find((track) => track.id === clip.trackId)
          ?.locked
      )
        return;
      const value = {
        ...structuredClone(copied),
        id: uid(),
        start: 0,
        duration: clip.duration,
      };
      if (clip.kind !== "text")
        for (const key of ["incoming", "during", "outgoing"] as const)
          value[key] = { ...value[key], type: "whole", offset: 0 };
      updateClip(clip.id, { behaviors: [...(clip.behaviors ?? []), value] });
      selectBehavior(clip.id, value.id);
    },
    [updateClip, selectBehavior],
  );
  const changeClipSpeed = useCallback(
    (id: string, speed: number) => {
      const before = current.current.clips.find((clip) => clip.id === id);
      if (!before) return;
      const next = setClipSpeed(before, speed);
      if (next === before) return;
      clearKeyframeEdit();
      setPlaying(false);
      updateClip(id, next);
    },
    [clearKeyframeEdit, setPlaying, updateClip],
  );
  const changeSpeedDuration = useCallback(
    (id: string, duration: number) => {
      const before = current.current.clips.find((clip) => clip.id === id);
      if (!before) return;
      const next = setSpeedDuration(
        before,
        duration,
        current.current.canvas.fps,
      );
      if (next === before) return;
      clearKeyframeEdit();
      setPlaying(false);
      updateClip(id, next);
    },
    [clearKeyframeEdit, setPlaying, updateClip],
  );
  const removeSpeedEffect = useCallback(
    (id: string) => {
      clearKeyframeEdit();
      setPlaying(false);
      updateClip(id, removeClipSpeed);
    },
    [clearKeyframeEdit, setPlaying, updateClip],
  );
  const addAssets = useCallback(
    (
      assets: Asset[],
      toTimeline = false,
      options: {
        newTrackForImages?: boolean;
        pasteToTop?: boolean;
        trackId?: string;
        time?: number;
      } = {},
    ) => {
      const before = current.current;
      const next = addMediaAssets(
        before,
        assets,
        options.time ?? playback.getSnapshot(),
        toTimeline,
        { ...options, imageDuration: defaults.current.timing.image },
      );
      apply(next);
      if (
        toTimeline &&
        (options.newTrackForImages ||
          options.pasteToTop ||
          options.time !== undefined)
      ) {
        selectMany(
          next.clips.slice(before.clips.length).map((clip) => clip.id),
        );
      }
    },
    [apply, playback],
  );
  const beginTextEdit = useCallback(
    (id: string) => {
      const project = current.current;
      const clip = project.clips.find((clip) => clip.id === id);
      const track = project.tracks.find((track) => track.id === clip?.trackId);
      if (!clip || clip.kind !== "text" || track?.locked || track?.hidden)
        return;
      select(id);
      setPlaying(false);
      seek((time) =>
        time >= clip.start && time < clip.start + clip.duration
          ? time
          : clip.start,
      );
      setEditingTextId(id);
    },
    [select],
  );
  const endTextEdit = useCallback((id: string) => {
    setEditingTextId((current) => (current === id ? null : current));
  }, []);
  const updateVideoZoomPan = useCallback(
    (patch: Partial<Transform>, time = playback.getSnapshot()) => {
      setPlaying(false);
      apply((project) =>
        setVideoZoomPan(
          project,
          patch,
          time,
          defaults.current.timing.animation,
        ),
      );
    },
    [apply, playback],
  );
  const stepFrame = useCallback(
    (direction: PlaybackDirection) => {
      setPlaying(false);
      seek((time) =>
        stepFrameTime(
          time,
          current.current.canvas.fps,
          direction,
          projectDuration(current.current),
        ),
      );
    },
    [seek, setPlaying],
  );
  const jumpMedia = useCallback(
    (direction: PlaybackDirection) => {
      setPlaying(false);
      seek((time) => mediaBoundaryTime(current.current, time, direction));
    },
    [seek, setPlaying],
  );
  const deleteAnimation = useCallback(
    (clipId: string, range: AnimationRange) => {
      updateClip(clipId, (clip) => removeAnimation(clip, range));
      clearKeyframeEdit();
    },
    [updateClip, clearKeyframeEdit],
  );
  const copyAnimation = useCallback(
    (clipId: string, range: AnimationRange, cut = false) => {
      const clip = current.current.clips.find((clip) => clip.id === clipId);
      if (
        !clip ||
        (cut &&
          current.current.tracks.find((track) => track.id === clip.trackId)
            ?.locked)
      )
        return null;
      const value = snapshotAnimation(clip, range);
      if (!value) return null;
      const token = uid();
      animationClipboard.current = { token, value };
      if (cut) deleteAnimation(clipId, range);
      return token;
    },
    [deleteAnimation],
  );
  const pasteCopiedAnimation = useCallback(() => {
    const clip = current.current.clips.find((clip) => clip.id === selectedId);
    if (
      !clip ||
      !animationClipboard.current ||
      current.current.tracks.find((track) => track.id === clip.trackId)?.locked
    )
      return false;
    const next = pasteAnimation(
      clip,
      animationClipboard.current.value,
      playback.getSnapshot() - clip.start,
    );
    if (next === clip) return false;
    updateClip(clip.id, next);
    if (animationClipboard.current.value.drawing) {
      editDrawing(
        clip.id,
        playback.getSnapshot() -
          clip.start +
          animationClipboard.current.value.duration,
        "end",
      );
      return true;
    }
    editKeyframe(
      clip.id,
      playback.getSnapshot() -
        clip.start +
        animationClipboard.current.value.duration,
      "end",
    );
    return true;
  }, [selectedId, playback, updateClip, editKeyframe, editDrawing]);
  const selected = selectedId ? clipsById.get(selectedId) : undefined;
  const editingTrack = project.tracks.find(
    (track) => track.id === selected?.trackId,
  );
  const selectedKeyframe =
    keyframeSelection &&
    selected?.id === keyframeSelection.clipId &&
    !playing &&
    !editingTrack?.locked &&
    !editingTrack?.hidden &&
    keyframeSelection.time - (selected.animationOffset ?? 0) >= 0 &&
    keyframeSelection.time - (selected.animationOffset ?? 0) <=
      selected.duration &&
    keyframeSelection.localTime >= 0 &&
    keyframeSelection.localTime <= selected.duration &&
    Math.abs(playhead - selected.start - keyframeSelection.localTime) < 1e-6 &&
    (selected.keyframes.some(
      (frame) => Math.abs(frame.time - keyframeSelection.time) < 1e-6,
    ) ||
      (keyframeSelection.time === 0 &&
        selected.keyframes.length &&
        selected.keyframes.every((frame) => frame.time > 0)))
      ? keyframeSelection
      : null;
  keyframeRef.current = selectedKeyframe;
  const selectedDrawingRange =
    drawingSelection &&
    selected?.id === drawingSelection.clipId &&
    !playing &&
    !editingTrack?.locked &&
    !editingTrack?.hidden &&
    Math.abs(playhead - selected.start - drawingSelection.localTime) < 1e-6
      ? (drawingAnimationRanges(selected).find(
          (range) =>
            Math.abs(
              (drawingSelection.side === "start" ? range.start : range.end) -
                drawingSelection.localTime,
            ) < 1e-6,
        ) ?? null)
      : null;
  const selectedDrawing = selectedDrawingRange ? drawingSelection : null;
  const selectedAnimation =
    selectedDrawingRange ??
    (selectedKeyframe && selected
      ? (animationRanges(selected).find(
          (range) =>
            Math.abs(
              (selectedKeyframe.side === "end" ? range.end : range.start) +
                (selected.animationOffset ?? 0) -
                selectedKeyframe.time,
            ) < 1e-6,
        ) ?? null)
      : null);
  useEffect(() => {
    if (keyframeSelection && !selectedKeyframe) clearKeyframeEdit();
  }, [keyframeSelection, selectedKeyframe, clearKeyframeEdit]);
  return {
    project,
    documentProject,
    timelineConflict,
    activeGroupId: groupScope?.id ?? null,
    timelineTabs: openGroups.map((id) => ({
      id,
      name: groupName(documentProject, id),
    })),
    switchTimeline,
    closeGroup,
    renameGroup,
    renamingGroup,
    setRenamingGroup,
    presetLibrary,
    preferences,
    apply,
    deleteSelectedClips,
    stitchSelectedClips,
    unstitchSelectedClips,
    timelineFocus,
    replace,
    markSaved,
    selected,
    selectedId,
    selectedIds,
    editAllCaptions,
    setEditAllCaptions,
    selectMany,
    select,
    selectCaptionTrack,
    playback,
    get playhead() {
      return playback.getSnapshot();
    },
    seek,
    advancePlayback,
    playing,
    setPlaying,
    narrationRecording,
    setNarrationRecording,
    dirty,
    setDirty,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    updateClip,
    updateTextAppearance,
    updateContentTransform,
    updateCrop,
    updateMask,
    canvasMode,
    penToolRequest,
    activatePen,
    setCanvasMode,
    penSettings,
    penDraft,
    penTargetId,
    setPenDraft,
    addPenStroke,
    finishDrawing,
    setPenSettings,
    updateTransform,
    copyClipProperties,
    pasteClipProperties,
    hasClipProperties: !!clipProperties,
    fitClipsToCanvas,
    addCustomAnimation,
    addSelectedAnimation,
    selectedKeyframe,
    selectedDrawing,
    selectedAnimation,
    copyAnimation,
    deleteAnimation,
    pasteCopiedAnimation,
    animationClipboardToken: () => animationClipboard.current?.token ?? null,
    clearAnimationClipboard: () => {
      animationClipboard.current = null;
    },
    editKeyframe,
    editDrawing,
    clearKeyframeEdit,
    addText,
    addAnnotation,
    addSpeedEffect,
    addRoundedCorners,
    addVisualEffect,
    addBehavior,
    addTransition,
    updateTransition,
    selectTransition,
    selectedTransition:
      transitionSelection &&
      selectedIds.includes(transitionSelection.clipId) &&
      project.clips.find((clip) => clip.id === transitionSelection.clipId)
        ?.transitions?.[transitionSelection.side]
        ? transitionSelection
        : null,
    updateBehavior,
    removeBehavior,
    selectBehavior,
    selectedBehavior:
      behaviorSelection &&
      selectedIds.includes(behaviorSelection.clipId) &&
      project.clips
        .find((clip) => clip.id === behaviorSelection.clipId)
        ?.behaviors?.some(
          (behavior) => behavior.id === behaviorSelection.behaviorId,
        )
        ? behaviorSelection
        : null,
    behaviorMenu,
    showBehaviorMenu,
    copyBehavior,
    pasteBehavior,
    hasBehaviorClipboard: () => !!behaviorClipboard.current,
    behaviorClipboardToken: () => behaviorClipboardToken.current,
    clearBehaviorClipboard: () => {
      behaviorClipboard.current = null;
      behaviorClipboardToken.current = null;
    },
    changeClipSpeed,
    changeSpeedDuration,
    removeSpeedEffect,
    addAssets,
    editingTextId,
    textSelection,
    setTextSelection,
    updateCharacterStyle,
    beginTextEdit,
    endTextEdit,
    zoomPanDraft,
    setZoomPanDraft,
    updateVideoZoomPan,
    stepFrame,
    jumpMedia,
    autoAnimate,
    setAutoAnimate,
  };
}
export type Editor = ReturnType<typeof useEditor>;

export function useEditorPlayhead(
  editor: Pick<Editor, "playback">,
  enabled = true,
): number {
  const { playback } = editor;
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? playback.subscribe(listener) : () => {},
    [enabled, playback],
  );
  return useSyncExternalStore(
    subscribe,
    playback.getSnapshot,
    playback.getServerSnapshot,
  );
}
