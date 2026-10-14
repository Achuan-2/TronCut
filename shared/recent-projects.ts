import { z } from "zod";

export const recentProjectSchema = z.object({
  file: z.string().min(1),
  name: z.string().min(1),
  openedAt: z.number().finite().nonnegative(),
  modifiedAt: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
  bytes: z.number().finite().nonnegative(),
  thumbnail: z.string().optional(),
});
export type RecentProject = z.infer<typeof recentProjectSchema> & {
  missing?: boolean;
};
export interface RecoveryInfo {
  name: string;
  file: string | null;
  modifiedAt: number;
  duration: number;
}
