import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Download,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Type,
  Upload,
  X,
} from "lucide-react";
import { type TextStyle, textPresets } from "../shared/model";
import type { Cue } from "../shared/subtitles";
import type { SpeechEngine } from "../shared/asr";
import {
  appendCaptionCues,
  captionClips,
  captionDefaults,
  convertCaptionsToText,
  replaceCaptionText,
} from "../shared/captions";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import CaptionProcessingFields from "./CaptionProcessingFields";
import {
  captionProcessingSchema,
  type CaptionProcessingOptions,
} from "../shared/caption-processing";

interface Props {
  editor: Editor;
  run: (fn: () => Promise<unknown>) => void;
  toast: (text: string) => void;
  busy: boolean;
  onPreferences: () => void;
}

type Dialog = "transcribe" | "replace" | "style" | "refine" | null;

export function addCues(
  editor: Editor,
  cues: Cue[],
  options: { newTrack?: boolean } = {},
) {
  let ids: string[] = [];
  editor.apply((project) => {
    const result = appendCaptionCues(project, cues, options);
    ids = result.ids;
    return result.project;
  });
  return ids;
}

export default function CaptionsPanel({
  editor,
  run,
  toast,
  busy,
  onPreferences,
}: Props) {
  const { project, selected } = editor;
  const captions = captionClips(project);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [engine, setEngine] = useState<SpeechEngine>("qwen3-asr");
  const [search, setSearch] = useState("");
  const [replacement, setReplacement] = useState("");
  const [processing, setProcessing] = useState<CaptionProcessingOptions>(() =>
    captionProcessingSchema.parse({}),
  );
  const [manualProcessing, setManualProcessing] =
    useState<CaptionProcessingOptions>(() =>
      captionProcessingSchema.parse({
        segmentation: "unlimited",
        refinement: "polish",
      }),
    );
  const menu = useRef<HTMLDivElement>(null);
  const first = captions[0];
  const selectedCaptions = captions.filter((clip) =>
    editor.selectedIds.includes(clip.id),
  );
  const refineTargets = (
    selectedCaptions.length ? selectedCaptions : captions
  ).filter(
    (clip) =>
      !project.tracks.find((track) => track.id === clip.trackId)?.locked,
  );
  const [style, setStyle] = useState<{
    text: TextStyle;
    opacity: number;
    y: number;
  }>(() => ({
    text: {
      ...textPresets[0].style,
      fontSize: captionDefaults.fontSize,
      outlineWidth: captionDefaults.outlineWidth,
    },
    opacity: 1,
    y: captionDefaults.y,
  }));

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!dialog) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialog(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [dialog]);

  const bridge = () => {
    if (!window.framecraft)
      throw new Error("此功能需要运行桌面版，请使用 pnpm dev");
    return window.framecraft;
  };
  const open = (next: Exclude<Dialog, null>) => {
    setMenuOpen(false);
    if (next === "style" && first)
      setStyle({
        text: { ...textPresets[0].style, ...first.style },
        opacity: first.transform.opacity,
        y: first.transform.y,
      });
    setDialog(next);
    if (next === "transcribe")
      void window.framecraft
        ?.preferences()
        .then((value) => setProcessing(value.captions))
        .catch((error) => toast(String(error)));
  };
  const importSubtitles = () => {
    setMenuOpen(false);
    run(async () => {
      const cues = await bridge().importSubtitles();
      if (!cues) return;
      addCues(editor, cues);
      toast(`已导入 ${cues.length} 条字幕`);
    });
  };
  const exportSubtitles = () => {
    setMenuOpen(false);
    run(async () => {
      if (!captions.length) throw new Error("没有可导出的字幕");
      const file = await bridge().exportSubtitles(
        captions.map((clip) => ({
          start: clip.start,
          end: clip.start + clip.duration,
          text: clip.text ?? "",
        })),
      );
      if (file) toast("字幕已导出");
    });
  };
  const convertSelected = () => {
    if (!selected?.caption) return;
    const result = convertCaptionsToText(project, [selected.id]);
    if (!result.ids.length) {
      toast("字幕轨道已锁定，请先解锁");
      return;
    }
    editor.apply(result.project);
    editor.selectMany(result.ids);
    setMenuOpen(false);
    toast("已将当前字幕转为普通文本");
  };
  const addCaption = () => {
    const start = editor.playhead;
    const ids = addCues(editor, [
      { start, end: start + 3, text: "在这里输入字幕" },
    ]);
    if (ids[0]) {
      editor.select(ids[0]);
      editor.beginTextEdit(ids[0]);
    }
  };

  return (
    <section className="captions-panel">
      <header className="caption-panel-header">
        <h2>字幕</h2>
        <div className="caption-header-actions">
          <button
            aria-label="统一字幕样式"
            title="统一字幕样式"
            disabled={!captions.length}
            onClick={() => open("style")}
          >
            <SlidersHorizontal size={17} />
          </button>
          <div className="caption-actions" ref={menu}>
            <button
              aria-label="字幕操作"
              title="字幕操作"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <MoreHorizontal size={19} />
            </button>
            {menuOpen && (
              <div className="caption-actions-menu" role="menu">
                <button role="menuitem" onClick={importSubtitles}>
                  <Upload size={14} />
                  导入字幕
                </button>
                <button
                  role="menuitem"
                  disabled={!captions.length}
                  onClick={exportSubtitles}
                >
                  <Download size={14} />
                  导出字幕
                </button>
                <button role="menuitem" onClick={() => open("transcribe")}>
                  <AudioLines size={14} />
                  语音转文本
                </button>
                <button
                  role="menuitem"
                  disabled={!refineTargets.length}
                  onClick={() => open("refine")}
                >
                  <Sparkles size={14} />
                  AI 精修与润色
                </button>
                <button
                  role="menuitem"
                  disabled={!selected?.caption}
                  onClick={convertSelected}
                >
                  <Type size={14} />
                  字幕转普通文本
                </button>
                <button role="menuitem" onClick={() => open("replace")}>
                  <Search size={14} />
                  搜索和替换
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="caption-list" aria-label="字幕列表">
        {!captions.length && (
          <div className="caption-empty">
            <Type size={28} />
            <b>还没有字幕</b>
            <span>添加字幕，或从右上角导入和识别</span>
          </div>
        )}
        {captions.map((clip) => {
          const locked = project.tracks.find(
            (track) => track.id === clip.trackId,
          )?.locked;
          return (
            <article
              key={clip.id}
              className={`caption-row ${selected?.id === clip.id ? "active" : ""}`}
              onPointerDown={() => {
                editor.select(clip.id);
                editor.seek(clip.start);
              }}
            >
              <button
                className="caption-time"
                title="跳到字幕开始位置"
                onClick={() => editor.seek(clip.start)}
              >
                {timeLabel(clip.start)}
              </button>
              <textarea
                aria-label={`${timeLabel(clip.start)} 字幕文本`}
                value={clip.text ?? ""}
                disabled={locked}
                placeholder="空白字幕"
                rows={Math.max(2, clip.text?.split("\n").length ?? 1)}
                onFocus={() => editor.select(clip.id)}
                onChange={(event) => {
                  const text = event.target.value;
                  editor.updateClip(clip.id, {
                    text,
                    name: text.slice(0, 24) || "空白字幕",
                  });
                }}
              />
            </article>
          );
        })}
      </div>

      <button className="caption-add-button" onClick={addCaption}>
        <Plus size={18} />
        添加字幕
      </button>

      {dialog && (
        <div className="modal-backdrop" onPointerDown={() => setDialog(null)}>
          <div
            className="caption-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`caption-${dialog}-title`}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <h2 id={`caption-${dialog}-title`}>
                  {dialog === "transcribe"
                    ? "语音转文本"
                    : dialog === "replace"
                      ? "搜索和替换"
                      : dialog === "refine"
                        ? "AI 精修与润色"
                        : "统一字幕样式"}
                </h2>
                <p>
                  {dialog === "transcribe"
                    ? "识别整个时间线的声音并新增字幕轨道；首次使用时自动下载模型。"
                    : dialog === "replace"
                      ? "搜索并批量替换所有未锁定字幕。"
                      : dialog === "refine"
                        ? `处理${selectedCaptions.length ? "选中的" : "全部"} ${refineTargets.length} 条未锁定字幕，保留时间和样式，支持撤销。`
                        : `统一修改 ${captions.length} 条字幕的显示样式。`}
                </p>
              </div>
              <button aria-label="关闭" onClick={() => setDialog(null)}>
                <X size={19} />
              </button>
            </div>

            {dialog === "transcribe" && (
              <>
                <label className="field vertical">
                  识别模型
                  <select
                    aria-label="识别模型"
                    value={engine}
                    onChange={(event) =>
                      setEngine(event.target.value as SpeechEngine)
                    }
                  >
                    <option value="qwen3-asr">Qwen3-ASR 0.6B · 多语言</option>
                    <option value="sensevoice">
                      SenseVoiceSmall · 中英日韩粤
                    </option>
                  </select>
                </label>
                <CaptionProcessingFields
                  value={processing}
                  onChange={setProcessing}
                />
                <button
                  className="caption-preferences-link"
                  onClick={() => {
                    setDialog(null);
                    onPreferences();
                  }}
                >
                  配置 AI 模型…
                </button>
                <button
                  className="wide-button primary"
                  disabled={busy}
                  onClick={() => {
                    setDialog(null);
                    run(async () => {
                      await bridge().savePreferences({ captions: processing });
                      const result = await bridge().transcribe(
                        project,
                        engine,
                        "auto",
                        {
                          device: "auto",
                          processing,
                        },
                      );
                      addCues(editor, result.cues, { newTrack: true });
                      toast(
                        `已生成 ${result.cues.length} 条字幕${result.warnings.length ? `；${result.warnings.join("；")}` : ""}`,
                      );
                    });
                  }}
                >
                  <AudioLines size={16} />
                  开始识别
                </button>
              </>
            )}

            {dialog === "refine" && (
              <>
                <CaptionProcessingFields
                  existing
                  value={manualProcessing}
                  onChange={setManualProcessing}
                />
                <button
                  className="caption-preferences-link"
                  onClick={() => {
                    setDialog(null);
                    onPreferences();
                  }}
                >
                  配置 AI 模型…
                </button>
                <button
                  className="wide-button primary"
                  disabled={busy || !refineTargets.length}
                  onClick={() => {
                    const targets = refineTargets;
                    setDialog(null);
                    run(async () => {
                      const result = await bridge().refineCaptions(
                        targets.map((clip) => ({
                          start: clip.start,
                          end: clip.start + clip.duration,
                          text: clip.text ?? "",
                        })),
                        manualProcessing,
                      );
                      const replacements = new Map(
                        targets.map((clip, index) => [
                          clip.id,
                          { original: clip, cue: result.cues[index] },
                        ]),
                      );
                      let changed = 0;
                      editor.apply((project) => {
                        const clips = project.clips.map((clip) => {
                          const replacement = replacements.get(clip.id);
                          if (
                            !replacement?.cue ||
                            !clip.caption ||
                            clip.text !== replacement.original.text ||
                            clip.start !== replacement.original.start ||
                            clip.duration !== replacement.original.duration ||
                            project.tracks.find(
                              (track) => track.id === clip.trackId,
                            )?.locked
                          )
                            return clip;
                          if (clip.text === replacement.cue.text) return clip;
                          changed++;
                          return {
                            ...clip,
                            text: replacement.cue.text,
                            name: replacement.cue.text.slice(0, 24),
                          };
                        });
                        return changed ? { ...project, clips } : project;
                      });
                      toast(
                        `已更新 ${changed} 条字幕${result.warnings.length ? `；${result.warnings.join("；")}` : ""}`,
                      );
                    });
                  }}
                >
                  <Sparkles size={16} />
                  开始精修
                </button>
              </>
            )}

            {dialog === "replace" && (
              <>
                <label className="field vertical">
                  搜索
                  <input
                    autoFocus
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <label className="field vertical">
                  替换为
                  <input
                    value={replacement}
                    onChange={(event) => setReplacement(event.target.value)}
                  />
                </label>
                <button
                  className="wide-button primary"
                  disabled={!search}
                  onClick={() => {
                    const result = replaceCaptionText(
                      project,
                      search,
                      replacement,
                    );
                    editor.apply(result.project);
                    toast(
                      result.changed
                        ? `已替换 ${result.changed} 条字幕`
                        : "没有找到匹配的字幕",
                    );
                    if (result.changed) setDialog(null);
                  }}
                >
                  全部替换
                </button>
              </>
            )}

            {dialog === "style" && (
              <>
                <label className="field">
                  字体
                  <select
                    value={style.text.fontFamily}
                    onChange={(event) =>
                      setStyle((value) => ({
                        ...value,
                        text: {
                          ...value.text,
                          fontFamily: event.target.value,
                        },
                      }))
                    }
                  >
                    <option>Microsoft YaHei</option>
                    <option>Arial</option>
                    <option>SimHei</option>
                    <option>SimSun</option>
                  </select>
                </label>
                <label className="field">
                  字号
                  <input
                    type="number"
                    min="8"
                    max="300"
                    value={style.text.fontSize}
                    onChange={(event) =>
                      setStyle((value) => ({
                        ...value,
                        text: {
                          ...value.text,
                          fontSize: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  文字颜色
                  <input
                    type="color"
                    value={style.text.color}
                    onChange={(event) =>
                      setStyle((value) => ({
                        ...value,
                        text: { ...value.text, color: event.target.value },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  描边颜色
                  <input
                    type="color"
                    value={style.text.outline}
                    onChange={(event) =>
                      setStyle((value) => ({
                        ...value,
                        text: { ...value.text, outline: event.target.value },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  描边宽度
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={style.text.outlineWidth}
                    onChange={(event) =>
                      setStyle((value) => ({
                        ...value,
                        text: {
                          ...value.text,
                          outlineWidth: Number(event.target.value),
                        },
                      }))
                    }
                  />
                </label>
                <label className="field">
                  位置
                  <select
                    value={style.y}
                    onChange={(event) =>
                      setStyle((value) => ({
                        ...value,
                        y: Number(event.target.value),
                      }))
                    }
                  >
                    <option value={captionDefaults.y}>底部</option>
                    {![captionDefaults.y, 0.5].includes(style.y) && (
                      <option value={style.y}>当前位置</option>
                    )}
                    <option value="0.5">居中</option>
                  </select>
                </label>
                <label className="field vertical">
                  不透明度 {Math.round(style.opacity * 100)}%
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={style.opacity}
                    onChange={(event) =>
                      setStyle((value) => ({
                        ...value,
                        opacity: Number(event.target.value),
                      }))
                    }
                  />
                </label>
                <button
                  className="wide-button primary"
                  onClick={() => {
                    const locked = new Set(
                      project.tracks
                        .filter((track) => track.locked)
                        .map((track) => track.id),
                    );
                    editor.apply((current) => ({
                      ...current,
                      clips: current.clips.map((clip) =>
                        clip.caption && !locked.has(clip.trackId)
                          ? {
                              ...clip,
                              style: { ...style.text },
                              transform: {
                                ...clip.transform,
                                x: 0.5,
                                y: style.y,
                                opacity: style.opacity,
                              },
                              keyframes: [],
                            }
                          : clip,
                      ),
                    }));
                    setDialog(null);
                    toast("已统一更新字幕样式");
                  }}
                >
                  应用到全部字幕
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
