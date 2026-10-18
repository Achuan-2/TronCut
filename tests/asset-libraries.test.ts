import { afterEach, describe, expect, it } from "vitest";
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

describe("跨工程素材库", () => {
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
  it("独立复制原始文件及鼠标元数据，重复使用复用项目素材，删除库不破坏工程和原文件", async () => {
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
});
