import fs from "node:fs/promises";
import path from "node:path";
import {
  cleanupProjectMedia,
  resolveProjectMediaPath,
  restoredProjectMedia,
} from "./project-media-cleanup";
import {
  type Project,
  validateProject,
  cursorRecordingSchema,
} from "../shared/model";

// Keep the legacy default recognizable when opening or resaving older files.
const unnamedProjectNames = new Set(["未命名项目", "未命名工程"]);

export function resolveContained(root: string, relative: string): string {
  if (path.isAbsolute(relative))
    throw new Error("TronCut 项目素材必须使用相对路径");
  const resolved = path.resolve(root, relative),
    rel = path.relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error(`项目素材越出了项目目录：${relative}`);
  return resolved;
}
export async function openProject(file: string): Promise<Project> {
  const project = validateProject(JSON.parse(await fs.readFile(file, "utf8")));
  const baseName = path.basename(file, path.extname(file)).trim();
  if (
    (!project.name || unnamedProjectNames.has(project.name)) &&
    baseName &&
    !unnamedProjectNames.has(baseName)
  ) {
    project.name = baseName;
  }
  const root = path.dirname(file);
  project.assets = await Promise.all(
    project.assets.map(async (asset) => {
      const full = resolveContained(root, asset.path);
      const realRoot = await fs.realpath(root);
      try {
        resolveContained(
          realRoot,
          path.relative(realRoot, await fs.realpath(full)),
        );
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      let cursor = asset.cursor;
      if (asset.cursorPath) {
        const cursorFile = resolveContained(root, asset.cursorPath);
        try {
          resolveContained(
            realRoot,
            path.relative(realRoot, await fs.realpath(cursorFile)),
          );
          cursor = cursorRecordingSchema.parse(
            JSON.parse(await fs.readFile(cursorFile, "utf8")),
          );
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
      }
      return {
        ...asset,
        path: full,
        cursor,
        missing: !(await fs.access(full).then(
          () => true,
          () => false,
        )),
      };
    }),
  );
  return project;
}
export async function saveProject(
  project: Project,
  file: string,
  iconPath?: string,
): Promise<Project> {
  const valid = validateProject(project),
    root = path.dirname(file);
  const previous = await fs.readFile(file, "utf8")
    .then(content => {
      try { return validateProject(JSON.parse(content)); }
      catch { return undefined; }
    })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
  const fileBaseName = path.basename(file, path.extname(file)).trim();
  if (
    (!valid.name || unnamedProjectNames.has(valid.name)) &&
    fileBaseName &&
    !unnamedProjectNames.has(fileBaseName)
  ) {
    valid.name = fileBaseName;
  }
  await fs.mkdir(path.join(root, "media"), { recursive: true });
  const realRoot = await fs.realpath(root),
    realMedia = await fs.realpath(path.join(root, "media"));
  resolveContained(realRoot, path.relative(realRoot, realMedia));
  const serialized = structuredClone(valid);
  serialized.format = "troncut";
  for (const asset of serialized.assets) {
    const original = valid.assets.find((a) => a.id === asset.id)!;
    const safeName = original.name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(-120);
    const target = path.join(root, "media", `${asset.id}-${safeName}`);
    if ((await fs.lstat(target).catch(() => null))?.isSymbolicLink())
      throw new Error("素材目标不能是符号链接");
    const source = resolveProjectMediaPath(original.path);
    if (path.resolve(source) !== path.resolve(target)) {
      await fs.copyFile(source, target);
    } else await fs.access(target);
    restoredProjectMedia(target);
    asset.path = `media/${path.basename(target)}`;
    if (asset.cursor) {
      asset.cursorPath = `media/${asset.id}-cursor.json`;
      const cursorTarget = resolveContained(root, asset.cursorPath);
      if ((await fs.lstat(cursorTarget).catch(() => null))?.isSymbolicLink())
        throw new Error("鼠标数据目标不能是符号链接");
      await fs.writeFile(`${cursorTarget}.tmp`, JSON.stringify(asset.cursor));
      await fs.rename(`${cursorTarget}.tmp`, cursorTarget);
      delete asset.cursor;
    }
    delete asset.missing;
  }
  // Replace only after all media has been collected. A failed copy leaves the last good JSON intact.
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(
    temporary,
    JSON.stringify(serialized, null, 2) + "\n",
    "utf8",
  );
  await fs.rename(temporary, file);
  try {
    await cleanupProjectMedia(serialized, file, previous);
  } catch (error) {
    throw new Error(`项目已保存，但清理已删除素材失败：${String(error)}`);
  }
  if (process.platform === "win32" && iconPath) {
    const desktopIni = path.join(root, "desktop.ini");
    const previous = await fs.readFile(desktopIni, "utf16le").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    const legacy = "\uFEFF[.ShellClassInfo]\r\nIconResource=project.ico,0\r\n";
    const content = `\uFEFF[.ShellClassInfo]\r\nIconResource=${path.resolve(iconPath)},0\r\n`;
    // Preserve custom folder settings. Only migrate the exact old generated file.
    if (previous === null || previous === legacy) {
      // OPEN_EXISTING avoids CREATE_ALWAYS failing on hidden/system desktop.ini.
      const handle = await fs.open(desktopIni, previous === null ? "wx" : "r+");
      try {
        await handle.writeFile(content, "utf16le");
        await handle.truncate(Buffer.byteLength(content, "utf16le"));
      } finally {
        await handle.close();
      }
      if (previous === legacy) {
        // Remove only an unchanged copy of the app icon, never a custom icon.
        const legacyIcon = path.join(root, "project.ico");
        const stat = await fs.lstat(legacyIcon).catch(() => null);
        if (stat?.isFile()) {
          const icons = await Promise.all([
            fs.readFile(legacyIcon),
            fs.readFile(iconPath),
          ]).catch(() => null);
          if (icons && icons[0].equals(icons[1]))
            await fs.unlink(legacyIcon).catch(() => { });
        }
      }
    }
    const { runProcess } = await import("./process");
    await runProcess("attrib", ["+r", root]).catch(() => { });
    await runProcess("attrib", [
      "+s",
      "+h",
      path.join(root, "desktop.ini"),
    ]).catch(() => { });
  }
  return {
    ...valid,
    assets: serialized.assets.map((a) => ({
      ...a,
      path: resolveContained(root, a.path),
      cursor: valid.assets.find((original) => original.id === a.id)?.cursor,
    })),
  };
}

// Reserve a dedicated folder atomically so concurrent saves never share media
// or overwrite an existing project, even when their names are identical.
export async function saveProjectInDirectory(
  project: Project,
  directory: string,
  iconPath?: string,
): Promise<{ project: Project; file: string }> {
  const name = project.name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim() || "未命名项目";
  await fs.mkdir(directory, { recursive: true });
  for (let suffix = 1; ; suffix++) {
    const folderName = suffix === 1 ? name : `${name}-${suffix}`;
    const root = path.join(directory, folderName);
    try {
      await fs.mkdir(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    const file = path.join(root, `${folderName}.troncut`);
    const saved = await saveProject({ ...project, name: folderName }, file, iconPath);
    return { project: saved, file };
  }
}

export async function renameProjectStorage(
  project: Project,
  currentFile: string,
  newName: string,
  iconPath?: string,
): Promise<{ project: Project; file: string; oldRoot: string; newRoot: string }> {
  const sanitized = newName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  if (!sanitized) throw new Error("项目名称无效");

  const oldRoot = path.dirname(path.resolve(currentFile));
  const oldFileName = path.basename(currentFile);
  const oldFileBase = path.basename(currentFile, path.extname(currentFile));
  const oldFolderName = path.basename(oldRoot);
  const parent = path.dirname(oldRoot);

  const isDedicatedFolder = oldFolderName === oldFileBase;
  const newRoot = isDedicatedFolder ? path.join(parent, sanitized) : oldRoot;
  const newFile = isDedicatedFolder
    ? path.join(newRoot, `${sanitized}.troncut`)
    : path.join(oldRoot, `${sanitized}.troncut`);

  const sameFile =
    process.platform === "win32"
      ? path.resolve(currentFile).toLowerCase() ===
      path.resolve(newFile).toLowerCase()
      : path.resolve(currentFile) === path.resolve(newFile);

  const sameFolder =
    process.platform === "win32"
      ? path.resolve(oldRoot).toLowerCase() ===
      path.resolve(newRoot).toLowerCase()
      : path.resolve(oldRoot) === path.resolve(newRoot);

  if (!sameFile && !sameFolder) {
    if (isDedicatedFolder) {
      if (
        await fs.access(newRoot).then(
          () => true,
          () => false,
        )
      ) {
        throw new Error(`同名项目文件夹“${sanitized}”已存在，请更换名称`);
      }
    } else {
      if (
        await fs.access(newFile).then(
          () => true,
          () => false,
        )
      ) {
        throw new Error(
          `同名项目文件“${sanitized}.troncut”已存在，请更换名称`,
        );
      }
    }
  }

  // 1. 如果是专属项目文件夹，先重命名文件夹
  if (isDedicatedFolder && !sameFolder) {
    if (
      process.platform === "win32" &&
      path.resolve(oldRoot).toLowerCase() === path.resolve(newRoot).toLowerCase()
    ) {
      const tempRoot = `${oldRoot}_rename_tmp_${Date.now()}`;
      await fs.rename(oldRoot, tempRoot);
      await fs.rename(tempRoot, newRoot);
    } else {
      await fs.rename(oldRoot, newRoot);
    }
  }

  // 2. 如果文件夹内的项目文件需要改名
  const currentFileInNewRoot = isDedicatedFolder
    ? path.join(newRoot, oldFileName)
    : currentFile;

  if (currentFileInNewRoot !== newFile) {
    if (
      process.platform === "win32" &&
      path.resolve(currentFileInNewRoot).toLowerCase() ===
      path.resolve(newFile).toLowerCase()
    ) {
      const tempFile = `${currentFileInNewRoot}_rename_tmp_${Date.now()}`;
      await fs.rename(currentFileInNewRoot, tempFile);
      await fs.rename(tempFile, newFile);
    } else {
      await fs.rename(currentFileInNewRoot, newFile);
    }
  }

  // 3. 将素材的绝对路径从 oldRoot 映射到 newRoot
  const updatedAssets = project.assets.map((asset) => {
    const rel = path.relative(oldRoot, asset.path);
    const isInside = !rel.startsWith("..") && !path.isAbsolute(rel);
    const nextPath = isInside ? path.resolve(newRoot, rel) : asset.path;

    let nextCursorPath = asset.cursorPath;
    if (asset.cursorPath) {
      const relCursor = path.relative(oldRoot, asset.cursorPath);
      const isCursorInside =
        !relCursor.startsWith("..") && !path.isAbsolute(relCursor);
      nextCursorPath = isCursorInside
        ? path.resolve(newRoot, relCursor)
        : asset.cursorPath;
    }

    return {
      ...asset,
      path: nextPath,
      cursorPath: nextCursorPath,
    };
  });

  const updatedProject: Project = {
    ...project,
    name: sanitized,
    assets: updatedAssets,
  };

  // 4. 保存更新后的 project 到 newFile
  const saved = await saveProject(updatedProject, newFile, iconPath);

  return { project: saved, file: newFile, oldRoot, newRoot };
}
