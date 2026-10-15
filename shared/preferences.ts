import { z } from "zod";
import { captionProcessingSchema } from "./caption-processing";
import { recordingSettingsSchema } from "./recording";
import {
  programPreferencesSchema,
  timingPreferencesSchema,
  projectPreferencesSchema,
  type EditorPreferences,
} from "./editor-preferences";

export const aiSettingsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .max(4096)
    .refine((value) => {
      const url = new URL(value);
      return (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }, "请输入 HTTP/HTTPS API 基础地址，不包含账号、参数或密钥"),
  model: z.string().trim().min(1).max(200),
});
export const defaultAiSettings = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
};
export const aiModelUpdateSchema = aiSettingsSchema.extend({
  id: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(8192).optional(),
  clearApiKey: z.boolean().optional(),
});
export const aiProviderUpdateSchema = aiSettingsSchema
  .pick({ baseUrl: true })
  .extend({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(100),
    models: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(200),
          model: z.string().trim().min(1).max(200),
        }),
      )
      .max(100)
      .refine(
        (models) => new Set(models.map((m) => m.model)).size === models.length,
        "同一服务不能重复添加相同模型",
      ),
    apiKey: z.string().trim().max(8192).optional(),
    clearApiKey: z.boolean().optional(),
  });
export type AiProviderUpdate = z.input<typeof aiProviderUpdateSchema>;
export type AiProviderProfile = Omit<
  AiProviderUpdate,
  "apiKey" | "clearApiKey"
> & { hasApiKey: boolean };
export interface AiModelProfile {
  id: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}
export interface Preferences extends EditorPreferences {
  ai: { baseUrl: string; model: string };
  hasApiKey: boolean;
  aiModels: AiModelProfile[];
  aiProviders: AiProviderProfile[];
  activeAiModelId: string;
  captions: z.infer<typeof captionProcessingSchema>;
}
export const preferencesUpdateSchema = z
  .object({
    ai: aiSettingsSchema.optional(),
    apiKey: z.string().trim().max(8192).optional(),
    clearApiKey: z.boolean().optional(),
    aiModels: z
      .array(aiModelUpdateSchema)
      .max(100)
      .refine(
        (models) =>
          new Set(models.map((model) => model.id)).size === models.length,
        "模型配置 ID 不能重复",
      )
      .optional(),
    aiProviders: z
      .array(aiProviderUpdateSchema)
      .max(100)
      .refine(
        (providers) =>
          new Set(providers.map((p) => p.id)).size === providers.length &&
          new Set(providers.flatMap((p) => p.models.map((m) => m.id))).size ===
            providers.flatMap((p) => p.models).length,
        "服务与模型配置 ID 不能重复",
      )
      .optional(),
    activeAiModelId: z.string().max(200).optional(),
    captions: captionProcessingSchema.optional(),
    program: programPreferencesSchema.optional(),
    timing: timingPreferencesSchema.optional(),
    project: projectPreferencesSchema.optional(),
    recording: recordingSettingsSchema.optional(),
  })
  .strict();
export type PreferencesUpdate = z.input<typeof preferencesUpdateSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema> & { apiKey: string };
