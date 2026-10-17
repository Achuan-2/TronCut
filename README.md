<div align="center">
  <img src="resources/icon.png" width="96" height="96" alt="TronCut" />
  <h1>TronCut</h1>
  <p><strong>录制屏幕，轻松剪辑，自在表达。</strong></p>
  <p>面向教程、演示与文字视频的本地桌面创作工具。</p>
  <p>
    <a href="https://github.com/Achuan-2/TronCut/releases"><img src="https://img.shields.io/github/v/release/Achuan-2/TronCut?label=release&color=71b896" alt="Release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0" /></a>
    <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-0078D4" alt="Windows and macOS" />
    <img src="https://img.shields.io/badge/status-release-71b896" alt="Release" />
  </p>
  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
  <p><a href="https://github.com/Achuan-2/TronCut/releases/tag/v0.5.1">下载安装</a> · <a href="#亮点">功能亮点</a> · <a href="docs/FEATURES.md">开发进度</a> · <a href="https://github.com/Achuan-2/TronCut/issues">反馈问题</a></p>
</div>

![TronCut Windows 编辑器](docs/images/editor.png)

TronCut 将录屏、剪辑、文字、字幕和声音处理放在同一个工作区。素材库、画布、属性面板和多轨时间线采用熟悉的桌面剪辑布局，重点改善教程制作中的文字添加、动画操作、字幕定位和工程迁移。

> **当前版本：v0.5.1 正式版。** Windows 已提供经过桌面测试的安装包；macOS 提供未签名、未经真机验证的 Intel 与 Apple Silicon 安装包，由使用者自行验证。Camtasia 工程导入目前为有限转换。本版尚未实现完整 Camtasia 功能，详见[兼容范围](#兼容范围)。

## 亮点

| 能力                   | 你可以做什么                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| **录屏后继续编辑鼠标** | Windows 原生录制将鼠标与画面分开；支持 Recordly 的 macOS、Tahoe、Windows 11、Figma 等样式，保留文本与指针等形态变化，也可调整大小、隐藏光标或启用点击高亮。 |
| **自动缩放与录屏背景** | 根据鼠标点击生成缩放，并在放大时平滑跟随鼠标；可选仅录屏缩放或背景一起缩放，支持动态背景、渐变和自定义图片。 |
| **自定义录制范围** | 支持屏幕内框选、拖动缩放和像素坐标输入；倒计时小窗不阻挡操作，录制工具条可最小化并重新唤出。 |
| **录屏对象** | 录制完成自动组合为一个对象；录后直接通过下拉框换背景，调整圆角、留白和鼠标，也可取消组合，分别编辑原始素材。 |
| **录屏自动美化** | 录前选择背景、留白、圆角和鼠标，录后自动添加独立背景，并根据鼠标点击和停留生成可编辑的缩放动画。 |
| **文字就在时间线旁**   | 一键添加文本，使用黑边白字、白边黑字、黑边黄字等模板；字幕可以放在画布中央，制作纯文字视频。               |
| **动画不必只靠拖拽**   | 右键或点击添加淡入、缩放、滑入动画；开启自动动画后，修改位置、缩放和透明度即可生成关键帧。                 |
| **本地语音字幕**       | Qwen3-ASR 0.6B / SenseVoiceSmall 全局识别时间线混音，保留裁剪、变速、空白和音量，按真实词时间或语音段生成独立字幕轨道。 |
| **文字生成本地配音**   | Windows 系统语音、Kokoro / VITS ONNX 和 LuxTTS ONNX 声音克隆；导入参考音频或直接录音，保存音色后重复试听和配音。 |
| **保调变速与播客声音** | 导出优先使用 Rubber Band 保持音调；提供降噪、均衡、压缩、响度处理与处理后试听。                            |
| **工程透明、素材随行** | 可读 JSON 工程，媒体与鼠标轨迹归档到同一目录；相对路径方便迁移，Windows 工程文件夹带软件图标。             |

此外，已提供多轨剪辑、多选、组合、同步移动、拆分、吸附、波纹删除、撤销重做、裁切旋转、颜色与模糊效果、淡入淡出、素材缩略图、概览波形和离线素材重链接。MP4 导出优先尝试可用硬件编码器，失败后回退到软件编码。

## 下载与开始使用

前往 **[GitHub Releases](https://github.com/Achuan-2/TronCut/releases/tag/v0.5.1)** 下载：

| 文件                                  | 用途                                     |
| ------------------------------------- | ---------------------------------------- |
| `TronCut-Setup-0.5.1-windows-x64.exe` | Windows x64 安装包，支持选择安装目录。   |
| `TronCut-0.5.1-windows-x64.zip`       | 免安装版；完整解压后运行 `TronCut.exe`。 |
| `TronCut-0.5.1-macos-arm64.dmg`       | Apple Silicon Mac 安装包，未经真机验证。 |
| `TronCut-0.5.1-macos-x64.dmg`         | Intel Mac 安装包，未经真机验证。         |
| `SHA256SUMS.txt`                      | 发布文件的 SHA256 校验值。               |

安装包包含对应平台的媒体引擎和字幕环境管理器，Windows 版还包含原生录屏组件，使用者无需安装 Node.js、FFmpeg 或 uv。**首次生成语音字幕需要联网下载 Python、依赖和模型**，完成后语音识别在本地运行。当前 Windows 与 macOS 包均未配置代码签名，macOS 包也未公证或进行真机功能验收。

使用方法按功能模块整理在 [使用文档](docs/README.md) 中，包括素材与录屏鼠标、时间线、文本、画布动画和工程管理。首次使用可阅读 [开始使用](docs/GETTING-STARTED.md)。

## 兼容范围

| 项目                | 当前状态                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Windows x64         | 已有安装包与打包程序桌面测试；真实设备同步、长录屏与 4K 压力测试仍待完成。                                               |
| macOS               | 提供 Apple Silicon 与 Intel DMG；未签名、未公证，也未进行安装、权限、录制和导出真机验收，由使用者自行验证并反馈。        |
| Camtasia `.tscproj` | 转换常见媒体引用、平面片段、时间、速度与部分变换；附导入报告并保留原 JSON。                                              |
| TREC 与专有背景     | **暂不支持完整导入。** 实际工程测试中 3 段 TREC 与水波背景被跳过，仅音乐转换成功。                                       |
| 字幕引擎            | 默认使用 Qwen3-ASR 0.6B INT8 CPU，可选 SenseVoiceSmall CPU；使用 Silero VAD。 |
| 声音增强            | 当前为 DSP 处理；画布播放原音，处理后试听与导出使用滤镜结果，不包含 AI 人声重建。                                        |

完整效果库、嵌套序列、TREC 鼠标元数据、代理媒体、统一 GPU 合成及 GIF/音频/交互导出尚未完成。硬件编码不等于全流程 GPU 加速；本版未经过专业软件音质盲测或大工程性能对比。

## 本地开发

v0.4.1 已提供可供 Codex 调用的 CLI：剪辑、抽帧、转录、文案配音、字幕和视频导出均返回结构化 JSON，并保留可编辑工程。无声视频由 Codex 根据抽帧生成脚本，再交给 CLI 配音和导出，说明见 [CLI 文档](docs/CLI.md)。

```powershell
pnpm build
pnpm --silent cli help
pnpm --silent cli run --plan plan.json
```

需要 **Node.js 22+、pnpm、Rust 1.85+**，并通过 `rustup target add wasm32-unknown-unknown` 安装 Wasm 目标；字幕开发使用 **uv 与 Python 3.11/3.12**。Windows 原生组件构建需要 Visual Studio 2022 C++ 工具链、Windows SDK 10.0.22621+ 和 CMake。时间线查询已采用 Rust 引擎，迁移范围与基准见 [Rust 引擎与性能](docs/RUST-ENGINE.md)。

```sh
git clone https://github.com/Achuan-2/TronCut.git
cd TronCut
pnpm install --frozen-lockfile
pnpm dev
```

开发时可从 PATH 查找 FFmpeg/FFprobe，也可在设置中选择引擎。独立二进制不提交到 Git，打包前的引擎准备方式见 [构建与发布](docs/BUILDING.md)。单独运行 Vite 只有界面预览；文件、录屏和导出需要 Electron。

```sh
pnpm build          # 类型检查 + 编辑器与 Electron 构建
pnpm test           # 核心逻辑与真实 FFmpeg 测试，需媒体引擎
pnpm test:smoke     # Electron 桌面回归，先执行 build 和 test
```

## 文档与参与

- [使用文档与功能模块](docs/README.md) · [开始使用](docs/GETTING-STARTED.md)
- [功能清单与路线图](docs/FEATURES.md) · [架构与工程协议](docs/ARCHITECTURE.md)
- [构建与发布](docs/BUILDING.md) · [验证记录](docs/VALIDATION.md)
- [本地语音字幕](docs/SENSEVOICE.md) · [真实 Camtasia 工程测试](docs/CAMTASIA-REAL-PROJECT-TEST.md)
- [性能优化总结](docs/PERFORMANCE-IMPROVEMENTS.md) ⚡ **新增**
  - [视频导出性能优化方案](docs/EXPORT-OPTIMIZATION.md) 🚀 **2-3倍速度提升**
  - [导出优化实施报告](docs/EXPORT-OPTIMIZATION-REPORT.md) 📊 **详细数据**
- [贡献指南](CONTRIBUTING.md) · [提交问题](https://github.com/Achuan-2/TronCut/issues/new/choose)

欢迎提供可复现的问题、兼容样本、测试结果和改进代码。提交工程或日志前，请移除私人素材与敏感信息。

## 许可与致谢

TronCut 原创代码采用 **[AGPL-3.0](LICENSE)**。第三方源码、二进制与模型保留各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

感谢 [OpenScreen](https://github.com/getopenscreen/openscreen) 的 MIT 原生捕获组件，以及 [FFmpeg](https://ffmpeg.org/)、[Rubber Band](https://breakfastquay.com/rubberband/)、[Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)、[SenseVoice](https://github.com/QwenAudio/SenseVoice)、[FunASR](https://github.com/modelscope/FunASR)、[uv](https://github.com/astral-sh/uv)、Electron、React 和 sharp。其他学习参考及固定提交见 [references/README.md](references/README.md)。
