import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

const mediaTypes: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".avif": "image/avif",
};

// Chromium seeks by byte offset. A partial body marked as 200 (as returned by
// Electron's file fetch) makes the decoder treat that offset as a new file.
export async function serveMediaFile(
  request: Request,
  file: string,
): Promise<Response> {
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) return new Response("素材不存在", { status: 404 });
    size = info.size;
  } catch {
    return new Response("素材不存在", { status: 404 });
  }
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type":
      mediaTypes[path.extname(file).toLowerCase()] ??
      "application/octet-stream",
  });
  let start = 0,
    end = size - 1,
    status = 200;
  // Ignore malformed/multipart ranges and serve the complete representation.
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/i);
  if (request.method !== "HEAD" && range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(end, Number(range[2])) : end;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= size
    ) {
      headers.set("Content-Range", `bytes */${size}`);
      headers.set("Content-Length", "0");
      return new Response(null, { status: 416, headers });
    }
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  headers.set("Content-Length", String(Math.max(0, end - start + 1)));
  if (request.method === "HEAD" || size === 0)
    return new Response(null, { status, headers });
  const stream = createReadStream(file, { start, end, signal: request.signal });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status,
    headers,
  });
}
