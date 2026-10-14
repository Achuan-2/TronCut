import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
  newTrack,
  numberTracks,
  projectDuration,
} from "../shared/model";
import {
  addMediaAssets,
  availableTrack,
  setTransform,
  setKeyframeTransform,
} from "../shared/editor";
import { selectionWithGroups } from "../shared/timeline";
import { setVideoZoomPan } from "../shared/video-zoom-pan";
import { type ContentTransform } from "../shared/crop";
import { animateContent, animateCrop } from "../shared/crop-animation";
import type { Crop } from "../shared/crop";
import { fitUpdatedText } from "./text";
import {
  animationEditTarget,
  animationRanges,
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
  stepFrameTime,
  mediaBoundaryTime,
  type PlaybackDirection,
} from "../shared/playback";

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
export function useEditor() {
  const [project, setProject] = useState<Project>(() => createProject());
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [zoomPanDraft, setZoomPanDraft] = useState<Transform | null>(null);
  const [canvasMode, setCanvasMode] = useState<"select" | "crop">("select");
  type KeyframeSelection = {
    clipId: string;
    time: number;
    side: "start" | "end";
  };
  const [keyframeSelection, setKeyframeSelection] =
    useState<KeyframeSelection | null>(null);
  const keyframeRef = useRef<KeyframeSelection | null>(null);
  const animationClipboard = useRef<{
    token: string;
    value: CopiedAnimation;
  } | null>(null);
  const clearKeyframeEdit = useCallback(() => {
    keyframeRef.current = null;
    setKeyframeSelection(null);
  }, []);
  const [selection, selectMany] = useState<string[]>([]);
  const selectedIds = selection.filter((id) =>
    project.clips.some((c) => c.id === id),
  );
  const selectedId = selectedIds.at(-1) ?? null;
  const select = useCallback((id: string | null, additive = false) => {
    if (id && !additive && keyframeRef.current?.clipId === id) return;
    clearKeyframeEdit();
    if (!id) {
      selectMany([]);
      return;
    }
    const group = selectionWithGroups(current.current, [id]);
    selectMany((previous) =>
      additive
        ? previous.includes(id)
          ? previous.filter((x) => !group.includes(x))
          : [...new Set([...previous, ...group])]
        : group,
    );
  }, []);
  const [playhead, setPlayhead] = useState(1.2);
  const seek = useCallback(
    (next: SetStateAction<number>) => {
      clearKeyframeEdit();
      setPlayhead(next);
    },
    [clearKeyframeEdit],
  );
  const [playing, setPlayingState] = useState(false);
  const setPlaying = useCallback(
    (next: boolean) => {
      if (next) clearKeyframeEdit();
      setPlayingState(next);
    },
    [clearKeyframeEdit],
  );
  const [dirty, setDirty] = useState(false);
  const [autoAnimate, setAutoAnimate] = useState(false);
  const past = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    current = useRef(project);
  current.current = project;
  const apply = useCallback(
    (next: Project | ((project: Project) => Project)) => {
      const before = current.current,
        result = typeof next === "function" ? next(before) : next;
      const tracks = numberTracks(result.tracks);
      const after = tracks === result.tracks ? result : { ...result, tracks };
      if (after === before) return;
      past.current = [...past.current.slice(-99), before];
      future.current = [];
      current.current = after;
      setProject(after);
      setDirty(true);
    },
    [],
  );
  const replace = useCallback((next: Project, unsaved = false) => {
    next = { ...next, tracks: numberTracks(next.tracks) };
    past.current = [];
    future.current = [];
    current.current = next;
    setProject(next);
    setEditingTextId(null);
    setZoomPanDraft(null);
    setCanvasMode("select");
    select(null);
    seek(0);
    setPlaying(false);
    setDirty(unsaved);
  }, []);
  const markSaved = useCallback((saved: Project) => {
    current.current = saved;
    setProject(saved);
    setDirty(false);
  }, []);
  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous) {
      future.current.push(current.current);
      current.current = previous;
      setProject(previous);
      setDirty(true);
    }
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (next) {
      past.current.push(current.current);
      current.current = next;
      setProject(next);
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
                typeof updater === "function"
                  ? updater(c)
                  : { ...c, ...updater },
              )
            : c,
        ),
      }));
    },
    [apply],
  );
  const updateContentTransform = useCallback(
    (id: string, patch: Partial<ContentTransform>) => {
      const frame = keyframeRef.current;
      updateClip(id, (clip) =>
        animateContent(clip, patch, {
          time: playhead - clip.start,
          auto: autoAnimate,
          endpoint: frame?.clipId === id ? frame : undefined,
        }),
      );
    },
    [updateClip, playhead, autoAnimate],
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
            time: playhead - clip.start,
            auto: autoAnimate,
            endpoint: frame?.clipId === id ? frame : undefined,
          },
          resetContent,
        );
      });
    },
    [updateClip, playhead, autoAnimate],
  );
  const editKeyframe = useCallback(
    (
      clipId: string,
      localTime: number,
      side: "start" | "end",
      keepSelection = false,
    ) => {
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
      const selection = { clipId, time: frame?.time ?? 0, side: target.side };
      keyframeRef.current = selection;
      setKeyframeSelection(selection);
      selectMany((previous) =>
        keepSelection
          ? [...previous.filter((id) => id !== clipId), clipId]
          : [clipId],
      );
      setPlayingState(false);
      setPlayhead(clip.start + selection.time - (clip.animationOffset ?? 0));
    },
    [],
  );
  const updateTransform = useCallback(
    (id: string, patch: Partial<Transform>, clipPatch: Partial<Clip> = {}) => {
      const frame = keyframeRef.current;
      updateClip(id, (clip) => {
        const source = { ...clip, ...clipPatch };
        return frame?.clipId === id
          ? setKeyframeTransform(
              source,
              patch,
              frame.time,
              frame.side === "start",
            )
          : setTransform(source, patch, playhead - clip.start, autoAnimate);
      });
    },
    [updateClip, playhead, autoAnimate],
  );
  const addSelectedKeyframe = useCallback(() => {
    const project = current.current;
    const results = project.clips
      .filter(
        (clip) =>
          selectedIds.includes(clip.id) &&
          !project.tracks.find((track) => track.id === clip.trackId)?.locked &&
          !project.tracks.find((track) => track.id === clip.trackId)?.hidden,
      )
      .map((clip) =>
        addAnimationKeyframe(clip, playhead - clip.start, project.canvas.fps),
      )
      .filter((result) => result !== null);
    if (!results.length) return;
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
    editKeyframe(focused.clip.id, focused.time, "end", true);
  }, [selectedIds, selectedId, playhead, apply, editKeyframe]);
  const addText = useCallback(
    (preset = 0, text?: string) => {
      const p = current.current;
      // Keep new text above existing visual layers when the top track is busy.
      let track = availableTrack(
        { tracks: p.tracks.slice(0, 1), clips: p.clips },
        playhead,
        5,
      );
      const tracks = [...p.tracks];
      if (!track) {
        track = newTrack(tracks.length);
        tracks.unshift(track);
      }
      const clip = newText(track.id, playhead, preset, text);
      apply({ ...p, tracks, clips: [...p.clips, clip] });
      select(clip.id);
    },
    [apply, playhead],
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
        options.time ?? playhead,
        toTimeline,
        options,
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
    [apply, playhead],
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
    (patch: Partial<Transform>, time = playhead) => {
      setPlaying(false);
      apply((project) => setVideoZoomPan(project, patch, time));
    },
    [apply, playhead],
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
      playhead - clip.start,
    );
    if (next === clip) return false;
    updateClip(clip.id, next);
    editKeyframe(
      clip.id,
      playhead - clip.start + animationClipboard.current.value.duration,
      "end",
    );
    return true;
  }, [selectedId, playhead, updateClip, editKeyframe]);
  const selected = project.clips.find((c) => c.id === selectedId);
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
    Math.abs(
      playhead -
        selected.start -
        keyframeSelection.time +
        (selected.animationOffset ?? 0),
    ) < 1e-6 &&
    (selected.keyframes.some(
      (frame) => Math.abs(frame.time - keyframeSelection.time) < 1e-6,
    ) ||
      (keyframeSelection.time === 0 &&
        selected.keyframes.length &&
        selected.keyframes.every((frame) => frame.time > 0)))
      ? keyframeSelection
      : null;
  keyframeRef.current = selectedKeyframe;
  const selectedAnimation =
    selectedKeyframe && selected
      ? (animationRanges(selected).find(
          (range) =>
            Math.abs(
              (selectedKeyframe.side === "end" ? range.end : range.start) +
                (selected.animationOffset ?? 0) -
                selectedKeyframe.time,
            ) < 1e-6,
        ) ?? null)
      : null;
  useEffect(() => {
    if (keyframeSelection && !selectedKeyframe) clearKeyframeEdit();
  }, [keyframeSelection, selectedKeyframe, clearKeyframeEdit]);
  return {
    project,
    apply,
    replace,
    markSaved,
    selected,
    selectedId,
    selectedIds,
    selectMany,
    select,
    playhead,
    seek,
    playing,
    setPlaying,
    dirty,
    setDirty,
    undo,
    redo,
    updateClip,
    updateContentTransform,
    updateCrop,
    canvasMode,
    setCanvasMode,
    updateTransform,
    addSelectedKeyframe,
    selectedKeyframe,
    selectedAnimation,
    copyAnimation,
    deleteAnimation,
    pasteCopiedAnimation,
    animationClipboardToken: () => animationClipboard.current?.token ?? null,
    clearAnimationClipboard: () => {
      animationClipboard.current = null;
    },
    editKeyframe,
    clearKeyframeEdit,
    addText,
    addAssets,
    editingTextId,
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
