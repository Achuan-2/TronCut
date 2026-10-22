import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PreferencesStore } from "../electron/preferences";
import {
  defaultShortcuts,
  shortcutCommandForEvent,
  shortcutOverridesSchema,
} from "../shared/shortcuts";

it("自定义快捷键持久化，拒绝冲突和无修饰键字母", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-shortcuts-"));
  try {
    const file = path.join(root, "preferences.json");
    const store = new PreferencesStore(file, {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => "",
    });
    expect(
      shortcutOverridesSchema.safeParse({ addText: "Shift+A" }).success,
    ).toBe(false);
    expect(shortcutOverridesSchema.safeParse({ addText: "T" }).success).toBe(
      false,
    );
    await store.save({ shortcuts: { addText: "Shift+Y" } });
    expect(
      (
        await new PreferencesStore(file, {
          isEncryptionAvailable: () => false,
          encryptString: () => Buffer.alloc(0),
          decryptString: () => "",
        }).get()
      ).shortcuts.addText,
    ).toBe("Shift+Y");
    expect(
      shortcutCommandForEvent(
        {
          key: "T",
          code: "KeyT",
          shiftKey: true,
          ctrlKey: false,
          metaKey: false,
          altKey: false,
        } as KeyboardEvent,
        { ...defaultShortcuts, addText: "Shift+Y" },
      ),
    ).toBeNull();
    await store.save({ shortcuts: {} });
    expect((await store.get()).shortcuts.addText).toBe("Shift+T");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
