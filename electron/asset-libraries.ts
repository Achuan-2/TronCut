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
    await fs.mkdir(this.root, { recursive: true });
    const temporary = path.join(this.root, "libraries.json.tmp");
    await fs.writeFile(temporary, JSON.stringify(libraries));
    await fs.rename(temporary, path.join(this.root, "libraries.json"));
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
  export(id: string, target: string) {
    return this.serialize(async () => {
      const library = this.find(await this.read(), id);
      const assets = library.assets.map((asset) => ({
        ...asset,
        path: `media/${asset.id}${path.extname(asset.path)}`,
        missing: undefined,
        cursorPath: undefined,
      }));
      const manifest = {
        format: "troncut-library",
        version: 1,
        name: library.name,
        assets,
      };
      const media = await Promise.all(
        library.assets.map(async (asset, index) => ({
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
        await fs.rm(path.join(staging, "media"), { recursive: true });
        await fs.rm(path.join(staging, "library.json"));
        await fs.rename(staging, folder);
        committedFolder = folder;
        libraries.push({ id, name, assets });
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
