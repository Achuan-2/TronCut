import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { importCamtasia } from "../electron/camtasia";
import { validateProject } from "../shared/model";

describe("Camtasia 导入边界", () => {
  const fixture = {
    width: 1920,
    height: 1080,
    editRate: 705600000,
    videoFormatFrameRate: 30,
    sourceBin: [{ id: 1, src: "media/movie.mp4", rect: [0, 0, 1920, 1080] }],
    timeline: {
      sceneTrack: {
        scenes: [
          {
            csml: {
              tracks: [
                {
                  medias: [
                    {
                      id: 10,
                      _type: "VMFile",
                      src: 1,
                      start: 705600000,
                      duration: 1411200000,
                      mediaStart: 2116800000,
                      mediaDuration: 2822400000,
                      parameters: { translation0: 192, translation1: 108 },
                    },
                    {
                      id: 11,
                      _type: "StitchedMedia",
                      medias: [{}],
                      start: 0,
                      duration: 705600000,
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    },
  };
  it("使用 editRate 转为秒，正确转换坐标方向与源时间", () => {
    const project = importCamtasia(
      fixture,
      path.resolve("sample/project.tscproj"),
    );
    expect(project.clips[0]).toMatchObject({
      start: 1,
      duration: 2,
      sourceIn: 3,
      speed: 2,
      transform: { x: 0.6, y: 0.4 },
    });
    expect(project.clips).toHaveLength(1);
    expect(project.importReport?.some((s) => s.includes("拼接组"))).toBe(true);
    expect(project.camtasiaOriginal).toEqual(fixture);
    expect(() => validateProject(project)).not.toThrow();
  });
  it.skipIf(
    !fs.existsSync(
      path.resolve(
        "references/pycamtasia/tests/fixtures/test_project_a.tscproj",
      ),
    ),
  )("测试来自参考仓库的真实 JSON 结构，不声称效果保真", () => {
    const file = path.resolve(
      "references/pycamtasia/tests/fixtures/test_project_a.tscproj",
    );
    const project = importCamtasia(
      JSON.parse(fs.readFileSync(file, "utf8")),
      file,
    );
    expect(project.tracks.length).toBeGreaterThan(0);
    expect(project.clips.length).toBeGreaterThan(0);
    expect(project.importReport?.length).toBeGreaterThan(1);
    expect(() => validateProject(project)).not.toThrow();
  });
  it("拒绝没有 editRate 的项目", () =>
    expect(() => importCamtasia({ sourceBin: [] }, "x")).toThrow("未识别"));
});
