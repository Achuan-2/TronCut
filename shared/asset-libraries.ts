import { z } from "zod";
import { projectSchema } from "./model";

export const defaultAssetLibraryId = "default";
export const libraryNameSchema = z
  .string()
  .trim()
  .min(1, "请输入库名称")
  .max(100);
export const assetLibrarySchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  name: libraryNameSchema,
  assets: projectSchema.shape.assets,
});
export type AssetLibrary = z.infer<typeof assetLibrarySchema>;
export const assetLibraryArchiveSchema = z.object({
  format: z.literal("troncut-library"),
  version: z.literal(1),
  name: libraryNameSchema,
  assets: projectSchema.shape.assets,
});
export const libraryAssetMime = "troncut-library-asset";
export const libraryAssetDragSchema = z.object({
  libraryId: assetLibrarySchema.shape.id,
  assetId: assetLibrarySchema.shape.id,
});
export type LibraryAssetDrag = z.infer<typeof libraryAssetDragSchema>;
