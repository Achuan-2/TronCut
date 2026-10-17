import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Copy, Scissors, Trash2 } from "lucide-react";
import {
  animationEasings,
  easingLabels,
  type AnimationEasing,
} from "../shared/easing";

export function AnimationContextMenu({
  x,
  y,
  easing,
  locked,
  close,
  copy,
  cut,
  remove,
  changeEasing,
}: {
  x: number;
  y: number;
  easing: AnimationEasing;
  locked: boolean;
  close: () => void;
  copy: () => void;
  cut: () => void;
  remove: () => void;
  changeEasing: (value: AnimationEasing) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const element = useRef<HTMLDivElement>(null);
  const left = Math.max(8, Math.min(x, window.innerWidth - 240));
  const top = Math.max(8, Math.min(y, window.innerHeight - 205));
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!element.current?.contains(event.target as Node)) close();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      } else if (
        (event.ctrlKey || event.metaKey) &&
        ["c", "x"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key.toLowerCase() === "c") copy();
        else if (!locked) cut();
        close();
      } else if (["Delete", "Backspace"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        if (!locked) remove();
        close();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", keys, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", keys, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [close, copy, cut, remove, locked]);
  const execute = (action: () => void) => {
    action();
    close();
  };
  return createPortal(
    <div
      ref={element}
      className="context-menu animation-context-menu"
      role="menu"
      aria-label="动画菜单"
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button role="menuitem" disabled={locked} onClick={() => execute(cut)}>
        <Scissors size={14} />
        剪切<span className="menu-shortcut">Ctrl+X</span>
      </button>
      <button role="menuitem" onClick={() => execute(copy)}>
        <Copy size={14} />
        复制<span className="menu-shortcut">Ctrl+C</span>
      </button>
      <button role="menuitem" disabled={locked} onClick={() => execute(remove)}>
        <Trash2 size={14} />
        删除<span className="menu-shortcut">Delete</span>
      </button>
      <hr />
      <div
        className={`animation-easing ${expanded ? "expanded" : ""}`}
        onMouseEnter={() => !locked && setExpanded(true)}
      >
        <button
          role="menuitem"
          disabled={locked}
          aria-haspopup="menu"
          aria-expanded={expanded}
          onClick={() => setExpanded(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              setExpanded(true);
            }
          }}
        >
          <Check size={14} />
          启用缓冲
          <ChevronRight size={14} className="menu-shortcut" />
        </button>
        {expanded && (
          <div
            className="context-menu animation-easing-menu"
            role="menu"
            aria-label="缓动方式"
            style={{
              left: left + 240 + 210 > window.innerWidth ? "auto" : "100%",
              right: left + 240 + 210 > window.innerWidth ? "100%" : "auto",
            }}
          >
            {animationEasings.map((value) => (
              <button
                key={value}
                role="menuitemradio"
                aria-checked={easing === value}
                onClick={() => execute(() => changeEasing(value))}
              >
                <Check
                  size={14}
                  style={{
                    visibility: easing === value ? "visible" : "hidden",
                  }}
                />
                {easingLabels[value]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
