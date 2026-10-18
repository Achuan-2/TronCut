import { z } from "zod";

export const editCommands = [
  { id: "undo", label: "撤销", shortcut: "CmdOrCtrl+Z", group: 0 },
  { id: "redo", label: "重做", shortcut: "CmdOrCtrl+Shift+Z", group: 0 },
  { id: "cut", label: "剪切", shortcut: "CmdOrCtrl+X", group: 1 },
  { id: "copy", label: "复制", shortcut: "CmdOrCtrl+C", group: 1 },
  { id: "paste", label: "粘贴", shortcut: "CmdOrCtrl+V", group: 1 },
  { id: "duplicate", label: "创建副本", shortcut: "CmdOrCtrl+D", group: 1 },
  { id: "delete", label: "删除", shortcut: "Delete", group: 2 },
  { id: "rippleDelete", label: "波纹删除", shortcut: "Shift+Delete", group: 2 },
  { id: "split", label: "在播放头处分割", shortcut: "CmdOrCtrl+K", group: 2 },
  { id: "stitch", label: "拼接所选媒体", shortcut: "CmdOrCtrl+Alt+I", group: 2 },
  { id: "unstitch", label: "移除全部拼接", shortcut: "CmdOrCtrl+Shift+\\", group: 2 },
  { id: "group", label: "组合", shortcut: "CmdOrCtrl+G", group: 3 },
  { id: "ungroup", label: "取消组合", shortcut: "CmdOrCtrl+Shift+G", group: 3 },
  { id: "selectAll", label: "全选", shortcut: "CmdOrCtrl+A", group: 4 },
  { id: "deselect", label: "取消选择", shortcut: "Escape", group: 4 },
  { id: "preferences", label: "首选项…", shortcut: "CmdOrCtrl+,", group: 5 },
] as const;
export type EditCommand = (typeof editCommands)[number]["id"];
export const textEditSchema = z.enum([
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "selectAll",
  "delete",
]);
export const editMenuStateSchema = z.object({
  blocked: z.boolean(),
  editingText: z.boolean(),
  session: z.boolean(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  selected: z.number().int().nonnegative(),
  editable: z.boolean(),
  canGroup: z.boolean(),
  canUngroup: z.boolean(),
  canSplit: z.boolean(),
  canStitch: z.boolean().optional(),
  canUnstitch: z.boolean().optional(),
});
export type EditMenuState = z.infer<typeof editMenuStateSchema>;
export function editCommandEnabled(id: EditCommand, state: EditMenuState) {
  if (state.blocked) return false;
  if (id === "preferences") return true;
  if (state.editingText)
    return [
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
      "delete",
    ].includes(id);
  if (!state.session) return false;
  if (id === "undo") return state.canUndo;
  if (id === "redo") return state.canRedo;
  if (id === "paste" || id === "selectAll") return true;
  if (id === "group") return state.canGroup;
  if (id === "ungroup") return state.canUngroup;
  if (id === "split") return state.canSplit;
  if (id === "stitch") return !!state.canStitch;
  if (id === "unstitch") return !!state.canUnstitch;
  if (id === "copy" || id === "deselect") return state.selected > 0;
  return state.editable;
}
