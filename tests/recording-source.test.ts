import { describe, expect, it } from "vitest";
import {
  recordingSourceSchema,
  resolveRecordingSource,
} from "../shared/recording-source";

const first = { id: "screen:1:0", name: "屏幕 1", displayId: "primary" };
const second = { id: "screen:2:0", name: "屏幕 2", displayId: "external" };
const window = { id: "window:100:0", name: "笔记窗口" };

describe("录制来源记忆", () => {
  it("恢复所选窗口或屏幕，列表重排和窗口标题变化不丢失选择", () => {
    expect(resolveRecordingSource([first, second, window], second)).toBe(
      second,
    );
    expect(resolveRecordingSource([second, first, window], window)).toBe(
      window,
    );
    const renamed = { ...window, name: "正在编辑的笔记" };
    expect(resolveRecordingSource([first, renamed], window)).toBe(renamed);
  });

  it("屏幕枚举编号变化后优先恢复稳定显示器 ID，窗口重开可按唯一标题恢复", () => {
    const moved = { ...second, id: "screen:1:0", name: "屏幕 1" };
    const other = { ...first, id: "screen:2:0", name: "屏幕 2" };
    expect(resolveRecordingSource([other, moved], second)).toBe(moved);
    const reopened = { ...window, id: "window:200:0" };
    expect(resolveRecordingSource([first, reopened], window)).toBe(reopened);
  });

  it("原来源关闭、标题不唯一或列表为空时使用有效默认项，窗口与屏幕不串选", () => {
    expect(resolveRecordingSource([first, second], window)).toBe(first);
    expect(
      resolveRecordingSource(
        [
          first,
          { ...window, id: "window:200:0" },
          { ...window, id: "window:300:0" },
        ],
        window,
      ),
    ).toBe(first);
    expect(
      resolveRecordingSource([first, { ...second, name: window.name }], window),
    ).toBe(first);
    expect(resolveRecordingSource([first, second], null)).toBe(first);
    expect(resolveRecordingSource([], second)).toBeUndefined();
  });

  it("保存来源身份而不保存缩略图，兼容没有显示器 ID 的来源", () => {
    expect(
      recordingSourceSchema.parse({
        ...window,
        thumbnail: "data:image/png;base64,preview",
      }),
    ).toEqual(window);
  });
});
