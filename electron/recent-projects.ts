import fs from "node:fs/promises";
import path from "node:path";
import {
  recentProjectSchema,
  type RecentProject,
} from "../shared/recent-projects";
import { projectDuration, type Project } from "../shared/model";

// Serialize writes so opening/saving two projects quickly cannot lose history.
export class RecentProjects {
  private queue: Promise<void> = Promise.resolve();
  constructor(private file: string) {}
  private async read(): Promise<RecentProject[]> {
    try {
      const value: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (!Array.isArray(value)) return [];
      return value
        .flatMap((item) => {
          const parsed = recentProjectSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        })
        .slice(0, 20);
    } catch {
      return [];
    }
  }
  async list(): Promise<RecentProject[]> {
    await this.queue;
    return Promise.all(
      (await this.read()).map(async (entry) => ({
        ...entry,
        missing: !(await fs.access(entry.file).then(
          () => true,
          () => false,
        )),
      })),
    );
  }
  async remember(project: Project, file: string, thumbnail?: string) {
    const operation = this.queue.then(async () => {
      const stat = await fs.stat(file);
      const entries = await this.read();
      const absolute = path.resolve(file);
      const same = (entry: RecentProject) =>
        process.platform === "win32"
          ? path.resolve(entry.file).toLowerCase() === absolute.toLowerCase()
          : path.resolve(entry.file) === absolute;
      const previous = entries.find(same);
      const entry: RecentProject = {
        file: absolute,
        name: project.name,
        openedAt: Date.now(),
        modifiedAt: stat.mtimeMs,
        duration: projectDuration(project),
        bytes: stat.size,
        thumbnail: thumbnail ?? previous?.thumbnail,
      };
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(
        `${this.file}.tmp`,
        JSON.stringify(
          [entry, ...entries.filter((item) => !same(item))].slice(0, 20),
        ),
      );
      await fs.rename(`${this.file}.tmp`, this.file);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
