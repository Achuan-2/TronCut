import { useCallback, useMemo, useRef, useState } from "react";
import { behaviorName, type Behavior } from "../shared/behaviors";
import {
  captureBehaviorPreset,
  deleteBehaviorPreset,
  emptyPresetLibrary,
  favoriteKey,
  libraryBehaviors,
  presetLibrarySchema,
  renameBehaviorPreset,
  restoreDefaultBehaviors,
  type PresetKind,
  type PresetLibraryState,
} from "../shared/preset-library";

export const presetLibraryStorageKey = "troncut.preset-library";
export function usePresetLibrary() {
  const [loaded] = useState(() => {
    try {
      const raw = localStorage.getItem(presetLibraryStorageKey);
      return {
        state: raw
          ? presetLibrarySchema.parse(JSON.parse(raw))
          : emptyPresetLibrary(),
        error: "",
      };
    } catch {
      return {
        state: emptyPresetLibrary(),
        error: "无法读取预设库，正在显示默认预设。",
      };
    }
  });
  const [state, setState] = useState(loaded.state);
  const [error, setError] = useState(loaded.error);
  const current = useRef(state);
  const behaviors = useMemo(() => libraryBehaviors(state), [state]);
  const findBehavior = useCallback(
    (id: string) =>
      libraryBehaviors(current.current, true).find(
        (preset) => preset.id === id,
      ),
    [],
  );
  const [menu, showMenu] = useState<{
    x: number;
    y: number;
    kind: PresetKind;
    id?: string;
  } | null>(null);
  const [dialog, showDialog] = useState<
    | { mode: "add"; name: string; behavior: Behavior }
    | { mode: "rename"; name: string; id: string }
    | null
  >(null);
  const update = (
    operation: (state: PresetLibraryState) => PresetLibraryState,
  ) => {
    try {
      const next = presetLibrarySchema.parse(operation(current.current));
      localStorage.setItem(presetLibraryStorageKey, JSON.stringify(next));
      current.current = next;
      setState(next);
      setError("");
      return true;
    } catch {
      setError("预设库保存失败，请检查本机存储空间后重试。");
      return false;
    }
  };
  return {
    state,
    error,
    menu,
    showMenu,
    dialog,
    showDialog,
    behaviors,
    findBehavior,
    isFavorite: (kind: PresetKind, id: string) =>
      state.favorites.includes(favoriteKey(kind, id)),
    toggleFavorite: (kind: PresetKind, id: string) =>
      update((state) => {
        const key = favoriteKey(kind, id);
        return {
          ...state,
          favorites: state.favorites.includes(key)
            ? state.favorites.filter((item) => item !== key)
            : [...state.favorites, key],
        };
      }),
    deleteBehavior: (id: string) =>
      update((state) => deleteBehaviorPreset(state, id)),
    restoreDefaults: () => update(restoreDefaultBehaviors),
    saveBehavior: (behavior: Behavior) =>
      showDialog({
        mode: "add",
        name: behaviorName(behavior),
        behavior: structuredClone(behavior),
      }),
    submitName: (name: string) => {
      if (!dialog || !name.trim() || name.trim().length > 100) return;
      if (
        update((state) =>
          dialog.mode === "add"
            ? {
                ...state,
                customBehaviors: [
                  ...state.customBehaviors,
                  captureBehaviorPreset(dialog.behavior, name),
                ],
              }
            : renameBehaviorPreset(state, dialog.id, name),
        )
      )
        showDialog(null);
    },
  };
}
export type PresetLibrary = ReturnType<typeof usePresetLibrary>;
