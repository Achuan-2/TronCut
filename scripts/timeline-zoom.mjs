import { expect } from "@playwright/test";

/** Geometry-oriented UI tests use pixels; the actual slider uses percentages. */
export async function timelineZoom(page) {
  return Number(await page.getByLabel("时间线缩放", { exact: true })
    .getAttribute("data-pixels-per-second"));
}

export async function setTimelineZoom(page, pixelsPerSecond) {
  const slider = page.getByLabel("时间线缩放", { exact: true });
  const minimum = Number(await slider.getAttribute("data-min-zoom"));
  const maximum = Math.max(minimum, 2400);
  const requested = Math.max(minimum, Math.min(maximum, pixelsPerSecond));
  const percent = maximum === minimum ? 0
    : Math.log(requested / minimum) / Math.log(maximum / minimum) * 100;
  await slider.evaluate((node, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      .set.call(node, String(value));
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, percent);
  await expect.poll(() => timelineZoom(page)).toBeCloseTo(requested, 6);
}
