import { z } from "zod";
import { editCommands } from "./edit-menu";

export const shortcutCommands = [
  { id: "new", label: "新建项目", shortcut: "CmdOrCtrl+N" },
  { id: "open", label: "导入项目", shortcut: "CmdOrCtrl+O" },
  { id: "save", label: "保存项目", shortcut: "CmdOrCtrl+S" },
  { id: "saveAs", label: "另存为", shortcut: "CmdOrCtrl+Shift+S" },
  { id: "import", label: "导入素材", shortcut: "CmdOrCtrl+I" },
  { id: "export", label: "导出视频", shortcut: "CmdOrCtrl+E" },
  ...editCommands,
  { id: "addText", label: "添加文本", shortcut: "Shift+T" },
  { id: "addAnimation", label: "添加动画", shortcut: "Shift+A" },
  { id: "playPause", label: "播放 / 暂停", shortcut: "Space" },
  { id: "previousFrame", label: "前一帧", shortcut: "ArrowLeft" },
  { id: "nextFrame", label: "后一帧", shortcut: "ArrowRight" },
  { id: "previousMedia", label: "前一个媒体", shortcut: "CmdOrCtrl+ArrowLeft" },
  { id: "nextMedia", label: "后一个媒体", shortcut: "CmdOrCtrl+ArrowRight" },
] as const;

export type ShortcutCommand = (typeof shortcutCommands)[number]["id"];
export type ShortcutMap = Record<ShortcutCommand, string>;
export const defaultShortcuts = Object.fromEntries(
  shortcutCommands.map(({ id, shortcut }) => [id, shortcut]),
) as ShortcutMap;

const commandIds = new Set<string>(shortcutCommands.map(({ id }) => id));
export const reservedShortcuts = new Set(["CmdOrCtrl+Shift+F9"]);
const shortcutPattern =
  /^(?:CmdOrCtrl\+)?(?:Alt\+)?(?:Shift\+)?(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Delete|Backspace|Escape|Space|Enter|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|,|\.|\/|\\|;|'|\[|\]|`|-)$/;

export const shortcutOverridesSchema = z
  .record(z.string(), z.string())
  .superRefine((value, context) => {
    for (const [id, shortcut] of Object.entries(value)) {
      if (!commandIds.has(id))
        context.addIssue({ code: "custom", message: `未知快捷键命令：${id}` });
      if (!shortcutPattern.test(shortcut) || /^[A-Z0-9]$/.test(shortcut))
        context.addIssue({
          code: "custom",
          message: `无效快捷键：${shortcut}`,
        });
      if (reservedShortcuts.has(shortcut))
        context.addIssue({
          code: "custom",
          message: `${shortcut} 已用于停止录屏`,
        });
    }
    const effective = { ...defaultShortcuts, ...value };
    const seen = new Map<string, string>();
    for (const command of shortcutCommands) {
      const binding = effective[command.id];
      const previous = seen.get(binding);
      if (previous)
        context.addIssue({
          code: "custom",
          message: `${command.label}与${shortcutCommands.find((item) => item.id === previous)?.label}的快捷键冲突`,
        });
      seen.set(binding, command.id);
    }
  });

export function resolveShortcuts(
  overrides: Record<string, string> = {},
): ShortcutMap {
  return { ...defaultShortcuts, ...overrides };
}

export function shortcutFromEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
): string | null {
  const key =
    event.key === " "
      ? "Space"
      : event.key.startsWith("Arrow")
        ? event.key
        : event.code === "Backslash"
          ? "\\"
          : event.key.length === 1
            ? event.key.toUpperCase()
            : event.key;
  if (["Control", "Meta", "Alt", "Shift", "Dead", "Process"].includes(key))
    return null;
  const result = `${event.ctrlKey || event.metaKey ? "CmdOrCtrl+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}${key}`;
  return shortcutPattern.test(result) && !/^[A-Z0-9]$/.test(result)
    ? result
    : null;
}

export function shortcutCommandForEvent(
  event: KeyboardEvent,
  shortcuts: ShortcutMap,
): ShortcutCommand | null {
  const binding = shortcutFromEvent(event);
  return (
    shortcutCommands.find((command) => shortcuts[command.id] === binding)?.id ??
    null
  );
}

export function displayShortcut(shortcut: string, platform = "win32") {
  return shortcut
    .replace("CmdOrCtrl", platform === "darwin" ? "⌘" : "Ctrl")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓");
}
