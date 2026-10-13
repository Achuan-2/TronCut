# SenseVoice 字幕引擎

在左侧“字幕”面板选择 `SenseVoiceSmall · 中文 / 快速识别`，选中含声音的视频/音频片段，再生成字幕。模型支持普通话、粤语、英语、日语、韩语；不应将 SenseVoice 研究系列的 50+ 语言范围当作当前 Small 检查点的能力。

应用通过 uv 按需安装 `sensevoice` extra，下载模型后在本地处理。首次调用包括 Python 依赖、模型下载与加载，不能与官方热模型推理时间直接比较。SenseVoice 和原有 Whisper 不需要同时安装，锁文件在 `workers/uv.lock`；应用缓存、模型和工作进程环境位于应用数据目录。

当前实现使用 FunASR 1.4.16 内置 SenseVoiceSmall，`trust_remote_code=False`，独立 FSMN-VAD。只识别所选片段的源区间；VAD 内存限制到一分钟输入，编码器单次最多十秒。按真实词级时间戳生成短字幕；时间信息缺失/格式不一致时，保留全部文字和真实 VAD 边界，不均匀分配字数时间。识别输出中的语言、情绪、声音事件控制标签会被移除。

当前基线匹配 PyTorch/torchaudio 2.9.1。自动模式依据 `torch.cuda.is_available()` 选择可用 CUDA，否则使用 CPU；显式 CUDA 在运行环境不支持时提示改用 CPU。默认依赖在 Windows 为 CPU 基线，不能据此宣称 NVIDIA GPU 或 macOS Metal 已加速或验收。后续的 CUDA 发行配置和 ONNX/原生部署应独立验证。

手动运行工作进程可检查返回字幕及元数据：

```powershell
# input.wav 必须为 16 kHz 单声道；应用会自动做这一步
uv run --project workers --extra sensevoice --python 3.12 python workers/transcribe.py --engine sensevoice --device cpu --language zh --input input.wav --output captions.json
```

旁边的 `captions.json.metadata.json` 记录模型、设备、音频时长、工作进程总耗时和时间戳回退段数。该耗时从 Python 工作进程开始计算，包括导入、下载/加载和推理，不包括 uv 安装以及应用提取音频的时间。

比较实际性能时应使用同一份音频、同一机器和明确的运行设备，分别记录首次加载与缓存后调用时间、整个字幕流程耗时、实时率、中文错误率、断句与时间戳偏差。官方原版 Whisper 基准不是本程序 Faster Whisper int8 的同条件对照；目前每次任务使用独立工作进程，也存在模型重新加载的开销。

## 2026-10-13 真实 CPU 转录

已使用官方 SenseVoiceSmall 模型中的 `example/zh.mp3`，FFmpeg 转为 16 kHz 单声道。5.616 秒样本输出“开放时间早上9点至下午5点。”，字幕为 0.750–5.550 秒，词时间戳回退段数为 0。

第一次工作进程含库导入、模型加载和 VAD 下载，共 75.644 秒。已有缓存后的第二次为 14.791 秒；使用本地缓存路径、避开模型仓库元信息查询后的第三次为 11.496 秒，其中模型准备 9.125 秒、VAD 0.020 秒、ASR/词时间/断句 0.344 秒。阶段计时包含相应调用的开销，不是单独网络前向传播计时，也不是常驻热模型性能。

证据为 `test-output/sensevoice-real.json`、`sensevoice-cached.json`、`sensevoice-local.json` 及各自 `.metadata.json`。模型位于 `.cache/models/modelscope/`，没有加入安装包；首次下载权重约 936 MB（十进制）。该短官方样本证明模型能实际转录并提供时间戳，不能证明用户语音准确率、长录音断句质量、CUDA/Mac 性能或与 Faster Whisper 的倍率。

Windows 安装包附带 uv 运行器；首次使用在应用数据目录下载 Python/依赖/模型。已有完整模型优先直接用本地路径。官方参考：[SenseVoice 使用说明](https://github.com/QwenAudio/SenseVoice)、[FunASR 内置实现](https://github.com/modelscope/FunASR/tree/main/funasr/models/sense_voice)。
