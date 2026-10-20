# 文本转语音

Windows 默认使用本机 Windows 系统语音，自动优先微软云希；也可切换至 Kokoro/VITS 或 LuxTTS 本地 ONNX 模型。系统音色的安装与调用见文末“Windows 系统语音”。

在“旁白”面板输入文稿，从右上角更多菜单打开“AI 配音设置”弹窗，选择模型、音色和 0.5–2 倍语速。点击“试听音色”播放独立示例，试听不会加入时间线或媒体库；更换音色、语速或关闭弹窗时停止播放并清理临时音频。完成设置后，在面板点击“生成音频”将正式配音加入时间线。更多菜单也可读取选中的文本或字幕，原来的读取配音参数、模型目录、设备和下载按钮已从界面移除。Kokoro 支持中英文混读；VITS 仅支持中文。生成音频统一为 48 kHz、单声道、PCM16 WAV，语速仅在最终 FFmpeg 转换时应用一次。

Kokoro/VITS 通过 sherpa-onnx 调用，LuxTTS 通过 `luxtts-onnx` 与 ONNX Runtime 调用，均使用 CPU 运行环境，无需 PyTorch 或 CUDA。字幕与配音共用 `workers/onnx/.venv/` 下的 Python 3.12 环境，`uv.lock` 锁定依赖。应用数据目录的 `models/onnx/` 保存下载模型；生成记录保留实际模型目录、精度、采样率、加载和推理耗时。

选择“LuxTTS · 声音克隆 ONNX”后，可导入 3–30 秒的参考音频，也可在弹窗直接录制参考声音。参考录音使用所选麦克风，最多 30 秒，不加入时间线；可先试听原声。填写音色名称和参考音频中说出的文字，也可点击“自动识别参考文字”，由 SenseVoice 在本地识别后校对。点击“克隆并保存音色”生成声音特征，之后在“配音音色”中直接选择，供试听或正式配音使用；关闭弹窗及重启应用后仍可读取。

音色库位于应用数据目录的 `cloned-voices/<音色 ID>/`，包含 `voice.json`、独立的 `reference.wav` 和不含 pickle 的 `prompt.npz`。导入文件保持原样，录音和导入引用在弹窗结束后清理；音色持有自己的音频副本。音色创建失败或取消不发布半成品。删除音色前需在界面确认，删除后已生成、已归档的项目音频仍可播放；重新生成则需要音色仍存在。音色库属于本机，不随项目自动迁移。

LuxTTS 使用官方仓库列出的 [luxtts-onnx 社区实现](https://github.com/ningyos/luxtts-onnx)，固定源码提交 `d29f673417d3bd8f82b8a2dda0131eb3eb6078e2`。从 [YatharthS/LuxTTS](https://huggingface.co/YatharthS/LuxTTS) 下载 `text_encoder.onnx`、`fm_decoder.onnx` 和 `tokens.txt`，从 [ProgCat/luxtts-onnx](https://huggingface.co/ProgCat/luxtts-onnx) 下载 `vocos.onnx`，版本与 SHA256 均固定，总计约 541 MiB。模型仅从 TronCut 自己的缓存或显式目录加载；不调用依赖库的隐式 Hugging Face 下载流程。声音特征另有最多 16 项内存缓存。推理使用四步采样，输出 48 kHz；对上游内部的 1.3 倍时长因子做补偿，避免固定参考段也被压缩后截短生成句子，用户语速仍仅由 FFmpeg 应用一次。

真实验证命令：`node scripts/verify-lux-tts.mjs`。设置 `TRONCUT_LUX_TEST_USER_DATA` 可使用指定的 TronCut 缓存；脚本生成独立参考音频、克隆和保存音色、验证连续合成命中缓存、关闭进程后重新读取音色，并检查删除音色后项目内的归档音频仍存在。2026-10-15 Windows CPU 验证结果在 `test-output/lux-tts/1792063347167/result.json`：测试句“你好，这是保存音色后的克隆配音。”生成原始时长 4.128 秒，以 1.25 倍语速转换后约 3.30 秒，本地 SenseVoice 回读全文一致，两次合成均命中内存模型。该样本验证内容完整性和调用流程，不代表克隆相似度评测或所有参考声音的质量。

`node scripts/smoke-lux-tts.mjs` 使用已有模型缓存和 `TRONCUT_LUX_TEST_AUDIO` 指定的测试 WAV，通过 Chromium 虚拟麦克风验证导入、录音、参考文字识别、音色保存/删除、试听和配音；临时测试音色会清理。真实麦克风设备与不同录音环境仍由用户实际试听。

本地 ONNX 模型仅从 TronCut 自己的缓存读取；缺少时自动下载官方完整模型包。CLI 仍可用 `modelDir` 指定完整模型文件夹，不会自动检查其他应用目录。Kokoro 需要 `model.int8.onnx`、`voices.bin`、`tokens.txt`、中英文词典、`espeak-ng-data/` 和中文规范化 FST；VITS 需要 `model.onnx`、`tokens.txt`、`lexicon.txt` 与规范化 FST。指定目录不完整时直接提示缺失文件，应用不会修改该目录或自动替换成其他模型。

配音和字幕识别均在首次使用时自动准备所需模型，不在弹窗中显示模型目录或下载按钮。用户在“语音转文本”弹窗中选择 Qwen3-ASR 或 SenseVoiceSmall 后直接识别整个时间线，无需选中片段。TronCut 自动复用自己的缓存，缺少识别模型或 Silero VAD 时自动下载并显示进度，完整模型不会重复下载。Qwen3-ASR 默认使用 0.6B INT8 模型，在 TronCut 自己的 `models/onnx/qwen3-asr-0.6b/` 目录运行。

CLI 的 `offline:true` 同时禁止 uv 与模型下载；环境或模型不完整时明确报错。下载与生成均可通过任务栏取消，生成失败或取消会清理本次配音输出。文稿与音频在本地处理。

长文稿按标点和长度分块，每块不超过 100 个字符，逐块写入 WAV。字幕、TTS 试听与正式配音共用常驻 Python 进程；同一模型首次加载后留在内存，更换音色、文稿和语速不重新加载。缓存最多保留四个最近使用的模型配置，超过上限时淘汰最久未使用项。模型目录、必需文件的大小或修改时间变化会触发重新加载；SenseVoice 的识别语言也参与缓存键。Silero VAD 单独保留一个实例，每次识别前重置状态和时间。任务串行执行，普通任务失败保留进程，取消活动推理则结束进程并在下次请求重建；取消排队任务不影响当前推理。应用退出会释放缓存，独立 CLI 命令之间不共享内存。运行记录中的 `modelCached` 表示缓存命中，命中时 `loadSeconds` 为零，任务栏显示“复用已加载的”模型。

生成结果可以试听，离开面板停止试听，返回时保留文稿和参数。保存项目会归档 WAV，`narration` 保留模型、音色、目录、语速和离线选项；已经生成的配音可在没有模型环境的电脑上继续播放和编辑。

旧 Kokoro、Qwen3-TTS 与 IndexTTS 项目仍可打开、播放已有音频。新配音从设置弹窗选择当前支持的模型和音色；声音克隆使用 LuxTTS，不恢复旧模型的语气指令或读取片段配音参数按钮。

开发验证：

```powershell
uv sync --project workers/onnx --frozen
uv run --project workers/onnx --frozen python -m unittest discover -s workers/onnx/tests -v
pnpm exec vitest run tests/asr.test.ts tests/tts.test.ts tests/onnx.test.ts
node scripts/verify-onnx.mjs
```

真实验证脚本支持 `TRONCUT_TEST_KOKORO_DIR`、`TRONCUT_TEST_SENSEVOICE_DIR` 和 `TRONCUT_TEST_QWEN3_ASR_DIR` 指定模型目录；默认从 TronCut 测试缓存下载模型。结果写入 `test-output/onnx-integration/result.json`，涵盖配音、一次语速转换、字幕、项目保存重开和离线生成。

`node scripts/verify-onnx-cache.mjs` 额外验证首次/重复试听、更换音色、正式配音、两种 ASR 的重复识别及 VAD 时间重置，并记录实际耗时与缓存命中。默认使用独立验证缓存，设置 `TRONCUT_CACHE_TEST_USER_DATA` 可明确使用已有 TronCut 缓存；需要已经准备好的 CPU 环境、Kokoro、两种 ASR 和 VAD，验证期间不下载。`TRONCUT_CACHE_TEST_AUDIO` 可指定识别样本，默认使用 `test-output/sensevoice-zh.wav`。结果位于 `test-output/onnx-cache/<时间戳>/result.json`。

2026-10-15 Windows 实测：Kokoro 首次试听 16.51 秒，重复试听 12.34 秒，其中模型加载由 2.83 秒降为零；更换音色及正式配音也命中同一模型缓存。对同一中文短样本，Qwen3-ASR 首次/重复调用为 7.59/1.33 秒，SenseVoice 为 2.82/0.36 秒，重复识别的字幕文字和时间戳一致；识别后再配音仍命中 TTS 缓存。证据位于 `test-output/onnx-cache/1792061843904/result.json`。这些是短样本服务调用耗时，TTS 音频仍需实际合成，不代表任意文稿、机器或长录音的固定倍率。

Qwen3-ASR CUDA 识别已移除。退出应用后，可清理应用数据目录的 `workers/onnx/.venv-cuda/`、旧 `qwen_gpu.py` 和 `models/onnx/qwen3-asr-0.6b-cuda/`。保留 `workers/onnx/.venv/` 可复用当前 CPU 环境；删除整个 `workers/` 不会删除项目和 `models/` 中的模型，但下次使用本地语音时需要重新准备运行环境，离线时可能无法完成。

设置 `TRONCUT_TEST_DOWNLOAD=1` 可额外验证 VITS 的真实下载、完整解压与缓存离线推理；`TRONCUT_TEST_DOWNLOAD_ONLY=1` 只运行此项。`node scripts/smoke-onnx-ui.mjs` 使用上述 Kokoro/SenseVoice 目录设置与已准备好的验证环境，检查实际 Electron 配音、试听、字幕及保存。

模型与配置参考 [sherpa-onnx 官方 Python 配音示例](https://github.com/k2-fsa/sherpa-onnx/blob/master/python-api-examples/offline-tts.py)；历史 IndexTTS 说明见 [INDEXTTS.md](INDEXTTS.md)。

本次在 Windows 完成 Kokoro/VITS 真实 CPU 合成、SenseVoiceSmall/Paraformer 真实转录、中文模型路径、VITS 官方模型包下载解压、缓存离线合成及项目保存重开验证。专项 Electron 流程通过模型准备按钮、配音加入时间线、试听与离开面板停止、参数保留、识别语言切换、字幕生成及项目保存，结果位于 `test-output/onnx-ui/`。类型检查、构建、10 项语音服务测试、8 项 Python 测试及打包资源检查通过；通用 `scripts/smoke.mjs` 在“组合”步骤超时，未作为本次完整编辑回归通过的证据。

## Windows 系统语音

Windows 桌面版配音默认选择“Windows 系统语音 · 本机音色”，自动优先使用本机注册的微软云希。每次打开设置弹窗时，从 `System.Speech` 重新读取已安装音色。无须 Python、ONNX 或下载模型；现有 Kokoro/VITS 仍可切换使用。名称带 `Online` 或注册 ID 以 `Edge-` 开头的音色不会出现在该列表中。通过 Windows 接口调用的自定义语音提供程序可能有自己的联网行为，TronCut 不会另接微软在线 TTS。

配音输出为 48 kHz 单声道 PCM16 WAV，语速仅在最后转换一次；分段字幕依据实际写入的 PCM 样本边界生成。系统音色 ID、文稿和语速随项目保存，生成失败和取消会清理本次输出。该入口只在 Windows 上提供，其他系统仍默认使用本地模型。

CLI 分段文案可指定 `"engine":"windows-sapi", "voice":"auto", "offline":true`，或把 `voice` 设为本机音色 ID。`auto` 同样优先云希。实际合成与保存重开验证：`node scripts/verify-windows-speech.mjs`，结果位于 `test-output/windows-speech/`。
