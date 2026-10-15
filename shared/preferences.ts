import { z } from "zod";
import { captionProcessingSchema } from "./caption-processing";

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
export interface Preferences {
  ai: { baseUrl: string; model: string };
  hasApiKey: boolean;
  captions: z.infer<typeof captionProcessingSchema>;
}
export const preferencesUpdateSchema = z
  .object({
    ai: aiSettingsSchema.optional(),
    apiKey: z.string().trim().max(8192).optional(),
    clearApiKey: z.boolean().optional(),
    captions: captionProcessingSchema.optional(),
  })
  .strict();
export type PreferencesUpdate = z.input<typeof preferencesUpdateSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema> & { apiKey: string };
