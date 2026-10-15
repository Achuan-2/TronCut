import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BehaviorPhase } from "../shared/behaviors";

const orders = [
  ["forward", "第一个到最后一个"],
  ["backward", "最后一个到第一个"],
  ["center", "中心向外"],
  ["simultaneous", "同时"],
] as const;
export default function BehaviorTypeMenu({
  value,
  text,
  change,
}: {
  value: BehaviorPhase["type"];
  text: boolean;
  change: (value: BehaviorPhase["type"]) => void;
}) {
  const [open, setOpen] = useState(false),
    [submenu, setSubmenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", outside);
    return () => window.removeEventListener("pointerdown", outside);
  }, [open]);
  const select = (next: BehaviorPhase["type"]) => {
    change(next);
    setOpen(false);
    setSubmenu(false);
    root.current?.querySelector("button")?.focus();
  };
  return (
    <div
      className="behavior-type-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label="行为类型"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setSubmenu(false);
        }}
      >
        {value === "whole"
          ? "对象"
          : `文本 - ${orders.find(([order]) => order === value)?.[1]}`}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="behavior-type-popup" role="menu">
          <button
            type="button"
            role="menuitemradio"
            aria-checked={value === "whole"}
            onClick={() => select("whole")}
          >
            对象
          </button>
          {text && (
            <div
              className="behavior-text-submenu"
              onMouseEnter={() => setSubmenu(true)}
            >
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={submenu}
                onClick={() => setSubmenu(true)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") setSubmenu(true);
                }}
              >
                文本
                <ChevronRight size={14} />
              </button>
              {submenu && (
                <div className="behavior-order-popup" role="menu">
                  {orders.map(([order, label]) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      key={order}
                      aria-checked={value === order}
                      onClick={() => select(order)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
