# TronCut AI 外部编辑工作流

## 概述

本文档介绍如何使用 TronCut CLI 和外部 AI 工具（如 Claude Opus）来自动化视频制作流程。这个工作流可以：

1. **自动抽帧** - 从视频中提取关键帧
2. **AI 脚本生成** - 使用 AI 模型根据关键帧生成解说脚本
3. **自动配音** - 使用 TTS 将脚本转为配音
4. **自动字幕生成** - 从音频生成字幕
5. **自动视频组织** - 使用 TronCut 组织所有元素并导出

---

## 🔄 完整工作流

```
视频输入
   ↓
[1] CLI 抽帧 → 关键帧 JSON
   ↓
[2] Claude AI 分析 → 生成脚本 JSON
   ↓
[3] CLI 配音 → 音频文件 + 时间码 JSON
   ↓
[4] CLI 转录 → 字幕 JSON
   ↓
[5] 手动编排或自动脚本 → TronCut 工程
   ↓
[6] TronCut 导出 → 最终视频
```

---

## 📋 必要工具

### 系统要求
- Node.js 22+
- Python 3.11+
- FFmpeg 和 FFprobe

### TronCut CLI
```bash
pnpm build
pnpm --silent cli help
```

### AI 模型
- Claude API（用于脚本生成）
- 本地 TTS 模型（Kokoro、VITS、LuxTTS）
- 本地语音识别（Qwen3-ASR、SenseVoice）

---

## 🛠️ 详细步骤

### 步骤 1：抽帧提取关键帧

#### 1.1 创建抽帧计划

文件: `scripts/extract-frames-plan.json`

```json
{
  "type": "extract_frames",
  "input": "input_video.mp4",
  "output": "extracted_frames",
  "settings": {
    "interval": "3s",
    "format": "jpg",
    "quality": 85,
    "includeMetadata": true
  },
  "analysis": {
    "detectSceneChange": true,
    "detectMotion": true,
    "scoreThreshold": 0.7
  }
}
```

#### 1.2 执行抽帧

```bash
pnpm --silent cli run --plan scripts/extract-frames-plan.json
```

#### 1.3 输出示例

```json
{
  "status": "success",
  "frames": [
    {
      "id": "frame_001",
      "timestamp": "00:00:03",
      "path": "extracted_frames/frame_001.jpg",
      "score": 0.95,
      "metadata": {
        "sceneChange": true,
        "motion": "high"
      }
    },
    {
      "id": "frame_002",
      "timestamp": "00:00:06",
      "path": "extracted_frames/frame_002.jpg",
      "score": 0.82,
      "metadata": {
        "sceneChange": false,
        "motion": "medium"
      }
    }
  ],
  "summary": {
    "totalFrames": 47,
    "validFrames": 12,
    "sceneChanges": 8
  }
}
```

---

### 步骤 2：AI 脚本生成

#### 2.1 准备图像数据

将抽取的帧转换为 Base64（用于 AI 分析）：

```bash
# 使用脚本处理
node scripts/prepare-ai-input.js
```

#### 2.2 调用 Claude API

文件: `scripts/generate-script.mjs`

```javascript
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

const client = new Anthropic();

async function generateScript() {
  // 读取抽取的帧信息
  const framesData = JSON.parse(
    fs.readFileSync("extracted_frames/frames.json", "utf-8")
  );

  // 构建提示
  const prompt = `You are a professional video scriptwriter. Analyze the following video frames and generate a clear, engaging script for a tutorial video.

For each frame, provide:
1. Scene description
2. Narration text
3. Recommended on-screen text/captions
4. Suggested effects or animations
5. Duration for this scene

Here are the video frames:

${framesData.frames
  .map(
    (frame) => `
Frame ${frame.id} (at ${frame.timestamp}):
- Description: [Visual analysis of frame]
- Motion level: ${frame.metadata.motion}
- Scene change: ${frame.metadata.sceneChange}
- Image: [reference to frame_${frame.id}.jpg]
`
  )
  .join("\n")}

Generate a structured JSON response with the following format:
{
  "title": "Video Title",
  "scenes": [
    {
      "frameId": "frame_001",
      "timestamp": "00:00:03",
      "narration": "Narration text for this scene...",
      "onScreenText": "Text to display on screen",
      "effects": ["fadeIn", "zoom"],
      "duration": 5,
      "notes": "Additional production notes"
    }
  ]
}`;

  try {
    const response = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    // 解析 AI 响应
    const scriptContent = response.content[0];
    if (scriptContent.type === "text") {
      const script = JSON.parse(scriptContent.text);

      // 保存脚本
      fs.writeFileSync(
        "generated_script.json",
        JSON.stringify(script, null, 2)
      );

      console.log("✅ Script generated successfully!");
      return script;
    }
  } catch (error) {
    console.error("❌ Error generating script:", error);
    throw error;
  }
}

generateScript();
```

#### 2.3 执行脚本生成

```bash
node scripts/generate-script.mjs
```

#### 2.4 输出示例

```json
{
  "title": "TronCut Complete Tutorial",
  "scenes": [
    {
      "frameId": "frame_001",
      "timestamp": "00:00:03",
      "narration": "Welcome to TronCut, a professional video editing tool. Let me show you how to get started.",
      "onScreenText": "Welcome to TronCut",
      "effects": ["fadeIn", "scaleUp"],
      "duration": 5,
      "notes": "Emphasize the ease of use"
    },
    {
      "frameId": "frame_002",
      "timestamp": "00:00:08",
      "narration": "First, you need to import your video files into the media library.",
      "onScreenText": "Import Media",
      "effects": ["fadeIn"],
      "duration": 4,
      "notes": "Show the import dialog"
    }
  ]
}
```

---

### 步骤 3：自动配音生成

#### 3.1 创建 TTS 计划

文件: `scripts/voiceover-plan.json`

```json
{
  "type": "text_to_speech",
  "scenes": [
    {
      "sceneId": "scene_001",
      "text": "Welcome to TronCut, a professional video editing tool. Let me show you how to get started.",
      "voice": "kokoro_english_male",
      "speed": 1.0,
      "pitch": 1.0,
      "timestamp": "00:00:03",
      "duration": 5
    },
    {
      "sceneId": "scene_002",
      "text": "First, you need to import your video files into the media library.",
      "voice": "kokoro_english_male",
      "speed": 1.0,
      "pitch": 1.0,
      "timestamp": "00:00:08",
      "duration": 4
    }
  ],
  "settings": {
    "audioFormat": "wav",
    "sampleRate": 48000,
    "bitDepth": 24
  }
}
```

#### 3.2 执行配音生成

```bash
pnpm --silent cli run --plan scripts/voiceover-plan.json
```

#### 3.3 输出示例

```json
{
  "status": "success",
  "voiceovers": [
    {
      "sceneId": "scene_001",
      "audioFile": "voiceovers/scene_001.wav",
      "duration": 4.8,
      "metadata": {
        "sampleRate": 48000,
        "channels": 2,
        "bitDepth": 24
      }
    }
  ]
}
```

---

### 步骤 4：自动字幕生成

#### 4.1 创建转录计划

文件: `scripts/transcribe-plan.json`

```json
{
  "type": "transcribe",
  "input": "output_video_with_voiceover.mp4",
  "settings": {
    "engine": "qwen3_asr",
    "language": "en-US",
    "model": "medium",
    "timestamps": true,
    "confidence_threshold": 0.7
  }
}
```

#### 4.2 执行转录

```bash
pnpm --silent cli run --plan scripts/transcribe-plan.json
```

#### 4.3 输出示例

```json
{
  "status": "success",
  "transcription": {
    "language": "en-US",
    "duration": 120.5,
    "captions": [
      {
        "id": "caption_001",
        "startTime": 3.0,
        "endTime": 7.8,
        "text": "Welcome to TronCut, a professional video editing tool.",
        "confidence": 0.98
      },
      {
        "id": "caption_002",
        "startTime": 8.0,
        "endTime": 12.0,
        "text": "First, you need to import your video files into the media library.",
        "confidence": 0.97
      }
    ]
  }
}
```

---

### 步骤 5：自动组织到 TronCut 工程

#### 5.1 创建组织脚本

文件: `scripts/organize-to-troncut.mjs`

```javascript
import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";

async function organizeToTronCut() {
  // 读取生成的数据
  const script = JSON.parse(fs.readFileSync("generated_script.json"));
  const transcription = JSON.parse(
    fs.readFileSync("transcription_output.json")
  );

  // 构建 TronCut 工程结构
  const project = {
    version: "0.4.8",
    metadata: {
      title: script.title,
      createdAt: new Date().toISOString(),
      autoGenerated: true,
      source: "ai-workflow",
    },
    timeline: {
      tracks: [
        {
          id: "video_main",
          type: "video",
          name: "Main Video",
          segments: script.scenes.map((scene, idx) => ({
            id: `seg_${idx}`,
            name: scene.narration.substring(0, 50),
            startTime: parseTimeToSeconds(scene.timestamp),
            duration: scene.duration,
            type: "video",
            file: `scenes/scene_${idx}.mp4`,
            effects: scene.effects,
          })),
        },
        {
          id: "text_main",
          type: "text",
          name: "Captions and Text",
          segments: script.scenes.map((scene, idx) => ({
            id: `text_${idx}`,
            startTime: parseTimeToSeconds(scene.timestamp),
            duration: scene.duration,
            content: scene.onScreenText,
            style: "caption_style",
            animation: "fadeIn",
          })),
        },
        {
          id: "audio_voiceover",
          type: "audio",
          name: "Voiceover",
          segments: transcription.captions.map((caption, idx) => ({
            id: `audio_${idx}`,
            startTime: caption.startTime,
            duration: caption.endTime - caption.startTime,
            type: "audio",
            file: `voiceovers/voiceover_${idx}.wav`,
            volume: 1.0,
          })),
        },
      ],
    },
    settings: {
      resolution: "1920x1080",
      fps: 30,
      autoKeyframe: true,
    },
  };

  // 保存工程文件
  fs.writeFileSync(
    "generated_project.troncut",
    JSON.stringify(project, null, 2)
  );

  console.log("✅ TronCut project generated!");
  return project;
}

function parseTimeToSeconds(timeStr) {
  const [hours, minutes, seconds] = timeStr.split(":").map(Number);
  return hours * 3600 + minutes * 60 + seconds;
}

organizeToTronCut();
```

#### 5.2 执行组织脚本

```bash
node scripts/organize-to-troncut.mjs
```

---

### 步骤 6：最终导出

#### 6.1 创建导出计划

文件: `scripts/export-plan.json`

```json
{
  "type": "export",
  "projectFile": "generated_project.troncut",
  "output": {
    "format": "mp4",
    "codec": "h264",
    "resolution": "1920x1080",
    "fps": 30,
    "bitrate": "10M",
    "audioCodec": "aac",
    "audioSampleRate": 48000,
    "outputPath": "export/final_video.mp4"
  },
  "settings": {
    "useHardwareAcceleration": true,
    "multipass": false
  }
}
```

#### 6.2 执行导出

```bash
pnpm --silent cli run --plan scripts/export-plan.json
```

---

## 📊 完整自动化脚本

文件: `scripts/auto-create-video.mjs`

```javascript
#!/usr/bin/env node

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data;
    });

    proc.stderr.on("data", (data) => {
      stderr += data;
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} failed: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function main() {
  try {
    console.log("🎬 Starting AI-powered video creation workflow...\n");

    // 步骤 1: 抽帧
    console.log("Step 1/6: Extracting frames...");
    await runCommand("pnpm", [
      "--silent",
      "cli",
      "run",
      "--plan",
      "scripts/extract-frames-plan.json",
    ]);
    console.log("✅ Frames extracted\n");

    // 步骤 2: AI 生成脚本
    console.log("Step 2/6: Generating script with AI...");
    // (省略详细代码，见前面的示例)
    console.log("✅ Script generated\n");

    // 步骤 3: 生成配音
    console.log("Step 3/6: Generating voiceover...");
    await runCommand("pnpm", [
      "--silent",
      "cli",
      "run",
      "--plan",
      "scripts/voiceover-plan.json",
    ]);
    console.log("✅ Voiceover generated\n");

    // 步骤 4: 生成字幕
    console.log("Step 4/6: Generating captions...");
    await runCommand("pnpm", [
      "--silent",
      "cli",
      "run",
      "--plan",
      "scripts/transcribe-plan.json",
    ]);
    console.log("✅ Captions generated\n");

    // 步骤 5: 组织工程
    console.log("Step 5/6: Organizing TronCut project...");
    await runCommand("node", ["scripts/organize-to-troncut.mjs"]);
    console.log("✅ Project organized\n");

    // 步骤 6: 导出
    console.log("Step 6/6: Exporting final video...");
    await runCommand("pnpm", [
      "--silent",
      "cli",
      "run",
      "--plan",
      "scripts/export-plan.json",
    ]);
    console.log("✅ Video exported\n");

    console.log("🎉 Video creation complete!");
    console.log("📁 Output: export/final_video.mp4");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

main();
```

#### 使用方式

```bash
chmod +x scripts/auto-create-video.mjs
node scripts/auto-create-video.mjs
```

---

## 🔒 环境变量配置

创建 `.env` 文件：

```bash
# Claude API
ANTHROPIC_API_KEY=sk-ant-...

# TronCut 设置
TRONCUT_CLI_PATH=./node_modules/.bin/troncut
TRONCUT_TEMP_DIR=./temp
TRONCUT_OUTPUT_DIR=./export

# 模型选择
TTS_ENGINE=kokoro
ASR_ENGINE=qwen3_asr

# 优化选项
USE_HARDWARE_ACCELERATION=true
MAX_PARALLEL_JOBS=4
```

---

## 💡 高级技巧

### 1. 条件渲染

根据关键帧特征添加不同的效果：

```javascript
const effects = [];
if (frame.metadata.sceneChange) {
  effects.push("crossfade");
}
if (frame.metadata.motion > 0.7) {
  effects.push("motionBlur");
}
```

### 2. 动态字幕位置

根据视频内容自动调整字幕位置：

```javascript
const subtitlePosition = detectedText ? "top" : "bottom";
```

### 3. 智能配速

根据脚本长度自动调整视频速度：

```javascript
const speed = scriptLength > 1000 ? 1.2 : 1.0;
```

### 4. 质量验证

在导出前自动验证：

```javascript
const qualityCheck = async () => {
  const result = await runCommand("ffprobe", ["-show_format", projectFile]);
  // 验证分辨率、帧率等
};
```

---

## 🚀 扩展与集成

### 与 GitHub Actions 集成

创建 `.github/workflows/auto-video.yml`：

```yaml
name: Auto-generate Promo Video

on:
  workflow_dispatch:
    inputs:
      video_type:
        description: "Video type"
        required: true
        default: "promo"

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "22"
      - run: pnpm install
      - run: node scripts/auto-create-video.mjs
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - uses: actions/upload-artifact@v3
        with:
          name: generated-video
          path: export/final_video.mp4
```

---

## 📞 故障排查

| 问题 | 解决方案 |
|------|---------|
| API 超时 | 增加 `max_tokens` 或分割成更小的任务 |
| 音频不同步 | 检查时间戳格式和转换 |
| 导出失败 | 验证所有输入文件路径正确 |
| 内存不足 | 降低视频分辨率或帧率 |

---

## 📚 相关资源

- [TronCut CLI 文档](CLI.md)
- [Claude API 文档](https://docs.anthropic.com)
- [FFmpeg 文档](https://ffmpeg.org/documentation.html)
