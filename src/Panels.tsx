import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  Type,
  Captions,
  Sparkles,
  AudioLines,
  Settings2,
  Plus,
  Film,
  Music2,
  Image,
  WandSparkles,
  Diamond,
  AlignCenter,
  Check,
  FileJson,
  ArrowRight,
  Play,
  Mic,
  MousePointer2,
  Scan,
  Link2,
  Paintbrush,
  ArrowRightLeft,
} from "lucide-react";
import { type Clip, textPresets, defaultTransform } from "../shared/model";
import { animation, transformAt } from "../shared/editor";
import type { Capabilities } from "../shared/bridge";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import { defaultCrop, defaultEffects } from "../shared/effects";
import { textBoxFor } from "./text";
import { MediaThumbnail } from "./MediaThumbnail";
import { defaultCursorStyle } from "../shared/cursor";
import NarrationPanel from "./NarrationPanel";
import ZoomPanPanel from "./ZoomPanPanel";
import { defaultContentTransform } from "../shared/crop";
import { visualClipAt } from "../shared/visual-state";
import { ScaleControl, RotationControls } from "./TransformControls";
import AnnotationsPanel from "./AnnotationsPanel";
import VisualEffectsPanel from "./VisualEffectsPanel";
import SpeedProperties from "./SpeedProperties";
import { hasClipSpeed } from "../shared/clip-speed";
import { hasBehaviors } from "../shared/behaviors";
import BehaviorsPanel from "./BehaviorsPanel";
import BehaviorProperties from "./BehaviorProperties";
import TransitionsPanel from "./TransitionsPanel";
import TransitionProperties from "./TransitionProperties";
import CaptionsPanel from "./CaptionsPanel";

export type Tab =
  | "media"
  | "annotations"
  | "captions"
  | "animations"
  | "zoompan"
  | "audio"
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
  { id: "zoompan", name: "缩放与平移", icon: Scan },
  { id: "effects", name: "视觉效果", icon: WandSparkles },
  { id: "audio", name: "音频", icon: AudioLines },
  { id: "narration", name: "配音", icon: Mic },
  { id: "settings", name: "设置", icon: Settings2 },
] as const;
interface Props {
  editor: Editor;
  tab: Tab;
  setTab: (tab: Tab) => void;
  importMedia: () => void;
  importCamtasia: () => void;
  capabilities?: Capabilities;
  run: (fn: () => Promise<unknown>) => void;
  toast: (text: string) => void;
  refreshCapabilities: () => void;
  busy: boolean;
}
export default function Panels(props: Props) {
  const { editor, tab, setTab, run, toast } = props,
    { project, selected, updateClip } = editor;
  const [query, setQuery] = useState("");
  const bridge = () => {
    if (!window.framecraft)
      throw new Error("此功能需要运行桌面版，请使用 pnpm dev");
    return window.framecraft;
  };
  const audition = useRef<HTMLAudioElement | null>(null);
  useEffect(
    () => () => {
      audition.current?.pause();
    },
    [],
  );
  return (
    <aside className="library">
      <nav className="tool-rail">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`${tab === t.id ? "selected" : ""} ${t.id === "zoompan" ? "zoom-pan-tab" : ""}`}
            onClick={() => setTab(t.id)}
          >
            <t.icon size={21} />
            <span>{t.name}</span>
          </button>
        ))}
      </nav>
      <div
        className={`library-content ${tab === "captions" ? "captions-library" : ""}`}
      >
        {tab !== "captions" && (
          <div className="library-heading">
            <h2>
              {tabs.find((t) => t.id === tab)?.name === "媒体"
                ? "素材库"
                : tabs.find((t) => t.id === tab)?.name}
            </h2>
            <span>
              {tab === "media"
                ? `${project.assets.length} 个素材`
                : "为表达加一点灵感"}
            </span>
          </div>
        )}
        {tab === "media" && (
          <>
            <button
              className="wide-button import-button"
              onClick={props.importMedia}
            >
              <Plus size={17} />
              导入媒体
            </button>
            <input
              className="search-input"
              placeholder="搜索素材…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!project.assets.length ? (
              <div className="library-empty">
                <div className="empty-icon">
                  <Film size={30} />
                </div>
                <b>好作品，从素材开始</b>
                <p>
                  导入视频、音频或图片
                  <br />
                  双击素材即可加入时间线
                </p>
                <button className="plain-link" onClick={props.importCamtasia}>
                  <FileJson size={14} />
                  导入 Camtasia 工程
                  <ArrowRight size={13} />
                </button>
              </div>
            ) : (
              <div className="asset-grid">
                {project.assets
                  .filter((a) =>
                    a.name.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((asset) => (
                    <button
                      className={`asset-card ${asset.missing ? "missing" : ""}`}
                      key={asset.id}
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData("framecraft-asset", asset.id)
                      }
                      onDoubleClick={() => {
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
                          const replacement = await bridge().relinkMedia(
                            asset.id,
                            consumed,
                          );
                          if (!replacement) return;
                          editor.apply((p) => ({
                            ...p,
                            assets: p.assets.map((a) =>
                              a.id === asset.id ? replacement : a,
                            ),
                          }));
                          toast("素材已重新链接，片段与动画保持原位置");
                        });
                      }}
                      title={`${asset.name}\n${asset.missing ? "双击重新链接素材" : "双击添加到时间线"}`}
                    >
                      <div className={`asset-thumbnail ${asset.kind}`}>
                        <MediaThumbnail
                          asset={asset}
                          waveform={asset.kind === "audio"}
                        />
                        {asset.kind === "video" ? (
                          <Film size={28} />
                        ) : asset.kind === "audio" ? (
                          <Music2 size={28} />
                        ) : (
                          <Image size={28} />
                        )}
                        <span>
                          {asset.missing
                            ? "素材离线"
                            : asset.kind === "image"
                              ? "图片"
                              : timeLabel(asset.duration)}
                        </span>
                      </div>
                      <span className="asset-name">{asset.name}</span>
                    </button>
                  ))}
              </div>
            )}
            <div className="library-bottom-note">
              <FileJson size={15} />
              <span>
                保存工程时，素材自动归档
                <br />
                JSON 工程，随时看得懂
              </span>
            </div>
          </>
        )}
        <div hidden={tab !== "annotations"}>
          <AnnotationsPanel key={project.id} editor={editor} />
        </div>
        {tab === "effects" && <VisualEffectsPanel editor={editor} />}
        {tab === "behaviors" && <BehaviorsPanel editor={editor} />}
        {tab === "transitions" && <TransitionsPanel editor={editor} />}
        <div hidden={tab !== "narration"}>
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
          />
        )}
        {tab === "zoompan" && <ZoomPanPanel editor={editor} />}
        {tab === "animations" && (
          <>
            <p className="panel-intro">
              选中片段，点击即添加。
              <br />
              也可以在时间线上右键添加动画。
            </p>
            <div className="animation-presets">
              {(["fade", "zoom", "slide"] as const).map((type, i) => (
                <button
                  key={type}
                  onClick={() => {
                    if (!selected) {
                      toast("请先选中片段");
                      return;
                    }
                    updateClip(selected.id, (c) =>
                      animation(c, type, editor.playhead - c.start),
                    );
                  }}
                >
                  <div className={`animation-demo ${type}`}>
                    <span />
                  </div>
                  <span>{["轻柔淡入", "平滑缩放", "侧边滑入"][i]}</span>
                  <small>0.6 秒 · 平滑曲线</small>
                </button>
              ))}
            </div>
            <div className="tip-card">
              <Diamond size={19} />
              <b>开启自动动画</b>
              <p>
                移动播放头，再修改右侧属性。TronCut
                会自动记录位置、缩放和不透明度，无需拖拽动画箭头。
              </p>
              <button
                onClick={() => editor.setAutoAnimate(!editor.autoAnimate)}
              >
                {editor.autoAnimate ? "已开启" : "开启自动动画"}
                {editor.autoAnimate && <Check size={14} />}
              </button>
            </div>
          </>
        )}
        {tab === "audio" && (
          <>
            <div className="audio-hero">
              <AudioLines size={38} />
              <h3>让旁白更好听</h3>
              <p>降噪 · 均衡 · 压缩 · 响度归一</p>
            </div>
            <button
              className="wide-button primary"
              onClick={() => {
                if (
                  !selected?.assetId ||
                  !project.assets.find((a) => a.id === selected.assetId)
                    ?.hasAudio
                ) {
                  toast("请选中有声音的片段");
                  return;
                }
                updateClip(selected.id, { podcast: !selected.podcast });
              }}
            >
              {selected?.podcast ? (
                <Check size={17} />
              ) : (
                <WandSparkles size={17} />
              )}
              {selected?.podcast ? "播客人声已启用" : "应用播客人声"}
            </button>
            <button
              className="wide-button"
              onClick={() =>
                run(async () => {
                  if (!selected) throw new Error("请选中有声音的片段");
                  audition.current?.pause();
                  editor.setPlaying(false);
                  const url = await bridge().previewAudio(project, selected.id);
                  audition.current = new Audio(url);
                  await audition.current.play();
                  toast("正在试听处理后的音频（最多 15 秒）");
                })
              }
            >
              <Play size={15} />
              处理后试听
            </button>
            <button
              className="wide-button"
              onClick={() => audition.current?.pause()}
            >
              停止试听
            </button>
            <p className="small-note">
              导出时应用高通、FFT 降噪、存在感均衡、动态压缩和 −16 LUFS
              响度处理。画布实时预览播放原音，可用「处理后试听」对比效果。这是
              DSP 预设，尚未接入 AI 人声重建。
            </p>
            <div className="tip-card">
              <h3>加速，也保留音调</h3>
              <p>
                {props.capabilities?.rubberband
                  ? "导出引擎已支持 Rubber Band 变速，保持原始音调。"
                  : "当前导出使用 FFmpeg atempo 保持音调。安装含 Rubber Band 的 FFmpeg 后将自动使用该引擎。"}
              </p>
              <p className="small-note">
                实际听感取决于素材与倍率，需要通过 A/B 试听调校。
              </p>
            </div>
          </>
        )}
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
              参考 OpenScreen / Recordly
              的录制流程。当前基础录屏仍会包含系统鼠标；可编辑光标、原生 GPU
              捕获、TREC 和完整 Camtasia 特效兼容尚在开发计划中。
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
  if (editor.selectedTransition)
    return <TransitionProperties editor={editor} />;
  const hasCursor =
    c?.kind === "video" &&
    !!editor.project.assets.find((asset) => asset.id === c.assetId)?.cursor;
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
  const value = c
    ? transformAt(c, editor.playhead - c.start)
    : defaultTransform;
  const update = (patch: Partial<Clip>) => {
    if (c && !locked) editor.updateClip(c.id, patch);
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
  const asset = editor.project.assets.find((asset) => asset.id === c?.assetId);
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
                <b>{c.name}</b>
                <small>
                  {locked
                    ? "轨道已锁定"
                    : c.kind === "text"
                      ? c.caption
                        ? "字幕文本"
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
                    onChange={(e) =>
                      update({
                        style: {
                          ...textPresets[Number(e.target.value)].style,
                        },
                      })
                    }
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
                  <h3 className="section-title">
                    {editingContent ? "框内画面" : "变换"}
                  </h3>
                  {editingContent && (
                    <p className="field-help">
                      拖动画面或调整缩放，裁剪框的位置与大小保持不变。
                    </p>
                  )}
                  <ScaleControl
                    value={(editingContent ? content.scale : value.scale) * 100}
                    onChange={(scale) => contentOrFrame("scale", scale / 100)}
                    disabled={locked}
                  />
                  <label className="field">
                    不透明度
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={value.opacity}
                      onChange={(e) =>
                        transform("opacity", Number(e.target.value))
                      }
                    />
                    <span className="range-value">
                      {Math.round(value.opacity * 100)}%
                    </span>
                  </label>
                  {!editingContent && (
                    <RotationControls
                      value={value}
                      fallbackZ={c.rotation}
                      onChange={transform}
                      disabled={locked}
                    />
                  )}
                  <h3 className="section-title">
                    {editingContent ? "内容位置" : "位置"}
                    <button
                      type="button"
                      className="center-layer"
                      title={editingContent ? "内容居中" : "画布居中"}
                      aria-label={editingContent ? "内容居中" : "画布居中"}
                      onClick={() =>
                        editingContent
                          ? editor.updateContentTransform(c.id, { x: 0, y: 0 })
                          : editor.updateTransform(c.id, { x: 0.5, y: 0.5 })
                      }
                    >
                      <AlignCenter size={14} />
                    </button>
                  </h3>
                  {numberField(
                    editingContent ? "内容位置 X (%)" : "位置 X (%)",
                    (editingContent ? content.x : value.x) * 100,
                    (x) => contentOrFrame("x", x / 100),
                    -400,
                    400,
                  )}
                  {numberField(
                    editingContent ? "内容位置 Y (%)" : "位置 Y (%)",
                    (editingContent ? content.y : value.y) * 100,
                    (y) => contentOrFrame("y", y / 100),
                    -400,
                    400,
                  )}
                  <h3 className="section-title">
                    {editingContent ? "裁剪框尺寸" : "尺寸"}
                  </h3>
                  {size.width > 0 &&
                    numberField(
                      "宽度 (px)",
                      size.width * value.scale,
                      (pixels) => resize("width", pixels),
                      1,
                      262144,
                      1,
                      !!editingContent,
                    )}
                  {size.height > 0 &&
                    numberField(
                      "高度 (px)",
                      size.height * value.scale,
                      (pixels) => resize("height", pixels),
                      1,
                      262144,
                      1,
                      !!editingContent,
                    )}
                  {c.kind !== "text" && (
                    <p className="size-ratio">
                      <Link2 size={12} />
                      宽高保持比例
                    </p>
                  )}
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
            {hasClipSpeed(c) && activeTab !== "behaviors" && (
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
