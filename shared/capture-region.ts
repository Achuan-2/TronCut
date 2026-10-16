import { z } from "zod";

/** Physical pixels relative to the selected display, independent of desktop DPI. */
export const captureRegionSchema = z.object({
  x: z.number().int().min(0).max(32768),
  y: z.number().int().min(0).max(32768),
  width: z.number().int().min(16).max(32768),
  height: z.number().int().min(16).max(32768),
});
export type CaptureRegion = z.infer<typeof captureRegionSchema>;

export function validateCaptureRegion(region: CaptureRegion, width: number, height: number) {
  const value = captureRegionSchema.parse(region);
  if (value.x + value.width > width || value.y + value.height > height)
    throw new Error("录制范围超出所选屏幕，请重新框选");
  // H.264 requires even dimensions. Keep the origin fixed and trim at most 1px.
  return { ...value, width: value.width - value.width % 2, height: value.height - value.height % 2 };
}
