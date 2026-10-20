import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createProject, type Asset } from "../shared/model";
import { openProject, saveProject } from "../electron/project-store";
import {
  cleanupProjectMedia,
  resolveProjectMediaAsset,
} from "../electron/project-media-cleanup";

async function fixture() {
  const root = await fs.mkdtemp(path.resolve("test-output/media-cleanup-"));
  const original = path.join(root, "original.png");
  await fs.writeFile(original, "original media");
  const project = createProject("素材清理");
  project.assets = [
    {
      id: "ddc35da0-56e1-4a93-82f1-b2ade2c3a010",
      name: "original.png",
      path: original,
      kind: "image",
      width: 320,
      height: 180,
      duration: 0,
      hasAudio: false,
    },
  ];
  const file = path.join(root, "project", "fixture.troncut");
  return { root, original, file, project: await saveProject(project, file) };
}

it("保存后清除已删除归档与轨迹，保留原件和导出视频；历史素材仍可读取并重新保存恢复", async () => {
  const { original, file, project } = await fixture();
  const archived = project.assets[0].path;
  const cursor = path.join(
    path.dirname(archived),
    `${project.assets[0].id}-cursor.json`,
  );
  const output = path.join(path.dirname(file), "export.mp4");
  await fs.writeFile(cursor, "cursor data");
  await fs.writeFile(output, "exported video");
  await saveProject({ ...project, assets: [] }, file);
  await expect(fs.access(archived)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.access(cursor)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(original, "utf8")).toBe("original media");
  expect(await fs.readFile(output, "utf8")).toBe("exported video");
  expect(
    await fs.readFile(resolveProjectMediaAsset(project.assets[0]).path, "utf8"),
  ).toBe("original media");
  await saveProject(project, file);
  expect(await fs.readFile(archived, "utf8")).toBe("original media");
  expect((await openProject(file)).assets[0].missing).toBe(false);
  expect(resolveProjectMediaAsset(project.assets[0]).path).toBe(archived);
});

it("清理历史 UUID 残留，保留手动放入的文件以及其他工程仍在引用的素材", async () => {
  const { file, project } = await fixture();
  const media = path.dirname(project.assets[0].path);
  const custom = path.join(media, "manual-notes.txt");
  const orphan = path.join(
    media,
    "6aef692c-4646-4a1d-b590-1b070d9697bd-old.mp4",
  );
  await fs.writeFile(custom, "manual file");
  await fs.writeFile(orphan, "orphan");
  const sibling = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.writeFile(
    path.join(path.dirname(file), "other.troncut"),
    JSON.stringify(sibling),
  );
  await saveProject({ ...project, assets: [] }, file);
  expect(await fs.readFile(project.assets[0].path, "utf8")).toBe(
    "original media",
  );
  expect(await fs.readFile(custom, "utf8")).toBe("manual file");
  await expect(fs.access(orphan)).rejects.toMatchObject({ code: "ENOENT" });
});

it("保存收集素材失败时保留上次工程与全部归档，无法读取的同目录工程阻止清理", async () => {
  const { file, project } = await fixture();
  const previous = await fs.readFile(file, "utf8");
  const missing: Asset = {
    ...project.assets[0],
    id: "missing",
    path: path.join(path.dirname(file), "missing.png"),
  };
  await expect(
    saveProject({ ...project, assets: [missing] }, file),
  ).rejects.toThrow();
  expect(await fs.readFile(file, "utf8")).toBe(previous);
  expect(await fs.readFile(project.assets[0].path, "utf8")).toBe(
    "original media",
  );
  await fs.writeFile(path.join(path.dirname(file), "broken.troncut"), "broken");
  await saveProject({ ...project, assets: [] }, file);
  expect(await fs.readFile(project.assets[0].path, "utf8")).toBe(
    "original media",
  );
});

it("非 UUID 的已知归档在素材改名或删除后也会清理", async () => {
  const { file, project } = await fixture();
  project.assets[0] = { ...project.assets[0], id: "imported-asset" };
  const saved = await saveProject(project, file);
  const renamed = await saveProject(
    { ...saved, assets: [{ ...saved.assets[0], name: "renamed.png" }] },
    file,
  );
  await expect(fs.access(saved.assets[0].path)).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(await fs.readFile(renamed.assets[0].path, "utf8")).toBe(
    "original media",
  );
  await saveProject({ ...renamed, assets: [] }, file);
  expect(await fs.readdir(path.dirname(renamed.assets[0].path))).toEqual([]);
});

it("不会沿符号链接或目录联接清理工程外的文件", async () => {
  const { root, file, project } = await fixture();
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  const external = path.join(
    outside,
    "ab6b3f2a-c27a-4c01-bba9-99a78bc87433-external.png",
  );
  await fs.writeFile(external, "outside");
  const linkedRoot = path.join(root, "linked-project");
  await fs.mkdir(linkedRoot);
  await fs.symlink(
    outside,
    path.join(linkedRoot, "media"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(
    await cleanupProjectMedia(
      { ...project, assets: [] },
      path.join(linkedRoot, path.basename(file)),
    ),
  ).toEqual([]);
  expect(await fs.readFile(external, "utf8")).toBe("outside");
});
