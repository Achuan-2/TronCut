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
  type AiProviderUpdate,
} from "../shared/preferences";
import { editorPreferencesSchema } from "../shared/editor-preferences";
import { recordingSettingsSchema } from "../shared/recording";

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
const storedProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  models: z.array(z.object({ id: z.string(), model: z.string() })),
  encryptedKey: z.string().default(""),
});
const storedSchema = z.object({
  ...editorPreferencesSchema.shape,
  ai: z
    .object({ baseUrl: z.string(), model: z.string() })
    .default(defaultAiSettings),
  encryptedKey: z.string().default(""),
  aiModels: z.array(storedModelSchema).default([]),
  aiProviders: z.array(storedProviderSchema).optional(),
  activeAiModelId: z.string().default(""),
  captions: captionProcessingSchema.default({}),
});
type StoredModel = z.infer<typeof storedModelSchema>;
type ModelDraft = StoredModel & { apiKey?: string; clearApiKey?: boolean };

export class PreferencesStore {
  private writes = Promise.resolve();
  constructor(
    private file: string,
    private secrets: SecretStorage,
  ) {}
  private async read() {
    let data: z.infer<typeof storedSchema>;
    let hasRecording = false;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8"));
      data = storedSchema.parse(raw);
      hasRecording = raw.recording !== undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("首选项读取失败，请检查配置文件");
      data = storedSchema.parse({});
    }
    if (!hasRecording) {
      try {
        data.recording = recordingSettingsSchema.parse(
          JSON.parse(
            await fs.readFile(
              path.join(path.dirname(this.file), "recording-settings.json"),
              "utf8",
            ),
          ),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          throw new Error("录屏首选项读取失败，请检查 recording-settings.json");
      }
    }
    // Migrate the original single-model settings without decrypting the key.
    if (!data.aiModels.length && (data.ai.model || data.encryptedKey))
      data.aiModels = [
        { id: "default", ...data.ai, encryptedKey: data.encryptedKey },
      ];
    if (data.aiProviders) {
      data.aiModels = data.aiProviders.flatMap((provider) =>
        provider.models.map((model) => ({
          ...model,
          baseUrl: provider.baseUrl,
          encryptedKey: provider.encryptedKey,
        })),
      );
    } else {
      // Preserve profile IDs and independently configured credentials during migration.
      data.aiProviders = data.aiModels.map((model) => ({
        id: model.id,
        name: new URL(model.baseUrl).host,
        baseUrl: model.baseUrl,
        encryptedKey: model.encryptedKey,
        models: [{ id: model.id, model: model.model }],
      }));
    }
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
      program: data.program,
      timing: data.timing,
      project: data.project,
      recording: data.recording,
      aiProviders: data.aiProviders!.map(({ encryptedKey, ...provider }) => ({
        ...provider,
        hasApiKey: Boolean(encryptedKey),
      })),
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
    const inputs = update.aiProviders
      ? update.aiProviders.flatMap((provider) => {
          const previous = stored.aiProviders?.find(
            (p) => p.id === provider.id,
          );
          return provider.models.map((model) => ({
            ...model,
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            clearApiKey: provider.clearApiKey,
            encryptedKey:
              previous &&
              new URL(previous.baseUrl).origin ===
                new URL(provider.baseUrl).origin
                ? previous.encryptedKey
                : "",
          }));
        })
      : undefined;
    const models: ModelDraft[] =
      inputs ??
      (update.aiModels ?? stored.aiModels).map((input) => {
        const previous = stored.aiModels.find((model) => model.id === input.id);
        const sameOrigin =
          previous &&
          new URL(previous.baseUrl).origin === new URL(input.baseUrl).origin;
        return {
          ...input,
          encryptedKey: sameOrigin ? previous.encryptedKey : "",
        };
      });
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
      throw new Error("请先在“编辑 → 首选项”中配置 AI 服务地址和模型");
    return { ...ai.data, apiKey: this.key(active) };
  }
  async save(input: PreferencesUpdate): Promise<Preferences> {
    const result = this.writes.then(() => this.saveNow(input));
    this.writes = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  async resolveProvider(
    input: AiProviderUpdate,
  ): Promise<Omit<AiSettings, "model">> {
    const data = await this.read();
    const previous = data.aiProviders?.find(
      (provider) => provider.id === input.id,
    );
    const encryptedKey =
      previous &&
      new URL(previous.baseUrl).origin === new URL(input.baseUrl).origin
        ? previous.encryptedKey
        : "";
    return {
      baseUrl: input.baseUrl,
      apiKey: this.key({ ...input, encryptedKey }),
    };
  }
  private key(input: {
    apiKey?: string;
    clearApiKey?: boolean;
    encryptedKey: string;
  }) {
    if (input.apiKey) return input.apiKey;
    if (input.clearApiKey || !input.encryptedKey) return "";
    try {
      return this.secrets.decryptString(
        Buffer.from(input.encryptedKey, "base64"),
      );
    } catch {
      throw new Error("无法解密 AI 密钥，请在首选项中重新填写");
    }
  }
  private encrypt(input: {
    apiKey?: string;
    clearApiKey?: boolean;
    encryptedKey: string;
  }) {
    if (input.apiKey) {
      if (!this.secrets.isEncryptionAvailable())
        throw new Error("系统安全存储不可用，无法保存 AI 密钥");
      return this.secrets.encryptString(input.apiKey).toString("base64");
    }
    return input.clearApiKey ? "" : input.encryptedKey;
  }
  private async saveNow(input: PreferencesUpdate): Promise<Preferences> {
    const update = preferencesUpdateSchema.parse(input);
    const stored = await this.read();
    const { models, active } = this.modelDrafts(stored, update);
    const savedModels: StoredModel[] = update.aiProviders
      ? []
      : models.map((model) => {
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
    const providers: z.infer<typeof storedProviderSchema>[] = [];
    if (update.aiProviders) {
      for (const input of update.aiProviders) {
        const previous = stored.aiProviders?.find((p) => p.id === input.id);
        const encryptedKey =
          previous &&
          new URL(previous.baseUrl).origin === new URL(input.baseUrl).origin
            ? previous.encryptedKey
            : "";
        providers.push({
          id: input.id,
          name: input.name,
          baseUrl: input.baseUrl,
          models: input.models,
          encryptedKey: this.encrypt({ ...input, encryptedKey }),
        });
      }
    } else {
      for (const model of savedModels) {
        const previous = stored.aiProviders?.find((p) =>
          p.models.some((m) => m.id === model.id),
        );
        let provider = providers.find(
          (p) =>
            p.id === previous?.id &&
            p.baseUrl === model.baseUrl &&
            p.encryptedKey === model.encryptedKey,
        );
        if (!provider) {
          provider = {
            id:
              previous && !providers.some((p) => p.id === previous.id)
                ? previous.id
                : randomUUID(),
            name: previous?.name ?? new URL(model.baseUrl).host,
            baseUrl: model.baseUrl,
            encryptedKey: model.encryptedKey,
            models: [],
          };
          providers.push(provider);
        }
        provider.models.push({ id: model.id, model: model.model });
      }
      if (
        !update.aiModels &&
        !update.ai &&
        !update.apiKey &&
        !update.clearApiKey
      )
        for (const provider of stored.aiProviders ?? [])
          if (!provider.models.length) providers.push(provider);
    }
    const data = {
      aiProviders: providers,
      activeAiModelId: active?.id ?? "",
      captions: update.captions ?? stored.captions,
      program: update.program ?? stored.program,
      timing: update.timing ?? stored.timing,
      project: update.project ?? stored.project,
      recording: update.recording ?? stored.recording,
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
