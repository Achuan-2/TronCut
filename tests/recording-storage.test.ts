import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createProject, uid } from "../shared/model";
import { openProject, saveProject } from "../electron/project-store";
import { projectRecordingDirectory } from "../electron/recording-storage";

it("录制目录位于当前项目 media，尚未创建项目时拒绝回退缓存，目录不能越界", async () => {
  const root = await fs.mkdtemp(
    path.resolve("test-output/recording-directory-"),
  );
  const file = path.join(root, "project", "project.troncut");
  await saveProject(createProject(), file);
  expect(await projectRecordingDirectory(file)).toBe(
    path.join(root, "project", "media"),
  );
  await expect(projectRecordingDirectory(null)).rejects.toThrow(
    "先新建或保存项目",
  );
  const other = path.join(root, "outside");
  await fs.mkdir(other);
  const linked = path.join(root, "linked");
  await fs.mkdir(linked);
  await fs.symlink(
    other,
    path.join(linked, "media"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(
    projectRecordingDirectory(path.join(linked, "linked.troncut")),
  ).rejects.toThrow("越出了项目目录");
});

it("完成的录屏和鼠标轨迹原地保存重开，不生成重复文件，未完成的录制仍保留", async () => {
  const root = await fs.mkdtemp(path.resolve("test-output/recording-storage-"));
  const file = path.join(root, "project.troncut");
  const project = await saveProject(createProject(), file);
  const directory = await projectRecordingDirectory(file);
  const id = uid(),
    name = "录屏-20261023.mp4";
  const media = path.join(directory, `${id}-${name}`);
  const cursor = {
    samples: [{ time: 0, x: 0.5, y: 0.5, visible: true, click: false }],
  };
  const incomplete = path.join(
    directory,
    `.recording-${uid()}-failed.raw.webm`,
  );
  await fs.writeFile(media, "completed recording");
  await fs.writeFile(incomplete, "recoverable recording");
  await fs.writeFile(
    path.join(directory, `${id}-cursor.json`),
    JSON.stringify(cursor),
  );
  project.assets = [
    {
      id,
      name,
      path: media,
      kind: "video",
      duration: 1,
      width: 320,
      height: 180,
      hasAudio: true,
      cursor,
    },
  ];
  const saved = await saveProject(project, file);
  expect(saved.assets[0].path).toBe(media);
  const reopened = await openProject(file);
  expect(reopened.assets[0]).toMatchObject({
    path: media,
    cursor,
    missing: false,
  });
  await saveProject(reopened, file);
  expect((await fs.readdir(directory)).sort()).toEqual(
    [`${id}-${name}`, `${id}-cursor.json`, path.basename(incomplete)].sort(),
  );
  expect(await fs.readFile(incomplete, "utf8")).toBe("recoverable recording");
  expect(JSON.parse(await fs.readFile(file, "utf8")).assets[0].path).toBe(
    `media/${id}-${name}`,
  );
});
