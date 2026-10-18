import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./FontSelect.css";

let installedFonts: Promise<string[]> | undefined;
function localFonts() {
  const query = (
    window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }
  ).queryLocalFonts;
  if (!query) return Promise.reject(new Error("当前环境无法读取本机字体"));
  installedFonts ??= query
    .call(window)
    .then((fonts) =>
      [
        ...new Set(
          fonts
            .map((font) => font.family)
            .filter((family) => family && family.length <= 100),
        ),
      ].sort((a, b) => a.localeCompare(b, "zh-CN")),
    )
    .catch((error) => {
      installedFonts = undefined;
      throw error;
    });
  return installedFonts;
}

export default function FontSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (font: string) => void;
}) {
  const [fonts, setFonts] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 240,
    maxHeight: 280,
  });
  const options = useMemo(() => {
    const all = fonts.includes(value)
      ? fonts
      : [value, ...fonts].filter(Boolean);
    const needle = query.trim().toLocaleLowerCase();
    return all.filter((font) => font.toLocaleLowerCase().includes(needle));
  }, [fonts, value, query]);
  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(-1);
  };
  const show = () => {
    if (open) return;
    setQuery("");
    setActive(-1);
    setOpen(true);
    if (!fonts.length) load();
  };
  const choose = (font: string) => {
    onChange(font);
    close();
  };
  const load = () => {
    void localFonts()
      .then((fonts) => {
        setFonts(fonts);
        setError("");
      })
      .catch((error: Error) => setError(error.message));
  };
  useEffect(load, []);
  useLayoutEffect(() => {
    if (!open) return;
    const positionPopup = () => {
      const bounds = input.current!.getBoundingClientRect();
      const width = Math.min(Math.max(bounds.width, 240), innerWidth - 16);
      const below = innerHeight - bounds.bottom - 8;
      const above = bounds.top - 8;
      const height = Math.min(280, Math.max(below, above));
      const down = below >= Math.min(280, above);
      setPosition({
        left: Math.max(8, Math.min(bounds.left, innerWidth - width - 8)),
        top: down ? bounds.bottom + 4 : Math.max(8, bounds.top - height - 4),
        width,
        maxHeight: height,
      });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!input.current?.contains(target) && !popup.current?.contains(target))
        close();
    };
    positionPopup();
    window.addEventListener("resize", positionPopup);
    window.addEventListener("scroll", positionPopup, true);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("resize", positionPopup);
      window.removeEventListener("scroll", positionPopup, true);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  useEffect(() => {
    popup.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <>
      <label className="field">
        字体
        <input
          ref={input}
          aria-label="字体"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && active >= 0 ? `${listId}-${active}` : undefined
          }
          autoComplete="off"
          placeholder={open ? "搜索字体" : undefined}
          value={open ? query : value}
          onFocus={show}
          onClick={show}
          onBlur={close}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) show();
              if (options.length)
                setActive((index) =>
                  event.key === "ArrowDown"
                    ? (index + 1) % options.length
                    : (index <= 0 ? options.length : index) - 1,
                );
            } else if (event.key === "Enter") {
              event.preventDefault();
              const exact = options.find(
                (font) =>
                  font.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
              );
              const chosen = options[active] ?? exact;
              if (open && chosen) choose(chosen);
            }
          }}
          title={error || `本机字体（${fonts.length}）`}
        />
      </label>
      {open &&
        createPortal(
          <div
            ref={popup}
            id={listId}
            role="listbox"
            aria-label="字体列表"
            className="font-select-list"
            style={position}
          >
            {options.map((font, index) => (
              <button
                key={font}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={active === index}
                tabIndex={-1}
                title={font}
                style={{ fontFamily: font }}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(font)}
              >
                {font}
              </button>
            ))}
            {!options.length && <p role="status">没有匹配的字体</p>}
          </div>,
          document.body,
        )}
      {error && <p className="field-help">{error}，点击字体框可重试。</p>}
    </>
  );
}
