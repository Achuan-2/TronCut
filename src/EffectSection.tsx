import { useState, type ReactNode } from "react";
import { ChevronDown, MoreHorizontal, RotateCcw, X } from "lucide-react";

export default function EffectSection({
  title,
  children,
  enabled,
  onToggle,
  onReset,
  onRemove,
  defaultExpanded = true,
  onSelect,
}: {
  title: string;
  children: ReactNode;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  onReset?: () => void;
  onRemove?: () => void;
  defaultExpanded?: boolean;
  onSelect?: () => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <section
      className="visual-effect-properties"
      aria-label={`${title}属性`}
      onPointerDownCapture={onSelect}
      onFocusCapture={onSelect}
    >
      <header className="effect-section-heading">
        <button
          className="effect-section-toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"}${title}属性`}
          onClick={() => setExpanded(!expanded)}
        >
          <ChevronDown size={16} />
          <h3>{title}</h3>
        </button>
        {(onReset || onRemove) && (
          <details className="effect-actions">
            <summary aria-label={`${title}选项`} title={`${title}选项`}>
              <MoreHorizontal size={18} />
            </summary>
            <div className="effect-actions-menu">
              {onReset && (
                <button
                  aria-label={
                    title === "剪辑速度" ? "恢复正常速度" : `重置${title}`
                  }
                  onClick={(event) => {
                    event.currentTarget.closest("details")!.open = false;
                    onReset();
                  }}
                >
                  <RotateCcw size={13} />
                  重置
                </button>
              )}
              {onRemove && (
                <button
                  aria-label={`移除${title}`}
                  onClick={(event) => {
                    event.currentTarget.closest("details")!.open = false;
                    onRemove();
                  }}
                >
                  <X size={13} />
                  移除
                </button>
              )}
            </div>
          </details>
        )}
        {onToggle && (
          <input
            type="checkbox"
            role="switch"
            aria-label={`启用${title}`}
            checked={enabled}
            onChange={(event) => onToggle(event.target.checked)}
          />
        )}
      </header>
      {expanded && <div className="effect-section-body">{children}</div>}
    </section>
  );
}
