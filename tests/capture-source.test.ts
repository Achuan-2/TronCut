import { beforeEach, expect, it, vi } from "vitest";
import { desktopCapturer } from "electron";
import { findCaptureSource } from "../electron/capture-source";

vi.mock("electron", () => ({ desktopCapturer: { getSources: vi.fn() } }));
const getSources = vi.mocked(desktopCapturer.getSources);
beforeEach(() => getSources.mockReset());

it.each(["screen:1:0", "window:42:0"])(
  "validates %s without capturing thumbnails or enumerating other source types",
  async (id) => {
    const source = { id, display_id: "1" } as Electron.DesktopCapturerSource;
    getSources.mockResolvedValue([source]);
    expect(await findCaptureSource(id)).toBe(source);
    expect(getSources).toHaveBeenCalledWith({
      types: [id.startsWith("screen:") ? "screen" : "window"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    });
  },
);

it("still checks live sources so closed targets cannot be selected", async () => {
  getSources.mockResolvedValue([]);
  expect(await findCaptureSource("window:42:0")).toBeUndefined();
  expect(getSources).toHaveBeenCalledOnce();
});

it("rejects unknown source types without enumerating windows", async () => {
  expect(await findCaptureSource("invalid")).toBeUndefined();
  expect(getSources).not.toHaveBeenCalled();
});
