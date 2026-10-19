import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { uid, type Asset } from "../shared/model";
import {
  assetLibrarySchema,
  assetLibraryArchiveSchema,
  defaultAssetLibraryId,
  libraryNameSchema,
  type AssetLibrary,
  type LibraryFolder,
} from "../shared/asset-libraries";
import { resolveContained } from "./project-store";
import { readLibraryArchive, writeLibraryArchive } from "./library-archive";

/** Libraries own copies. Project reuse gets another copy so deleting a library is safe. */
export class AssetLibraries {
  private root: string;
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private userData: string) {
    this.root = path.join(userData, "asset-libraries");
  }
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const next = this.pending.then(action);
    this.pending = next.catch(() => {});
    return next;
  }
  private async read() {
    try {
      return z
        .array(assetLibrarySchema)
        .parse(
          JSON.parse(
            await fs.readFile(path.join(this.root, "libraries.json"), "utf8"),
          ),
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return [
        { id: defaultAssetLibraryId, name: "默认", assets: [] },
      ] as AssetLibrary[];
    }
  }
  private async write(libraries: AssetLibrary[]) {
    libraries.forEach((library) => this.validateFolders(library));
    await fs.mkdir(this.root, { recursive: true });
    const temporary = path.join(this.root, "libraries.json.tmp");
    await fs.writeFile(temporary, JSON.stringify(libraries));
    await fs.rename(temporary, path.join(this.root, "libraries.json"));
  }
  private validateFolders(library: Pick<AssetLibrary, "assets" | "folders">) {
    const folders = library.folders ?? [];
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const assets = new Set(library.assets.map((asset) => asset.id));
    const assigned = new Set<string>();
    if (byId.size !== folders.length) throw new Error("文件夹 ID 重复");
    for (const folder of folders) {
      const visited = new Set([folder.id]);
      let parent = folder.parentId;
      while (parent) {
        if (visited.has(parent) || !byId.has(parent))
          throw new Error("文件夹层级无效");
        visited.add(parent);
        parent = byId.get(parent)!.parentId;
      }
      for (const id of folder.assetIds) {
        if (!assets.has(id) || assigned.has(id))
          throw new Error("文件夹包含无效或重复的素材");
        assigned.add(id);
      }
    }
  }
  private folder(library: AssetLibrary, id: string) {
    const folder = library.folders?.find((item) => item.id === id);
    if (!folder) throw new Error("文件夹不存在");
    return folder;
  }
  private folderName(
    library: AssetLibrary,
    input: string,
    parentId?: string,
    except?: string,
  ) {
    const name = libraryNameSchema.parse(input);
    if (
      library.folders?.some(
        (item) =>
          item.id !== except &&
          item.parentId === parentId &&
          item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new Error("已存在同名文件夹");
    return name;
  }
  createFolder(id: string, name: string, parentId?: string) {
    return this.serialize(async () => {
      const libraries = await this.read();
      const library = this.find(libraries, id);
      if (parentId) this.folder(library, parentId);
      if ((library.folders?.length ?? 0) >= 1000)
        throw new Error("每个库最多保存 1000 个文件夹");
      const folder: LibraryFolder = {
        id: uid(),
        name: this.folderName(library, name, parentId),
        parentId,
        assetIds: [],
      };
      (library.folders ??= []).push(folder);
      await this.write(libraries);
      return folder.id;
    });
  }
  renameFolder(id: string, folderId: string, name: string) {
    return this.serialize(async () => {
      const libraries = await this.read();
      const library = this.find(libraries, id);
      const folder = this.folder(library, folderId);
      folder.name = this.folderName(library, name, folder.parentId, folderId);
      await this.write(libraries);
    });
  }
  removeFolder(id: string, folderId: string) {
    return this.serialize(async () => {
      const libraries = await this.read();
      const library = this.find(libraries, id);
      const folder = this.folder(library, folderId);
      // Removing an organizational folder returns its contents to the library root.
      for (const child of library.folders ?? []) {
        if (child.parentId === folderId) {
          child.parentId = undefined;
          let name = child.name;
          for (
            let suffix = 2;
            library.folders?.some(
              (item) =>
                item.id !== child.id && !item.parentId && item.name === name,
            );
            suffix++
          )
            name = `${child.name.slice(0, 90)} (${suffix})`;
          child.name = name;
        }
      }
      library.folders = library.folders?.filter((item) => item.id !== folderId);
      await this.write(libraries);
    });
  }
  setAssetFolder(id: string, assetId: string, folderId: string | null) {
    return this.serialize(async () => {
      const libraries = await this.read();
      const library = this.find(libraries, id);
      if (!library.assets.some((asset) => asset.id === assetId))
        throw new Error("库中素材不存在");
      const target = folderId ? this.folder(library, folderId) : undefined;
      for (const folder of library.folders ?? [])
        folder.assetIds = folder.assetIds.filter((item) => item !== assetId);
      target?.assetIds.push(assetId);
      await this.write(libraries);
    });
  }
  renameAsset(id: string, assetId: string, name: string) {
    return this.serialize(async () => {
      const libraries = await this.read();
      const asset = this.find(libraries, id).assets.find(
        (item) => item.id === assetId,
      );
      if (!asset) throw new Error("库中素材不存在");
      asset.name = libraryNameSchema.parse(name);
      await this.write(libraries);
    });
  }
  transferAsset(id: string, assetId: string, targetId: string, move: boolean) {
    return this.serialize(async () => {
      if (id === targetId) throw new Error("请选择其他素材库");
      const libraries = await this.read();
      const sourceLibrary = this.find(libraries, id);
      const targetLibrary = this.find(libraries, targetId);
      const asset = sourceLibrary.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error("库中素材不存在");
      if (targetLibrary.assets.length >= 10000)
        throw new Error("目标素材库已满");
      const source = await this.source(asset);
      const copyId = uid();
      const relative = `${targetId}/${copyId}${path.extname(source)}`;
      const target = resolveContained(this.root, relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      let copied = false;
      try {
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
        copied = true;
        targetLibrary.assets.push({ ...asset, id: copyId, path: relative });
        if (move) {
          sourceLibrary.assets = sourceLibrary.assets.filter(
            (item) => item.id !== assetId,
          );
          for (const folder of sourceLibrary.folders ?? [])
            folder.assetIds = folder.assetIds.filter(
              (item) => item !== assetId,
            );
        }
        await this.write(libraries);
      } catch (error) {
        if (copied) await fs.rm(target, { force: true });
        throw error;
      }
      if (move) await fs.rm(source, { force: true });
    });
  }
  private find(libraries: AssetLibrary[], id: string) {
    const library = libraries.find((item) => item.id === id);
    if (!library) throw new Error("素材库不存在，请重新选择");
    return library;
  }
  private uniqueName(
    libraries: AssetLibrary[],
    input: string,
    except?: string,
  ) {
    const name = libraryNameSchema.parse(input);
    if (
      libraries.some(
        (item) =>
          item.id !== except &&
          item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    )
      throw new Error("已存在同名素材库，请使用其他名称");
    return name;
  }
  private async source(asset: Asset) {
    const file = resolveContained(this.root, asset.path);
    const actual = await fs.realpath(file);
    resolveContained(
      await fs.realpath(this.root),
      path.relative(await fs.realpath(this.root), actual),
    );
    return actual;
  }
  private async snapshot(libraries: AssetLibrary[]) {
    return Promise.all(
      libraries.map(async (library) => ({
        ...library,
        assets: await Promise.all(
          library.assets.map(async (asset) => ({
            ...asset,
            path: resolveContained(this.root, asset.path),
            missing: !(await this.source(asset).then(
              () => true,
              () => false,
            )),
          })),
        ),
      })),
    );
  }
  list() {
    return this.serialize(async () => this.snapshot(await this.read()));
  }
  create(name: string) {
    return this.serialize(async () => {
      const libraries = await this.read();
      const library: AssetLibrary = {
        id: uid(),
        name: this.uniqueName(libraries, name),
        assets: [],
      };
      libraries.push(library);
      await this.write(libraries);
      return library.id;
    });
  }
  rename(id: string, name: string) {
    return this.serialize(async () => {
      const libraries = await this.read();
      this.find(libraries, id).name = this.uniqueName(libraries, name, id);
      await this.write(libraries);
    });
  }
  remove(id: string) {
    return this.serialize(async () => {
      if (id === defaultAssetLibraryId) throw new Error("默认素材库不能删除");
      const libraries = await this.read();
      this.find(libraries, id);
      await this.write(libraries.filter((item) => item.id !== id));
      await fs.rm(resolveContained(this.root, id), {
        recursive: true,
        force: true,
      });
    });
  }
  add(id: string, sources: Asset[]) {
    return this.serialize(async () => {
      const libraries = await this.read();
      const library = this.find(libraries, id);
      if (library.assets.length + sources.length > 10000)
        throw new Error("每个素材库最多保存 10000 个素材");
      const folder = resolveContained(this.root, id);
      await fs.mkdir(folder, { recursive: true });
      const copied: string[] = [];
      try {
        for (const source of sources) {
          if (source.missing) throw new Error("请先重新链接离线素材");
          const assetId = uid();
          const extension =
            path.extname(source.path).replace(/[^.a-zA-Z0-9]/g, "") || ".bin";
          const relative = `${id}/${assetId}${extension}`;
          const target = resolveContained(this.root, relative);
          copied.push(target);
          await fs.copyFile(source.path, target);
          library.assets.push({
            ...source,
            id: assetId,
            path: relative,
            missing: undefined,
            cursorPath: undefined,
          });
        }
        await this.write(libraries);
      } catch (error) {
        await Promise.all(copied.map((file) => fs.rm(file, { force: true })));
        throw error;
      }
    });
  }
  removeAsset(id: string, assetId: string) {
    return this.serialize(async () => {
      const libraries = await this.read();
      const library = this.find(libraries, id);
      const asset = library.assets.find((item) => item.id === assetId);
      if (!asset) throw new Error("库中素材不存在");
      library.assets = library.assets.filter((item) => item.id !== assetId);
      for (const folder of library.folders ?? [])
        folder.assetIds = folder.assetIds.filter((item) => item !== assetId);
      await this.write(libraries);
      await fs.rm(resolveContained(this.root, asset.path), { force: true });
    });
  }
  materialize(id: string, assetId: string) {
    return this.serialize(async () => {
      const asset = this.find(await this.read(), id).assets.find(
        (item) => item.id === assetId,
      );
      if (!asset) throw new Error("库中素材不存在");
      const source = await this.source(asset);
      const folder = path.join(this.userData, "library-imports");
      await fs.mkdir(folder, { recursive: true });
      // Stable project IDs/path allow repeated insertion without duplicate bin entries.
      const target = path.join(folder, `${asset.id}${path.extname(source)}`);
      try {
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      return {
        ...asset,
        id: `library-${asset.id}`,
        path: target,
        missing: undefined,
      };
    });
  }
  export(id: string, target: string, assetId?: string) {
    return this.serialize(async () => {
      const library = this.find(await this.read(), id);
      const selected = assetId
        ? library.assets.filter((asset) => asset.id === assetId)
        : library.assets;
      if (assetId && !selected.length) throw new Error("库中素材不存在");
      const assets = selected.map((asset) => ({
        ...asset,
        path: `media/${asset.id}${path.extname(asset.path)}`,
        missing: undefined,
        cursorPath: undefined,
      }));
      const manifest = {
        format: "troncut-library",
        version: 1,
        name: assetId ? selected[0].name : library.name,
        folders: assetId ? undefined : library.folders,
        assets,
      };
      const media = await Promise.all(
        selected.map(async (asset, index) => ({
          name: assets[index].path,
          source: await this.source(asset),
        })),
      );
      const temporary = `${target}.${uid()}.tmp`;
      try {
        await writeLibraryArchive(temporary, JSON.stringify(manifest), media);
        await fs.rename(temporary, target);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
  }
  import(file: string) {
    return this.serialize(async () => {
      await fs.mkdir(this.root, { recursive: true });
      const staging = await fs.mkdtemp(path.join(this.root, ".import-"));
      let committedFolder: string | null = null;
      try {
        const entries = await readLibraryArchive(file, staging);
        const manifest = assetLibraryArchiveSchema.parse(
          JSON.parse(
            await fs.readFile(path.join(staging, "library.json"), "utf8"),
          ),
        );
        this.validateFolders(manifest);
        const libraries = await this.read();
        let name = manifest.name;
        for (
          let suffix = 2;
          libraries.some(
            (item) =>
              item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          );
          suffix++
        )
          name = `${manifest.name.slice(0, 90)} (${suffix})`;
        const id = uid();
        const folder = resolveContained(this.root, id);
        const assets = [];
        const assetIds = new Map<string, string>();
        const used = new Set<string>();
        for (const asset of manifest.assets) {
          if (
            !/^media\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(asset.path) ||
            !entries.has(asset.path) ||
            used.has(asset.path)
          )
            throw new Error("素材库清单包含无效或缺失的素材");
          used.add(asset.path);
          const assetId = uid();
          if (assetIds.has(asset.id)) throw new Error("素材 ID 重复");
          assetIds.set(asset.id, assetId);
          const name = `${assetId}${path.extname(asset.path)}`;
          await fs.rename(
            resolveContained(staging, asset.path),
            path.join(staging, name),
          );
          assets.push({
            ...asset,
            id: assetId,
            path: `${id}/${name}`,
            missing: undefined,
            cursorPath: undefined,
          });
        }
        await fs.rm(path.join(staging, "media"), {
          recursive: true,
          force: true,
        });
        await fs.rm(path.join(staging, "library.json"));
        await fs.rename(staging, folder);
        committedFolder = folder;
        const folderIds = new Map(
          manifest.folders?.map((folder) => [folder.id, uid()]),
        );
        const folders = manifest.folders?.map((folder) => ({
          ...folder,
          id: folderIds.get(folder.id)!,
          parentId: folder.parentId
            ? folderIds.get(folder.parentId)
            : undefined,
          assetIds: folder.assetIds.map((assetId) => assetIds.get(assetId)!),
        }));
        libraries.push({ id, name, assets, folders });
        await this.write(libraries);
        committedFolder = null;
        return id;
      } finally {
        await fs.rm(staging, { recursive: true, force: true });
        if (committedFolder)
          await fs.rm(committedFolder, { recursive: true, force: true });
      }
    });
  }
}
