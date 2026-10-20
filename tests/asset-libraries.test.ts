import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { AssetLibraries } from "../electron/asset-libraries";
import type { Asset } from "../shared/model";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-libraries-"));
  roots.push(root);
  const file = path.join(root, "录屏.mp4");
  await fs.writeFile(file, "test-media-content");
  const asset: Asset = {
    id: "source",
    path: file,
    name: "演示录屏",
    kind: "video",
    duration: 20,
    width: 1920,
    height: 1080,
    hasAudio: true,
    cursor: {
      samples: [{ time: 1, x: 0.5, y: 0.3, click: true, visible: true }],
    },
  };
  const store = new AssetLibraries(path.join(root, "profile"));
  return { root, store, asset };
}

describe("跨项目素材库", () => {
  it("初始化默认库，管理名称与库，拒绝空白/重名及删除默认库", async () => {
    const { root, store } = await fixture();
    expect(await store.list()).toEqual([
      { id: "default", name: "默认", assets: [] },
    ]);
    const id = await store.create("  常用  ");
    await expect(store.create("常用")).rejects.toThrow("同名");
    await expect(store.rename(id, "默认")).rejects.toThrow("同名");
    await expect(store.create(" ")).rejects.toThrow();
    await store.rename(id, "片头");
    const restarted = new AssetLibraries(path.join(root, "profile"));
    expect((await restarted.list())[1].name).toBe("片头");
    await expect(store.remove("default")).rejects.toThrow("不能删除");
    await store.remove(id);
    expect(await store.list()).toHaveLength(1);
  });
  it("独立复制原始文件及鼠标元数据，重复使用复用项目素材，删除库不破坏项目和原文件", async () => {
    const { store, asset } = await fixture();
    const id = await store.create("录屏");
    await store.add(id, [asset]);
    const saved = (await store.list())[1].assets[0];
    expect(saved.path).not.toBe(asset.path);
    expect(saved.cursor).toEqual(asset.cursor);
    expect(saved.missing).toBe(false);
    expect(await fs.readFile(saved.path, "utf8")).toBe("test-media-content");
    const used = await store.materialize(id, saved.id);
    expect(used.path).not.toBe(saved.path);
    expect(await store.materialize(id, saved.id)).toEqual(used);
    await store.remove(id);
    expect(await fs.readFile(used.path, "utf8")).toBe("test-media-content");
    expect(await fs.readFile(asset.path, "utf8")).toBe("test-media-content");
  });
  it("并发写入串行提交；失败批量添加回滚，保留之前的库和素材", async () => {
    const { root, store, asset } = await fixture();
    await Promise.all([
      store.create("一"),
      store.create("二"),
      store.add("default", [asset]),
    ]);
    expect(await store.list()).toHaveLength(3);
    await expect(
      store.add("default", [
        asset,
        { ...asset, path: path.join(root, "missing.mp4") },
      ]),
    ).rejects.toThrow();
    const saved = (await store.list())[0].assets;
    expect(saved).toHaveLength(1);
    expect(await fs.readdir(path.dirname(saved[0].path))).toHaveLength(1);
    await fs.unlink(saved[0].path);
    expect((await store.list())[0].assets[0].missing).toBe(true);
    await store.removeAsset("default", saved[0].id);
    expect((await store.list())[0].assets).toEqual([]);
  });
  it("ZIP包含文件和元数据，离开原始库也可导入；同名导入自动新建且分配新ID", async () => {
    const { root, store, asset } = await fixture();
    const id = await store.create("共享素材");
    await store.add(id, [asset]);
    const file = path.join(root, "素材.zip");
    await store.export(id, file);
    const before = (await store.list())[1].assets[0];
    const files = unzipSync(await fs.readFile(file));
    expect(Object.keys(files)).toHaveLength(2);
    expect(Object.keys(files).some((name) => name.startsWith("media/"))).toBe(
      true,
    );
    const copyId = await store.import(file);
    expect((await store.list()).find((item) => item.id === copyId)?.name).toBe(
      "共享素材 (2)",
    );
    await store.remove(id);
    await fs.unlink(asset.path);
    const imported = (await store.list()).find((item) => item.id === copyId)!;
    expect(imported.assets[0].id).not.toBe(before.id);
    expect(imported.assets[0].cursor).toEqual(asset.cursor);
    expect(await fs.readFile(imported.assets[0].path, "utf8")).toBe(
      "test-media-content",
    );
    const other = new AssetLibraries(path.join(root, "other-profile"));
    await other.import(file);
    expect((await other.list())[1].assets[0].missing).toBe(false);
  });
  it("导出缺失文件不会覆盖已有压缩包", async () => {
    const { root, store, asset } = await fixture();
    await store.add("default", [asset]);
    const file = path.join(root, "保留.zip");
    await fs.writeFile(file, "old-archive");
    await fs.unlink((await store.list())[0].assets[0].path);
    await expect(store.export("default", file)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("old-archive");
  });
  it("拒绝路径穿越、缺失文件及非素材库ZIP，失败不留下半成品库", async () => {
    const { root, store, asset } = await fixture();
    const file = path.join(root, "invalid.zip");
    const manifest = {
      format: "troncut-library",
      version: 1,
      name: "坏库",
      assets: [{ ...asset, path: "media/absent.mp4" }],
    };
    const invalidArchives: Record<string, Uint8Array>[] = [
      {
        "../outside.txt": strToU8("bad"),
        "library.json": strToU8(JSON.stringify(manifest)),
      },
      { "library.json": strToU8(JSON.stringify(manifest)) },
      { "library.json": strToU8(JSON.stringify({ ...manifest, version: 99 })) },
      {
        "library.json": strToU8(
          JSON.stringify({
            ...manifest,
            assets: [{ ...asset, path: asset.path }],
          }),
        ),
      },
    ];
    for (const files of invalidArchives) {
      await fs.writeFile(file, zipSync(files));
      await expect(store.import(file)).rejects.toThrow();
      expect(await store.list()).toHaveLength(1);
      expect(
        await fs.readdir(path.join(root, "profile", "asset-libraries")),
      ).toEqual([]);
    }
  });
  it("文件夹层级和素材归属持久化，删除文件夹保留素材并提升子文件夹", async () => {
    const { root, store, asset } = await fixture();
    await store.add("default", [asset]);
    const saved = (await store.list())[0].assets[0];
    const parent = await store.createFolder("default", "背景音");
    const child = await store.createFolder("default", "日常", parent);
    await expect(store.createFolder("default", " 背景音 ")).rejects.toThrow(
      "同名",
    );
    await expect(
      store.createFolder("default", "坏层级", "absent"),
    ).rejects.toThrow("不存在");
    await store.setAssetFolder("default", saved.id, child);
    await store.renameFolder("default", child, "片头");
    const restarted = new AssetLibraries(path.join(root, "profile"));
    expect((await restarted.list())[0].folders).toEqual([
      { id: parent, name: "背景音", assetIds: [] },
      { id: child, parentId: parent, name: "片头", assetIds: [saved.id] },
    ]);
    await store.setAssetFolder("default", saved.id, parent);
    await store.removeFolder("default", parent);
    const library = (await store.list())[0];
    expect(library.assets).toHaveLength(1);
    expect(library.folders).toEqual([
      { id: child, name: "片头", assetIds: [] },
    ]);
    expect(await fs.readFile(saved.path, "utf8")).toBe("test-media-content");
    await store.setAssetFolder("default", saved.id, child);
    await store.setAssetFolder("default", saved.id, null);
    expect((await store.list())[0].folders?.[0].assetIds).toEqual([]);
    await store.setAssetFolder("default", saved.id, child);
    await store.removeAsset("default", saved.id);
    expect((await store.list())[0].folders?.[0].assetIds).toEqual([]);
  });
  it("重命名保留文件和元数据，复制独立副本，移动后项目副本仍可读取", async () => {
    const { root, store, asset } = await fixture();
    const target = await store.create("目标库");
    await store.add("default", [asset]);
    const saved = (await store.list())[0].assets[0];
    const folder = await store.createFolder("default", "常用");
    await store.setAssetFolder("default", saved.id, folder);
    await store.renameAsset("default", saved.id, " 新标题 ");
    expect((await store.list())[0].assets[0]).toMatchObject({
      name: "新标题",
      path: saved.path,
      cursor: asset.cursor,
    });
    await expect(store.renameAsset("default", saved.id, " ")).rejects.toThrow();
    const used = await store.materialize("default", saved.id);
    await store.transferAsset("default", saved.id, target, false);
    let libraries = await store.list();
    expect(libraries[0].assets).toHaveLength(1);
    const copy = libraries[1].assets[0];
    expect(copy.id).not.toBe(saved.id);
    expect(copy.path).not.toBe(saved.path);
    expect(copy).toMatchObject({ name: "新标题", cursor: asset.cursor });
    await store.transferAsset("default", saved.id, target, true);
    libraries = await new AssetLibraries(path.join(root, "profile")).list();
    expect(libraries[0].assets).toEqual([]);
    expect(libraries[0].folders?.[0].assetIds).toEqual([]);
    expect(libraries[1].assets).toHaveLength(2);
    await expect(fs.access(saved.path)).rejects.toThrow();
    expect(await fs.readFile(copy.path, "utf8")).toBe("test-media-content");
    expect(await fs.readFile(used.path, "utf8")).toBe("test-media-content");
    expect(await fs.readFile(asset.path, "utf8")).toBe("test-media-content");
  });
  it("移动到无效库或复制缺失文件失败时保留源记录与文件", async () => {
    const { store, asset } = await fixture();
    const target = await store.create("目标");
    await store.add("default", [asset]);
    const saved = (await store.list())[0].assets[0];
    await expect(
      store.transferAsset("default", saved.id, "absent", true),
    ).rejects.toThrow("不存在");
    await expect(
      store.transferAsset("default", saved.id, "default", true),
    ).rejects.toThrow("其他素材库");
    expect(await fs.readFile(saved.path, "utf8")).toBe("test-media-content");
    await fs.unlink(saved.path);
    await expect(
      store.transferAsset("default", saved.id, target, true),
    ).rejects.toThrow();
    expect((await store.list())[0].assets).toHaveLength(1);
    expect((await store.list())[1].assets).toHaveLength(0);
  });
  it("移动写入失败时回滚目标副本，源记录与源文件保持可用", async () => {
    const { root, store, asset } = await fixture();
    const target = await store.create("目标");
    await store.add("default", [asset]);
    const saved = (await store.list())[0].assets[0];
    const write = vi
      .spyOn(fs, "rename")
      .mockRejectedValueOnce(new Error("模拟磁盘写入失败"));
    try {
      await expect(
        store.transferAsset("default", saved.id, target, true),
      ).rejects.toThrow("磁盘写入失败");
    } finally {
      write.mockRestore();
    }
    const libraries = await store.list();
    expect(libraries[0].assets).toHaveLength(1);
    expect(libraries[1].assets).toHaveLength(0);
    expect(await fs.readFile(saved.path, "utf8")).toBe("test-media-content");
    expect(
      await fs.readdir(path.join(root, "profile", "asset-libraries", target)),
    ).toEqual([]);
  });
  it("整库归档重映射文件夹和素材 ID，单资产导出仅包含所选素材及元数据", async () => {
    const { root, store, asset } = await fixture();
    await store.add("default", [
      asset,
      { ...asset, id: "other", name: "另一个素材" },
    ]);
    const before = (await store.list())[0];
    const parent = await store.createFolder("default", "标题");
    const child = await store.createFolder("default", "片头", parent);
    await store.setAssetFolder("default", before.assets[0].id, child);
    const file = path.join(root, "folders.zip");
    await store.export("default", file);
    const importedId = await store.import(file);
    const imported = (await store.list()).find(
      (library) => library.id === importedId,
    )!;
    expect(imported.folders?.[0].id).not.toBe(parent);
    expect(imported.folders?.[1]).toMatchObject({
      parentId: imported.folders?.[0].id,
      assetIds: [imported.assets[0].id],
    });
    const single = path.join(root, "asset.zip");
    await store.export("default", single, before.assets[0].id);
    const entries = unzipSync(await fs.readFile(single));
    expect(Object.keys(entries)).toHaveLength(2);
    const singleId = await store.import(single);
    const singleLibrary = (await store.list()).find(
      (library) => library.id === singleId,
    )!;
    expect(singleLibrary.assets).toHaveLength(1);
    expect(singleLibrary.assets[0]).toMatchObject({
      name: asset.name,
      cursor: asset.cursor,
    });
    expect(singleLibrary.folders).toBeUndefined();
  });
  it("拒绝循环文件夹和重复归属的归档，空文件夹库也可导入", async () => {
    const { root, store, asset } = await fixture();
    const file = path.join(root, "invalid-folders.zip");
    const manifest = {
      format: "troncut-library",
      version: 1,
      name: "无效",
      assets: [{ ...asset, path: "media/source.mp4" }],
    };
    for (const folders of [
      [{ id: "a", name: "循环", parentId: "a", assetIds: [] }],
      [{ id: "a", name: "无父级", parentId: "missing", assetIds: [] }],
      [{ id: "a", name: "重复", assetIds: [asset.id, asset.id] }],
    ]) {
      await fs.writeFile(
        file,
        zipSync({
          "library.json": strToU8(JSON.stringify({ ...manifest, folders })),
          "media/source.mp4": strToU8("media"),
        }),
      );
      await expect(store.import(file)).rejects.toThrow();
      expect(await store.list()).toHaveLength(1);
    }
    await store.createFolder("default", "空文件夹");
    await store.export("default", file);
    const id = await store.import(file);
    expect(
      (await store.list()).find((library) => library.id === id)?.folders?.[0]
        .name,
    ).toBe("空文件夹");
  });
});
