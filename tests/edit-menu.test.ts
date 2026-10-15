import { expect, it } from "vitest";
import { editCommandEnabled, type EditMenuState } from "../shared/edit-menu";

it("菜单按首页、文本编辑、锁定轨道及撤销状态启用编辑命令", () => {
  const state: EditMenuState = {
    blocked: false,
    editingText: false,
    session: false,
    canUndo: false,
    canRedo: false,
    selected: 0,
    editable: false,
    canGroup: false,
    canUngroup: false,
    canSplit: false,
  };
  expect(editCommandEnabled("preferences", state)).toBe(true);
  expect(editCommandEnabled("paste", state)).toBe(false);
  const locked = { ...state, session: true, selected: 1 };
  expect(editCommandEnabled("copy", locked)).toBe(true);
  expect(editCommandEnabled("cut", locked)).toBe(false);
  expect(editCommandEnabled("delete", locked)).toBe(false);
  expect(editCommandEnabled("undo", { ...locked, canUndo: true })).toBe(true);
  expect(
    editCommandEnabled("split", { ...locked, editable: true, canSplit: true }),
  ).toBe(true);
  expect(editCommandEnabled("copy", { ...state, editingText: true })).toBe(
    true,
  );
  expect(editCommandEnabled("preferences", { ...state, blocked: true })).toBe(
    false,
  );
});
