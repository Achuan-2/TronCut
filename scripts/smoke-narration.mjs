import { _electron as electron, expect } from "@playwright/test";
import { timelineZoom } from "./timeline-zoom.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

// Use Chromium's fake microphone to verify encoding and saved files without
// recording any sound from the user's physical microphone.
const root = path.resolve(`test-output/narration/run-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const env = {
  ...process.env,
  FRAMECRAFT_SMOKE: "1",
  FRAMECRAFT_USER_DATA:
    process.env.TRONCUT_TEST_PROFILE || path.join(root, "profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
if (process.env.TRONCUT_TEST_VITS_DIR) {
  const destination = path.join(
    env.FRAMECRAFT_USER_DATA,
    "models/onnx/vits-zh-aishell3",
  );
  if (
    path.resolve(process.env.TRONCUT_TEST_VITS_DIR) !==
    path.resolve(destination)
  )
    await fs.cp(process.env.TRONCUT_TEST_VITS_DIR, destination, {
      recursive: true,
    });
}
const app = await electron.launch({
  args: [
    ".",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
  env,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("旁白测试");
  await page.getByRole("button", { name: "添加文本", exact: true }).click();
  await page
    .getByLabel("文本内容", { exact: true })
    .fill("这是可以照读的旁白文稿。");
  await expect(page.locator(".workspace-status")).toHaveCount(0);
  expect((await page.evaluate(() => window.framecraft.capabilities())).ffmpeg).toBe(true);
  const rail = page.locator(".tool-rail");
  await expect(
    rail.getByRole("button", { name: "音频", exact: true }),
  ).toHaveCount(0);
  await expect(
    rail.getByRole("button", { name: "配音", exact: true }),
  ).toHaveCount(0);
  await rail.getByRole("button", { name: "旁白", exact: true }).click();
  await page.getByRole("button", { name: "旁白更多选项", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "读取选中文本", exact: true })
    .click();
  await expect(page.getByLabel("旁白文稿")).toHaveValue(
    "这是可以照读的旁白文稿。",
  );
  await expect(page.getByLabel("录制过程中静音时间轴")).toBeChecked();
  await page.getByRole("button", { name: "旁白更多选项", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "AI 配音设置", exact: true })
    .click();
  await page.getByLabel("配音模型", { exact: true }).selectOption("vits-onnx");
  await page.getByLabel("配音音色", { exact: true }).selectOption("173");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await rail.getByRole("button", { name: "旁白", exact: true }).click();
  await expect(page.getByLabel("旁白文稿")).toHaveValue(
    "这是可以照读的旁白文稿。",
  );
  await page.getByRole("button", { name: "旁白更多选项", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "AI 配音设置", exact: true })
    .click();
  await expect(page.getByLabel("配音音色")).toHaveValue("173");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.locator(".narration-body").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: path.join(root, "narration.png") });

  // Permission rejection must recover the controls and the editor action lock.
  await page.evaluate(() => {
    window.__originalMicrophone = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("测试拒绝授权", "NotAllowedError");
    };
  });
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("无法开始录音");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  // Leaving while microphone permission is pending must discard a late stream.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = (constraints) =>
      new Promise((resolve) => {
        window.__resolveMicrophone = async () => {
          const stream = await window.__originalMicrophone(constraints);
          window.__lastMicrophone = stream;
          resolve(stream);
        };
      });
  });
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof window.__resolveMicrophone))
    .toBe("function");
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await page.evaluate(() => window.__resolveMicrophone());
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeEnabled();
  assert.ok(
    await page.evaluate(() =>
      window.__lastMicrophone
        .getTracks()
        .every((track) => track.readyState === "ended"),
    ),
  );
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(0);
  await rail.getByRole("button", { name: "旁白", exact: true }).click();
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await window.__originalMicrophone(constraints);
      window.__lastMicrophone = stream;
      return stream;
    };
  });
  const zoom = await timelineZoom(page);
  await page.locator(".ruler").click({ position: { x: 2 * zoom, y: 12 } });
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  const stop = page.getByRole("button", { name: /^停止录音/ });
  await expect(stop).toContainText("00:01.", { timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "生成音频", exact: true }),
  ).toBeDisabled();
  await stop.click();
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(1, {
    timeout: 15000,
  });
  await expect(
    page.getByRole("button", { name: "开始录音", exact: true }),
  ).toBeEnabled();
  assert.ok(
    await page.evaluate(() =>
      window.__lastMicrophone
        .getTracks()
        .every((track) => track.readyState === "ended"),
    ),
  );
  await page.getByRole("button", { name: "试听音频", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止试听", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止试听", exact: true }).click();

  // Switching tabs saves the active take and releases its microphone.
  await page.locator(".ruler").click({ position: { x: 2 * zoom, y: 12 } });
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await expect(page.locator(".canvas-scene audio")).toHaveCount(1);
  assert.ok(
    await page.locator(".canvas-scene audio").evaluate((audio) => audio.muted),
  );
  await expect(stop).toContainText("00:01.");
  await page.getByRole("button", { name: "媒体", exact: true }).click();
  await expect(page.locator(".timeline-clip.audio")).toHaveCount(2, {
    timeout: 15000,
  });
  assert.ok(
    await page.evaluate(() =>
      window.__lastMicrophone
        .getTracks()
        .every((track) => track.readyState === "ended"),
    ),
  );
  await rail.getByRole("button", { name: "旁白", exact: true }).click();
  await page.locator(".ruler").click({ position: { x: 2 * zoom, y: 12 } });
  await expect
    .poll(() =>
      page
        .locator(".canvas-scene audio")
        .evaluateAll((items) => items.every((audio) => !audio.muted)),
    )
    .toBe(true);
  await expect(page.getByLabel("旁白文稿")).toHaveValue(
    "这是可以照读的旁白文稿。",
  );

  if (process.env.TRONCUT_TEST_VITS_DIR) {
    await page.getByRole("button", { name: "生成音频", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已生成", {
      timeout: 180000,
    });
    await expect(page.locator(".timeline-clip.audio")).toHaveCount(3);
  }

  await app.evaluate(({ dialog }, destination) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [destination],
    });
  }, root);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("项目已保存", {
    timeout: 20000,
  });
  const projectFile = path.join(root, "旁白测试/旁白测试.troncut");
  const project = JSON.parse(await fs.readFile(projectFile, "utf8"));
  const recordings = project.assets.filter(
    (asset) => asset.kind === "audio" && !asset.narration,
  );
  assert.equal(recordings.length, 2);
  for (const asset of recordings) {
    assert.ok(
      asset.hasAudio && asset.duration >= 0.5,
      "录音应包含有效音频和持续时间",
    );
    assert.ok(
      (await fs.stat(path.resolve(path.dirname(projectFile), asset.path)))
        .size > 1000,
    );
  }
  const firstClip = project.clips.find(
    (clip) => clip.assetId === recordings[0].id,
  );
  assert.equal(firstClip.start, 2, "录音应插入开始录制时的播放头位置");
  assert.ok(
    project.tracks.every((track) => !track.muted),
    "静音录制不应修改项目轨道的静音状态",
  );
  if (process.env.TRONCUT_TEST_VITS_DIR) {
    const speech = project.assets.find((asset) => asset.narration);
    assert.equal(speech.narration.engine, "vits-onnx");
    assert.equal(speech.narration.text, "这是可以照读的旁白文稿。");
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(root, "result.json"),
    JSON.stringify(
      {
        projectFile,
        recordings: recordings.length,
        realTts: !!process.env.TRONCUT_TEST_VITS_DIR,
        rendererErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(`旁白录音、权限恢复、切换保存、文稿保留与项目归档通过：${root}`);
} finally {
  await app.close();
}
