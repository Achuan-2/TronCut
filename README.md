<div align="center">
  <img src="resources/icon.png" width="96" height="96" alt="TronCut" />
  <h1>TronCut</h1>
  <p><strong>录制屏幕，轻松剪辑，自在表达。</strong></p>
  <p>面向教程、演示与文字视频的本地桌面创作工具。</p>
  <p>
    <a href="https://github.com/Achuan-2/TronCut/releases"><img src="https://img.shields.io/github/v/release/Achuan-2/TronCut?include_prereleases&label=release&color=71b896" alt="Release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0" /></a>
    <img src="https://img.shields.io/badge/platform-Windows-0078D4" alt="Windows" />
    <img src="https://img.shields.io/badge/status-preview-orange" alt="Preview" />
  </p>
  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
  <p><a href="https://github.com/Achuan-2/TronCut/releases/tag/v0.3.0">下载安装</a> · <a href="#亮点">功能亮点</a> · <a href="docs/FEATURES.md">开发进度</a> · <a href="https://github.com/Achuan-2/TronCut/issues">反馈问题</a></p>
</div>

![TronCut Windows 编辑器](docs/images/editor.png)

TronCut 将录屏、剪辑、文字、字幕和声音处理放在同一个工作区。素材库、画布、属性面板和多轨时间线采用熟悉的桌面剪辑布局，重点改善教程制作中的文字添加、动画操作、字幕定位和工程迁移。

> **当前版本：v0.3.0 预发布。** Windows 已提供安装包并完成短时录屏、编辑、保存和导出的桌面测试。macOS 仍在开发，Camtasia 工程导入目前为有限转换。本版尚未实现完整 Camtasia 功能，详见[兼容范围](#兼容范围)。

## 亮点

| 能力                   | 你可以做什么                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| **录屏后继续编辑鼠标** | Windows 原生录制将鼠标与画面分开；更换箭头、圆形或十字，调整大小和颜色，隐藏光标，启用平滑移动与点击高亮。 |
| **文字就在时间线旁**   | 一键添加文本，使用黑边白字、白边黑字、黑边黄字等模板；字幕可以放在画布中央，制作纯文字视频。               |
| **动画不必只靠拖拽**   | 右键或点击添加淡入、缩放、滑入动画；开启自动动画后，修改位置、缩放和透明度即可生成关键帧。                 |
| **本地语音字幕**       | SenseVoiceSmall 支持普通话、粤语、英语、日语和韩语；使用真实词时间断句，并映射片段裁剪与变速。             |
| **文字生成本地配音**   | Kokoro/Qwen3-TTS 提供预设音色，IndexTTS 2.5 用参考音频复刻音色；调节语速、试听并加入时间线。 |
| **保调变速与播客声音** | 导出优先使用 Rubber Band 保持音调；提供降噪、均衡、压缩、响度处理与处理后试听。                            |
| **工程透明、素材随行** | 可读 JSON 工程，媒体与鼠标轨迹归档到同一目录；相对路径方便迁移，Windows 工程文件夹带软件图标。             |

此外，已提供多轨剪辑、多选、组合、同步移动、拆分、吸附、波纹删除、撤销重做、裁切旋转、颜色与模糊效果、淡入淡出、素材缩略图、概览波形和离线素材重链接。MP4 导出优先尝试可用硬件编码器，失败后回退到软件编码。

## 下载与开始使用

前往 **[GitHub Releases](https://github.com/Achuan-2/TronCut/releases/tag/v0.3.0)** 下载：

| 文件                                  | 用途                                     |
| ------------------------------------- | ---------------------------------------- |
| `TronCut-Setup-0.3.0-windows-x64.exe` | Windows x64 安装包，支持选择安装目录。   |
| `TronCut-0.3.0-windows-x64.zip`       | 免安装版；完整解压后运行 `TronCut.exe`。 |
| `SHA256SUMS.txt`                      | 发布文件的 SHA256 校验值。               |

安装包包含媒体引擎、原生录屏组件和字幕环境管理器，使用者无需安装 Node.js、FFmpeg 或 uv。**首次生成语音字幕需要联网下载 Python、依赖和模型**，完成后语音识别在本地运行。当前 Windows 包未配置代码签名证书。

使用方法按功能模块整理在 [使用文档](docs/README.md) 中，包括素材与录屏鼠标、时间线、文本、画布动画和工程管理。首次使用可阅读 [开始使用](docs/GETTING-STARTED.md)。

## 兼容范围

| 项目                | 当前状态                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Windows x64         | 已有安装包与打包程序桌面测试；真实设备同步、长录屏与 4K 压力测试仍待完成。                                               |
| macOS               | 已有跨平台源码与 DMG 配置，尚无经过真机验证的 Mac 发布包。                                                               |
| Camtasia `.tscproj` | 转换常见媒体引用、平面片段、时间、速度与部分变换；附导入报告并保留原 JSON。                                              |
| TREC 与专有背景     | **暂不支持完整导入。** 实际工程测试中 3 段 TREC 与水波背景被跳过，仅音乐转换成功。                                       |
| 字幕引擎            | SenseVoiceSmall 已通过官方中文短样本真实 CPU 转录；Faster Whisper 与 VideoCaptioner CLI 已接入，尚未完成同条件模型对照。 |
| 声音增强            | 当前为 DSP 处理；画布播放原音，处理后试听与导出使用滤镜结果，不包含 AI 人声重建。                                        |

完整效果库、嵌套序列、TREC 鼠标元数据、代理媒体、统一 GPU 合成及 GIF/音频/交互导出尚未完成。硬件编码不等于全流程 GPU 加速；本版未经过专业软件音质盲测或大工程性能对比。

## 本地开发

需要 **Node.js 22+、pnpm**；字幕开发使用 **uv 与 Python 3.11/3.12**。Windows 原生组件构建需要 Visual Studio 2022 C++ 工具链、Windows SDK 10.0.22621+ 和 CMake。

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
- [SenseVoice 实测](docs/SENSEVOICE.md) · [真实 Camtasia 工程测试](docs/CAMTASIA-REAL-PROJECT-TEST.md)
- [贡献指南](CONTRIBUTING.md) · [提交问题](https://github.com/Achuan-2/TronCut/issues/new/choose)

欢迎提供可复现的问题、兼容样本、测试结果和改进代码。提交工程或日志前，请移除私人素材与敏感信息。

## 许可与致谢

TronCut 原创代码采用 **[AGPL-3.0](LICENSE)**。第三方源码、二进制与模型保留各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

感谢 [OpenScreen](https://github.com/getopenscreen/openscreen) 的 MIT 原生捕获组件，以及 [FFmpeg](https://ffmpeg.org/)、[Rubber Band](https://breakfastquay.com/rubberband/)、[SenseVoice](https://github.com/QwenAudio/SenseVoice)、[FunASR](https://github.com/modelscope/FunASR)、[uv](https://github.com/astral-sh/uv)、Electron、React 和 sharp。其他学习参考及固定提交见 [references/README.md](references/README.md)。
