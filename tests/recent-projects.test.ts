import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecentProjects } from "../electron/recent-projects";
import { createProject, newText } from "../shared/model";

it("最近项目按打开顺序持久化去重，并发保存不丢失，移走文件保留缺失标记", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "troncut-recent-"));
  try {
    const file = path.join(root, "recent.json"),
      store = new RecentProjects(file);
    const p = createProject("中文项目");
    p.clips = [newText(p.tracks[0].id, 0)];
    const a = path.join(root, "A.troncut"),
      b = path.join(root, "B.troncut");
    await fs.writeFile(a, "A");
    await fs.writeFile(b, "BB");
    await Promise.all([
      store.remember(p, a, "data:image/png;base64,YQ=="),
      store.remember({ ...p, name: "B" }, b),
    ]);
    expect((await store.list()).map((item) => item.file)).toEqual([b, a]);
    await store.remember({ ...p, name: "新名称" }, a);
    const reloaded = await new RecentProjects(file).list();
    expect(reloaded).toHaveLength(2);
    expect(reloaded[0].name).toBe("新名称");
    expect(reloaded[0].duration).toBe(p.clips[0].duration);
    expect(reloaded[0].thumbnail).toBe("data:image/png;base64,YQ==");
    await fs.unlink(a);
    expect((await store.list())[0].missing).toBe(true);
    await Promise.all([
      store.remove(a),
      store.remember({ ...p, name: "保留项目" }, b),
    ]);
    expect(
      (await new RecentProjects(file).list()).map((item) => item.file),
    ).toEqual([b]);
    expect(await fs.readFile(b, "utf8")).toBe("BB");
    await store.remove(b);
    expect(await new RecentProjects(file).list()).toEqual([]);
    expect(await store.hasHistory()).toBe(true);
    await fs.writeFile(file, "broken json");
    expect(await store.list()).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("最多保留20个最近项目，忽略损坏条目", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "troncut-recent-limit-"),
  );
  try {
    const history = path.join(root, "recent.json"),
      store = new RecentProjects(history);
    await fs.writeFile(history, JSON.stringify([{ file: 3, name: "bad" }]));
    expect(await store.list()).toEqual([]);
    for (let i = 0; i < 22; i++) {
      const file = path.join(root, `${i}.troncut`);
      await fs.writeFile(file, "file");
      await store.remember(createProject(String(i)), file);
    }
    const entries = await store.list();
    expect(entries).toHaveLength(20);
    expect(entries[0].name).toBe("21");
    expect(entries.at(-1)?.name).toBe("2");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
