// Run only when refreshing the pinned Recordly artwork.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const source = "references/Recordly/src/assets/cursors";
await fs.mkdir("resources/recordly-cursors", { recursive: true });
const files = {
  macos: "macos/pointer-1__34-24.svg",
  tahoe: "tahoe/pointer-1__14-6.svg",
  windows11: "windows11/arrow__31-22.svg",
  figma: "custom/minimal-cursor.svg",
};
const packShapes = {
  macos: {
    text: "ibeam-1",
    pointer: "pointinghand-1",
    crosshair: "crosshair-1",
    "open-hand": "openhand-1",
    "closed-hand": "closedhand-1",
    "resize-ew": "resizeeastwest-1",
    "resize-ns": "resizenorthsouth-1",
    "not-allowed": "notallowed-1",
  },
  tahoe: {
    text: "ibeam-1",
    pointer: "pointinghand-1",
    crosshair: "crosshair-1",
    "open-hand": "openhand-1",
    "closed-hand": "closedhand-1",
    "resize-ew": "resizeeastwest-1",
    "resize-ns": "resizenorthsouth-1",
    "not-allowed": "notallowed-1",
  },
  windows11: {
    text: "text",
    pointer: "pointer",
    crosshair: "cross",
    "open-hand": "grab",
    "closed-hand": "grabbing",
    "resize-ew": "resize-horizontal",
    "resize-ns": "resize-vertical",
    "not-allowed": "block",
  },
};
for (const [style, shapes] of Object.entries(packShapes)) {
  const entries = await fs.readdir(path.join(source, style));
  for (const [shape, stem] of Object.entries(shapes)) {
    const file = entries.find((name) => name.startsWith(stem + "__"));
    if (!file) throw new Error(`Missing ${style}/${stem}`);
    files[`${style}:${shape}`] = `${style}/${file}`;
  }
}
const artwork = {};
for (const [style, file] of Object.entries(files)) {
  const svg = await fs.readFile(path.join(source, file), "utf8");
  await fs.copyFile(
    path.join(source, file),
    `resources/recordly-cursors/${style.replace(":", "-")}.svg`,
  );
  const clean = svg.replace(/<\?xml[^>]*\?>/g, "");
  const { data, info } = await sharp(Buffer.from(clean))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width,
    top = info.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3]) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  const width = right - left + 1,
    height = bottom - top + 1;
  const anchor = file.match(/__(\d+)-(\d+)/);
  const x = anchor ? (Number(anchor[1]) / 100) * info.width : 40;
  const y = anchor ? (Number(anchor[2]) / 100) * info.height : 22;
  artwork[style] = {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} ${top} ${width} ${height}">${clean.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(width|height|x|y)="[^"]*"/g, "").replace("<svg ", `<svg x="0" y="0" width="${info.width}" height="${info.height}" `))}</svg>`,
    aspect: width / height,
    anchor: {
      x: Math.max(0, Math.min(1, (x - left) / width)),
      y: Math.max(0, Math.min(1, (y - top) / height)),
    },
  };
}
await fs.writeFile(
  "shared/recordly/cursor-artwork.json",
  JSON.stringify(artwork, null, 2) + "\n",
);
