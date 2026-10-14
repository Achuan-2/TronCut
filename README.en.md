<div align="center">
  <img src="resources/icon.png" width="96" height="96" alt="TronCut" />
  <h1>TronCut</h1>
  <p><strong>Record your screen. Edit with ease. Make your ideas visible.</strong></p>
  <p>A local desktop workspace for tutorials, demos, and text-based videos.</p>
  <p>
    <a href="https://github.com/Achuan-2/TronCut/releases"><img src="https://img.shields.io/github/v/release/Achuan-2/TronCut?label=release&color=71b896" alt="Release" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="AGPL-3.0" /></a>
    <img src="https://img.shields.io/badge/platform-Windows-0078D4" alt="Windows" />
    <img src="https://img.shields.io/badge/status-release-71b896" alt="Release" />
  </p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
  <p><a href="https://github.com/Achuan-2/TronCut/releases/tag/v0.4.0">Download</a> · <a href="#highlights">Highlights</a> · <a href="docs/FEATURES.md">Roadmap</a> · <a href="https://github.com/Achuan-2/TronCut/issues">Report an issue</a></p>
</div>

![TronCut Windows editor — Chinese UI](docs/images/editor.png)

TronCut brings screen recording, editing, text, captions, and audio processing into one workspace. Its media library, canvas, inspector, and multitrack timeline use a familiar desktop editing layout, with particular attention to adding text, creating animations, positioning captions, and moving projects between machines.

> **Current version: v0.4.0 release.** A Windows installer is available and short recording, editing, saving, and export workflows have been tested in the packaged app. macOS is still in development and Camtasia import is limited. This release does not provide complete Camtasia feature parity; see [compatibility](#compatibility). The application UI is currently Chinese; this README is available in both languages.

## Highlights

| Capability                                   | What you can do                                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Edit the cursor after recording**          | Windows native recording stores cursor data separately. Choose an arrow, circle, or cross; change size and color; hide the cursor; enable smooth movement and click highlights.               |
| **Add text beside the timeline**             | Insert text in one click with white text with black outlines, black text with white outlines, and yellow text with black outlines. Center captions on the canvas to create text-based videos. |
| **Animate without drag-only controls**       | Add fade, zoom, and slide animations from the context menu or presets. Auto animation records keyframes when you change position, scale, or opacity.                                          |
| **Local speech captions**                    | sherpa-onnx runs SenseVoiceSmall/Paraformer ONNX models with real word or speech-segment timings, source trimming, and playback speed alignment.                                    |
| **Pitch-preserving speed and podcast audio** | Export prefers Rubber Band for pitch preservation. Audio processing includes noise reduction, EQ, compression, loudness adjustment, and a processed audition.                                 |
| **Readable, portable projects**              | Readable JSON projects collect media and cursor data in one folder using relative paths, with a custom folder icon on Windows.                                                                |

TronCut also provides multitrack editing, multiple selection, grouping, synchronized moves, splitting, snapping, ripple deletion, undo/redo, crop and rotation, color and blur effects, fades, thumbnails, overview waveforms, and missing-media relinking. MP4 export tries an available hardware encoder before falling back to software encoding.

## Download and get started

Download from **[GitHub Releases](https://github.com/Achuan-2/TronCut/releases/tag/v0.4.0)**:

| File                                  | Purpose                                                           |
| ------------------------------------- | ----------------------------------------------------------------- |
| `TronCut-Setup-0.4.0-windows-x64.exe` | Windows x64 installer with a configurable installation directory. |
| `TronCut-0.4.0-windows-x64.zip`       | Portable build; extract the entire archive and run `TronCut.exe`. |
| `SHA256SUMS.txt`                      | SHA256 checksums for release files.                               |

Windows packages include the media engine, native recording helpers, and the speech environment manager. End users do not need to install Node.js, FFmpeg, or uv. **The first speech-caption task needs internet access to download Python, dependencies, and models**; speech recognition then runs locally. The current Windows build is unsigned.

See the [user documentation](docs/README.md) for media, recording cursors, timeline editing, text, canvas animation, and project management. Start with [Getting started](docs/GETTING-STARTED.md). These guides currently use Chinese to match the application UI.

## Compatibility

| Item                             | Current status                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows x64                      | Installer and packaged desktop workflows tested; real-device synchronization, long sessions, and 4K stress testing remain outstanding.                                                               |
| macOS                            | Cross-platform source and DMG configuration exist; no Mac release has been verified on a real device.                                                                                                |
| Camtasia `.tscproj`              | Converts common media references, flat clips, timing, speed, and some transforms. An import report and the original JSON are retained.                                                               |
| TREC and proprietary backgrounds | **Complete import is not supported.** A real project test skipped three TREC recordings and a water-ripple background; only the music was converted.                                                 |
| Speech engines                   | SenseVoiceSmall/Paraformer recognition and Kokoro/VITS narration use sherpa-onnx on CPU, with model download and offline options. |
| Voice enhancement                | DSP processing is available. Canvas playback uses the original audio; processed audition and export use the filters. AI voice reconstruction is not included.                                        |

A complete effects library, nested sequences, TREC cursor metadata, proxy media, a shared GPU compositor, and GIF/audio/interactive exports remain unfinished. Hardware encoding does not mean the entire pipeline is GPU accelerated. Professional audio blind tests and large-project performance comparisons have not been completed.

## Local development

Use **Node.js 22+ and pnpm**. Speech development uses **uv and Python 3.11/3.12**. Windows native helpers require the Visual Studio 2022 C++ toolchain, Windows SDK 10.0.22621+, and CMake.

```sh
git clone https://github.com/Achuan-2/TronCut.git
cd TronCut
pnpm install --frozen-lockfile
pnpm dev
```

For development, FFmpeg/FFprobe can be found on PATH or selected in Settings. Standalone binaries are not committed to Git; see [building and releases](docs/BUILDING.md) for packaging prerequisites. Vite alone previews the interface; file access, recording, and export require Electron.

```sh
pnpm build          # Typecheck and build the editor and Electron processes
pnpm test           # Core logic and actual FFmpeg tests; media engines required
pnpm test:smoke     # Electron desktop regression; run build and test first
```

## Documentation and contributing

- [User documentation and modules](docs/README.md) · [Getting started](docs/GETTING-STARTED.md)
- [Feature checklist and roadmap](docs/FEATURES.md) · [Architecture and project format](docs/ARCHITECTURE.md)
- [Building and releases](docs/BUILDING.md) · [Validation record](docs/VALIDATION.md)
- [SenseVoice measurements](docs/SENSEVOICE.md) · [Real Camtasia project test](docs/CAMTASIA-REAL-PROJECT-TEST.md)
- [Contribution guide](CONTRIBUTING.md) · [Open an issue](https://github.com/Achuan-2/TronCut/issues/new/choose)

Reproducible bugs, compatibility samples, test results, and code improvements are welcome. Remove private media and sensitive information before sharing projects or logs. Detailed engineering documents are currently primarily in Chinese.

## License and acknowledgements

Original TronCut code is licensed under **[AGPL-3.0](LICENSE)**. Third-party source, binaries, and models retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Camtasia is a TechSmith product name. TronCut is an independent project and is not affiliated with or endorsed by TechSmith.

Thanks to [OpenScreen](https://github.com/getopenscreen/openscreen) for its MIT native capture components, and to [FFmpeg](https://ffmpeg.org/), [Rubber Band](https://breakfastquay.com/rubberband/), [SenseVoice](https://github.com/QwenAudio/SenseVoice), [FunASR](https://github.com/modelscope/FunASR), [uv](https://github.com/astral-sh/uv), Electron, React, and sharp. Additional study references and pinned commits are listed in [references/README.md](references/README.md).
