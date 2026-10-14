import { clipboard } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uid, type Asset } from "../shared/model";
import { probeMedia } from "./media";
import { runProcess } from "./process";
import { importMediaPaths } from "./import-media";

const clipFormat = "TronCut.Clips";

export function copyClipClipboard(token: string): void {
  clipboard.writeBuffer(clipFormat, Buffer.from(token, "utf8"));
}

async function clipboardFiles(): Promise<string[]> {
  if (process.platform === "win32") {
    // CF_HDROP is a predefined Windows format, so Electron's custom-format reader
    // cannot reliably read the complete Explorer file list. Read it in an STA helper.
    const output = await runProcess(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ConvertTo-Json -InputObject @([System.Windows.Forms.Clipboard]::GetFileDropList()) -Compress",
      ],
      { timeout: 10000 },
    );
    const files: unknown = JSON.parse(output.trim() || "[]");
    return Array.isArray(files)
      ? files.filter((file): file is string => typeof file === "string")
      : [];
  }
  const data = clipboard
    .readBuffer(
      process.platform === "darwin" ? "public.file-url" : "text/uri-list",
    )
    .toString("utf8");
  return data.split(/\r?\n/).flatMap((line) => {
    try {
      return line.startsWith("file:")
        ? [fileURLToPath(line.replace(/\0+$/, ""))]
        : [];
    } catch {
      return [];
    }
  });
}

export async function importClipboardMedia(
  storage: string,
  resourcesPath?: string,
): Promise<{ assets: Asset[]; clipToken: string | null }> {
  const token = clipboard.readBuffer(clipFormat).toString("utf8");
  if (token) return { assets: [], clipToken: token };
  const hasFiles = clipboard
    .availableFormats()
    .some((format) =>
      /^(CF_HDROP|FileDrop|FileNameW?|Shell IDList Array|text\/uri-list|public\.file-url)$/i.test(
        format,
      ),
    );
  if (hasFiles) {
    // Explorer can expose a thumbnail as well as files. Prefer the real files,
    // but never start an STA helper for ordinary screenshot/image clipboard data.
    const assets = await importMediaPaths(
      await clipboardFiles(),
      resourcesPath,
    );
    if (assets.length) return { assets, clipToken: null };
  }
  const image = clipboard.readImage();
  if (image.isEmpty()) return { assets: [], clipToken: null };
  // Clipboard pixels have no source file. Keep them with user data so recovery
  // and project saving can collect the image just like a recorded media file.
  await fs.mkdir(storage, { recursive: true });
  const file = path.join(storage, `粘贴图片-${uid()}.png`);
  try {
    await fs.writeFile(file, image.toPNG());
    return { assets: [await probeMedia(file, resourcesPath)], clipToken: null };
  } catch (error) {
    await fs.rm(file, { force: true });
    throw error;
  }
}
