import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { captionProcessingSchema } from "../shared/caption-processing";
import {
  aiSettingsSchema,
  defaultAiSettings,
  preferencesUpdateSchema,
  type Preferences,
  type PreferencesUpdate,
  type AiSettings,
} from "../shared/preferences";

interface SecretStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
const storedSchema = z.object({
  ai: z
    .object({ baseUrl: z.string(), model: z.string() })
    .default(defaultAiSettings),
  encryptedKey: z.string().default(""),
  captions: captionProcessingSchema.default({}),
});

export class PreferencesStore {
  constructor(
    private file: string,
    private secrets: SecretStorage,
  ) {}
  private async read() {
    try {
      return storedSchema.parse(
        JSON.parse(await fs.readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return storedSchema.parse({});
      throw new Error("首选项读取失败，请检查配置文件");
    }
  }
  async get(): Promise<Preferences> {
    const data = await this.read();
    return {
      ai: data.ai,
      captions: data.captions,
      hasApiKey: Boolean(data.encryptedKey),
    };
  }
  async resolveAi(update?: PreferencesUpdate): Promise<AiSettings> {
    const draft = preferencesUpdateSchema.parse(update ?? {});
    const stored = await this.read();
    const ai = aiSettingsSchema.safeParse(draft.ai ?? stored.ai);
    if (!ai.success)
      throw new Error("请先在顶部首选项中配置 AI 服务地址和模型");
    let apiKey = draft.apiKey || "";
    const sameOrigin =
      new URL(ai.data.baseUrl).origin === new URL(stored.ai.baseUrl).origin;
    if (!apiKey && !draft.clearApiKey && sameOrigin && stored.encryptedKey) {
      try {
        apiKey = this.secrets.decryptString(
          Buffer.from(stored.encryptedKey, "base64"),
        );
      } catch {
        throw new Error("无法解密 AI 密钥，请在首选项中重新填写");
      }
    }
    return { ...ai.data, apiKey };
  }
  async save(input: PreferencesUpdate): Promise<Preferences> {
    const update = preferencesUpdateSchema.parse(input);
    const stored = await this.read();
    if (update.ai) {
      // Credentials belong to an origin; changing providers never reuses an old key.
      if (
        new URL(update.ai.baseUrl).origin !== new URL(stored.ai.baseUrl).origin
      )
        stored.encryptedKey = "";
      stored.ai = update.ai;
    }
    if (update.clearApiKey) stored.encryptedKey = "";
    if (update.apiKey) {
      if (!this.secrets.isEncryptionAvailable())
        throw new Error("系统安全存储不可用，无法保存 AI 密钥");
      stored.encryptedKey = this.secrets
        .encryptString(update.apiKey)
        .toString("base64");
    }
    if (update.captions) stored.captions = update.captions;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(stored, null, 2), {
        mode: 0o600,
      });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return this.get();
  }
}
