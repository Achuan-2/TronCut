import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import {
  storagePreferencesSchema,
  type StoragePreferences,
} from "../shared/storage";

export function defaultStorageDirectories(
  userData: string,
): StoragePreferences {
  return {
    backupDirectory: userData,
    onnxModelsDirectory: path.join(userData, "models", "onnx"),
    projectDirectory: path.join(
      os.homedir(),
      "Documents",
      "TronCut",
      "Projects",
    ),
    previewProxyDirectory: "",
  };
}

export function resolveStorageDirectories(
  userData: string,
  settings: StoragePreferences,
  defaults = defaultStorageDirectories(userData),
) {
  const directories = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof StoragePreferences)[]) {
    if (!settings[key]) continue;
    if (!path.isAbsolute(settings[key]))
      throw new Error("请选择绝对路径的存储文件夹");
    directories[key] = path.resolve(settings[key]);
  }
  return directories;
}

export function resolvePreviewProxyDirectory(
  directories: StoragePreferences,
  projectFile: string | null,
) {
  if (!projectFile) return path.join(
    directories.previewProxyDirectory || directories.projectDirectory,
    ".preview-proxies-unsaved",
  );
  const absolute = path.resolve(projectFile);
  const identity = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  const name = path.basename(projectFile, path.extname(projectFile));
  return path.join(
    directories.previewProxyDirectory || path.join(path.dirname(projectFile), "preview-proxies"),
    `${name}-${hash}`,
  );
}

/** Used by both desktop speech tasks and the standalone CLI. */
export async function readStorageDirectories(userData: string) {
  let settings = storagePreferencesSchema.parse({});
  try {
    const data = JSON.parse(
      await fs.readFile(path.join(userData, "preferences.json"), "utf8"),
    );
    settings = storagePreferencesSchema.parse(data.storage ?? {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return resolveStorageDirectories(userData, settings);
}

async function writableDirectory(directory: string) {
  await fs.mkdir(directory, { recursive: true });
  const probe = path.join(directory, `.troncut-write-${randomUUID()}`);
  await fs.writeFile(probe, "", { flag: "wx" });
  await fs.unlink(probe);
}

/** Copy missing files only. Existing destination files and source data remain intact. */
export async function prepareStorageDirectories(
  previous: StoragePreferences,
  next: StoragePreferences,
) {
  for (const key of Object.keys(next) as (keyof StoragePreferences)[]) {
    const source = previous[key],
      destination = next[key];
    if (source === destination) continue;
    if (key === "previewProxyDirectory") {
      if (destination) await writableDirectory(destination);
      continue;
    }
    if (key === "onnxModelsDirectory") {
      const relative = path.relative(source, destination);
      if (!relative) continue;
      if (
        !relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative)
      )
        throw new Error("模型存储位置不能位于当前模型文件夹内部");
    }
    await writableDirectory(destination);
    if (key === "projectDirectory") continue;
    try {
      if (key === "backupDirectory") {
        await fs.copyFile(
          path.join(source, "recovery.json"),
          path.join(destination, "recovery.json"),
          constants.COPYFILE_EXCL,
        );
      } else {
        // Never migrate partial downloads left by interrupted tasks.
        await fs.cp(source, destination, {
          recursive: true,
          force: false,
          errorOnExist: false,
          filter: (file) => !path.basename(file).startsWith(".download-"),
        });
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        code !== "ENOENT" &&
        !(key === "backupDirectory" && code === "EEXIST")
      )
        throw error;
    }
  }
}
