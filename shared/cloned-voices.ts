import { z } from "zod";

export const clonedVoiceSchema = z.object({
  id: z.string().uuid(),
  engine: z.literal("lux-onnx"),
  name: z.string().trim().min(1).max(80),
  transcript: z.string().trim().min(1).max(2000),
  duration: z.number().finite().min(3).max(30.1),
  createdAt: z.string().datetime(),
});
export type ClonedVoice = z.infer<typeof clonedVoiceSchema>;

export const createClonedVoiceSchema = z.object({
  name: z.string().trim().min(1, "请输入音色名称").max(80),
  referenceAssetId: z.string().uuid(),
  transcript: z.string().trim().min(1, "请填写参考音频的文字内容").max(2000),
  offline: z.boolean().default(false),
});
export type CreateClonedVoice = z.input<typeof createClonedVoiceSchema>;
