# 本地语音字幕引擎

当前字幕使用 sherpa-onnx，默认 Qwen3-ASR 0.6B INT8，也可选择 SenseVoiceSmall。字幕面板的“语音转文本”弹窗只需要选择模型，再点击“开始识别”，无需选择片段。TronCut 自动复用自己的 `models/onnx/` 缓存，缺少模型时下载。Qwen3-ASR 使用卷积前端、INT8 encoder/decoder 与 tokenizer，SenseVoice 使用 `model.int8.onnx` 和 `tokens.txt`；两者共用单独缓存的 `models/onnx/silero_vad.onnx`。

字幕面板只显示按时间排列、可直接修改的字幕。右上角菜单提供导入、导出、语音转文本、字幕转普通文本及搜索替换；底部可在播放头处添加字幕。语音识别每执行一次都会新建一条字幕轨道，重复识别不会把结果堆到原轨道；手动新增和导入字幕继续写入已有字幕轨道。统一样式按钮可批量修改字体、字号、颜色、描边、位置和不透明度。

识别整个时间线的最终混音，保留片段裁剪、变速、音量、淡入淡出、播客处理和时间线空白，跳过静音与隐藏轨道。混音转为 16 kHz 单声道 PCM16 音频后流式进入 Silero VAD，再按真实语音段识别，字幕时间直接对应工程时间。有 token 时间戳时细分字幕，否则保留完整语音段。Qwen3-ASR 支持自动识别语言，CLI 也支持中文、英语、日语、韩语和粤语提示。当前为 CPU 环境，工作进程与真实验证命令见 [本地 ONNX 语音说明](TTS.md)。

## 2026-10-15 Qwen3-ASR 真实 CPU 转录

已将用户提供的 Qwen3-ASR 0.6B INT8 模型复制到 TronCut 自己的缓存并完成真实推理。官方 SenseVoice 中文短样本经 Silero VAD 得到 0.746–5.122 秒语音段，Qwen3-ASR 自动语言与中文提示均输出一条字幕“菜饭时间：早上九点至下午五点。”。这证明模型加载、语言提示、VAD 分段和字幕输出链路可用；该句与参考文本并非完全一致，不能据此宣称识别准确率已经达到可用标准。验证产物位于 `test-output/qwen3-asr-real/`。

全局流程另将该语音放在两个不同轨道的第 2 秒和第 10 秒，经时间线混音后一次识别，分别得到 2.762–7.106 秒和 10.762–15.106 秒两条字幕，保留片段位置与中间空白。服务调用直接使用 TronCut 自己的模型缓存及独立运行环境，结果位于 `test-output/qwen3-asr-real/project-captions.json`。

## 旧 FunASR 实现与历史验证

以下是 2026-10-13 的旧实现记录，不代表当前 ONNX 后台的配置或性能。

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
