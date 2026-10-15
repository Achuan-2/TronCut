# Codex 调用 TronCut CLI

CLI 可以创建和编辑工程、剪辑视频、生成字幕、按文案配音、添加背景音乐及导出 MP4，全程无需打开编辑窗口。生成的 `.troncut` 工程包含可编辑的视频、配音和字幕图层，可以继续在软件界面中调整。v0.4.1 已包含 CLI。

无声视频采用 Codex 与 CLI 配合的流程：CLI 抽取带时间的画面，Codex 查看画面并写分段文案，再调用 CLI 生成本地配音、按实际音频时间添加字幕和导出。文案由调用者生成，不需要另配视觉 AI API。

## 启动与结果

源码环境先执行 `pnpm build`，然后在仓库目录调用：

```powershell
pnpm --silent cli help
pnpm --silent cli inspect --input 'D:/Videos/input.mp4'
```

新构建的 Windows 安装包和免安装目录提供 `troncut.cmd`，与 `TronCut.exe` 放在同一目录：

```powershell
& 'D:/Apps/TronCut/troncut.cmd' help
& 'D:/Apps/TronCut/troncut.cmd' inspect --input 'D:/Videos/input.mp4'
```

也支持 `TronCut.exe --cli <命令>`。程序每次在 stdout 返回一个 JSON，进度以 JSONL 写入 stderr；`ok:false` 表示失败，退出码为 1，取消为 130。`--result result.json` 可额外保存结果，方便调用者读取。已有输出需要显式使用 `--overwrite`，输出不能覆盖源素材或输入配置文件。

## 剪辑、转录、导出

创建 `plan.json`。以下路径以该 JSON 文件所在目录为基准，时间单位为秒：

```json
{
  "version": 1,
  "name": "教程剪辑",
  "cuts": [
    { "input": "input.mp4", "sourceIn": 0, "sourceOut": 10 },
    { "input": "input.mp4", "sourceIn": 30, "sourceOut": 50, "speed": 2 }
  ],
  "transcribe": { "engine": "sensevoice", "language": "zh" },
  "output": {
    "project": "output/project.troncut",
    "video": "output/video.mp4",
    "srt": "output/captions.srt"
  }
}
```

```powershell
pnpm --silent cli run --plan plan.json
```

两段源区间会依次排列，第二段 20 秒素材以 2 倍速播放，占用 10 秒。字幕先按真实源时间识别，再转换为裁剪、变速后的时间线位置。`cuts` 支持多个输入文件；显式填写 `start` 可指定片段的时间线位置，同一源轨道不接受重叠区间。

新建工程默认尝试转录，`transcribe:false` 可仅剪辑和导出。没有音频或未识别到语音时，`run` 返回 `status:"needs_script"`，保存工程和抽帧资料，等待 Codex 补充文案；此时尚未生成最终视频。有音频的转录和所有请求的输出完成后返回 `status:"complete"`。

## 无声视频：看画面、写文案、配音与字幕

Codex 先检查素材，再抽帧。抽帧既可以使用原素材，也可以使用已经剪辑的工程：

```powershell
pnpm --silent cli frames --input input.mp4 --output storyboard --interval 2 --max-frames 40
# 已剪辑工程的画面时间以编辑后的时间线为准
pnpm --silent cli frames --project output/project.troncut --output storyboard-edited
```

输出目录包含 `frames.json`、JPEG 画面、`script-guide.md` 和 `script-template.json`。Codex 读取索引、查看图片，并根据实际画面填写文案。最多抽取 `max-frames` 张；较长视频会均匀取样，索引中的时间是画面在当前工程中的真实位置。

分段文案示例 `script.json`：

```json
{
  "engine": "kokoro-onnx",
  "voice": "10",
  "segments": [
    { "start": 0, "end": 5, "text": "这里填写根据对应画面写出的简短解说。" },
    { "start": 5, "end": 10, "text": "这里填写下一段操作的说明。" }
  ]
}
```

段落必须按时间排序、不重叠，结束时间不超过工程时长。配音不足一个时间段时保留余下间隔，超长时最多加速至 `maxFitSpeed`（默认 2 倍），再长则提示缩短文稿或延长画面。默认静音原有音视频片段，`muteOriginal:false` 可保留原声。

```powershell
pnpm --silent cli narrate --project output/project.troncut --script script.json --output narrated/project.troncut --srt narrated/captions.srt
pnpm --silent cli export --project narrated/project.troncut --output narrated/video.mp4
```

配音字幕采用 TTS 每个实际生成分段的采样边界，保留原文，并按配音语速、时间段加速比例转换到时间线。`captionChars` 默认 22，控制朗读及字幕分段长度。字幕字号默认随画布高度调整。

也可以把整个脚本放进剪辑计划的 `narration` 字段，由 `run --plan final-plan.json` 一次完成剪辑、配音、字幕、工程保存和视频导出。`narration` 与自动转录同时配置时，使用文案配音生成字幕。调用者可在 `captions` 中指定 `y` 和 `fontSize`。

## 编辑已有工程

`inspect --project` 返回片段 ID、素材、轨道、时间和关键帧。调用者据此写 `edits.json`：

```json
[
  { "type": "trim", "clipId": "片段ID", "sourceIn": 2, "sourceOut": 8 },
  { "type": "speed", "clipId": "片段ID", "speed": 1.5 },
  { "type": "move", "clipId": "片段ID", "start": 0 },
  { "type": "text", "text": "教程标题", "start": 0, "end": 3 },
  { "type": "remove", "clipIds": ["另一个片段ID"], "ripple": true }
]
```

```powershell
pnpm --silent cli edit --project project.troncut --edits edits.json --output edited/project.troncut
```

支持裁剪、变速、移动、音量、删除、波纹删除和添加文字。锁定轨道拒绝编辑；变速会同步重定时关键帧，裁剪保留原动画曲线的时间偏移。剪辑计划也可以用 `project` 代替 `cuts`，配合 `edits` 继续处理既有工程。

背景音乐通过计划的 `music` 数组配置，默认音量为 50%：

```json
"music": [{ "input": "music.mp3", "start": 0, "volume": 0.5 }]
```

## 单独转录与模型准备

```powershell
pnpm --silent cli transcribe --project project.troncut --output captioned/project.troncut --srt captioned/captions.srt --engine sensevoice --language zh
pnpm --silent cli transcribe --project project.troncut --output gpu/project.troncut --engine qwen3-asr --device cuda
pnpm --silent cli models --engine sensevoice
pnpm --silent cli models --engine vits-onnx
```

识别支持 `qwen3-asr`（默认）、`sensevoice`，配音支持 `kokoro-onnx`、`vits-onnx`。默认识别整个时间线的混音，保留空白、裁剪、变速、音量和音频效果，跳过静音与隐藏轨道，每次生成新的字幕轨道。模型缺失时自动下载，缓存与 GUI 共用。`--offline` 仅使用已有环境和模型；转录可用 `--model-dir` 指定目录，文案配音可在脚本中填写 `modelDir`。`--clips id1,id2` 可显式限制参与混音的片段。

Qwen3-ASR 可通过 `--device cuda` 使用 NVIDIA GPU，首次使用自动准备独立 CUDA 环境与官方 FP16 模型；`cpu` 或默认 `auto` 使用现有 INT8 CPU 模型。计划文件的 `transcribe.device` 接受相同取值。GPU 模式的 `--model-dir` 必须是官方 Transformers 模型目录，不能填写 CPU ONNX 模型目录；SenseVoiceSmall 只支持 CPU。

创建 `--cancel-file` 指定的文件可取消长任务；源码启动器还支持 Ctrl+C，并等待工作进程清理。`--software` 可让 `run` 或 `export` 使用软件编码，默认沿用软件的硬件探测与回退策略。

## 验证

`pnpm exec vitest run tests/cli.test.ts` 验证命令协议、文件保护、剪辑、真实抽帧、无声文案请求与导出。`node scripts/verify-cli.mjs` 使用生成的红蓝无声视频和本地 VITS 模型，验证实际 CLI 的剪辑、抽帧、文案回填、配音、字幕、导出、工程往返和单次 `run` 流程。可通过 `TRONCUT_CLI_TEST_APP` 指定打包后的 `TronCut.exe`，通过 `TRONCUT_CLI_TEST_PROFILE` 指定已准备好模型的测试环境；`TRONCUT_CLI_TEST_ASR_DIR` 可额外验证真实转录。

2026-10-15 完成源码与 Windows 打包版真实流程验证，打包版入口为 `release/cli-verification/win-unpacked/troncut.cmd`，结果位于 `test-output/cli-real/run-1792000199833/`。4 秒红蓝视频生成了两段实际 VITS 配音、两条原文字幕、可编辑工程和 MP4；对导出视频的 SenseVoice 转录也产生了有效字幕。已检查导出画面的字幕与非静音声轨。构建、141 项测试、8 项 Python 测试及打包资源检查通过。
