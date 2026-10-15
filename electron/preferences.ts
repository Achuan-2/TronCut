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
const storedModelSchema = z.object({
  id: z.string(),
  baseUrl: z.string(),
  model: z.string(),
  encryptedKey: z.string().default(""),
});
const storedSchema = z.object({
  ai: z
    .object({ baseUrl: z.string(), model: z.string() })
    .default(defaultAiSettings),
  encryptedKey: z.string().default(""),
  aiModels: z.array(storedModelSchema).default([]),
  activeAiModelId: z.string().default(""),
  captions: captionProcessingSchema.default({}),
});
type StoredModel = z.infer<typeof storedModelSchema>;
type ModelDraft = StoredModel & { apiKey?: string; clearApiKey?: boolean };

export class PreferencesStore {
  constructor(
    private file: string,
    private secrets: SecretStorage,
  ) {}
  private async read() {
    let data: z.infer<typeof storedSchema>;
    try {
      data = storedSchema.parse(
        JSON.parse(await fs.readFile(this.file, "utf8")),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("首选项读取失败，请检查配置文件");
      data = storedSchema.parse({});
    }
    // Migrate the original single-model settings without decrypting the key.
    if (!data.aiModels.length && (data.ai.model || data.encryptedKey))
      data.aiModels = [
        { id: "default", ...data.ai, encryptedKey: data.encryptedKey },
      ];
    if (!data.aiModels.some((model) => model.id === data.activeAiModelId))
      data.activeAiModelId = data.aiModels[0]?.id ?? "";
    return data;
  }
  async get(): Promise<Preferences> {
    const data = await this.read();
    const active = data.aiModels.find(
      (model) => model.id === data.activeAiModelId,
    );
    return {
      ai: active
        ? { baseUrl: active.baseUrl, model: active.model }
        : defaultAiSettings,
      captions: data.captions,
      hasApiKey: Boolean(active?.encryptedKey),
      aiModels: data.aiModels.map(({ encryptedKey, ...model }) => ({
        ...model,
        hasApiKey: Boolean(encryptedKey),
      })),
      activeAiModelId: data.activeAiModelId,
    };
  }
  /** Credentials belong to both a profile and an origin, even for unsaved tests. */
  private modelDrafts(
    stored: z.infer<typeof storedSchema>,
    update: PreferencesUpdate,
  ) {
    const models: ModelDraft[] = (update.aiModels ?? stored.aiModels).map(
      (input) => {
        const previous = stored.aiModels.find((model) => model.id === input.id);
        const sameOrigin =
          previous &&
          new URL(previous.baseUrl).origin === new URL(input.baseUrl).origin;
        return {
          ...input,
          encryptedKey: sameOrigin ? previous.encryptedKey : "",
        };
      },
    );
    const activeId = update.activeAiModelId ?? stored.activeAiModelId;
    if (
      update.activeAiModelId &&
      !models.some((model) => model.id === activeId)
    )
      throw new Error("所选 AI 模型不存在，请重新选择");
    let active = models.find((model) => model.id === activeId) ?? models[0];
    // Retain the single-model API for existing callers.
    if (update.ai || update.apiKey || update.clearApiKey) {
      if (!active) {
        active = { id: "default", ...defaultAiSettings, encryptedKey: "" };
        models.push(active);
      }
      if (update.ai) {
        if (
          new URL(active.baseUrl).origin !== new URL(update.ai.baseUrl).origin
        )
          active.encryptedKey = "";
        Object.assign(active, update.ai);
      }
      Object.assign(active, {
        apiKey: update.apiKey,
        clearApiKey: update.clearApiKey,
      });
    }
    return { models, active };
  }
  async resolveAi(update?: PreferencesUpdate): Promise<AiSettings> {
    const draft = preferencesUpdateSchema.parse(update ?? {});
    const { active } = this.modelDrafts(await this.read(), draft);
    const ai = aiSettingsSchema.safeParse(active);
    if (!ai.success || !active)
      throw new Error("请先在顶部首选项中配置 AI 服务地址和模型");
    let apiKey = active.apiKey || "";
    if (!apiKey && !active.clearApiKey && active.encryptedKey) {
      try {
        apiKey = this.secrets.decryptString(
          Buffer.from(active.encryptedKey, "base64"),
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
    const { models, active } = this.modelDrafts(stored, update);
    const savedModels: StoredModel[] = models.map((model) => {
      let encryptedKey = model.clearApiKey ? "" : model.encryptedKey;
      if (model.apiKey) {
        if (!this.secrets.isEncryptionAvailable())
          throw new Error("系统安全存储不可用，无法保存 AI 密钥");
        encryptedKey = this.secrets
          .encryptString(model.apiKey)
          .toString("base64");
      }
      return {
        id: model.id,
        baseUrl: model.baseUrl,
        model: model.model,
        encryptedKey,
      };
    });
    const data = {
      aiModels: savedModels,
      activeAiModelId: active?.id ?? "",
      captions: update.captions ?? stored.captions,
    };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(data, null, 2), {
        mode: 0o600,
      });
      await fs.rename(temporary, this.file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return this.get();
  }
}
