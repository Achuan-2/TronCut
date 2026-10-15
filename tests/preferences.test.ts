import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PreferencesStore } from "../electron/preferences";
import { aiSettingsSchema } from "../shared/preferences";
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
