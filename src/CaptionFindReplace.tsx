import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ListFilter,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react";
import {
  defaultCaptionSearchOptions,
  findCaptionMatches,
  replaceCaptionMatches,
  type CaptionMatch,
} from "../shared/caption-search";
import type { Editor } from "./useEditor";

export default function CaptionFindReplace({
  editor,
  mode,
  visible,
  onClose,
  onResults,
  toast,
}: {
  editor: Editor;
  mode: "find" | "replace";
  visible: boolean;
  onClose: () => void;
  onResults: (matches: CaptionMatch[], active: CaptionMatch | null) => void;
  toast: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [options, setOptions] = useState(defaultCaptionSearchOptions);
  const [expanded, setExpanded] = useState(mode === "replace");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const widget = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 500 });
  const [height, setHeight] = useState(72);
  // Float over the preview when the sidebar is narrow, keeping the inputs usable.
  useLayoutEffect(() => {
    if (!visible || !anchor.current || !widget.current) return;
    const update = () => {
      const bounds = anchor.current!.getBoundingClientRect();
      setPosition({
        left: bounds.left,
        top: bounds.top,
        width: Math.min(500, window.innerWidth - bounds.left - 12),
      });
      setHeight(widget.current!.getBoundingClientRect().height);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor.current);
    observer.observe(widget.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [visible]);
  const { matches, error } = useMemo(
    () => findCaptionMatches(editor.project, query, options),
    [editor.project, query, options],
  );
  const currentIndex = matches.length ? Math.min(index, matches.length - 1) : 0;
  const active = matches[currentIndex] ?? null;
  useEffect(() => {
    if (!visible) return;
    setExpanded(mode === "replace");
    input.current?.focus();
    input.current?.select();
  }, [mode, visible]);
  useEffect(() => {
    if (visible) onResults(matches, active);
  }, [matches, active, onResults, visible]);
  const move = (direction: number) => {
    if (matches.length)
      setIndex((currentIndex + direction + matches.length) % matches.length);
  };
  const replace = (all: boolean) => {
    if (!active) return;
    const result = replaceCaptionMatches(
      editor.project,
      query,
      replacement,
      options,
      all ? undefined : active,
    );
    if (result.changed) {
      editor.apply(result.project);
      if (!all) {
        const before =
          editor.project.clips.find((clip) => clip.id === active.clipId)!
            .text ?? "";
        const after =
          result.project.clips.find((clip) => clip.id === active.clipId)!
            .text ?? "";
        const end = active.end + after.length - before.length;
        const next = findCaptionMatches(result.project, query, options).matches;
        const order = new Map(
          editor.project.clips
            .filter((clip) => clip.caption)
            .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
            .map((clip, i) => [clip.id, i]),
        );
        const nextIndex = next.findIndex(
          (match) =>
            (match.clipId === active.clipId && match.start >= end) ||
            order.get(match.clipId)! > order.get(active.clipId)!,
        );
        setIndex(Math.max(0, nextIndex));
      } else setIndex(0);
      toast(`已替换 ${result.occurrences} 处，共 ${result.changed} 条字幕`);
    } else move(1);
  };
  if (!visible) return null;
  const content = (
    <div
      ref={widget}
      className="caption-find"
      style={position}
      role="search"
      aria-label="字幕搜索替换"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (
          (event.ctrlKey || event.metaKey) &&
          ["f", "h"].includes(event.key.toLowerCase())
        ) {
          event.preventDefault();
          setExpanded(event.key.toLowerCase() === "h");
          input.current?.focus();
          input.current?.select();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          if (event.target === input.current) move(event.shiftKey ? -1 : 1);
          else if (event.target instanceof HTMLInputElement)
            replace(event.ctrlKey || event.metaKey);
        }
      }}
    >
      <button
        className="caption-find-toggle"
        title={expanded ? "折叠替换" : "展开替换"}
        aria-label={expanded ? "折叠替换" : "展开替换"}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      <div className="caption-find-content">
        <div className="caption-find-row">
          <div className={`caption-find-input ${error ? "invalid" : ""}`}>
            <input
              ref={input}
              aria-label="查找字幕"
              placeholder="查找"
              value={query}
              aria-invalid={Boolean(error)}
              title="在未锁定字幕中查找；Enter 下一项，Shift+Enter 上一项"
              onChange={(event) => {
                setQuery(event.target.value);
                setIndex(0);
              }}
            />
            {(
              [
                ["matchCase", "Aa", "区分大小写"],
                ["wholeWord", "ab", "全词匹配"],
                ["regex", ".*", "使用正则表达式"],
              ] as const
            ).map(([key, label, title]) => (
              <button
                key={key}
                className={key === "wholeWord" ? "whole-word" : ""}
                title={title}
                aria-label={title}
                aria-pressed={options[key]}
                onClick={() => {
                  setOptions({ ...options, [key]: !options[key] });
                  setIndex(0);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <span
            className="caption-find-count"
            role="status"
            aria-label="字幕匹配计数"
          >
            {query
              ? `${matches.length ? currentIndex + 1 : 0}/${matches.length}`
              : ""}
          </span>
          <button
            title="上一项（Shift+Enter）"
            aria-label="上一个匹配"
            disabled={!matches.length}
            onClick={() => move(-1)}
          >
            <ArrowUp size={16} />
          </button>
          <button
            title="下一项（Enter）"
            aria-label="下一个匹配"
            disabled={!matches.length}
            onClick={() => move(1)}
          >
            <ArrowDown size={16} />
          </button>
          <button
            title="仅在选中字幕中查找"
            aria-label="仅在选中字幕中查找"
            aria-pressed={Boolean(options.clipIds)}
            disabled={!options.clipIds && !editor.selectedIds.length}
            onClick={() => {
              setOptions({
                ...options,
                clipIds: options.clipIds ? undefined : [...editor.selectedIds],
              });
              setIndex(0);
            }}
          >
            <ListFilter size={16} />
          </button>
          <button
            title="关闭（Escape）"
            aria-label="关闭字幕搜索替换"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        {expanded && (
          <div className="caption-find-row">
            <div className="caption-find-input">
              <input
                aria-label="替换字幕为"
                placeholder="替换"
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
              />
              <button
                title="保留大小写"
                aria-label="保留大小写"
                aria-pressed={options.preserveCase}
                onClick={() =>
                  setOptions({
                    ...options,
                    preserveCase: !options.preserveCase,
                  })
                }
              >
                AB
              </button>
            </div>
            <button
              title="替换当前项（Enter）"
              aria-label="替换当前匹配"
              disabled={!active}
              onClick={() => replace(false)}
            >
              <Replace size={17} />
            </button>
            <button
              title="全部替换（Ctrl+Enter）"
              aria-label="替换全部匹配"
              disabled={!active}
              onClick={() => replace(true)}
            >
              <ReplaceAll size={17} />
            </button>
          </div>
        )}
        {error && (
          <p className="caption-find-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
  return (
    <>
      <div ref={anchor} className="caption-find-anchor" style={{ height }} />
      {createPortal(content, document.body)}
    </>
  );
}

export function CaptionHighlights({
  text,
  matches,
  active,
}: {
  text: string;
  matches: CaptionMatch[];
  active: CaptionMatch | null;
}) {
  let offset = 0;
  const parts = matches.map((match) => {
    const before = text.slice(offset, match.start);
    offset = match.end;
    return (
      <span key={match.start}>
        {before}
        <mark
          className={
            active?.clipId === match.clipId && active.start === match.start
              ? "current"
              : ""
          }
        >
          {text.slice(match.start, match.end) || "\u200b"}
        </mark>
      </span>
    );
  });
  return (
    <div className="caption-highlights" aria-hidden="true">
      {parts}
      {text.slice(offset)}
      {"\n"}
    </div>
  );
}
