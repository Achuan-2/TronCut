# IndexTTS 2.5 本地配置

开发版配音面板已接入 IndexTTS 2.5，用 1–30 秒的参考人声复刻音色，支持现有中英配音、0.5–2 倍语速、试听、取消、时间线插入和项目保存。模型本身支持更多语言，本次界面先提供中文与英语。参考音频会作为项目素材收集到 `media/`，配音参数通过 `referenceAssetId` 保留引用；推理使用参考音频的前 15 秒。

IndexTTS 依赖 Python 3.11、PyTorch/torchaudio 2.8.0 和 Transformers 4.52.1，独立环境避免与 Kokoro/Qwen 冲突。Windows NVIDIA 环境使用 CUDA 12.8 版 PyTorch 与 BF16；未启用 DeepSpeed、Flash Attention、自定义 CUDA kernel 或 torch.compile，不要求用户为这些可选加速器安装编译工具。主模型和辅助模型需要下载数 GB。

## 准备环境

开发环境可执行：

```powershell
./scripts/setup-indextts.ps1
pnpm dev
```

脚本先检查 NVIDIA 驱动，再把独立 worker、虚拟环境和模型放进 `.framecraft-dev/`。CPU 环境使用 `./scripts/setup-indextts.ps1 -Device cpu`，速度和内存需求尚待实测。已有完整缓存可用 `-Offline` 检查；离线缓存缺失会报错。安装包会携带 worker 配置与 uv，依赖和模型仍按需下载到应用数据目录，开发环境缓存不会自动进入安装包。

配音面板选择“IndexTTS 2.5 · 参考音频配音”，导入参考音频或选择已有音频素材，填写文稿后生成。该模型默认“自动 · 优先 NVIDIA 显卡”：检测到 NVIDIA 驱动时准备 CUDA 环境，否则使用 CPU。手动选择 CUDA 而驱动不可用时，在下载前报错；显存不足不会静默切换设备。CUDA 模式还会检查 BF16 支持。

## 固定版本与离线行为

源码固定为官方提交 `d9e41aac89fd00b3d71497fddb287b7f24613712`，通过 GitHub 源码 ZIP 安装，不依赖最终用户安装 Git。模型固定为 `IndexTeam/IndexTTS-2.5` 的 `c39ce5ba981572cb187443877ff559dfb246ce63`；辅助模型包括 w2v-bert-2.0、CAMPPlus 和 BigVGAN，版本记录在模型目录的 `troncut-models.json`。本次使用参考音频的情绪，不下载或加载额外的 QwenEmotion 模型。

模型放在 `models/indextts2_5/`。所有推理必需的辅助文件会先由 worker 准备，再调用 IndexTTS，避免上游自动选择 ModelScope/镜像的行为绕过离线模式。离线缺失模型文件时直接报错；Python 依赖由 uv 的 `--offline --frozen` 约束。Windows RTX 4050 上的完整缓存离线推理已验证。

## 本机验证

2026-10-13 完成 `.framecraft-dev/` 中的独立 CUDA 环境和全部模型配置，`setup-indextts.ps1 -Offline` 通过，PyTorch 2.8.0+cu128 能识别 RTX 4050 Laptop（6141 MiB）并支持 BF16。Electron 内选取 7.325 秒的已生成 Kokoro 测试音频作参考，离线生成“欢迎使用，这是一段测试配音。”，输出 3.341271 秒的 48 kHz 单声道有效 WAV。worker 记录实际设备 `cuda:0`、精度 `bf16`、首次加载 137.782 秒、生成 11.451 秒；这是一条短样本，不是音色保真或模型速度对照。

试听、自动插入声音轨、参考音频随项目归档、保存重开与配音参数读取全部通过，前端运行错误为零。证据位于 `test-output/tts/index-desktop-1791888307077/validation.json` 和 `index-narration.png`。目前每次生成重新加载模型，尚未实现常驻推理；长文稿、真人参考音色、CPU 和 Mac 仍待验证。本次未重新打包或发布安装包。

官方文档：[IndexTTS](https://github.com/index-tts/index-tts)、[IndexTTS 2.5 模型卡](https://huggingface.co/IndexTeam/IndexTTS-2.5)。源码及模型采用 Bilibili IndexTTS/模型许可，不属于 TronCut 的 AGPL，也不能直接标记为 Apache-2.0。
