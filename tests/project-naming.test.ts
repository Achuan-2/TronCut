import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProject } from "../shared/model";
import { openProject, saveProject, saveProjectInDirectory, renameProjectStorage } from "../electron/project-store";
import { defaultExportFileName } from "../shared/export-settings";
import type { Asset } from "../shared/model";

describe("工程命名与保存往返", () => {
  it("同名项目并发保存时独立归档，另存副本收集素材且保留原工程", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-default-project-"));
    try {
      const directory = path.join(root, "Projects");
      const source = path.join(root, "sample.png");
      await fs.writeFile(source, "image content");
      const project = createProject();
      project.assets = [{
        id: "sample", name: "sample.png", path: source, kind: "image",
        duration: 5, width: 320, height: 180, hasAudio: false,
      }];
      const results = await Promise.all([
        saveProjectInDirectory(project, directory),
        saveProjectInDirectory(project, directory),
      ]);
      expect(new Set(results.map((result) => result.project.name))).toEqual(
        new Set(["未命名工程", "未命名工程-2"]),
      );
      for (const result of results) {
        expect(path.basename(path.dirname(result.file))).toBe(result.project.name);
        expect(path.basename(result.file)).toBe(`${result.project.name}.troncut`);
        expect((await openProject(result.file)).assets[0].missing).toBe(false);
      }
      const original = results[0];
      const originalContent = await fs.readFile(original.file, "utf8");
      const copy = await saveProjectInDirectory(
        { ...original.project, name: "另存副本" }, path.join(root, "Elsewhere"),
      );
      expect(await fs.readFile(original.file, "utf8")).toBe(originalContent);
      expect(await fs.readFile(copy.project.assets[0].path, "utf8")).toBe("image content");
      expect(copy.project.assets[0].path).not.toBe(original.project.assets[0].path);
      const renamed = await renameProjectStorage(original.project, original.file, "新名称");
      expect(path.basename(path.dirname(renamed.file))).toBe("新名称");
      expect((await openProject(renamed.file)).assets[0].missing).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("默认未命名工程保存到具体文件名时，自动同步工程名称与导出视频名称", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-name-test-"));
    try {
      const file = path.join(root, "我的教程视频.troncut");
      const project = createProject(); // 默认 "未命名工程"
      expect(project.name).toBe("未命名工程");

      const saved = await saveProject(project, file);
      expect(saved.name).toBe("我的教程视频");

      // 验证存入磁盘文件的实际内容
      const raw = JSON.parse(await fs.readFile(file, "utf8"));
      expect(raw.name).toBe("我的教程视频");

      // 验证重新打开该工程
      const opened = await openProject(file);
      expect(opened.name).toBe("我的教程视频");

      // 验证导出视频默认文件名
      expect(defaultExportFileName(opened.name)).toBe("我的教程视频");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("已命名工程保存时保留原名称；历史未命名工程按文件名纠正", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-name-test2-"));
    try {
      // 1. 已命名工程保持自定义名称
      const fileCustom = path.join(root, "fileA.troncut");
      const customProject = createProject("自定义好名字");
      const savedCustom = await saveProject(customProject, fileCustom);
      expect(savedCustom.name).toBe("自定义好名字");

      // 2. 模拟过去遗留的历史工程（文件名为 产品发布会.troncut，但内部 json 的 name 仍是 未命名工程）
      const legacyFile = path.join(root, "产品发布会.troncut");
      await fs.writeFile(
        legacyFile,
        JSON.stringify({ ...createProject(), name: "未命名工程" }),
        "utf8",
      );

      const openedLegacy = await openProject(legacyFile);
      expect(openedLegacy.name).toBe("产品发布会");
      expect(defaultExportFileName(openedLegacy.name)).toBe("产品发布会");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("直接修改项目名称时，专属项目文件夹和项目文件同步改名且素材映射有效", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-rename-test-"));
    try {
      // 创建专属工程目录 root/初版演示/初版演示.troncut
      const folderA = path.join(root, "初版演示");
      const fileA = path.join(folderA, "初版演示.troncut");
      const project = createProject("初版演示");

      // 添加一个伪素材
      const dummyAssetPath = path.join(root, "sample.png");
      await fs.writeFile(dummyAssetPath, "fake image content");
      const asset: Asset = {
        id: "asset_test_1",
        name: "sample.png",
        path: dummyAssetPath,
        kind: "image",
        duration: 5,
        width: 1920,
        height: 1080,
        hasAudio: false,
      };
      project.assets = [asset];

      // 首次保存到 folderA
      const savedA = await saveProject(project, fileA);
      expect(await fs.access(fileA).then(() => true, () => false)).toBe(true);
      expect(savedA.assets[0].path).toContain("初版演示");

      // 执行重命名为 "终版演示"
      const result = await renameProjectStorage(savedA, fileA, "终版演示");
      const expectedFolderB = path.join(root, "终版演示");
      const expectedFileB = path.join(expectedFolderB, "终版演示.troncut");

      expect(result.file).toBe(expectedFileB);
      expect(result.project.name).toBe("终版演示");

      // 验证旧文件夹和文件已不存在
      expect(await fs.access(folderA).then(() => true, () => false)).toBe(false);
      expect(await fs.access(fileA).then(() => true, () => false)).toBe(false);

      // 验证新文件夹和文件已存在
      expect(await fs.access(expectedFolderB).then(() => true, () => false)).toBe(true);
      expect(await fs.access(expectedFileB).then(() => true, () => false)).toBe(true);

      // 验证素材路径已正确更新到新文件夹下
      expect(result.project.assets[0].path).toBe(
        path.join(expectedFolderB, "media", `asset_test_1-sample.png`),
      );
      expect(
        await fs.access(result.project.assets[0].path).then(() => true, () => false),
      ).toBe(true);

      // 验证重新 openProject 能正确读取
      const reloaded = await openProject(expectedFileB);
      expect(reloaded.name).toBe("终版演示");
      expect(reloaded.assets[0].missing).toBe(false);

      // 验证同名冲突检查
      const conflictFolder = path.join(root, "已有同名");
      await fs.mkdir(conflictFolder);
      await expect(
        renameProjectStorage(result.project, expectedFileB, "已有同名"),
      ).rejects.toThrow("同名工程文件夹“已有同名”已存在");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
