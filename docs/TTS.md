# 文本转语音

Windows 默认使用本机 Windows 系统语音，自动优先微软云希；也可切换至 Kokoro/VITS 本地 ONNX 模型。系统音色的安装与调用见文末“Windows 系统语音”。

在“旁白”面板输入文稿，从右上角更多菜单打开“AI 配音设置”弹窗，选择模型、音色和 0.5–2 倍语速。点击“试听音色”播放独立示例，试听不会加入时间线或媒体库；更换音色、语速或关闭弹窗时停止播放并清理临时音频。完成设置后，在面板点击“生成音频”将正式配音加入时间线。更多菜单也可读取选中的文本或字幕，原来的读取配音参数、模型目录、设备和下载按钮已从界面移除。Kokoro 支持中英文混读；VITS 仅支持中文。生成音频统一为 48 kHz、单声道、PCM16 WAV，语速仅在最终 FFmpeg 转换时应用一次。

两种配音模型均通过 sherpa-onnx 调用，使用 CPU 运行环境，无需 PyTorch 或 CUDA。字幕与配音共用 `workers/onnx/.venv/` 下的 Python 3.12 环境，`uv.lock` 锁定 `sherpa-onnx` 和配套 `sherpa-onnx-core` 原生库。应用数据目录的 `models/onnx/` 保存下载模型；生成记录保留实际模型目录、精度、采样率、加载和推理耗时。

本地 ONNX 模型仅从 TronCut 自己的缓存读取；缺少时自动下载官方完整模型包。CLI 仍可用 `modelDir` 指定完整模型文件夹，不会自动检查其他应用目录。Kokoro 需要 `model.int8.onnx`、`voices.bin`、`tokens.txt`、中英文词典、`espeak-ng-data/` 和中文规范化 FST；VITS 需要 `model.onnx`、`tokens.txt`、`lexicon.txt` 与规范化 FST。指定目录不完整时直接提示缺失文件，应用不会修改该目录或自动替换成其他模型。

配音和字幕识别均在首次使用时自动准备所需模型，不在弹窗中显示模型目录或下载按钮。用户在“语音转文本”弹窗中选择 Qwen3-ASR 或 SenseVoiceSmall 后直接识别整个时间线，无需选中片段。TronCut 自动复用自己的缓存，缺少识别模型或 Silero VAD 时自动下载并显示进度，完整模型不会重复下载。Qwen3-ASR 默认使用 0.6B INT8 模型，在 TronCut 自己的 `models/onnx/qwen3-asr-0.6b/` 目录运行。

CLI 的 `offline:true` 同时禁止 uv 与模型下载；环境或模型不完整时明确报错。下载与生成均可通过任务栏取消，生成失败或取消会清理本次配音输出。文稿与音频在本地处理。

长文稿按标点和长度分块，每块不超过 100 个字符，逐块写入 WAV。字幕、TTS 试听与正式配音共用常驻 Python 进程；同一模型首次加载后留在内存，更换音色、文稿和语速不重新加载。缓存最多保留四个最近使用的模型配置，超过上限时淘汰最久未使用项。模型目录、必需文件的大小或修改时间变化会触发重新加载；SenseVoice 的识别语言也参与缓存键。Silero VAD 单独保留一个实例，每次识别前重置状态和时间。任务串行执行，普通任务失败保留进程，取消活动推理则结束进程并在下次请求重建；取消排队任务不影响当前推理。应用退出会释放缓存，独立 CLI 命令之间不共享内存。运行记录中的 `modelCached` 表示缓存命中，命中时 `loadSeconds` 为零，任务栏显示“复用已加载的”模型。

生成结果可以试听，离开面板停止试听，返回时保留文稿和参数。保存工程会归档 WAV，`narration` 保留模型、音色、目录、语速和离线选项；已经生成的配音可在没有模型环境的电脑上继续播放和编辑。

旧 Kokoro、Qwen3-TTS 与 IndexTTS 工程仍可打开、播放已有音频。新配音从设置弹窗选择当前支持的模型和音色，不再提供旧模型的语气指令、参考声音克隆或读取片段配音参数按钮。

开发验证：

```powershell
uv sync --project workers/onnx --frozen
uv run --project workers/onnx --frozen python -m unittest discover -s workers/onnx/tests -v
pnpm exec vitest run tests/asr.test.ts tests/tts.test.ts tests/onnx.test.ts
node scripts/verify-onnx.mjs
```

真实验证脚本支持 `TRONCUT_TEST_KOKORO_DIR`、`TRONCUT_TEST_SENSEVOICE_DIR` 和 `TRONCUT_TEST_QWEN3_ASR_DIR` 指定模型目录；默认从 TronCut 测试缓存下载模型。结果写入 `test-output/onnx-integration/result.json`，涵盖配音、一次语速转换、字幕、工程保存重开和离线生成。

`node scripts/verify-onnx-cache.mjs` 额外验证首次/重复试听、更换音色、正式配音、两种 ASR 的重复识别及 VAD 时间重置，并记录实际耗时与缓存命中。默认使用独立验证缓存，设置 `TRONCUT_CACHE_TEST_USER_DATA` 可明确使用已有 TronCut 缓存；需要已经准备好的 CPU 环境、Kokoro、两种 ASR 和 VAD，验证期间不下载。`TRONCUT_CACHE_TEST_AUDIO` 可指定识别样本，默认使用 `test-output/sensevoice-zh.wav`。结果位于 `test-output/onnx-cache/<时间戳>/result.json`。

2026-10-15 Windows 实测：Kokoro 首次试听 16.51 秒，重复试听 12.34 秒，其中模型加载由 2.83 秒降为零；更换音色及正式配音也命中同一模型缓存。对同一中文短样本，Qwen3-ASR 首次/重复调用为 7.59/1.33 秒，SenseVoice 为 2.82/0.36 秒，重复识别的字幕文字和时间戳一致；识别后再配音仍命中 TTS 缓存。证据位于 `test-output/onnx-cache/1792061843904/result.json`。这些是短样本服务调用耗时，TTS 音频仍需实际合成，不代表任意文稿、机器或长录音的固定倍率。

Qwen3-ASR CUDA 识别已移除。退出应用后，可清理应用数据目录的 `workers/onnx/.venv-cuda/`、旧 `qwen_gpu.py` 和 `models/onnx/qwen3-asr-0.6b-cuda/`。保留 `workers/onnx/.venv/` 可复用当前 CPU 环境；删除整个 `workers/` 不会删除工程和 `models/` 中的模型，但下次使用本地语音时需要重新准备运行环境，离线时可能无法完成。

设置 `TRONCUT_TEST_DOWNLOAD=1` 可额外验证 VITS 的真实下载、完整解压与缓存离线推理；`TRONCUT_TEST_DOWNLOAD_ONLY=1` 只运行此项。`node scripts/smoke-onnx-ui.mjs` 使用上述 Kokoro/SenseVoice 目录设置与已准备好的验证环境，检查实际 Electron 配音、试听、字幕及保存。

模型与配置参考 [sherpa-onnx 官方 Python 配音示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/offline-tts.py)；历史 IndexTTS 说明见 [INDEXTTS.md](INDEXTTS.md)。

本次在 Windows 完成 Kokoro/VITS 真实 CPU 合成、SenseVoiceSmall/Paraformer 真实转录、中文模型路径、VITS 官方模型包下载解压、缓存离线合成及工程保存重开验证。专项 Electron 流程通过模型准备按钮、配音加入时间线、试听与离开面板停止、参数保留、识别语言切换、字幕生成及工程保存，结果位于 `test-output/onnx-ui/`。类型检查、构建、10 项语音服务测试、8 项 Python 测试及打包资源检查通过；通用 `scripts/smoke.mjs` 在“组合”步骤超时，未作为本次完整编辑回归通过的证据。

## Windows 系统语音

Windows 桌面版配音默认选择“Windows 系统语音 · 本机音色”，自动优先使用本机注册的微软云希。每次打开设置弹窗时，从 `System.Speech` 重新读取已安装音色。无须 Python、ONNX 或下载模型；现有 Kokoro/VITS 仍可切换使用。名称带 `Online` 或注册 ID 以 `Edge-` 开头的音色不会出现在该列表中。通过 Windows 接口调用的自定义语音提供程序可能有自己的联网行为，TronCut 不会另接微软在线 TTS。

配音输出为 48 kHz 单声道 PCM16 WAV，语速仅在最后转换一次；分段字幕依据实际写入的 PCM 样本边界生成。系统音色 ID、文稿和语速随工程保存，生成失败和取消会清理本次输出。该入口只在 Windows 上提供，其他系统仍默认使用本地模型。

CLI 分段文案可指定 `"engine":"windows-sapi", "voice":"auto", "offline":true`，或把 `voice` 设为本机音色 ID。`auto` 同样优先云希。实际合成与保存重开验证：`node scripts/verify-windows-speech.mjs`，结果位于 `test-output/windows-speech/`。
