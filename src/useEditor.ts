import { useCallback, useRef, useState } from "react";
import {
  createProject,
  type Project,
  type Clip,
  newText,
  uid,
  defaultTransform,
  type Asset,
} from "../shared/model";
import { addMediaAssets } from "../shared/editor";
import { selectionWithGroups } from "../shared/timeline";

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
    kind: "visual",
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
  return project;
}
export function useEditor() {
  const [project, setProject] = useState<Project>(demoProject);
  const [selection, selectMany] = useState<string[]>([]);
  const selectedIds = selection.filter((id) =>
    project.clips.some((c) => c.id === id),
  );
  const selectedId = selectedIds.at(-1) ?? null;
  const select = useCallback((id: string | null, additive = false) => {
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
  const [playhead, seek] = useState(1.2);
  const [playing, setPlaying] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autoAnimate, setAutoAnimate] = useState(false);
  const past = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    current = useRef(project);
  current.current = project;
  const apply = useCallback(
    (next: Project | ((project: Project) => Project)) => {
      const before = current.current,
        after = typeof next === "function" ? next(before) : next;
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
    past.current = [];
    future.current = [];
    current.current = next;
    setProject(next);
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
            ? typeof updater === "function"
              ? updater(c)
              : { ...c, ...updater }
            : c,
        ),
      }));
    },
    [apply],
  );
  const addText = useCallback(
    (preset = 0, text?: string) => {
      const p = current.current;
      let track =
        p.tracks.find((t) => t.id === "titles" && !t.locked) ??
        p.tracks.find((t) => t.kind === "visual" && !t.locked);
      const tracks = [...p.tracks];
      if (
        !track ||
        p.clips.some(
          (c) =>
            c.trackId === track!.id &&
            c.start < playhead + 5 &&
            c.start + c.duration > playhead,
        )
      ) {
        track = {
          id: uid(),
          name: "文本与字幕",
          kind: "visual",
          hidden: false,
          muted: false,
          locked: false,
        };
        tracks.unshift(track);
      }
      const clip = newText(track.id, playhead, preset, text);
      apply({ ...p, tracks, clips: [...p.clips, clip] });
      select(clip.id);
    },
    [apply, playhead],
  );
  const addAssets = useCallback(
    (assets: Asset[], toTimeline = false) => {
      apply((p) => addMediaAssets(p, assets, playhead, toTimeline));
    },
    [apply, playhead],
  );
  const selected = project.clips.find((c) => c.id === selectedId);
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
    addText,
    addAssets,
    autoAnimate,
    setAutoAnimate,
  };
}
export type Editor = ReturnType<typeof useEditor>;
