import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export type PreviewOption<T extends string> = {
  value: T;
  label: string;
  preview: ReactNode;
};

/** A preview-bearing select whose popup stays visible outside scrolling panels. */
export default function PreviewSelect<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string;
  value: T;
  options: PreviewOption<T>[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 0,
  });
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  const show = () => {
    if (trigger.current?.matches(":disabled")) return;
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    );
    setOpen(true);
  };
  const choose = (index: number) => {
    setOpen(false);
    if (!trigger.current?.matches(":disabled")) onChange(options[index].value);
    trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current!.getBoundingClientRect();
      const width = Math.min(
        Math.max(bounds.width, 240),
        window.innerWidth - 16,
      );
      const below = window.innerHeight - bounds.bottom - 12;
      const above = bounds.top - 12;
      const height = Math.min(options.length * 52 + 10, 360);
      const upwards = below < height && above > below;
      const maxHeight = Math.max(52, Math.min(height, upwards ? above : below));
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8)),
        top: upwards ? bounds.top - maxHeight - 4 : bounds.bottom + 4,
        width,
        maxHeight,
      });
    };
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) place();
    };
    place();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open, options.length]);
  useLayoutEffect(() => {
    if (!open || !popup.current) return;
    const menu = popup.current;
    const option = document.getElementById(`${id}-${active}`);
    if (!option) return;
    // Scroll this menu only; scrollIntoView also moves its enclosing dialog.
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (
      option.offsetTop + option.offsetHeight >
      menu.scrollTop + menu.clientHeight
    )
      menu.scrollTop =
        option.offsetTop + option.offsetHeight - menu.clientHeight;
  }, [open, active, id, position.maxHeight]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="preview-select"
        role="combobox"
        data-value={value}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (
            [
              "ArrowDown",
              "ArrowUp",
              "Home",
              "End",
              "Enter",
              " ",
              "Escape",
            ].includes(event.key)
          ) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") setOpen(false);
            else if (!open) show();
            else if (event.key === "Enter" || event.key === " ") choose(active);
            else
              setActive(
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? options.length - 1
                    : (active +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        options.length) %
                      options.length,
              );
          }
        }}
      >
        <span className="preview-select-thumbnail" aria-hidden="true">
          {selected.preview}
        </span>
        <span className="preview-select-label">{selected.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={id}
            role="listbox"
            aria-label={`${label}选项`}
            className="preview-select-popup"
            style={position}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                id={`${id}-${index}`}
                type="button"
                role="option"
                data-value={option.value}
                aria-label={option.label}
                aria-selected={option.value === value}
                tabIndex={-1}
                className={active === index ? "active" : undefined}
                onPointerMove={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span className="preview-select-thumbnail" aria-hidden="true">
                  {option.preview}
                </span>
                <span className="preview-select-label">{option.label}</span>
                {option.value === value && (
                  <Check size={15} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
