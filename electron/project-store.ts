import fs from "node:fs/promises";
import path from "node:path";
import {
  type Project,
  validateProject,
  cursorRecordingSchema,
} from "../shared/model";

export function resolveContained(root: string, relative: string): string {
  if (path.isAbsolute(relative))
    throw new Error("TronCut 工程素材必须使用相对路径");
  const resolved = path.resolve(root, relative),
    rel = path.relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))
    throw new Error(`工程素材越出了工程目录：${relative}`);
  return resolved;
}
export async function openProject(file: string): Promise<Project> {
  const project = validateProject(JSON.parse(await fs.readFile(file, "utf8")));
  const baseName = path.basename(file, path.extname(file)).trim();
  if (
    (!project.name || project.name === "未命名工程") &&
    baseName &&
    baseName !== "未命名工程"
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
  const fileBaseName = path.basename(file, path.extname(file)).trim();
  if (
    (!valid.name || valid.name === "未命名工程") &&
    fileBaseName &&
    fileBaseName !== "未命名工程"
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
    if (path.resolve(original.path) !== path.resolve(target)) {
      await fs.copyFile(original.path, target);
    } else await fs.access(target);
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
            await fs.unlink(legacyIcon).catch(() => {});
        }
      }
    }
    const { runProcess } = await import("./process");
    await runProcess("attrib", ["+r", root]).catch(() => {});
    await runProcess("attrib", [
      "+s",
      "+h",
      path.join(root, "desktop.ini"),
    ]).catch(() => {});
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
