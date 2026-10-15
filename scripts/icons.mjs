import sharp from "sharp";
import { writeFile } from "node:fs/promises";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="60" fill="#152a24"/><path d="M48 54H208V96H149V202H107V96H48Z" fill="#75e6b5"/><path d="M177 141L223 172L177 203Z" fill="#caffdf"/></svg>`;
const png = await sharp(Buffer.from(svg)).png().toBuffer();
// macOS requires at least 512px; rasterize the vector at 1024px while keeping
// the ICO entry at its supported 256px size.
await writeFile("resources/icon.png", await sharp(Buffer.from(svg)).resize(1024, 1024).png().toBuffer());
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[6] = 0;
header[7] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await writeFile("resources/icon.ico", Buffer.concat([header, png]));
