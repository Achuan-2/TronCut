import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PreferencesStore } from "../electron/preferences";
import {
  aiSettingsSchema,
  preferencesUpdateSchema,
} from "../shared/preferences";
import { defaultRecordingSettings } from "../shared/recording";
const secrets = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) =>
    Buffer.from(value.split("").reverse().join("")),
  decryptString: (value: Buffer) =>
    value.toString().split("").reverse().join(""),
};

it("首选项持久化且不向界面或工程暴露密钥，更换服务不会复用原密钥", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-preferences-"));
  try {
    const file = path.join(root, "preferences.json");
    const store = new PreferencesStore(file, secrets);
    const ai = { baseUrl: "https://first.example/v1", model: "my-model" };
    const saved = await store.save({ ai, apiKey: "test-key-secret" });
    expect(saved.hasApiKey).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("test-key-secret");
    expect(await fs.readFile(file, "utf8")).not.toContain("test-key-secret");
    expect((await new PreferencesStore(file, secrets).resolveAi()).apiKey).toBe(
      "test-key-secret",
    );
    expect(
      (
        await store.resolveAi({
          ai: { ...ai, baseUrl: "https://other.example/v1" },
        })
      ).apiKey,
    ).toBe("");
    await store.save({ captions: { segmentation: "custom", maxChars: 15 } });
    expect((await store.get()).captions.maxChars).toBe(15);
    expect((await store.resolveAi()).apiKey).toBe("test-key-secret");
    await store.save({ ai: { ...ai, baseUrl: "https://other.example/v1" } });
    expect((await store.get()).hasApiKey).toBe(false);
    await store.save({ apiKey: "new-secret" });
    await store.save({ clearApiKey: true });
    expect((await store.resolveAi()).apiKey).toBe("");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("拒绝地址中的凭据和非 HTTP 协议，不在安全存储不可用时明文保存密钥", async () => {
  for (const baseUrl of [
    "file:///test",
    "https://user:password@example.com",
    "https://example.com?key=secret",
  ]) {
    expect(aiSettingsSchema.safeParse({ baseUrl, model: "test" }).success).toBe(
      false,
    );
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-preferences-"));
  try {
    const store = new PreferencesStore(path.join(root, "preferences.json"), {
      ...secrets,
      isEncryptionAvailable: () => false,
    });
    await expect(store.save({ apiKey: "secret" })).rejects.toThrow(
      "系统安全存储不可用",
    );
    expect((await store.get()).hasApiKey).toBe(false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("多个模型独立保存密钥，切换、测试、修改与删除不会串用配置", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-preferences-"));
  try {
    const file = path.join(root, "preferences.json");
    let store = new PreferencesStore(file, secrets);
    const first = {
      id: "first",
      baseUrl: "https://same.example/v1",
      model: "model-a",
    };
    const second = { ...first, id: "second", model: "model-b" };
    await store.save({
      aiModels: [
        { ...first, apiKey: "first-secret" },
        { ...second, apiKey: "second-secret" },
      ],
      activeAiModelId: first.id,
    });
    store = new PreferencesStore(file, secrets);
    expect(await store.resolveAi()).toEqual({
      baseUrl: first.baseUrl,
      model: first.model,
      apiKey: "first-secret",
    });
    await store.save({ activeAiModelId: second.id });
    expect((await store.resolveAi()).apiKey).toBe("second-secret");
    // Unsaved test settings use the matching profile without changing the selection.
    expect(
      (await store.resolveAi({ aiModels: [first], activeAiModelId: first.id }))
        .apiKey,
    ).toBe("first-secret");
    expect((await store.get()).activeAiModelId).toBe(second.id);
    expect(
      (
        await store.resolveAi({
          aiModels: [{ ...first, baseUrl: "https://other.example/v1" }],
          activeAiModelId: first.id,
        })
      ).apiKey,
    ).toBe("");
    expect(
      (
        await store.resolveAi({
          aiModels: [{ ...first, id: "new" }],
          activeAiModelId: "new",
        })
      ).apiKey,
    ).toBe("");
    const visible = await store.get();
    expect(visible.aiModels.map((model) => model.hasApiKey)).toEqual([
      true,
      true,
    ]);
    expect(JSON.stringify(visible)).not.toContain("secret");
    expect(await fs.readFile(file, "utf8")).not.toContain("first-secret");
    await store.save({ aiModels: [first], activeAiModelId: first.id });
    expect((await store.get()).aiModels).toHaveLength(1);
    expect((await store.resolveAi()).apiKey).toBe("first-secret");
    await store.save({
      aiModels: [{ ...first, clearApiKey: true }],
      activeAiModelId: first.id,
    });
    expect((await store.resolveAi()).apiKey).toBe("");
    await store.save({ aiModels: [], activeAiModelId: "" });
    expect((await store.get()).aiModels).toEqual([]);
    await expect(store.resolveAi()).rejects.toThrow("配置 AI");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("旧单模型配置保留密钥和字幕设置，保存后迁移为多模型格式", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-preferences-"));
  try {
    const file = path.join(root, "preferences.json");
    const ai = { baseUrl: "https://legacy.example/v1", model: "legacy" };
    await fs.writeFile(
      file,
      JSON.stringify({
        ai,
        encryptedKey: secrets.encryptString("legacy-secret").toString("base64"),
        captions: { maxChars: 18 },
      }),
    );
    const store = new PreferencesStore(file, secrets);
    expect((await store.get()).aiModels).toEqual([
      { id: "default", ...ai, hasApiKey: true },
    ]);
    await store.save({ captions: { maxChars: 20 } });
    expect(await store.resolveAi()).toEqual({ ...ai, apiKey: "legacy-secret" });
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    expect(data.ai).toBeUndefined();
    expect(data.encryptedKey).toBeUndefined();
    expect(data.aiProviders).toHaveLength(1);
    expect(data.captions.maxChars).toBe(20);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("拒绝重复模型 ID 和无效选择，并保持已有设置", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-preferences-"));
  try {
    const model = {
      id: "one",
      baseUrl: "https://example.com/v1",
      model: "test",
    };
    expect(
      preferencesUpdateSchema.safeParse({ aiModels: [model, model] }).success,
    ).toBe(false);
    const store = new PreferencesStore(
      path.join(root, "preferences.json"),
      secrets,
    );
    await store.save({ aiModels: [model], activeAiModelId: model.id });
    await expect(store.save({ activeAiModelId: "missing" })).rejects.toThrow(
      "不存在",
    );
    expect((await store.get()).activeAiModelId).toBe(model.id);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("一个服务的多个模型共享密钥，列表获取和切换不修改选择，修改来源不泄露密钥", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-provider-"));
  const file = path.join(root, "preferences.json"),
    store = new PreferencesStore(file, secrets);
  const provider = {
    id: "service",
    name: "测试服务",
    baseUrl: "https://service.example/v1",
    models: [
      { id: "a", model: "model-a" },
      { id: "b", model: "model-b" },
    ],
  };
  try {
    await store.save({
      aiProviders: [{ ...provider, apiKey: "shared-secret" }],
      activeAiModelId: "a",
    });
    expect((await store.resolveAi()).apiKey).toBe("shared-secret");
    await store.save({ activeAiModelId: "b" });
    expect(await store.resolveAi()).toEqual({
      baseUrl: provider.baseUrl,
      model: "model-b",
      apiKey: "shared-secret",
    });
    expect((await store.resolveProvider(provider)).apiKey).toBe(
      "shared-secret",
    );
    expect(
      (
        await store.resolveProvider({
          ...provider,
          baseUrl: "https://other.example/v1",
        })
      ).apiKey,
    ).toBe("");
    expect(
      (await store.resolveProvider({ ...provider, id: "new-service" })).apiKey,
    ).toBe("");
    expect((await store.get()).activeAiModelId).toBe("b");
    expect((await store.get()).aiProviders).toHaveLength(1);
    const disk = await fs.readFile(file, "utf8");
    expect(disk).not.toContain("shared-secret");
    expect(JSON.parse(disk).aiProviders[0].models).toHaveLength(2);
    await store.save({
      aiProviders: [{ ...provider, models: [] }],
      activeAiModelId: "",
    });
    expect((await store.get()).aiModels).toHaveLength(0);
    expect((await store.resolveProvider(provider)).apiKey).toBe(
      "shared-secret",
    );
    await store.save({ aiProviders: [provider], activeAiModelId: "a" });
    expect((await store.resolveAi()).apiKey).toBe("shared-secret");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("分组首选项串行合并保存，旧配置补全默认值，配置损坏不会覆盖原文件", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "troncut-grouped-preferences-"),
  );
  const file = path.join(root, "preferences.json"),
    store = new PreferencesStore(file, secrets);
  try {
    expect((await store.get()).timing).toMatchObject({
      image: 5,
      animation: 1,
    });
    await Promise.all([
      store.save({ program: { snapping: false, waveforms: false } }),
      store.save({ timing: { image: 8, animation: 2 } }),
      store.save({ project: { width: 1080, height: 1920, fps: 60 } }),
    ]);
    const saved = await new PreferencesStore(file, secrets).get();
    expect(saved.program).toMatchObject({ snapping: false, waveforms: false });
    expect(saved.timing).toMatchObject({ image: 8, animation: 2 });
    expect(saved.project).toMatchObject({ width: 1080, height: 1920, fps: 60 });
    await fs.writeFile(file, "{invalid");
    await expect(store.save({ captions: {} })).rejects.toThrow("读取失败");
    expect(await fs.readFile(file, "utf8")).toBe("{invalid");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("迁移旧录屏默认值后与首选项统一保存，后续不被旧文件覆盖", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "troncut-recording-preferences-"),
  );
  try {
    const legacy = {
      ...defaultRecordingSettings,
      cursor: { ...defaultRecordingSettings.cursor, size: 72 },
      autoZoom: false,
    };
    const file = path.join(root, "recording-settings.json");
    await fs.writeFile(file, JSON.stringify(legacy));
    const store = new PreferencesStore(
      path.join(root, "preferences.json"),
      secrets,
    );
    expect((await store.get()).recording).toEqual(legacy);
    await store.save({
      recording: { ...legacy, cursor: { ...legacy.cursor, size: 56 } },
    });
    await fs.writeFile(file, JSON.stringify(defaultRecordingSettings));
    expect((await store.get()).recording.cursor.size).toBe(56);
    expect((await store.get()).recording.autoZoom).toBe(false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
