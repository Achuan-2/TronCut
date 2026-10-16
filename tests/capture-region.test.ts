import { expect, it } from "vitest";
import { validateCaptureRegion } from "../shared/capture-region";

it("keeps the selected origin and makes H.264 dimensions even", () => {
  expect(validateCaptureRegion({ x: 121, y: 87, width: 641, height: 361 }, 1920, 1080))
    .toEqual({ x: 121, y: 87, width: 640, height: 360 });
});

it.each([
  { x: -1, y: 0, width: 640, height: 360 },
  { x: 0, y: 0, width: 15, height: 360 },
  { x: 1600, y: 0, width: 640, height: 360 },
  { x: 0, y: 900, width: 640, height: 360 },
])("rejects an invalid or off-display region: %o", (region) => {
  expect(() => validateCaptureRegion(region, 1920, 1080)).toThrow();
});
