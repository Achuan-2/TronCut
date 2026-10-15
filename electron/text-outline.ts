import sharp from "sharp";

/** Squared Euclidean distance to the nearest foreground sample, in linear time. */
function distanceLine(values: Float64Array, length: number) {
  const vertices = new Int32Array(length);
  const boundaries = new Float64Array(length + 1);
  const result = new Float64Array(length);
  let last = 0;
  boundaries[0] = -Infinity;
  boundaries[1] = Infinity;
  for (let q = 1; q < length; q++) {
    let intersection: number;
    while (true) {
      const v = vertices[last];
      intersection = (values[q] + q * q - values[v] - v * v) / (2 * (q - v));
      if (intersection > boundaries[last]) break;
      last--;
    }
    vertices[++last] = q;
    boundaries[last] = intersection;
    boundaries[last + 1] = Infinity;
  }
  last = 0;
  for (let q = 0; q < length; q++) {
    while (boundaries[last + 1] < q) last++;
    const delta = q - vertices[last];
    result[q] = delta * delta + values[vertices[last]];
  }
  return result;
}

/** One round outline mask, supersampled before downscaling. Unlike repeated
 * source-over copies, this does not accumulate antialiasing at offset edges. */
export async function outlinedText(
  text: Buffer,
  color: string,
  outline: string,
  radius: number,
  padding: number,
): Promise<Buffer> {
  const info = await sharp(text).metadata();
  const width = info.width! + padding * 2;
  const height = info.height! + padding * 2;
  const alpha = await sharp(text).extractChannel(3).raw().toBuffer();
  const foreground = await sharp({
    create: {
      width: info.width!,
      height: info.height!,
      channels: 3,
      background: color,
    },
  })
    .joinChannel(alpha, {
      raw: { width: info.width!, height: info.height!, channels: 1 },
    })
    .png()
    .toBuffer();
  const layers: sharp.OverlayOptions[] = [];
  if (radius > 0) {
    const scale = 4;
    const w = width * scale,
      h = height * scale;
    const padded = await sharp(alpha, {
      raw: { width: info.width!, height: info.height!, channels: 1 },
    })
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: "#000000",
      })
      .png()
      .toBuffer();
    const mask = await sharp(padded)
      .resize(w, h, { kernel: "cubic" })
      .greyscale()
      .raw()
      .toBuffer();
    const field = new Float64Array(w * h);
    const line = new Float64Array(Math.max(w, h));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) line[x] = mask[y * w + x] >= 128 ? 0 : 1e12;
      field.set(distanceLine(line, w), y * w);
    }
    const expanded = Buffer.alloc(w * h);
    const squaredRadius = (radius * scale) ** 2;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) line[y] = field[y * w + x];
      const distances = distanceLine(line, h);
      for (let y = 0; y < h; y++)
        expanded[y * w + x] = distances[y] <= squaredRadius ? 255 : 0;
    }
    const outlineAlpha = await sharp(expanded, {
      raw: { width: w, height: h, channels: 1 },
    })
      .resize(width, height)
      .greyscale()
      .raw()
      .toBuffer();
    const outlined = await sharp({
      create: { width, height, channels: 3, background: outline },
    })
      .joinChannel(outlineAlpha, { raw: { width, height, channels: 1 } })
      .png()
      .toBuffer();
    layers.push({ input: outlined, left: 0, top: 0 });
  }
  layers.push({ input: foreground, left: padding, top: padding });
  return sharp({
    create: { width, height, channels: 4, background: "#00000000" },
  })
    .composite(layers)
    .png()
    .toBuffer();
}
