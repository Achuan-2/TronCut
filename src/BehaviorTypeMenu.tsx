import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { createPortal } from "react-dom";
import type { BehaviorPhase } from "../shared/behaviors";
import "./BehaviorTypeMenu.css";

const orders = [
  ["forward", "第一个到最后一个"],
  ["backward", "最后一个到第一个"],
  ["center", "中心向外"],
  ["simultaneous", "同时"],
] as const;

const menuItems = (menu: HTMLDivElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLButtonElement>("button") ?? []);
const clamp = (position: number, size: number, viewport: number) =>
  Math.max(8, Math.min(position, viewport - size - 8));

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
  const trigger = useRef<HTMLButtonElement>(null);
  const mainMenu = useRef<HTMLDivElement>(null);
  const orderMenu = useRef<HTMLDivElement>(null);
  const textItem = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const focusOrders = useRef(false);
  const id = useId();
  const [position, setPosition] = useState({
    left: 0,
    top: 0,
    width: 180,
    orderLeft: 0,
    orderTop: 0,
    leftward: true,
  });
  const cancelClose = () => clearTimeout(closeTimer.current);
  const close = (restoreFocus = false) => {
    cancelClose();
    focusOrders.current = false;
    setOpen(false);
    setSubmenu(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };
  const closeOrders = () => {
    cancelClose();
    if (orderMenu.current?.contains(document.activeElement))
      textItem.current?.focus({ preventScroll: true });
    setSubmenu(false);
  };
  const openOrders = (keyboard = false) => {
    cancelClose();
    focusOrders.current = keyboard;
    setSubmenu(true);
    if (keyboard && submenu) {
      (
        orderMenu.current?.querySelector<HTMLButtonElement>(
          '[aria-checked="true"]',
        ) ?? menuItems(orderMenu.current)[0]
      )?.focus({ preventScroll: true });
    }
  };
  const delayCloseOrders = () => {
    cancelClose();
    closeTimer.current = setTimeout(closeOrders, 180);
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current || !mainMenu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const menu = mainMenu.current.getBoundingClientRect();
    const width = Math.min(Math.max(180, anchor.width), window.innerWidth - 16);
    const left = clamp(anchor.left, width, window.innerWidth);
    const top = clamp(
      anchor.bottom + menu.height + 2 <= window.innerHeight - 8
        ? anchor.bottom + 2
        : anchor.top - menu.height - 2,
      menu.height,
      window.innerHeight,
    );
    const child = orderMenu.current?.getBoundingClientRect();
    const childWidth = child?.width ?? Math.min(240, window.innerWidth - 16);
    const leftward = left + width + childWidth > window.innerWidth - 8;
    const rowOffset =
      (textItem.current?.getBoundingClientRect().top ?? menu.top) - menu.top;
    setPosition({
      left,
      top,
      width,
      leftward,
      orderLeft: clamp(
        leftward ? left - childWidth + 1 : left + width - 1,
        childWidth,
        window.innerWidth,
      ),
      orderTop: clamp(top + rowOffset, child?.height ?? 0, window.innerHeight),
    });
    if (submenu && focusOrders.current) {
      (
        orderMenu.current?.querySelector<HTMLButtonElement>(
          '[aria-checked="true"]',
        ) ?? menuItems(orderMenu.current)[0]
      )?.focus({ preventScroll: true });
      focusOrders.current = false;
    }
  }, [open, submenu]);

  useEffect(() => {
    if (!open) return;
    (value === "whole"
      ? menuItems(mainMenu.current)[0]
      : textItem.current
    )?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        ![trigger.current, mainMenu.current, orderMenu.current].some((node) =>
          node?.contains(target),
        )
      )
        close();
    };
    const scroll = (event: Event) => {
      if (
        ![mainMenu.current, orderMenu.current].some((node) =>
          node?.contains(event.target as Node),
        )
      )
        close();
    };
    const resize = () => close();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      cancelClose();
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  const select = (next: BehaviorPhase["type"]) => {
    change(next);
    close(true);
  };
  const menuKeyDown = (event: KeyboardEvent<HTMLDivElement>, child = false) => {
    // Menu keystrokes must not reach timeline shortcuts.
    event.stopPropagation();
    const items = menuItems(child ? orderMenu.current : mainMenu.current);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[next]?.focus({ preventScroll: true });
      if (!child && items[next] === textItem.current) openOrders();
      else if (!child) closeOrders();
    } else if (
      event.key === "ArrowRight" &&
      !child &&
      document.activeElement === textItem.current
    ) {
      event.preventDefault();
      openOrders(true);
    } else if ((event.key === "ArrowLeft" && child) || event.key === "Escape") {
      event.preventDefault();
      if (submenu) {
        closeOrders();
        textItem.current?.focus({ preventScroll: true });
      } else close(true);
    } else if (event.key === "Tab") close(true);
  };
  return (
    <div className="behavior-type-menu">
      <button
        ref={trigger}
        type="button"
        aria-label="行为类型"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp", "Escape"].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") close(true);
            else setOpen(true);
          }
        }}
      >
        <span>
          {value === "whole"
            ? "对象"
            : `文本 - ${orders.find(([order]) => order === value)?.[1]}`}
        </span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <>
            <div
              className="behavior-type-popup"
              role="menu"
              aria-label="行为类型菜单"
              id={id}
              ref={mainMenu}
              style={{
                left: position.left,
                top: position.top,
                width: position.width,
              }}
              onKeyDown={(event) => menuKeyDown(event)}
            >
              <button
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                aria-checked={value === "whole"}
                onMouseEnter={closeOrders}
                onClick={() => select("whole")}
              >
                <span className="behavior-menu-check">
                  {value === "whole" && <Check size={14} aria-hidden="true" />}
                </span>
                <span>对象</span>
              </button>
              {text && (
                <button
                  ref={textItem}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-haspopup="menu"
                  aria-expanded={submenu}
                  aria-controls={submenu ? `${id}-orders` : undefined}
                  className={submenu ? "behavior-submenu-open" : undefined}
                  onMouseEnter={() => openOrders()}
                  onMouseLeave={delayCloseOrders}
                  onClick={() => openOrders(true)}
                >
                  <span className="behavior-menu-check">
                    {value !== "whole" && (
                      <Check size={14} aria-hidden="true" />
                    )}
                  </span>
                  <span>文本</span>
                  {position.leftward ? (
                    <ChevronLeft size={14} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={14} aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
            {text && submenu && (
              <div
                className="behavior-order-popup"
                role="menu"
                aria-label="文本顺序"
                id={`${id}-orders`}
                ref={orderMenu}
                style={{ left: position.orderLeft, top: position.orderTop }}
                onMouseEnter={cancelClose}
                onMouseLeave={delayCloseOrders}
                onKeyDown={(event) => menuKeyDown(event, true)}
              >
                {orders.map(([order, label]) => (
                  <button
                    type="button"
                    role="menuitemradio"
                    tabIndex={-1}
                    key={order}
                    aria-checked={value === order}
                    onClick={() => select(order)}
                  >
                    <span className="behavior-menu-check">
                      {value === order && (
                        <Check size={14} aria-hidden="true" />
                      )}
                    </span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </>,
          document.body,
        )}
    </div>
  );
}
