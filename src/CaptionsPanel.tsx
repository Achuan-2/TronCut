import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FontSelect from "./FontSelect";
import TextFormatFields from "./TextFormatFields";
import {
  AudioLines,
  Download,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Scissors,
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
} from "../shared/captions";
import type { Editor } from "./useEditor";
import { timeLabel } from "./Preview";
import CaptionProcessingFields from "./CaptionProcessingFields";
import TextFillFields from "./TextFillFields";
import CaptionFindReplace, { CaptionHighlights } from "./CaptionFindReplace";
import type { CaptionMatch } from "../shared/caption-search";
import {
  captionProcessingSchema,
  segmentCaptionCues,
  type CaptionProcessingOptions,
} from "../shared/caption-processing";
import {
  captionSegmentationGroups,
  applyCaptionSegmentation,
} from "../shared/caption-segmentation";

interface Props {
  editor: Editor;
  run: (fn: () => Promise<unknown>) => void;
  toast: (text: string) => void;
  busy: boolean;
  onPreferences: () => void;
}

type Dialog = "transcribe" | "style" | "refine" | "segment" | null;

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
  const [searchMode, setSearchMode] = useState<"find" | "replace" | null>(null);
  const [searchResults, setSearchResults] = useState<{
    matches: CaptionMatch[];
    active: CaptionMatch | null;
  }>({ matches: [], active: null });
  const captionList = useRef<HTMLDivElement>(null);
  const activeSearchKey = useRef<string | null>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const handleSearchResults = useCallback(
    (matches: CaptionMatch[], active: CaptionMatch | null) => {
      setSearchResults({ matches, active });
      const key = active
        ? `${active.clipId}:${active.start}:${active.end}`
        : null;
      if (activeSearchKey.current === key) return;
      activeSearchKey.current = key;
      if (!active) return;
      const current = editorRef.current;
      const clip = current.project.clips.find(
        (clip) => clip.id === active.clipId,
      );
      if (clip) {
        current.select(clip.id);
        current.seek(clip.start);
      }
      const row = Array.from(captionList.current?.children ?? []).find(
        (row) => (row as HTMLElement).dataset.clipId === active.clipId,
      );
      row?.scrollIntoView({ block: "nearest" });
      row
        ?.querySelector("textarea")
        ?.setSelectionRange(active.start, active.end);
    },
    [],
  );
  const matchesByClip = useMemo(() => {
    const grouped = new Map<string, CaptionMatch[]>();
    if (searchMode)
      for (const match of searchResults.matches) {
        const group = grouped.get(match.clipId) ?? [];
        group.push(match);
        grouped.set(match.clipId, group);
      }
    return grouped;
  }, [searchResults.matches, searchMode]);
  const [processing, setProcessing] = useState<CaptionProcessingOptions>(() =>
    captionProcessingSchema.parse({}),
  );
  const [manualProcessing, setManualProcessing] =
    useState<CaptionProcessingOptions>(() =>
      captionProcessingSchema.parse({
        segmentation: "unlimited",
        refinement: "correct",
      }),
    );
  const [segmentation, setSegmentation] = useState<CaptionProcessingOptions>(
    () => captionProcessingSchema.parse({}),
  );
  const menu = useRef<HTMLDivElement>(null);
  const first = captions[0];
  const selectedCaptions = captions.filter((clip) =>
    editor.selectedIds.includes(clip.id),
  );
  const selectedCaptionTracks = new Set(
    selectedCaptions.map((clip) => clip.trackId),
  );
  const segmentationTargets = captions.filter(
    (clip) =>
      (!selectedCaptionTracks.size ||
        selectedCaptionTracks.has(clip.trackId)) &&
      !project.tracks.find((track) => track.id === clip.trackId)?.locked,
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
      {
        start,
        end: start + editor.preferences.timing.caption,
        text: "在这里输入字幕",
      },
    ]);
    if (ids[0]) {
      editor.select(ids[0]);
      editor.beginTextEdit(ids[0]);
    }
  };

  return (
    <section
      className="captions-panel"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          ["f", "h"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          event.stopPropagation();
          setSearchMode(event.key.toLowerCase() === "h" ? "replace" : "find");
        }
      }}
    >
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
                  disabled={!segmentationTargets.length}
                  onClick={() => open("segment")}
                >
                  <Scissors size={14} />
                  断句
                </button>
                <button
                  role="menuitem"
                  disabled={!refineTargets.length}
                  onClick={() => open("refine")}
                >
                  <Sparkles size={14} />
                  AI纠错精修
                </button>
                <button
                  role="menuitem"
                  disabled={!selected?.caption}
                  onClick={convertSelected}
                >
                  <Type size={14} />
                  字幕转普通文本
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setSearchMode("replace");
                  }}
                >
                  <Search size={14} />
                  搜索和替换
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <CaptionFindReplace
        editor={editor}
        mode={searchMode ?? "replace"}
        visible={Boolean(searchMode)}
        onClose={() => {
          setSearchMode(null);
          activeSearchKey.current = null;
          const row = Array.from(captionList.current?.children ?? []).find(
            (row) =>
              (row as HTMLElement).dataset.clipId ===
              searchResults.active?.clipId,
          );
          row?.querySelector("textarea")?.focus({ preventScroll: true });
        }}
        onResults={handleSearchResults}
        toast={toast}
      />

      <div ref={captionList} className="caption-list" aria-label="字幕列表">
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
              data-clip-id={clip.id}
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
              <div
                className={`caption-text-editor ${matchesByClip.has(clip.id) ? "searching" : ""}`}
              >
                {matchesByClip.has(clip.id) && (
                  <CaptionHighlights
                    text={clip.text ?? ""}
                    matches={matchesByClip.get(clip.id)!}
                    active={searchResults.active}
                  />
                )}
                <textarea
                  aria-label={`${timeLabel(clip.start)} 字幕文本`}
                  value={clip.text ?? ""}
                  disabled={locked}
                  placeholder="空白字幕"
                  rows={Math.max(2, clip.text?.split("\n").length ?? 1)}
                  onFocus={() => editor.select(clip.id)}
                  onScroll={(event) => {
                    const highlights =
                      event.currentTarget.previousElementSibling;
                    if (highlights) {
                      highlights.scrollTop = event.currentTarget.scrollTop;
                      highlights.scrollLeft = event.currentTarget.scrollLeft;
                    }
                  }}
                  onChange={(event) => {
                    const text = event.target.value;
                    editor.updateClip(clip.id, {
                      text,
                      name: text.slice(0, 24) || "空白字幕",
                    });
                  }}
                />
              </div>
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
                    : dialog === "refine"
                      ? "AI纠错精修"
                      : dialog === "segment"
                        ? "字幕断句"
                        : "统一字幕样式"}
                </h2>
                <p>
                  {dialog === "transcribe"
                    ? "识别整个时间线的声音并新增字幕轨道；首次使用时自动下载模型。"
                    : dialog === "refine"
                      ? `处理${selectedCaptions.length ? "选中的" : "全部"} ${refineTargets.length} 条未锁定字幕，保留时间和样式，支持撤销。`
                      : dialog === "segment"
                        ? `对${selectedCaptionTracks.size ? "选中字幕轨道上的" : "全部"} ${segmentationTargets.length} 条未锁定字幕重新断句，无需重新识别语音。相邻同样式字幕可重新组合，保留样式和较长停顿，支持撤销；新断点按原字幕时间估算。`
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
                    onChange={(event) => {
                      setEngine(event.target.value as SpeechEngine);
                    }}
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
                          device: "cpu",
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

            {dialog === "segment" && (
              <>
                <CaptionProcessingFields
                  segmentationOnly
                  value={segmentation}
                  onChange={setSegmentation}
                />
                {segmentation.segmentation === "ai" && (
                  <button
                    className="caption-preferences-link"
                    onClick={() => {
                      setDialog(null);
                      onPreferences();
                    }}
                  >
                    配置 AI 模型…
                  </button>
                )}
                <button
                  className="wide-button primary"
                  disabled={
                    busy ||
                    !segmentationTargets.length ||
                    (segmentation.segmentation === "custom" &&
                      (!Number.isInteger(segmentation.maxChars) ||
                        segmentation.maxChars < 8 ||
                        segmentation.maxChars > 120))
                  }
                  onClick={() => {
                    const groups = captionSegmentationGroups(
                      project,
                      segmentationTargets.map((clip) => clip.id),
                    );
                    const options = {
                      ...segmentation,
                      refinement: "none" as const,
                    };
                    setDialog(null);
                    run(async () => {
                      const results: Parameters<
                        typeof applyCaptionSegmentation
                      >[1] = [];
                      const warnings = new Set<string>();
                      for (const group of groups) {
                        const result =
                          options.segmentation === "ai"
                            ? await bridge().refineCaptions(
                                [group.cue],
                                options,
                              )
                            : {
                                cues: segmentCaptionCues([group.cue], options),
                                warnings: [],
                              };
                        result.warnings.forEach((warning) =>
                          warnings.add(warning),
                        );
                        results.push({ group, cues: result.cues });
                      }
                      let ids: string[] = [],
                        changed = 0;
                      editor.apply((current) => {
                        const result = applyCaptionSegmentation(
                          current,
                          results,
                        );
                        ids = result.ids;
                        changed = result.changed;
                        return result.project;
                      });
                      if (ids.length) editor.selectMany(ids);
                      toast(
                        `${changed ? `已重新断句，共 ${ids.length} 条字幕` : "字幕断句无需调整"}${warnings.size ? `；${[...warnings].join("；")}` : ""}`,
                      );
                    });
                  }}
                >
                  <Scissors size={16} />
                  应用断句
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

            {dialog === "style" && (
              <>
                <TextFormatFields
                  style={style.text}
                  onChange={(patch) =>
                    setStyle((value) => ({
                      ...value,
                      text: { ...value.text, ...patch },
                    }))
                  }
                />
                <FontSelect
                    value={style.text.fontFamily}
                    onChange={(fontFamily) =>
                      setStyle((value) => ({
                        ...value,
                        text: {
                          ...value.text,
                          fontFamily,
                        },
                      }))
                    }
                />
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
                <TextFillFields
                  style={style.text}
                  onChange={(patch) =>
                    setStyle((value) => ({
                      ...value,
                      text: { ...value.text, ...patch },
                    }))
                  }
                />
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
