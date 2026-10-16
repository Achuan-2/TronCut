# 参考源码

已于 2026-10-13 克隆以下仓库（浅克隆），源码保持原样。各子目录在根 `.gitignore` 中排除，不随产品源码发布；只有本索引作为文档提交。OpenScreen Windows 捕获组件是明确采用的例外，源代码及 MIT 许可独立保存在 `native/windows/`，已编译用于 TronCut。

| 本地目录          | 上游                                                                        | 本次提交                                   | 许可证                                 | 主要参考                                                              |
| ----------------- | --------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------- | --------------------------------------------------------------------- |
| `openscreen/`     | [getopenscreen/openscreen](https://github.com/getopenscreen/openscreen)     | `bd04d3a7a05453b52d7f33c1d9c9b4b932ff05e3` | MIT                                    | 原生 WGC/ScreenCaptureKit、光标 sidecar、流式录制、GPU 渲染与平台边界 |
| `Recordly/`       | [webadderallorg/Recordly](https://github.com/webadderallorg/Recordly)       | `535d1cfafa87cc318db6f2b57b70b6c1c1079862` | AGPL-3.0（见原 LICENSE.md 及品牌要求） | 原生 Windows WASAPI 音频、录制流程、自动缩放与光标交互                |
| `VideoCaptioner/` | [WEIFENG2333/VideoCaptioner](https://github.com/WEIFENG2333/VideoCaptioner) | `95842ecb5618c0b6a548a336bdfb0eb859bdb501` | GPL-3.0                                | VAD、词级时间戳、字幕断句、文稿对齐、CLI 对接                         |
| `pycamtasia/`     | [grandmasteri/pycamtasia](https://github.com/grandmasteri/pycamtasia)       | `443a41e37cddb460c0aa6e046c951cb17f241bf3` | MIT                                    | Camtasia 项目结构、editRate、媒体源、真实 JSON 测试样本               |
| `SenseVoice/`     | [QwenAudio/SenseVoice](https://github.com/QwenAudio/SenseVoice)             | `586bbdb2b052f4fe19322581825228b6810a9fb3` | MIT（代码；模型见模型卡）              | 非自回归识别、五种语言、CTC 时间戳与模型性能基准                      |
| `FunASR/`         | [modelscope/FunASR](https://github.com/modelscope/FunASR)                   | `f793eae5778eae93854646f9b4b9c42a23584651` | MIT（代码；各模型独立声明）            | SenseVoice 内置模型、FSMN-VAD 和 timestamp/words 约定                 |

## 推荐阅读位置

2026-10-15 额外阅读了 [storytold/filmcraft 的架构文档](https://github.com/storytold/filmcraft/blob/main/docs/architecture.md)，参考独立 Rust 引擎、可替换界面和媒体管线分层。此次未克隆或复制其代码，也未采用其编解码器；TronCut 自行实现的 Rust 时间线索引及验证范围见 [Rust 引擎](../docs/RUST-ENGINE.md)。

OpenScreen：`electron/ipc/recordingStream.ts` 展示写入流生命周期；`electron/native-bridge/cursor/recording/windowsNativeRecordingSession.ts` 展示光标采样器；`electron/native/wgc-capture/` 为采用的 Windows 原生组件。TronCut 的应用生命周期、工程、鼠标预览与导出自行实现，未复制 OpenScreen 整体应用。

Recordly：`electron/native/windows-capture/src/` 中的 `wasapi_loopback.*`、`mf_encoder.*` 与 `main.cpp` 适合研究系统音频和原生编码；`electron/cursorHider.ts` 用于理解光标隐藏。录屏自动缩放、安全区域跟随、弹簧缓动及倒计时代码已适配到 TronCut，静态和视频壁纸、鼠标图形已复制；采用范围、上游提交和许可见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

VideoCaptioner：`videocaptioner/cli/main.py` 定义 CLI 参数。该版本内部映射包括 Faster Whisper，但 `--asr` choices 没有该值。TronCut 为 Faster Whisper 单独实现工作进程，保留 Whisper.cpp 的外部 CLI 接口。

pycamtasia：`tests/fixtures/test_project_a.tscproj` 等样本与 `src/camtasia/resources/new.cmproj/project.tscproj` 用于验证项目的层级结构与时间单位。本项目测试直接读取参考样本，不将样本打包到安装程序；不以读取成功代表导入保真。

SenseVoice：`README.md`、`demo2.py` 与 `model.py` 用于核对模型范围、公开性能基准和毫秒时间戳。FunASR：`funasr/models/sense_voice/model.py` 的 `post()` 输出 `[start_ms,end_ms]` 与独立 `words`；本项目选择官方 Python 包中的集成实现，不打包克隆仓库或加载下载目录的远程 Python。两者只作为源码参考保留原样。
