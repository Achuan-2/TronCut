import fs from "node:fs/promises";
import { createReadStream, openSync, writeSync, closeSync } from "node:fs";
import path from "node:path";
import { Unzip, UnzipInflate, Zip, ZipPassThrough } from "fflate";

// Stream media through the archive; video libraries must not be read into RAM.
export async function writeLibraryArchive(
  file: string,
  manifest: string,
  media: { name: string; source: string }[],
) {
  const sizes = await Promise.all(media.map((item) => fs.stat(item.source)));
  // fflate writes classic ZIP, whose entry sizes and offsets are 32-bit.
  if (
    sizes.reduce((sum, stat) => sum + stat.size, Buffer.byteLength(manifest)) >
    0xff000000
  )
    throw new Error("素材库超过 ZIP 的 4 GB 限制，请拆分为多个库后导出");
  const fd = openSync(file, "wx");
  try {
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      writeSync(fd, chunk);
    });
    const entry = new ZipPassThrough("library.json");
    zip.add(entry);
    entry.push(Buffer.from(manifest), true);
    for (const item of media) {
      const entry = new ZipPassThrough(item.name);
      zip.add(entry);
      for await (const chunk of createReadStream(item.source))
        entry.push(chunk);
      entry.push(new Uint8Array(), true);
    }
    zip.end();
  } finally {
    closeSync(fd);
  }
}

/** Extract only our flat manifest/media layout into a fresh, owned directory. */
export async function readLibraryArchive(file: string, staging: string) {
  const seen = new Set<string>();
  const handles = new Set<number>();
  let total = 0;
  let failure: Error | null = null;
  await fs.mkdir(path.join(staging, "media"));
  const unzip = new Unzip((entry) => {
    if (failure) return;
    try {
      if (entry.name === "media/" && !seen.has(entry.name)) {
        seen.add(entry.name);
        return;
      }
      if (
        seen.has(entry.name) ||
        seen.size > 10001 ||
        !(
          entry.name === "library.json" ||
          /^media\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(entry.name)
        )
      )
        throw new Error("素材库压缩包包含重复或无效的文件路径");
      seen.add(entry.name);
      const fd = openSync(path.join(staging, entry.name), "wx");
      handles.add(fd);
      let size = 0;
      entry.ondata = (error, chunk, final) => {
        if (failure) return;
        try {
          if (error) throw error;
          size += chunk.length;
          total += chunk.length;
          if (
            size >
              (entry.name === "library.json" ? 32 * 1024 * 1024 : 0xffffffff) ||
            total > 64 * 1024 ** 3
          )
            throw new Error("素材库压缩包解压大小超出限制");
          writeSync(fd, chunk);
          if (final) {
            closeSync(fd);
            handles.delete(fd);
          }
        } catch (error) {
          failure = error as Error;
          entry.terminate();
        }
      };
      entry.start();
    } catch (error) {
      failure = error as Error;
    }
  });
  unzip.register(UnzipInflate);
  try {
    for await (const chunk of createReadStream(file)) {
      unzip.push(chunk);
      if (failure) throw failure;
    }
    unzip.push(new Uint8Array(), true);
    if (failure) throw failure;
    if (!seen.has("library.json") || handles.size)
      throw new Error("素材库压缩包不完整");
    return seen;
  } finally {
    for (const fd of handles) closeSync(fd);
  }
}
