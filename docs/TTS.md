# 本地 ONNX 文本转语音

在“配音”面板输入文稿，或选中文本/字幕片段后点击“读取选中文本”。Kokoro v1.1 提供 103 个中英文音色，VITS AIShell3 提供 174 个中文说话人；选择音色与 0.5–2 倍语速后生成，结果作为音频素材加入时间线。Kokoro 支持中英文混读；VITS 仅支持中文。生成音频统一为 48 kHz、单声道、PCM16 WAV，语速仅在最终 FFmpeg 转换时应用一次。

两种模型均通过 sherpa-onnx 调用，当前提供 CPU 运行环境，无需 PyTorch 或 CUDA。字幕与配音共用 `workers/onnx/` 下的 Python 3.12 环境，`uv.lock` 锁定 `sherpa-onnx` 和配套 `sherpa-onnx-core` 原生库。应用数据目录的 `models/onnx/` 保存下载模型；生成记录保留实际模型目录、精度、采样率、加载和推理耗时。

“配音模型目录”留空时，仅检查 TronCut 自己的模型缓存；缺少模型时下载官方完整模型包。也可以手动指定完整模型文件夹，不会自动检查其他应用目录。Kokoro 需要 `model.int8.onnx`、`voices.bin`、`tokens.txt`、中英文词典、`espeak-ng-data/` 和中文规范化 FST；VITS 需要 `model.onnx`、`tokens.txt`、`lexicon.txt` 与规范化 FST。指定目录不完整时直接提示缺失文件，应用不会修改该目录或自动替换成其他模型。

配音面板仍可单独准备配音模型。字幕识别不再显示下载按钮或模型目录：用户在“语音转文本”弹窗中选择 Qwen3-ASR 或 SenseVoiceSmall 后直接识别整个时间线，无需选中片段。TronCut 自动复用自己的缓存，缺少识别模型或 Silero VAD 时自动下载并显示进度，完整模型不会重复下载。Qwen3-ASR 默认使用 0.6B INT8 模型，在 TronCut 自己的 `models/onnx/qwen3-asr-0.6b/` 目录运行。

勾选“仅使用已下载的依赖和模型”后，生成流程同时禁止 uv 与模型下载；环境或模型不完整时明确报错。主动点击下载按钮仍会联网准备所选模型。下载与生成均可通过任务栏取消，生成失败或取消会清理本次配音输出。文稿与音频在本地处理。

长文稿按标点和长度分块，每块不超过 100 个字符，逐块写入 WAV。当前每次任务重新加载模型，尚无常驻推理。生成结果可以试听，离开面板停止试听，返回时保留文稿和参数。保存工程会归档 WAV，`narration` 保留模型、音色、目录、语速和离线选项；已经生成的配音可在没有模型环境的电脑上继续播放和编辑。

旧 Kokoro、Qwen3-TTS 与 IndexTTS 工程仍可打开、播放和读取配音参数；重新生成会切换到 Kokoro ONNX 并提示重新选择音色。新流程不提供旧模型的语气指令或参考声音克隆。

开发验证：

```powershell
uv sync --project workers/onnx --frozen
uv run --project workers/onnx --frozen python -m unittest discover -s workers/onnx/tests -v
pnpm exec vitest run tests/asr.test.ts tests/tts.test.ts tests/onnx.test.ts
node scripts/verify-onnx.mjs
```

真实验证脚本支持 `TRONCUT_TEST_KOKORO_DIR`、`TRONCUT_TEST_SENSEVOICE_DIR` 和 `TRONCUT_TEST_QWEN3_ASR_DIR` 指定模型目录；默认从 TronCut 测试缓存下载模型。结果写入 `test-output/onnx-integration/result.json`，涵盖配音、一次语速转换、字幕、工程保存重开和离线生成。

设置 `TRONCUT_TEST_DOWNLOAD=1` 可额外验证 VITS 的真实下载、完整解压与缓存离线推理；`TRONCUT_TEST_DOWNLOAD_ONLY=1` 只运行此项。`node scripts/smoke-onnx-ui.mjs` 使用上述 Kokoro/SenseVoice 目录设置与已准备好的验证环境，检查实际 Electron 配音、试听、字幕及保存。

模型与配置参考 [sherpa-onnx 官方 Python 配音示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/offline-tts.py)；历史 IndexTTS 说明见 [INDEXTTS.md](INDEXTTS.md)。

本次在 Windows 完成 Kokoro/VITS 真实 CPU 合成、SenseVoiceSmall/Paraformer 真实转录、中文模型路径、VITS 官方模型包下载解压、缓存离线合成及工程保存重开验证。专项 Electron 流程通过模型准备按钮、配音加入时间线、试听与离开面板停止、参数保留、识别语言切换、字幕生成及工程保存，结果位于 `test-output/onnx-ui/`。类型检查、构建、10 项语音服务测试、8 项 Python 测试及打包资源检查通过；通用 `scripts/smoke.mjs` 在“组合”步骤超时，未作为本次完整编辑回归通过的证据。
