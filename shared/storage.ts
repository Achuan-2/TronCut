import { z } from "zod";

const directory = z
  .string()
  .trim()
  .max(32768)
  .refine((value) => !value.includes("\0"), "文件夹路径不能包含空字符");

export const storagePreferencesSchema = z.object({
  backupDirectory: directory.default(""),
  onnxModelsDirectory: directory.default(""),
  projectDirectory: directory.default(""),
  previewProxyDirectory: directory.default(""),
});
export type StoragePreferences = z.infer<typeof storagePreferencesSchema>;
export type StorageDirectoryKind = keyof StoragePreferences;
