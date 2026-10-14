# 本地文本转语音

配音功能从 v0.3.0 起在“配音”面板中提供。输入文稿，或选中文本/字幕片段后点击“读取选中文本”；生成结果会作为音频素材加入开始生成时播放头所在的位置。已有轨道在该时间被占用、隐藏或锁定时，会选择另一条可用轨道，没有可用轨道时再新建。

IndexTTS 2.5 使用参考音频复刻音色，有独立 Python 3.11 环境和模型缓存，配置见 [IndexTTS 说明](INDEXTTS.md)。

Kokoro 中文版提供中文女声和男声，适合 CPU 配音。Qwen3-TTS 0.6B 和 1.7B 提供中文及英语配音；1.7B 还支持自然语言语气指令。语速为 0.5–2 倍，生成后统一转换为 48 kHz、单声道、PCM 16-bit WAV，可继续剪辑、应用声音效果并导出。

首次运行通过 uv 下载 Python 3.12、对应依赖及 Hugging Face 模型，不向云端提交文稿。CPU 与 CUDA、Kokoro 与 Qwen 的环境分开存放；CPU 使用 CPU 版 PyTorch，CUDA 显式选择 NVIDIA 版。自动模式默认准备 CPU 环境，Mac 的 MPS 需要手动选择，尚待真机验证。

完成同一模型、设备、音色的首次生成后，可勾选“仅使用已下载的依赖和模型”。离线模式同时约束 uv 和 Hugging Face，缺少缓存时会报错，不会联网补齐。切换模型或音色可能需要额外下载。Qwen 还需准备其语音 tokenizer；仅缓存主模型不代表已具备完整离线环境。

生成时显示进度，可通过全局任务栏取消；失败或取消会清理本次生成目录。模型加载阶段的百分比不会反映实际下载字节数。当前每次生成重新加载模型，尚未实现常驻推理，长文稿会按句子、段落与长度分段生成。

Kokoro 在文字转音素后还会检查 510 音素上限，超过时继续细分，避免上游 pipeline 直接截断中文或数字展开后的音素。单字符展开过长或无法产生音素时明确报错。

生成结果可在面板试听，离开面板会停止试听，返回时保留文稿及参数。保存工程会收集 WAV 到 `media/`，文稿、模型选择、音色、设备、语速和语气指令记录在素材的 `narration` 字段中；选中配音片段后可“读取配音参数”并生成新素材。离线打开和播放已保存工程不需要模型或 Python 环境。

开发环境的依赖准备和纯逻辑测试：

```sh
uv sync --project workers/tts --python 3.12 --frozen --extra kokoro --extra cpu
uv run --no-project --python 3.12 python -m unittest discover -s workers/tts/tests -v
pnpm exec vitest run tests/tts.test.ts
```

Qwen 使用 `--extra qwen`；NVIDIA 环境将 `--extra cpu` 换为 `--extra cuda`。Windows 安装包带有 uv，Python 环境与模型按需下载，worker 文件由打包配置单独收集。

模型调用参考 [Kokoro 官方中文示例](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/blob/main/samples/make_zh.py)、[Qwen3-TTS 官方说明](https://github.com/QwenLM/Qwen3-TTS)，CPU/CUDA 依赖配置参考 [uv 可选依赖来源](https://docs.astral.sh/uv/concepts/projects/dependencies/#optional-dependencies)。

2026-10-13 在 Windows 上完成 Kokoro 的真实 CPU 下载与中文合成，以及完整 Electron 离线生成、1.25 倍语速、试听、切换面板、参数读取、时间线插入、工程保存与重开测试。Qwen、CUDA、MPS 仍为接口接入，尚未完成真实推理；GPU 自动检测和环境就绪状态尚未提供。详细证据见 [验证记录](VALIDATION.md)。
