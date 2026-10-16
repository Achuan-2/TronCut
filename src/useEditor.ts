import { addMediaFrame as addFrameEffect, supportsMediaFrame } from "../shared/media-frame";
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
  transformAt,
} from "../shared/editor";
import { selectionWithGroups } from "../shared/timeline";
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
import { fitUpdatedText } from "./text";
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
  const selectedId = selectedIds.at(-1) ?? null;
  const select = useCallback((id: string | null, additive = false) => {
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
        ? captionTrackSelection(current.current, id)
        : selectionWithGroups(current.current, [id]);
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
    setCanvasMode(defaults.current.program.defaultTool);
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
  const updateTextAppearance = useCallback(
    (
      id: string,
      patch: CaptionAppearance,
      options: { preserveFontSize?: boolean } = {},
    ) => {
      apply((project) => {
        const target = project.clips.find((clip) => clip.id === id);
        if (
          !target ||
          project.tracks.find((track) => track.id === target.trackId)?.locked
        )
          return project;
        const next = target.caption
          ? updateCaptionAppearance(project, id, patch)
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
            const fitted = fitUpdatedText(before, clip);
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
    [apply],
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
          time: playhead - clip.start,
          auto: autoAnimate,
          duration: defaults.current.timing.animation,
          endpoint: frame?.clipId === id ? frame : undefined,
        }),
      );
    },
    [updateClip, playhead, autoAnimate],
  );
  const updateMask = useCallback(
    (id: string, patch: Partial<MaskGeometry>) => {
      const frame = keyframeRef.current;
      updateClip(id, (clip) => animateMask(clip, patch, {
        time: playhead - clip.start,
        auto: autoAnimate,
        duration: defaults.current.timing.animation,
        endpoint: frame?.clipId === id ? frame : undefined,
      }));
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
            duration: defaults.current.timing.animation,
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
      const selection = { clipId, time: frame?.time ?? 0, side: target.side };
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
      setPlayhead(clip.start + selection.time - (clip.animationOffset ?? 0));
    },
    [],
  );
  const updateTransform = useCallback(
    (id: string, patch: Partial<Transform>, clipPatch: Partial<Clip> = {}) => {
      const frame = keyframeRef.current;
      const clip = current.current.clips.find((clip) => clip.id === id);
      if (clip?.caption && frame?.clipId !== id) {
        const sampled = transformAt(clip, playhead - clip.start);
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
              playhead - clip.start,
              autoAnimate,
              defaults.current.timing.animation,
            );
      });
    },
    [updateClip, updateTextAppearance, playhead, autoAnimate],
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
        addAnimationKeyframe(
          clip,
          playhead - clip.start,
          project.canvas.fps,
          defaults.current.timing.animation,
        ),
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
        {
          tracks: p.tracks.filter((track) => !track.captionTrack).slice(0, 1),
          clips: p.clips,
        },
        playhead,
        defaults.current.timing.text,
      );
      const tracks = [...p.tracks];
      if (!track) {
        track = newTrack(tracks.length);
        tracks.unshift(track);
      }
      const clip = newText(track.id, playhead, preset, text);
      clip.duration = defaults.current.timing.text;
      apply({ ...p, tracks, clips: [...p.clips, clip] });
      select(clip.id);
    },
    [apply, playhead],
  );
  const addAnnotation = useCallback(
    (
      template: AnnotationTemplate,
      time = playhead,
      trackId?: string,
      position?: { x: number; y: number },
    ) => {
      const p = current.current;
      const preferred = trackId
        ? p.tracks.filter(
            (track) => track.id === trackId && !track.captionTrack,
          )
        : p.tracks.filter((track) => !track.captionTrack).slice(0, 1);
      let track = availableTrack(
        { tracks: preferred, clips: p.clips },
        time,
        defaults.current.timing.annotation,
      );
      const tracks = [...p.tracks];
      if (!track) {
        track = newTrack(tracks.length);
        tracks.unshift(track);
      }
      const clip = annotationClip(template, track.id, time);
      clip.duration = defaults.current.timing.annotation;
      if (clip.kind === "shape")
        clip.transform.scale = Math.max(
          0.05,
          Math.min(
            1,
            (p.canvas.width * 0.4) / 600,
            (p.canvas.height * 0.4) / 300,
          ),
        );
      if (position) clip.transform = { ...clip.transform, ...position };
      apply({ ...p, tracks, clips: [...p.clips, clip] });
      setPlaying(false);
      select(clip.id);
    },
    [apply, playhead, select, setPlaying],
  );
  const addRoundedCorners = useCallback((id?: string) => {
    const project = current.current;
    const ids = id ? [id] : selectedIds;
    const clips = project.clips.map((clip) =>
      ids.includes(clip.id) && !project.tracks.find((track) => track.id === clip.trackId)?.locked
        ? addFrameEffect(clip) : clip,
    );
    if (clips.some((clip, index) => clip !== project.clips[index])) apply({ ...project, clips });
    if (id && project.clips.some((clip) => clip.id === id && supportsMediaFrame(clip))) select(id);
    clearKeyframeEdit();
    setPlaying(false);
  }, [apply, selectedIds, select, clearKeyframeEdit, setPlaying]);
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
    [addSpeedEffect, addRoundedCorners, selectedIds, apply, select, clearKeyframeEdit, setPlaying],
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
        const behavior = { ...behaviorFromPreset(preset, clip.duration, clip.kind), name: preset.name };
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
        options.time ?? playhead,
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
      apply((project) =>
        setVideoZoomPan(
          project,
          patch,
          time,
          defaults.current.timing.animation,
        ),
      );
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
    presetLibrary,
    preferences,
    apply,
    replace,
    markSaved,
    selected,
    selectedId,
    selectedIds,
    selectMany,
    select,
    selectCaptionTrack,
    playhead,
    seek,
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
