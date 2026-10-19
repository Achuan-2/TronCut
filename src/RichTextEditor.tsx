import { useEffect, useLayoutEffect, useRef } from "react";
import type { Clip } from "../shared/model";
import { textFormatCss } from "../shared/text-format";
import {
  textSegments,
  characterStyleAt,
  type TextRange,
} from "../shared/rich-text";

function selectionOffsets(root: HTMLElement): TextRange | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { start, end: start + range.toString().length };
}

function restoreSelection(root: HTMLElement, offsets: TextRange) {
  const textLength = root.textContent?.length ?? 0;
  offsets = {
    start: Math.min(offsets.start, textLength),
    end: Math.min(offsets.end, textLength),
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let node = walker.nextNode(),
    position = 0,
    started = false;
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!started && offsets.start <= position + length) {
      range.setStart(node, Math.max(0, offsets.start - position));
      started = true;
    }
    if (started && offsets.end <= position + length) {
      range.setEnd(node, Math.max(0, offsets.end - position));
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      return;
    }
    position += length;
    node = walker.nextNode();
  }
  if (!root.textContent) {
    range.selectNodeContents(root);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  }
}

export default function RichTextEditor({
  clip,
  scale,
  onChange,
  onSelection,
  onEnd,
  onUndo,
  onRedo,
}: {
  clip: Clip;
  scale: number;
  onChange: (text: string) => void;
  onSelection: (range: TextRange | null) => void;
  onEnd: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const selectionCallback = useRef(onSelection);
  selectionCallback.current = onSelection;
  useLayoutEffect(() => {
    const element = root.current!;
    if (composing.current) return;
    const selection = selectionOffsets(element);
    const nodes = textSegments(clip).map((run) => {
      const span = document.createElement("span"),
        style = characterStyleAt(clip, run.start);
      span.textContent = (clip.text ?? "").slice(run.start, run.end);
      Object.assign(span.style, {
        ...textFormatCss(style),
        fontFamily: `"${style.fontFamily.replace(/["\\]/g, "")}", "PingFang SC", sans-serif`,
        fontSize: `${style.fontSize * scale}px`,
        color: style.color,
        webkitTextStroke: `${style.outlineWidth * scale}px ${style.outline}`,
      });
      return span;
    });
    element.replaceChildren(...nodes);
    if (document.activeElement === element && selection)
      restoreSelection(element, selection);
  }, [clip.text, clip.textRuns, clip.style, scale]);
  useEffect(() => {
    const element = root.current!;
    element.focus();
    restoreSelection(element, { start: 0, end: (clip.text ?? "").length });
    const changed = () => {
      const selection = selectionOffsets(element);
      if (selection)
        selectionCallback.current(
          selection.end > selection.start ? selection : null,
        );
    };
    changed();
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, []);
  const commit = () => {
    if (composing.current) return;
    onChange((root.current?.textContent ?? "").slice(0, 10000));
    const selection = root.current && selectionOffsets(root.current);
    if (selection)
      selectionCallback.current(
        selection.end > selection.start ? selection : null,
      );
  };
  // Keep every line break as a text node. Browser editing commands otherwise
  // insert div/br elements, whose textContent loses line breaks and offsets.
  const insertPlainText = (text: string) => {
    const element = root.current!,
      selection = window.getSelection();
    const offsets = selectionOffsets(element);
    if (!selection?.rangeCount || !offsets) return;
    const available =
      10000 - (element.textContent!.length - (offsets.end - offsets.start));
    const node = document.createTextNode(text.slice(0, Math.max(0, available)));
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    commit();
  };
  return (
    <div
      ref={root}
      className="preview-text-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="画布文本内容"
      aria-multiline="true"
      spellCheck={false}
      onInput={commit}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        commit();
      }}
      onPaste={(event) => {
        event.preventDefault();
        insertPlainText(
          event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"),
        );
      }}
      onDrop={(event) => event.preventDefault()}
      onBlur={onEnd}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (
          (event.ctrlKey || event.metaKey) &&
          (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (event.shiftKey || event.key.toLowerCase() === "y") onRedo();
          else onUndo();
        } else if (
          event.key === "Escape" ||
          (event.key === "Enter" && (event.ctrlKey || event.metaKey))
        ) {
          event.preventDefault();
          event.stopPropagation();
          onEnd();
        } else if (event.key === "Enter") {
          event.preventDefault();
          insertPlainText("\n");
        }
      }}
    />
  );
}
