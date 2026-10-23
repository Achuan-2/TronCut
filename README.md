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
  <p><a href="https://github.com/Achuan-2/TronCut/releases">下载安装</a> · <a href="#亮点">功能亮点</a> · <a href="#功能截图">功能截图</a> · <a href="docs/FEATURES.md">开发进度</a> · <a href="https://github.com/Achuan-2/TronCut/issues">反馈问题</a></p>
</div>

![TronCut Windows 编辑器：项目媒体、画布预览与多轨时间线](docs/images/editor.png)

TronCut 集成录屏、剪辑、文字、字幕和声音处理，大大提升教程、演示和文字视频的制作效率。


## 亮点

| 能力                   | 你可以做什么                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| **录屏后继续编辑鼠标** | Windows 原生录制将鼠标与画面分开；支持 macOS、Tahoe、Windows 11、Figma 等样式，保留文本与指针等形态变化，也可调整大小、隐藏光标或启用点击高亮。 |
| **自动缩放与录屏背景** | 根据鼠标点击生成缩放，并在放大时平滑跟随鼠标；可选仅录屏缩放或背景一起缩放，支持动态背景、渐变和自定义图片。 |
| **自定义录制范围** | 支持屏幕内框选、拖动缩放和像素坐标输入；倒计时小窗不阻挡操作，录制工具条可最小化并重新唤出。 |
| **录屏对象** | 录制完成自动组合为一个对象；录后直接通过下拉框换背景，调整圆角、留白和鼠标，也可取消组合，分别编辑原始素材。 |
| **录屏自动美化** | 录前选择背景、留白、圆角和鼠标，录后自动添加独立背景，并根据鼠标点击和停留生成可编辑的缩放动画。 |
| **文字就在时间线旁**   | 一键添加文本，使用黑边白字、白边黑字、黑边黄字等模板；字幕可以放在画布中央，制作纯文字视频。               |
| **动画轻松添加**   | 右键或点击添加淡入、缩放、滑入动画；开启自动动画后，修改位置、缩放和透明度即可生成关键帧。                 |
| **本地语音字幕**       | Qwen3-ASR 0.6B / SenseVoiceSmall 全局识别时间线混音，保留裁剪、变速、空白和音量，按真实词时间或语音段生成独立字幕轨道。 |
| **文字生成本地配音**   | Windows 系统语音、Kokoro / VITS ONNX 和 LuxTTS ONNX 声音克隆；导入参考音频或直接录音，保存音色后重复试听和配音。 |
| **保调变速与播客声音** | 导出优先使用 Rubber Band 保持音调；提供降噪、均衡、压缩、响度处理与处理后试听。                            |
| **项目透明、素材随行** | 可读 JSON 项目，媒体与鼠标轨迹归档到同一目录；相对路径方便迁移，Windows 项目文件夹带软件图标。             |

此外，已提供多轨剪辑、多选、组合、同步移动、拆分、吸附、波纹删除、撤销重做、裁切旋转、颜色与模糊效果、淡入淡出、素材缩略图、概览波形和离线素材重链接。MP4 导出优先尝试可用硬件编码器，失败后回退到软件编码。

## 下载与开始使用

前往 **[GitHub Releases](https://github.com/Achuan-2/TronCut/releases)** 下载：

当前版本为 **[v0.6.2](https://github.com/Achuan-2/TronCut/releases/tag/v0.6.2)**，新增 Markdown 公式与局部颜色、编辑所有动画、时间线素材颜色和自定义快捷键，并改进录屏、代理文件存储与时间线剪辑。详见[发布说明](docs/releases/v0.6.2.md)。

使用方法按功能模块整理在 [使用文档](docs/README.md) 中，包括素材与录屏鼠标、时间线、文本、画布动画和项目管理。首次使用可阅读 [开始使用](docs/GETTING-STARTED.md)。

## 功能截图

以下均为 Windows 桌面版实际界面，使用同一个演示项目展示编辑流程。

### 录屏自动美化

录制前选择背景、留白、圆角和鼠标样式，开启根据鼠标点击自动缩放与跟随。录制完成后，还能继续修改录屏对象的外观与缩放设置。[录屏与鼠标说明](docs/MEDIA.md)

<img src="docs/images/feature-recording.png" width="800" alt="录屏美化设置：渐变背景、留白、圆角、鼠标样式与自动缩放" />

### 文字与标注

拖入文字模板，在画布上直接编辑内容；调整字体、颜色、描边和局部文字样式，也能把常用样式保存为模板。标注面板还提供形状、箭头、模糊高亮、草图运动和涂鸦笔。[文本与标注说明](docs/TEXT.md)

![文字模板与文本属性：在画布上编辑标题](docs/images/feature-text.png)

### 媒体与文字行为

悬停预览动效，拖入或双击应用，再分别调整“进／期间／出”的样式、方向、速度与循环。添加新的媒体行为会自动替换旧行为，方便快速比较效果。[行为说明](docs/BEHAVIORS.md)

![媒体行为预设与三阶段属性：为标题添加漂移动效](docs/images/feature-behaviors.png)

### 关键帧动画

为片段添加自定义动画，在时间线上调整动画范围，再修改起止位置、缩放和透明度；也可开启自动动画，或通过取景框设置视频的缩放与平移。[画布与动画说明](docs/CANVAS.md)

![自定义动画面板、时间线动画箭头与画面属性](docs/images/feature-animations.png)

### 视觉效果

为画面添加圆角、边框、阴影、遮罩、着色或局部模糊。多个效果可组合使用，圆角与边框同时启用时，边框跟随圆角轮廓。[视觉效果说明](docs/VISUAL-EFFECTS.md)

![视觉效果库与圆角边框组合：在画布中查看效果](docs/images/feature-effects.png)

### 字幕编辑

字幕列表与播放位置联动，可逐条修改文字、查找替换，或统一设置字体、描边和背景。字幕保存在独立轨道，支持本地语音识别及字幕文件导入导出。[字幕使用说明](docs/GETTING-STARTED.md)

![字幕列表、画布字幕预览与独立字幕轨道](docs/images/feature-captions.png)

### 本地配音

在旁白面板输入文稿，选择模型、音色和语速，试听后生成音频并加入时间线。支持 Windows 系统音色、Kokoro／VITS ONNX，以及 LuxTTS ONNX 声音克隆；图中展示本机 Windows 音色设置。[本地配音说明](docs/TTS.md)

<img src="docs/images/feature-narration.png" width="560" alt="AI 配音设置：Windows 本机音色、配音语速与试听" />

### 视频导出

设置保存位置、文件名、分辨率、质量与格式，导出前查看输出尺寸、帧率和时长。项目文件保留可编辑内容，方便继续修改。[视频导出说明](docs/EXPORT.md)

<img src="docs/images/feature-export.png" width="760" alt="视频导出设置：保存位置、分辨率、质量、格式与输出信息" />


## 本地开发

v0.4.1 已提供可供 Codex 调用的 CLI：剪辑、抽帧、转录、文案配音、字幕和视频导出均返回结构化 JSON，并保留可编辑项目。无声视频由 Codex 根据抽帧生成脚本，再交给 CLI 配音和导出，说明见 [CLI 文档](docs/CLI.md)。

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

开发时可从 PATH 查找 FFmpeg/FFprobe，安装包使用随包提供的引擎。独立二进制不提交到 Git，打包前的引擎准备方式见 [构建与发布](docs/BUILDING.md)。单独运行 Vite 只有界面预览；文件、录屏和导出需要 Electron。

```sh
pnpm build          # 类型检查 + 编辑器与 Electron 构建
pnpm test           # 核心逻辑与真实 FFmpeg 测试，需媒体引擎
pnpm test:smoke     # Electron 桌面回归，先执行 build 和 test
```

## 文档与参与

- [使用文档与功能模块](docs/README.md) · [开始使用](docs/GETTING-STARTED.md)
- [功能清单与路线图](docs/FEATURES.md) · [架构与项目协议](docs/ARCHITECTURE.md)
- [构建与发布](docs/BUILDING.md) · [验证记录](docs/VALIDATION.md)
- [本地语音字幕](docs/SENSEVOICE.md) · [真实 Camtasia 项目测试](docs/CAMTASIA-REAL-PROJECT-TEST.md)
- [性能优化总结](docs/PERFORMANCE-IMPROVEMENTS.md)
- [贡献指南](CONTRIBUTING.md) · [提交问题](https://github.com/Achuan-2/TronCut/issues/new/choose)

欢迎提供可复现的问题、兼容样本、测试结果和改进代码。提交项目或日志前，请移除私人素材与敏感信息。

## 许可与致谢

TronCut 原创代码采用 **[AGPL-3.0](LICENSE)**。第三方源码、二进制与模型保留各自许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

感谢 [OpenScreen](https://github.com/getopenscreen/openscreen) 的 MIT 原生捕获组件，以及 [FFmpeg](https://ffmpeg.org/)、[Rubber Band](https://breakfastquay.com/rubberband/)、[Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR)、[SenseVoice](https://github.com/QwenAudio/SenseVoice)、[FunASR](https://github.com/modelscope/FunASR)、[uv](https://github.com/astral-sh/uv)、Electron、React 和 sharp。其他学习参考及固定提交见 [references/README.md](references/README.md)。
