import { expect, it } from "vitest";
import { recordingName } from "../electron/recording-name";

it("按本地录制开始时间命名，兼容 Windows 文件名并区分同秒录制", () => {
  const a = recordingName(new Date(2026, 9, 16, 8, 9, 7, 5));
  expect(a).toBe("录屏 2026-10-16 08-09-07-005");
  expect(a).not.toMatch(/[<>:"/\\|?*]/);
  expect(recordingName(new Date(2026, 9, 16, 8, 9, 7, 6))).not.toBe(a);
});
