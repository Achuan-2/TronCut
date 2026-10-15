import { useMemo, useState } from "react";
import {
  FolderOpen,
  Type,
  Captions,
  Sparkles,
  AudioLines,
  Settings2,
  Film,
  Music2,
  WandSparkles,
  Mic,
  MousePointer2,
  Paintbrush,
  ArrowRightLeft,
} from "lucide-react";
import { type Asset, type Clip, textPresets, defaultTransform } from "../shared/model";
import { createTransformSampler } from "../shared/editor";
import type { Capabilities } from "../shared/bridge";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import { defaultCrop, defaultEffects } from "../shared/effects";
import { textBoxFor } from "./text";
import MediaLibrary from "./MediaLibrary";
import { defaultCursorStyle } from "../shared/cursor";
import NarrationPanel from "./NarrationPanel";
import AnimationsPanel from "./AnimationsPanel";
import { defaultContentTransform } from "../shared/crop";
import { visualClipAt } from "../shared/visual-state";
import FrameTransformProperties from "./FrameTransformProperties";
import RoundedCornersProperties from "./RoundedCornersProperties";
import AnnotationsPanel from "./AnnotationsPanel";
import VisualEffectsPanel from "./VisualEffectsPanel";
import SpeedProperties from "./SpeedProperties";
import { hasClipSpeed } from "../shared/clip-speed";
import { hasBehaviors } from "../shared/behaviors";
import BehaviorsPanel from "./BehaviorsPanel";
import BehaviorProperties from "./BehaviorProperties";
import TextFillFields from "./TextFillFields";
import TransitionsPanel from "./TransitionsPanel";
import TransitionProperties from "./TransitionProperties";
import CaptionsPanel from "./CaptionsPanel";

export type Tab =
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
  { id: "media", name: "媒体", icon: FolderOpen },
  { id: "annotations", name: "标注", icon: Type },
  { id: "captions", name: "字幕", icon: Captions },
  { id: "animations", name: "动画", icon: Sparkles },
  { id: "behaviors", name: "行为", icon: Paintbrush },
  { id: "transitions", name: "转换", icon: ArrowRightLeft },
  { id: "effects", name: "视觉效果", icon: WandSparkles },
  { id: "narration", name: "旁白", icon: Mic },
  { id: "settings", name: "设置", icon: Settings2 },
] as const;
interface Props {
  editor: Editor;
  tab: Tab;
  setTab: (tab: Tab) => void;
  importMedia: () => void;
  capabilities?: Capabilities;
  run: (fn: () => Promise<unknown>) => void;
  toast: (text: string) => void;
  refreshCapabilities: () => void;
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
          >
            <t.icon size={21} />
            <span>{t.name}</span>
          </button>
        ))}
      </nav>
      <div
        className={`library-content ${tab === "media" ? "media-library" : tab === "captions" ? "captions-library" : tab === "narration" ? "narration-library" : tab === "animations" ? "animations-library" : ""}`}
      >
        {tab !== "captions" && tab !== "animations" && tab !== "narration" && (
          <div className="library-heading">
            <h2>
              {tabs.find((t) => t.id === tab)?.name === "媒体"
                ? "素材库"
                : tabs.find((t) => t.id === tab)?.name}
            </h2>
            {tab === "media" && <span>{project.assets.length} 个素材</span>}
          </div>
        )}
        {tab === "media" && (
          <MediaLibrary
            assets={project.assets}
            query={query}
            onQueryChange={setQuery}
            onImport={props.importMedia}
            onActivate={(asset: Asset) => {
              if (!asset.missing) {
                editor.addAssets([asset], true);
                return;
              }
              run(async () => {
                const consumed = Math.max(
                  0,
                  ...project.clips
                    .filter((c) => c.assetId === asset.id)
                    .map((c) => c.sourceIn + c.duration * c.speed),
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
            <h3 className="section-title">工程画布</h3>
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
            <h3 className="section-title">媒体引擎</h3>
            <div className="engine-status">
              <i className={props.capabilities?.ffmpeg ? "online" : ""} />
              {props.capabilities?.ffmpeg
                ? "FFmpeg / FFprobe 可用"
                : "请配置 FFmpeg / FFprobe"}
            </div>
            {(["ffmpeg", "ffprobe", "videocaptioner"] as const).map((name) => (
              <button
                className="wide-button"
                key={name}
                onClick={() =>
                  run(async () => {
                    await bridge().selectBinary(name);
                    props.refreshCapabilities();
                  })
                }
              >
                <Settings2 size={14} />
                配置 {name}
              </button>
            ))}
            <p className="small-note">
              开发版可从 PATH 查找引擎。安装包的媒体引擎放在 resources/bin。
            </p>
            <h3 className="section-title">TronCut</h3>
            <p className="small-note">
              本地工程 · 自由表达
              <br />
              Windows
              原生录屏支持独立鼠标、自动背景与鼠标聚焦缩放；兼容录制的鼠标包含在画面中。TREC
              和完整 Camtasia 特效兼容仍在开发计划中。
            </p>
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
        <select
          value={style.style}
          onChange={(event) =>
            change({ style: event.target.value as typeof style.style })
          }
        >
          <option value="arrow">箭头</option>
          <option value="circle">圆形</option>
          <option value="cross">十字</option>
          <option value="hidden">隐藏鼠标</option>
        </select>
      </label>
      <label className="field">
        鼠标大小
        <input
          type="number"
          min={8}
          max={160}
          value={style.size}
          onChange={(event) => {
            const size = Number(event.target.value);
            if (Number.isFinite(size) && size >= 8 && size <= 160)
              change({ size });
          }}
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

export function Inspector({ editor }: { editor: Editor }) {
  const c = editor.selected,
    locked = editor.project.tracks.find((t) => t.id === c?.trackId)?.locked;
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
  const tabs = [
    ...(c?.kind !== "audio"
      ? [{ name: "video", label: hasCursor ? "视频" : "画面", icon: Film }]
      : []),
    ...(hasCursor
      ? [{ name: "cursor", label: "鼠标", icon: MousePointer2 }]
      : []),
    ...(hasText ? [{ name: "text", label: "文本", icon: Type }] : []),
    ...(c && hasBehaviors(c)
      ? [{ name: "behaviors", label: "行为", icon: Paintbrush }]
      : []),
    ...(c?.kind === "audio"
      ? [{ name: "audio", label: "声音", icon: Music2 }]
      : []),
  ];
  const activeTab =
    editor.selectedBehavior?.clipId === c?.id
      ? "behaviors"
      : tab.clipId === c?.id &&
          tab.name !== "behaviors" &&
          tabs.some((item) => item.name === tab.name)
        ? tab.name
        : hasText
          ? "text"
          : c?.kind === "audio"
            ? "audio"
            : "video";
  const cursorActive = activeTab === "cursor";
  const textActive = activeTab === "text";
  const value =
    c && sampleTransform
      ? sampleTransform(editor.playhead - c.start)
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
        : { width: 600, height: 300 };
  const resize = (axis: "width" | "height", pixels: number) => {
    if (!c || locked) return;
    if (c.kind === "text" && editor.selectedKeyframe?.clipId !== c.id) {
      const dimension = pixels / value.scale;
      if (dimension >= 16 && dimension <= 32768)
        update({ textBox: { ...size, [axis]: dimension } });
    } else {
      const scale = pixels / size[axis];
      if (scale >= 0.05 && scale <= 8) transform("scale", scale);
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
      <input
        type="number"
        value={Number(current.toFixed(3))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (
            Number.isFinite(v) &&
            (min === undefined || v >= min) &&
            (max === undefined || v <= max)
          )
            change(v);
        }}
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
              <span className={`selection-icon ${c.kind}`}>
                {c.kind === "text" ? (
                  <Type size={20} />
                ) : c.kind === "audio" ? (
                  <AudioLines size={20} />
                ) : (
                  <Film size={20} />
                )}
              </span>
              <div>
                <b title={c.name}>{c.name}</b>
                <small>
                  {locked
                    ? "轨道已锁定"
                    : c.kind === "text"
                      ? c.caption
                        ? `字幕轨道 · ${captionCount} 条字幕（样式与位置统一设置）`
                        : "文本图层"
                      : c.kind === "shape"
                        ? "标注图层"
                        : "媒体片段"}
                </small>
              </div>
            </div>
            {editor.selectedKeyframe && (
              <div className="keyframe-edit-status" role="status">
                <span>
                  编辑动画
                  {editor.selectedKeyframe.side === "start"
                    ? "起点"
                    : "终点"} · {timeLabel(editor.playhead)}
                </span>
                <button type="button" onClick={editor.clearKeyframeEdit}>
                  退出
                </button>
              </div>
            )}
            {hasCursor && (
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
                  value={c.text ?? ""}
                  onChange={(e) =>
                    update({
                      text: e.target.value,
                      name: e.target.value.slice(0, 24) || "文本",
                    })
                  }
                />
                <label className="field">
                  花字
                  <select
                    value=""
                    onChange={(e) => {
                      if (locked) return;
                      editor.updateTextAppearance(
                        c.id,
                        {
                          style: {
                            ...textPresets[Number(e.target.value)].style,
                          },
                        },
                        { preserveFontSize: true },
                      );
                    }}
                  >
                    <option value="" disabled>
                      选择模板
                    </option>
                    {textPresets.map((p, i) => (
                      <option key={p.name} value={i}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                {numberField(
                  "字号",
                  c.style?.fontSize ?? 68,
                  (fontSize) => update({ style: { ...c.style!, fontSize } }),
                  8,
                  300,
                  1,
                  !!c.autoResizeText,
                )}
                <label className="field">
                  文字颜色
                  <input
                    type="color"
                    value={c.style?.color ?? "#ffffff"}
                    onChange={(e) =>
                      update({
                        style: { ...c.style!, color: e.target.value },
                      })
                    }
                  />
                </label>
                <label className="field">
                  描边颜色
                  <input
                    type="color"
                    value={c.style?.outline ?? "#111111"}
                    onChange={(e) =>
                      update({
                        style: { ...c.style!, outline: e.target.value },
                      })
                    }
                  />
                </label>
                {numberField(
                  "描边宽度",
                  c.style?.outlineWidth ?? 4,
                  (outlineWidth) =>
                    update({ style: { ...c.style!, outlineWidth } }),
                  0,
                  20,
                )}
                <label className="field">
                  字体
                  <input
                    value={c.style?.fontFamily ?? "Microsoft YaHei"}
                    onChange={(e) =>
                      update({
                        style: { ...c.style!, fontFamily: e.target.value },
                      })
                    }
                  />
                </label>
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
            <div
              id="inspector-video"
              role="tabpanel"
              aria-labelledby="inspector-video-tab"
              hidden={activeTab !== "video"}
            >
              {c.kind === "shape" && (
                <label className="field">
                  填充
                  <input
                    type="color"
                    value={c.fill ?? "#71e6b5"}
                    onChange={(e) => update({ fill: e.target.value })}
                  />
                </label>
              )}
              {c.kind !== "audio" && (
                <>
                  <FrameTransformProperties
                    clip={c} value={value} canvas={editor.project.canvas} size={size}
                    editingContent={!!editingContent} content={content} disabled={locked}
                    onTransform={transform} onContentOrFrame={contentOrFrame} onResize={resize}
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
              {c.mediaFrame && (
                <RoundedCornersProperties key={c.id} clip={c} editor={editor} size={size} />
              )}
              {hasClipSpeed(c) && <SpeedProperties key={c.id} clip={c} editor={editor} />}
            </div>
            <div
              id="inspector-audio"
              role="tabpanel"
              aria-labelledby="inspector-audio-tab"
              hidden={activeTab !== "audio"}
            >
              {c.assetId &&
                editor.project.assets.find((a) => a.id === c.assetId)
                  ?.hasAudio && (
                  <>
                    <h3 className="section-title">声音</h3>
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
