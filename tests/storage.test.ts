import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PreferencesStore } from "../electron/preferences";
import { onnxEnvironment } from "../electron/onnx";
import { defaultStorageDirectories } from "../electron/storage";

const secrets = {
  isEncryptionAvailable: () => false,
  encryptString: () => Buffer.from(""),
  decryptString: () => "",
};

it("自定义目录持久化、复制备份和模型且保留目标文件，所有语音任务读取新模型目录", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-storage-"));
  try {
    const profile = path.join(root, "profile");
    const defaults = defaultStorageDirectories(profile);
    defaults.projectDirectory = path.join(root, "默认项目");
    await fs.mkdir(
      path.join(defaults.onnxModelsDirectory, "sensevoice-small"),
      { recursive: true },
    );
    await fs.writeFile(path.join(profile, "recovery.json"), "old-backup");
    await fs.writeFile(
      path.join(
        defaults.onnxModelsDirectory,
        "sensevoice-small/model.int8.onnx",
      ),
      "model",
    );
    await fs.writeFile(
      path.join(defaults.onnxModelsDirectory, "silero_vad.onnx"),
      "vad",
    );
    await fs.mkdir(
      path.join(defaults.onnxModelsDirectory, ".download-task-old"),
    );
    await fs.writeFile(
      path.join(defaults.onnxModelsDirectory, ".download-task-old/partial"),
      "partial",
    );
    const storage = {
      backupDirectory: path.join(root, "备份"),
      onnxModelsDirectory: path.join(root, "模型"),
      projectDirectory: path.join(root, "项目"),
    };
    await fs.mkdir(storage.onnxModelsDirectory);
    await fs.writeFile(
      path.join(storage.onnxModelsDirectory, "silero_vad.onnx"),
      "existing-vad",
    );
    let store = new PreferencesStore(
      path.join(profile, "preferences.json"),
      secrets,
      defaults,
    );
    await store.save({ storage });
    store = new PreferencesStore(
      path.join(profile, "preferences.json"),
      secrets,
      defaults,
    );
    expect((await store.get()).storage).toEqual(storage);
    expect(await store.storageDirectories()).toEqual(storage);
    expect(
      await fs.readFile(
        path.join(storage.backupDirectory, "recovery.json"),
        "utf8",
      ),
    ).toBe("old-backup");
    expect(
      await fs.readFile(
        path.join(
          storage.onnxModelsDirectory,
          "sensevoice-small/model.int8.onnx",
        ),
        "utf8",
      ),
    ).toBe("model");
    expect(
      await fs.readFile(
        path.join(storage.onnxModelsDirectory, "silero_vad.onnx"),
        "utf8",
      ),
    ).toBe("existing-vad");
    expect(await fs.readdir(storage.onnxModelsDirectory)).not.toContain(
      ".download-task-old",
    );
    expect(await fs.readFile(path.join(profile, "recovery.json"), "utf8")).toBe(
      "old-backup",
    );
    expect((await fs.stat(storage.projectDirectory)).isDirectory()).toBe(true);
    expect(
      (await onnxEnvironment(profile, "workers")).TRONCUT_ONNX_MODELS,
    ).toBe(storage.onnxModelsDirectory);
    await store.save({
      storage: {
        backupDirectory: "",
        onnxModelsDirectory: "",
        projectDirectory: "",
      },
    });
    expect(await store.storageDirectories()).toEqual(defaults);
    expect(await fs.readFile(path.join(profile, "recovery.json"), "utf8")).toBe(
      "old-backup",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("目录不可写、相对路径和嵌套模型位置保存失败时保留当前设置", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-storage-"));
  try {
    const store = new PreferencesStore(
      path.join(root, "preferences.json"),
      secrets,
    );
    const original = (await store.get()).storage;
    await fs.writeFile(path.join(root, "file"), "occupied");
    for (const patch of [
      { backupDirectory: path.join(root, "file") },
      { projectDirectory: "relative/path" },
      { onnxModelsDirectory: path.join(root, "models/onnx/nested") },
    ]) {
      await expect(
        store.save({ storage: { ...original, ...patch } }),
      ).rejects.toThrow();
      expect((await store.get()).storage).toEqual(original);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("切换备份位置等待先前备份写完，后续备份写入新位置", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-storage-"));
  try {
    const store = new PreferencesStore(
      path.join(root, "preferences.json"),
      secrets,
    );
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const write = store.useStorage(async ({ backupDirectory }) => {
      await pending;
      await fs.writeFile(path.join(backupDirectory, "recovery.json"), "latest");
    });
    const next = path.join(root, "backup");
    const save = store.save({ storage: { backupDirectory: next } });
    finish();
    await Promise.all([write, save]);
    expect(await fs.readFile(path.join(next, "recovery.json"), "utf8")).toBe(
      "latest",
    );
    await store.useStorage(async ({ backupDirectory }) => {
      expect(backupDirectory).toBe(next);
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
