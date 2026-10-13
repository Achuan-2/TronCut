# Third-party notices / 第三方声明

Copyright © 2026 Achuan-2 and TronCut contributors. Original TronCut code is distributed under **AGPL-3.0-only**; see [LICENSE](LICENSE). Third-party components retain the notices and licenses of their respective authors.

TronCut 原创代码使用 AGPL-3.0-only。第三方源码、独立可执行文件、依赖和模型不因本项目的许可证声明而改变原许可。

## Included native source / 随源码提供

| Component                                         | Version / source                                                                                                                                                  | License | Distribution                                                                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| OpenScreen Windows WGC capture and cursor sampler | [bd04d3a7a05453b52d7f33c1d9c9b4b932ff05e3](https://github.com/getopenscreen/openscreen/tree/bd04d3a7a05453b52d7f33c1d9c9b4b932ff05e3/electron/native/wgc-capture) | MIT     | Vendored in [native/windows](native/windows), with its original [LICENSE](native/windows/LICENSE) and [NOTICE](native/windows/NOTICE.md). |

## Windows release binaries / Windows 发布包

| Component                         | Source                                                                                                                                                                                                         | License                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| FFmpeg / FFprobe 9.0.2 essentials | [Gyan builds](https://www.gyan.dev/ffmpeg/builds/) · [9.0.2 release](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2) · [FFmpeg commit 946fcce07b](https://github.com/FFmpeg/FFmpeg/commit/946fcce07b) | GPL-3.0; build includes GPL libraries such as libx264 and Rubber Band. |
| uv 0.6.5                          | [astral-sh/uv 0.6.5](https://github.com/astral-sh/uv/tree/0.6.5)                                                                                                                                               | MIT OR Apache-2.0                                                      |
| OpenScreen capture helpers        | Same source as the vendored C++ files above                                                                                                                                                                    | MIT                                                                    |
| Electron and Chromium             | Versions locked in pnpm-lock.yaml; [Electron](https://github.com/electron/electron)                                                                                                                            | MIT and bundled Chromium third-party notices                           |

The FFmpeg build is unmodified and runs as a separate process. Its supplied license, build configuration, upstream source reference, and original archive checksum are retained in `resources/bin/FFmpeg-LICENSE.txt`, `FFmpeg-README.txt`, and `manifest.json`, and are included in the Windows packages. The release provides an archive of the referenced FFmpeg source commit. External libraries and their notices remain subject to their own licenses; see the upstream build information for its full library list and [MSYS2 package sources](https://github.com/msys2/MINGW-packages) for the toolchain's dependencies.

FFmpeg 保持上游构建原样，通过独立进程使用；保留 GPL 正文、构建配置、源码链接与下载校验记录。uv 的 MIT/Apache 正文及 OpenScreen 的 MIT 正文也随安装包提供。Electron/Chromium 自带许可位于解压后的程序目录。

## Application dependencies / 应用依赖

Dependency versions are locked in `pnpm-lock.yaml`. Notable components include React (MIT), lucide-react (ISC), Zod (MIT), sharp (Apache-2.0), and libvips (LGPL-2.1-or-later). Their original package notices are retained where supplied. Build-time tools include Vite, TypeScript, esbuild, electron-builder, Playwright, and Vitest; consult each upstream project for its license.

## Optional speech dependencies and models / 可选语音组件

Speech environments are downloaded on demand and are not included in the Windows release. Versions are locked in `workers/uv.lock` (recognition) and `workers/tts/uv.lock` (synthesis); model weights are downloaded separately to application data.

- [SenseVoice](https://github.com/QwenAudio/SenseVoice) and [FunASR](https://github.com/modelscope/FunASR): MIT code; model weights are subject to their model-card terms.
- [SenseVoiceSmall model card](https://modelscope.cn/models/iic/SenseVoiceSmall) and [FSMN-VAD model card](https://modelscope.cn/models/iic/speech_fsmn_vad_zh-cn-16k-common-pytorch).
- [Faster Whisper](https://github.com/SYSTRAN/faster-whisper): MIT; its dependencies and downloaded Whisper models retain their own notices.
- [VideoCaptioner](https://github.com/WEIFENG2333/VideoCaptioner): optional user-configured external CLI, GPL-3.0; its code and binaries are not bundled.
- [Kokoro](https://github.com/hexgrad/kokoro) and [Misaki](https://github.com/hexgrad/misaki): Apache-2.0 code; [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) weights retain their model-card terms.
- [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS): Apache-2.0 code; the [0.6B](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice) and [1.7B](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) CustomVoice models retain their model-card terms.
- PyTorch, torchaudio, Transformers, soundfile and the spaCy English language model are optional downloaded dependencies; their own licenses remain applicable.
- [IndexTTS](https://github.com/index-tts/index-tts), pinned at `d9e41aac89fd00b3d71497fddb287b7f24613712`: Bilibili IndexTTS license; [IndexTTS 2.5](https://huggingface.co/IndexTeam/IndexTTS-2.5) weights use the Bilibili model license. Its isolated dependency lock is `workers/indextts/uv.lock`. Auxiliary w2v-bert-2.0, CAMPPlus and BigVGAN weights keep their own model-card licenses; downloaded license files are retained where provided.

## Study references / 学习参考

Recordly, VideoCaptioner, pycamtasia, SenseVoice, and FunASR clones under `references/` are not published or packaged as part of this repository. Only the reference index is tracked. OpenScreen's Windows capture source is the explicitly included exception documented above.

## Trademarks / 商标

Camtasia is a TechSmith product name. TronCut is an independent project and is not affiliated with or endorsed by TechSmith. Third-party product names are used to identify compatibility targets and components.
