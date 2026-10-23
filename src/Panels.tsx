import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderOpen,
  Type,
  Captions,
  Sparkles,
  AudioLines,
  Settings2,
  Film,
  MonitorDot,
  Music2,
  WandSparkles,
  Mic,
  MousePointer2,
  Paintbrush,
  ArrowRightLeft,
  Star,
  Shapes,
} from "lucide-react";
import { type Asset, type Clip, defaultTransform } from "../shared/model";
import { createTransformSampler } from "../shared/editor";
import { dimensionTransform } from "../shared/canvas";
import { useEditorPlayhead, type Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import { defaultCrop, defaultEffects } from "../shared/effects";
import { textBoxFor } from "./text";
import AssetLibraryPanel from "./AssetLibraryPanel";
import {
  assetClips,
  mediaReplacementError,
  requiredMediaDuration,
  removeLibraryAssets,
  moveProjectMedia,
  editProjectMediaFolder,
} from "../shared/media-library";
import { defaultCursorStyle } from "../shared/cursor";
import CursorStyleSelect from "./CursorStyleSelect";
import NumberInput from "./NumberInput";
import NarrationPanel from "./NarrationPanel";
import AnimationsPanel from "./AnimationsPanel";
import { defaultContentTransform } from "../shared/crop";
import { visualClipAt } from "../shared/visual-state";
import FrameTransformProperties from "./FrameTransformProperties";
import RoundedCornersProperties from "./RoundedCornersProperties";
import VisualEffectProperties from "./VisualEffectProperties";
import AnnotationsPanel from "./AnnotationsPanel";
import VisualEffectsPanel from "./VisualEffectsPanel";
import SpeedProperties from "./SpeedProperties";
import { hasClipSpeed } from "../shared/clip-speed";
import { hasBehaviors } from "../shared/behaviors";
import BehaviorsPanel from "./BehaviorsPanel";
import BehaviorProperties from "./BehaviorProperties";
import TextFillFields from "./TextFillFields";
import TextFormatFields from "./TextFormatFields";
import FontSelect from "./FontSelect";
import TextPresetPicker from "./TextPresetPicker";
import { characterStyleAt } from "../shared/rich-text";
import TransitionsPanel from "./TransitionsPanel";
import TransitionProperties from "./TransitionProperties";
import CaptionsPanel from "./CaptionsPanel";
import FavoritesPanel from "./FavoritesPanel";
import RecordingObjectProperties from "./RecordingObjectProperties";
import AnnotationProperties from "./AnnotationProperties";
import { shapeSize } from "../shared/annotation-style";
import { recordingMaster } from "../shared/recording-objects";
import { animationRanges } from "../shared/animation-ranges";

export type Tab =
  | "favorites"
  | "media"
  | "annotations"
  | "captions"
  | "animations"
  | "narration"
  | "effects"
  | "behaviors"
  | "transitions"
  | "settings";
const tabs = [
  { id: "favorites", name: "收藏夹", icon: Star },
  { id: "media", name: "媒体", icon: FolderOpen },
  { id: "annotations", name: "标注", icon: Type },
  { id: "effects", name: "视觉效果", icon: WandSparkles },
  { id: "transitions", name: "转换", icon: ArrowRightLeft },
  { id: "animations", name: "动画", icon: Sparkles },
  { id: "behaviors", name: "行为", icon: Paintbrush },
  { id: "narration", name: "旁白", icon: Mic },
  { id: "captions", name: "字幕", icon: Captions },
  { id: "settings", name: "设置", icon: Settings2 },
] as const;
interface Props {
  editor: Editor;
  tab: Tab;
  setTab: (tab: Tab) => void;
  importMedia: () => void;
  importDroppedMedia: (files: File[]) => void;
  run: (fn: () => Promise<unknown>) => void;
  toast: (text: string) => void;
  busy: boolean;
  onPreferences: () => void;
}
export default function Panels(props: Props) {
  const { editor, tab, setTab, run, toast } = props,
    { project } = editor;
  const [query, setQuery] = useState("");
  const bridge = () => {
    if (!window.framecraft)
      throw new Error("此功能需要运行桌面版，请使用 pnpm dev");
    return window.framecraft;
  };
  return (
    <aside className="library">
      <nav className="tool-rail">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "selected" : ""}
            onClick={() => setTab(t.id)}
            onContextMenu={t.id === "behaviors" ? (event) => {
              event.preventDefault();
              editor.presetLibrary.showMenu({ kind: "behavior", x: event.clientX, y: event.clientY });
            } : undefined}
          >
            <t.icon size={21} />
            <span>{t.name}</span>
          </button>
        ))}
      </nav>
      <div
        className={`library-content ${tab === "media" ? "media-library" : tab === "captions" ? "captions-library" : tab === "narration" ? "narration-library" : tab === "animations" ? "animations-library" : ""}`}
        onContextMenu={tab === "behaviors" ? (event) => {
          event.preventDefault();
          editor.presetLibrary.showMenu({ kind: "behavior", x: event.clientX, y: event.clientY });
        } : undefined}
      >
        {tab !== "media" && tab !== "captions" && tab !== "animations" && tab !== "narration" && (
          <div className="library-heading">
            <h2>
              {tabs.find((t) => t.id === tab)?.name}
            </h2>
          </div>
        )}
        {editor.presetLibrary.error && <p className="preset-library-error" role="alert">{editor.presetLibrary.error}</p>}
        {tab === "favorites" && <FavoritesPanel editor={editor} toast={toast} />}
        {tab === "media" && (
          <AssetLibraryPanel
            key={`media:${editor.documentProject.id}`}
            toast={toast}
            busy={props.busy}
            assets={project.assets}
            folders={editor.documentProject.mediaFolders}
            onBatchCommand={(assets, command) => run(async () => {
              if (command === "add") {
                if (assets.some((asset) => asset.missing))
                  throw new Error("请先更新离线素材");
                editor.setPlaying(false);
                editor.addAssets(assets, true, {
                  time: editor.playback.getSnapshot(),
                  sequential: true,
                });
              } else {
                editor.editProjectMedia((p) =>
                  removeLibraryAssets(p, assets.map((asset) => asset.id)),
                );
                toast(`已移除 ${assets.length} 个素材及引用片段，保存后清理项目副本和预览代理，可撤销`);
              }
            })}
            onMoveToFolder={(ids, folderId) => run(async () => {
              editor.editProjectMedia((p) => moveProjectMedia(p, ids, folderId));
            })}
            onEditFolder={(command, name, folderId) => {
              editor.editProjectMedia((p) =>
                editProjectMediaFolder(p, command, name, folderId),
              );
            }}
            query={query}
            onQueryChange={setQuery}
            onImport={props.importMedia}
            onDropFiles={props.importDroppedMedia}
            unavailable={(asset) => ({
              ...(asset.missing ? { add: "请先更新离线素材" } : {}),
              replace:
                mediaReplacementError(project, editor.selectedIds, asset) ?? undefined,
              ...(!assetClips(editor.documentProject, asset.id).length
                ? { select: "该素材尚未添加到时间线" } : {}),
            })}
            onCommand={(asset, command) => run(async () => {
              if (command === "add") {
                editor.setPlaying(false);
                editor.addAssets([asset], true, {
                  time: editor.playback.getSnapshot(),
                });
              } else if (command === "replace") {
                editor.replaceMediaSelection(asset);
                toast("已替换所选片段的媒体，时间与效果保持不变");
              } else if (command === "select") {
                editor.selectAssetClips(asset.id);
              } else if (command === "delete") {
                editor.editLibraryAsset(asset.id);
                toast("已移除素材及引用片段，保存后清理项目副本和预览代理，可撤销");
              } else {
                const consumed = requiredMediaDuration(
                  assetClips(editor.documentProject, asset.id),
                );
                const replacement = await bridge().updateMedia(asset.id, consumed);
                if (replacement) {
                  editor.editLibraryAsset(asset.id, replacement);
                  toast("素材已更新，全部引用片段保持时间与效果");
                }
              }
            })}
            onActivate={(asset: Asset) => {
              if (!asset.missing) {
                editor.addAssets([asset], true);
                return;
              }
              run(async () => {
                const consumed = requiredMediaDuration(
                  project.clips.filter((clip) => clip.assetId === asset.id),
                );
                const replacement = await bridge().relinkMedia(asset.id, consumed);
                if (!replacement) return;
                editor.apply((p) => ({
                  ...p,
                  assets: p.assets.map((a) => a.id === asset.id ? replacement : a),
                }));
                toast("素材已重新链接，片段与动画保持原位置");
              });
            }}
          />
        )}
        <div hidden={tab !== "annotations"}>
          <AnnotationsPanel key={project.id} editor={editor} />
        </div>
        {tab === "effects" && <VisualEffectsPanel editor={editor} />}
        {tab === "behaviors" && <BehaviorsPanel editor={editor} />}
        {tab === "transitions" && <TransitionsPanel editor={editor} />}
        <div className="narration-content" hidden={tab !== "narration"}>
          <NarrationPanel
            key={project.id}
            editor={editor}
            active={tab === "narration"}
            busy={props.busy}
            run={run}
            toast={toast}
          />
        </div>
        {tab === "captions" && (
          <CaptionsPanel
            editor={editor}
            run={run}
            toast={toast}
            busy={props.busy}
            onPreferences={props.onPreferences}
          />
        )}
        <AnimationsPanel
          key={project.id}
          editor={editor}
          active={tab === "animations"}
          toast={toast}
        />
        {tab === "settings" && (
          <>
            <h3 className="section-title">项目画布</h3>
            <label className="field">
              分辨率
              <select
                value={`${project.canvas.width}x${project.canvas.height}`}
                onChange={(e) => {
                  const [width, height] = e.target.value.split("x").map(Number);
                  editor.apply((p) => ({
                    ...p,
                    canvas: { ...p.canvas, width, height },
                  }));
                }}
              >
                <option
                  value={`${project.canvas.width}x${project.canvas.height}`}
                >
                  {project.canvas.width} × {project.canvas.height}
                </option>
                <option value="1920x1080">1920 × 1080 · 横屏</option>
                <option value="1080x1920">1080 × 1920 · 竖屏</option>
                <option value="1080x1080">1080 × 1080 · 方形</option>
                <option value="1280x720">1280 × 720 · 轻量</option>
                <option value="3840x2160">3840 × 2160 · 4K</option>
              </select>
            </label>
            <label className="field">
              帧率
              <select
                value={project.canvas.fps}
                onChange={(e) =>
                  editor.apply((p) => ({
                    ...p,
                    canvas: { ...p.canvas, fps: Number(e.target.value) },
                  }))
                }
              >
                {[24, 25, 30, 60].map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              背景
              <input
                type="color"
                value={project.canvas.background}
                onChange={(e) =>
                  editor.apply((p) => ({
                    ...p,
                    canvas: { ...p.canvas, background: e.target.value },
                  }))
                }
              />
            </label>
            <label className="field">
              视频编码
              <select
                value={project.exportSettings?.encoder ?? "auto"}
                onChange={(e) =>
                  editor.apply((p) => ({
                    ...p,
                    exportSettings: {
                      encoder: e.target.value as "auto" | "software",
                    },
                  }))
                }
              >
                <option value="auto">优先硬件 · 自动回退</option>
                <option value="software">CPU · 软件编码</option>
              </select>
            </label>
          </>
        )}
      </div>
    </aside>
  );
}
function CursorProperties({
  clip,
  update,
}: {
  clip: Clip;
  update: (patch: Partial<Clip>) => void;
}) {
  const style = clip.cursorStyle ?? defaultCursorStyle;
  const change = (patch: Partial<typeof style>) =>
    update({ cursorStyle: { ...style, ...patch } });
  return (
    <>
      <h3 className="section-title">鼠标</h3>
      <label className="field">
        鼠标样式
        <CursorStyleSelect
          value={style.style}
          color={style.color}
          onChange={(style) => change({ style })}
        />
      </label>
      <label className="field">
        鼠标大小
        <NumberInput
          min={8}
          max={160}
          value={style.size}
          onValueChange={(size) => change({ size })}
        />
      </label>
      <label className="field">
        鼠标颜色
        <input
          type="color"
          value={style.color}
          onChange={(event) => change({ color: event.target.value })}
        />
      </label>
      {(["clicks", "smooth"] as const).map((key, index) => (
        <label className="check-field" key={key}>
          <input
            type="checkbox"
            checked={style[key]}
            onChange={(event) => change({ [key]: event.target.checked })}
          />
          {["点击高亮", "平滑鼠标移动"][index]}
        </label>
      ))}
    </>
  );
}

function LoudnessProperties({ editor }: { editor: Editor }) {
  const input = useRef<HTMLInputElement>(null);
  const selected = new Set(editor.selectedIds);
  const audio = new Set(
    editor.project.assets.filter(asset => asset.hasAudio).map(asset => asset.id),
  );
  const clips = editor.project.clips.filter(clip =>
    selected.has(clip.id) && audio.has(clip.assetId ?? "") &&
    !clip.audioDetached && (clip.kind === "audio" || clip.kind === "video"),
  );
  const enabled = editor.project.audio?.autoNormalizeLoudness === true;
  const allOn = clips.every(clip => clip.autoNormalizeLoudness !== false);
  const mixed = !allOn && clips.some(clip => clip.autoNormalizeLoudness !== false);
  const locked = clips.some(clip =>
    editor.project.tracks.find(track => track.id === clip.trackId)?.locked,
  );
  useEffect(() => {
    if (input.current) input.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <label className="check-field" title={enabled ? undefined : "请先在项目设置中启用自动标准化响度"}>
      <input
        ref={input}
        type="checkbox"
        checked={allOn}
        aria-checked={mixed ? "mixed" : allOn}
        disabled={!enabled || locked || !clips.length}
        onChange={event => {
          const ids = new Set(clips.map(clip => clip.id));
          const checked = event.target.checked;
          editor.apply(project => ({
            ...project,
            clips: project.clips.map(clip =>
              ids.has(clip.id) ? { ...clip, autoNormalizeLoudness: checked } : clip,
            ),
          }));
        }}
      />
      自动标准化响度
    </label>
  );
}

export function Inspector({ editor }: { editor: Editor }) {
  const playhead = useEditorPlayhead(editor);
  const c = editor.selected,
    locked = editor.project.tracks.find((t) => t.id === c?.trackId)?.locked ||
      (!!c?.recording && editor.project.clips.some(clip => clip.groupId === c.groupId &&
        editor.project.tracks.find(track => track.id === clip.trackId)?.locked));
  const isRecording = !!c && recordingMaster(editor.project, c.id)?.id === c.id;
  const [tab, setTab] = useState({ clipId: "", name: "video" });
  const selectedAsset = useMemo(
    () =>
      c?.assetId
        ? editor.project.assets.find((asset) => asset.id === c.assetId)
        : undefined,
    [editor.project.assets, c?.assetId],
  );
  const sampleTransform = useMemo(
    () => (c ? createTransformSampler(c) : null),
    [c],
  );
  const captionCount = useMemo(
    () =>
      c?.caption
        ? editor.project.clips.filter(
          (clip) => clip.caption && clip.trackId === c.trackId,
        ).length
        : 0,
    [editor.project.clips, c?.caption, c?.trackId],
  );
  if (editor.selectedTransition)
    return <TransitionProperties editor={editor} />;
  const hasCursor = c?.kind === "video" && !!selectedAsset?.cursor;
  const hasText = c?.kind === "text";
  const hasAnimations = c && c.kind !== "audio" && animationRanges(c).length > 0;
  const textSelection = editor.textSelection?.clipId === c?.id ? editor.textSelection : null;
  const characterStyle = c && textSelection ? characterStyleAt(c, textSelection.start) : c?.style;
  const hasAnnotation = c?.kind === "shape";
  const tabs = [
    ...(isRecording ? [{ name: "recording", label: "录屏", icon: MonitorDot }] : []),
    ...(c?.kind !== "audio"
      ? [{ name: "video", label: isRecording ? "画面" : hasCursor ? "视频" : "画面", icon: Film }]
      : []),
    ...(hasAnnotation
      ? [{ name: "annotation", label: "标注", icon: Shapes }]
      : []),
    ...(hasCursor && !isRecording
      ? [{ name: "cursor", label: "鼠标", icon: MousePointer2 }]
      : []),
    ...(hasText ? [{ name: "text", label: "文本", icon: Type }] : []),
    ...(c && hasBehaviors(c)
      ? [{ name: "behaviors", label: "行为", icon: Paintbrush }]
      : []),
    ...(c && !c.audioDetached && selectedAsset?.hasAudio && (c.kind === "video" || c.kind === "audio")
      ? [{ name: "audio", label: "声音", icon: Music2 }]
      : []),
  ];
  const activeTab =
    editor.selectedKeyframe?.clipId === c?.id ? "video" :
      editor.selectedDrawing?.clipId === c?.id ? "annotation" :
        editor.selectedBehavior?.clipId === c?.id
          ? "behaviors"
          : tab.clipId === c?.id &&
            tab.name !== "behaviors" &&
            tabs.some((item) => item.name === tab.name)
            ? tab.name
            : hasAnnotation ? "annotation" : isRecording ? "recording" : hasText
              ? "text"
              : c?.kind === "audio"
                ? "audio"
                : "video";
  const cursorActive = activeTab === "cursor";
  const textActive = activeTab === "text";
  const value =
    c && sampleTransform
      ? sampleTransform(playhead - c.start)
      : defaultTransform;
  const update = (patch: Partial<Clip>) => {
    if (!c || locked) return;
    if (patch.style || patch.textBox || patch.autoResizeText !== undefined)
      editor.updateTextAppearance(c.id, patch);
    else editor.updateClip(c.id, patch);
  };
  const transform = (key: keyof typeof value, v: number) => {
    if (c && !locked && Number.isFinite(v))
      editor.updateTransform(c.id, { [key]: v });
  };
  const editingContent =
    editor.canvasMode === "crop" && c && ["image", "video"].includes(c.kind);
  const sampledVisual = c ? visualClipAt(c, value) : null;
  const content = sampledVisual?.contentTransform ?? defaultContentTransform;
  const contentOrFrame = (key: "scale" | "x" | "y", next: number) => {
    if (!c || locked || !Number.isFinite(next)) return;
    if (editingContent) editor.updateContentTransform(c.id, { [key]: next });
    else transform(key, next);
  };
  const asset = selectedAsset;
  const fit = asset
    ? Math.min(
      editor.project.canvas.width / Math.max(1, asset.width),
      editor.project.canvas.height / Math.max(1, asset.height),
    )
    : 1;
  const crop = sampledVisual?.crop ?? defaultCrop;
  const size =
    c?.kind === "text"
      ? textBoxFor(c)
      : asset
        ? {
          width: asset.width * fit * (1 - crop.left - crop.right),
          height: asset.height * fit * (1 - crop.top - crop.bottom),
        }
        : c ? shapeSize(c) : { width: 600, height: 300 };
  const resize = (axis: "width" | "height", pixels: number) => {
    if (!c || locked) return;
    if (c.kind === "text" && editor.selectedKeyframe?.clipId !== c.id) {
      const dimension =
        pixels / (value.scale * (value[axis === "width" ? "scaleX" : "scaleY"] ?? 1));
      if (dimension >= 16 && dimension <= 32768)
        update({ textBox: { ...size, [axis]: dimension } });
    } else {
      const patch = dimensionTransform(
        value, size, axis, pixels,
        c.kind === "text" || c.lockAspectRatio !== false,
      );
      if (patch) editor.updateTransform(c.id, patch);
    }
  };
  const numberField = (
    label: string,
    current: number,
    change: (value: number) => void,
    min?: number,
    max?: number,
    step = 1,
    disabled = false,
  ) => (
    <label className="field">
      {label}
      <NumberInput
        value={Number(current.toFixed(3))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={change}
      />
    </label>
  );
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <span>属性</span>
        <Settings2 size={15} />
      </div>
      {c && (
        <div
          className="inspector-tabs"
          role="tablist"
          aria-label="片段属性"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const current = tabs.findIndex((item) => item.name === activeTab);
            const index =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (current +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    tabs.length) %
                  tabs.length;
            if (tabs[index].name !== "video") editor.clearKeyframeEdit();
            if (tabs[index].name !== "behaviors") editor.select(c.id);
            else if (c.behaviors?.length)
              editor.selectBehavior(c.id, c.behaviors[0].id);
            setTab({ clipId: c.id, name: tabs[index].name });
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>("button")
            [index]?.focus();
          }}
        >
          {tabs.map(({ name, label, icon: Icon }) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`inspector-${name}-tab`}
              aria-controls={`inspector-${name}`}
              aria-selected={activeTab === name}
              tabIndex={activeTab === name ? 0 : -1}
              onClick={() => {
                if (name !== "video") editor.clearKeyframeEdit();
                if (name !== "behaviors") editor.select(c.id);
                else if (c.behaviors?.length)
                  editor.selectBehavior(c.id, c.behaviors[0].id);
                setTab({ clipId: c.id, name });
              }}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="inspector-body">
        {!c ? (
          <div className="inspector-empty">
            <Settings2 size={28} />
            <b>选择一个片段</b>
            <p>
              编辑文字、位置、动画和声音
              <br />
              每一步，都在你的掌控之中。
            </p>
          </div>
        ) : (
          <fieldset disabled={!!locked}>
            <div className="inspector-selection">
              {hasAnimations && (
                <button
                  type="button"
                  className="edit-all-animations"
                  aria-label="编辑所有动画"
                  aria-pressed={editor.editAllAnimations}
                  title={
                    editor.editAllAnimations
                      ? "编辑所有动画：属性更改影响整个素材的所有动画。点击切换为编辑单个动画。"
                      : "属性更改影响单个动画。点击开启编辑所有动画。"
                  }
                  onClick={() => editor.setEditAllAnimations(!editor.editAllAnimations)}
                >
                  <svg width="44" height="20" viewBox="0 0 44 20" aria-hidden="true">
                    <path d="M8 10h9m9 0h9" stroke="currentColor" strokeWidth="2" />
                    <path d="m12 5 6 5-6 5zm17 0 6 5-6 5z" fill="currentColor" />
                    <g className="animation-scope-dots" fill="currentColor">
                      <circle cx="5" cy="10" r="3" />
                      <circle cx="22" cy="10" r="3" />
                      <circle cx="39" cy="10" r="3" />
                    </g>
                  </svg>
                </button>
              )}
              {!hasAnimations && (
                <span className={`selection-icon ${isRecording ? "recording-object-selection" : c.kind}`}>
                  {isRecording ? (
                    <MonitorDot size={20} className="recording-object-icon" role="img" aria-label="录屏组合" />
                  ) : c.kind === "text" ? (
                    <Type size={20} />
                  ) : c.kind === "audio" ? (
                    <AudioLines size={20} />
                  ) : (
                    <Film size={20} />
                  )}
                </span>
              )}
              <div>
                <b title={c.name}>{isRecording ? "录屏对象" : c.name}</b>
                <small>
                  {locked
                    ? "轨道已锁定"
                    : c.kind === "text"
                      ? c.caption
                        ? editor.editAllCaptions
                          ? `字幕轨道 · ${captionCount} 条字幕（样式与位置统一设置）`
                          : "字幕 · 仅编辑当前字幕"
                        : "文本图层"
                      : c.kind === "shape"
                        ? "标注图层"
                        : isRecording ? c.name : "媒体片段"}
                </small>
              </div>
            </div>
            {c.caption && (
              <label
                className="check-field"
                title="勾选后同步修改同轨所有字幕的样式与位置；取消后仅修改当前字幕。"
              >
                <input
                  type="checkbox"
                  checked={editor.editAllCaptions}
                  onChange={(event) =>
                    editor.setEditAllCaptions(event.target.checked)
                  }
                />
                编辑字幕所有文字
              </label>
            )}
            {editor.selectedKeyframe && !editor.editAllAnimations && (
              <div className="keyframe-edit-status" role="status">
                <span>
                  编辑动画
                  {editor.selectedKeyframe.side === "start"
                    ? "起点"
                    : "终点"} · {timeLabel(
                      c.start + editor.selectedKeyframe.time - (c.animationOffset ?? 0),
                    )}
                </span>
                <button type="button" onClick={editor.clearKeyframeEdit}>
                  退出
                </button>
              </div>
            )}
            {isRecording && activeTab === "recording" && <div role="tabpanel" id="inspector-recording"
              aria-labelledby="inspector-recording-tab" hidden={activeTab !== "recording"}>
              <RecordingObjectProperties key={c.id} clip={c} editor={editor} />
            </div>}
            {hasCursor && !isRecording && (
              <div
                id="inspector-cursor"
                role="tabpanel"
                aria-labelledby="inspector-cursor-tab"
                hidden={!cursorActive}
              >
                <CursorProperties clip={c} update={update} />
              </div>
            )}
            {c.kind === "text" && (
              <div
                id="inspector-text"
                role="tabpanel"
                aria-labelledby="inspector-text-tab"
                hidden={!textActive}
              >
                <h3 className="section-title">文本内容</h3>
                <textarea
                  aria-label="文本内容"
                  title={"支持 $公式$（行内）和 $$公式$$（独立一行）；公式跟随文字颜色，也可用 \\textcolor{red}{x} 局部着色"}
                  placeholder="输入文字或公式，例如 $E=mc^2$"
                  value={c.text ?? ""}
                  maxLength={10000}
                  onSelect={(event) => {
                    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
                    if (end > start)
                      editor.setTextSelection({ clipId: c.id, start, end });
                    else if (document.activeElement === event.currentTarget)
                      editor.setTextSelection(null);
                  }}
                  onChange={(e) =>
                    update({
                      text: e.target.value,
                      name: e.target.value.slice(0, 24) || "文本",
                    })
                  }
                />
                <p className="field-help text-selection-status">
                  {textSelection ? `已选中 ${Array.from((c.text ?? "").slice(textSelection.start, textSelection.end)).length} 个字符，样式仅应用于选中文字。` : "选中部分文字可单独修改样式，未选择时应用于整段。"}
                </p>
                <TextPresetPicker
                  presets={editor.presetLibrary.textPresets}
                  style={characterStyle}
                  disabled={locked}
                  onSelect={(preset) => {
                    if (locked) return;
                    const {
                      fontFamily, color, outline, outlineWidth,
                      bold, italic, underline,
                    } = preset.style;
                    const characterPatch = {
                      fontFamily,
                      color,
                      outline,
                      outlineWidth,
                      bold: bold !== false,
                      italic: !!italic,
                      underline: !!underline,
                    };
                    if (textSelection) {
                      editor.updateCharacterStyle(c.id, characterPatch);
                      return;
                    }
                    editor.updateTextAppearance(
                      c.id,
                      { style: { ...preset.style } },
                      { preserveFontSize: true, characterPatch },
                    );
                  }}
                />
                <button
                  type="button"
                  className="wide-button save-text-preset"
                  onClick={() => {
                    if (c.style)
                      editor.presetLibrary.saveText({
                        ...c.style,
                        ...characterStyle,
                      });
                  }}
                >
                  保存当前预设为模板
                </button>
                {numberField(
                  "字号",
                  characterStyle?.fontSize ?? 68,
                  (fontSize) => editor.updateCharacterStyle(c.id, { fontSize }),
                  8,
                  300,
                  1,
                  !!c.autoResizeText && !textSelection,
                )}
                <label className="field">
                  文字颜色
                  <input
                    type="color"
                    value={characterStyle?.color ?? "#ffffff"}
                    onChange={(e) =>
                      editor.updateCharacterStyle(c.id, { color: e.target.value })
                    }
                  />
                </label>
                <label className="field">
                  描边颜色
                  <input
                    type="color"
                    value={characterStyle?.outline ?? "#111111"}
                    onChange={(e) =>
                      editor.updateCharacterStyle(c.id, { outline: e.target.value })
                    }
                  />
                </label>
                {numberField(
                  "描边宽度",
                  characterStyle?.outlineWidth ?? 4,
                  (outlineWidth) =>
                    editor.updateCharacterStyle(c.id, { outlineWidth }),
                  0,
                  20,
                )}
                <FontSelect value={characterStyle?.fontFamily ?? "Microsoft YaHei"} onChange={(fontFamily) => editor.updateCharacterStyle(c.id, { fontFamily })} />
                <TextFormatFields
                  style={characterStyle}
                  disabled={locked}
                  onChange={(patch) => editor.updateCharacterStyle(c.id, patch)}
                />
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={!!c.autoResizeText}
                    onChange={(event) =>
                      update({ autoResizeText: event.target.checked })
                    }
                  />
                  自动调整文本大小
                </label>
                <p className="field-help">
                  拖动画布中的文本框手柄，按框的宽高调整字号。
                </p>
                <TextFillFields
                  style={c.style}
                  onChange={(patch) =>
                    editor.updateTextAppearance(
                      c.id,
                      { style: { ...c.style!, ...patch } },
                      { preserveFontSize: true },
                    )
                  }
                />
              </div>
            )}
            {hasAnnotation && (
              <div
                id="inspector-annotation"
                role="tabpanel"
                aria-labelledby="inspector-annotation-tab"
                hidden={activeTab !== "annotation"}
              >
                <AnnotationProperties clip={c} editor={editor} />
              </div>
            )}
            <div
              id="inspector-video"
              role="tabpanel"
              aria-labelledby="inspector-video-tab"
              hidden={activeTab !== "video"}
            >
              {c.kind !== "audio" && (
                <>
                  <FrameTransformProperties
                    clip={c} value={value} canvas={editor.project.canvas} size={size}
                    editingContent={!!editingContent} content={content} disabled={locked}
                    onTransform={transform} onContentOrFrame={contentOrFrame} onResize={resize}
                    onToggleAspectRatio={() => update({ lockAspectRatio: c.lockAspectRatio === false })}
                    onPosition={(position) => {
                      if (!locked) editor.updateTransform(c.id, position);
                    }}
                    onCenter={() => editingContent
                      ? editor.updateContentTransform(c.id, { x: 0, y: 0 })
                      : editor.updateTransform(c.id, { x: 0.5, y: 0.5, z: 0 })}
                  />
                  <div className="flip-controls">
                    {(["flipX", "flipY"] as const).map((key, index) => (
                      <label className="check-field" key={key}>
                        <input
                          type="checkbox"
                          checked={(c.effects ?? defaultEffects)[key]}
                          onChange={(e) =>
                            update({
                              effects: {
                                ...(c.effects ?? defaultEffects),
                                [key]: e.target.checked,
                              },
                            })
                          }
                        />
                        {["水平翻转", "垂直翻转"][index]}
                      </label>
                    ))}
                  </div>
                </>
              )}
              {c.mediaFrame && !isRecording && (
                <RoundedCornersProperties key={c.id} clip={c} editor={editor} size={size} />
              )}
              {hasClipSpeed(c) && <SpeedProperties key={c.id} clip={c} editor={editor} />}
              {c.visualEffects && <VisualEffectProperties clip={c} sampledClip={sampledVisual ?? c} editor={editor} />}
            </div>
            <div
              id="inspector-audio"
              role="tabpanel"
              aria-labelledby="inspector-audio-tab"
              hidden={activeTab !== "audio"}
            >
              {!c.audioDetached && c.assetId &&
                editor.project.assets.find((a) => a.id === c.assetId)
                  ?.hasAudio && (
                  <>
                    <h3 className="section-title">声音</h3>
                    <LoudnessProperties editor={editor} />
                    <label className="field">
                      音量
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={c.volume}
                        onChange={(e) =>
                          update({ volume: Number(e.target.value) })
                        }
                      />
                      <span className="range-value">
                        {Math.round(c.volume * 100)}%
                      </span>
                    </label>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={c.podcast}
                        onChange={(e) => update({ podcast: e.target.checked })}
                      />
                      播客人声增强（导出）
                    </label>
                  </>
                )}
            </div>
            {c.kind === "audio" && hasClipSpeed(c) && activeTab === "audio" && (
              <SpeedProperties clip={c} editor={editor} />
            )}
            {hasBehaviors(c) && (
              <div
                id="inspector-behaviors"
                role="tabpanel"
                aria-labelledby="inspector-behaviors-tab"
                hidden={activeTab !== "behaviors"}
              >
                <BehaviorProperties clip={c} editor={editor} />
              </div>
            )}
          </fieldset>
        )}
      </div>
    </aside>
  );
}
