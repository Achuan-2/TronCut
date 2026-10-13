# 构建与发布 / Building and releases

## Development / 开发

Use Node.js 22+ and pnpm. Clone the repository, run `pnpm install --frozen-lockfile`, then `pnpm dev`. Development data stays in `.framecraft-dev/`; this legacy directory name is retained for compatibility. Installed builds use the OS application-data directory.

使用 Node.js 22+ 与 pnpm。语音环境使用 uv 与 Python 3.11/3.12，独立模型在第一次转录时下载；不要将模型或虚拟环境提交到源码仓库。

## Windows engines / Windows 引擎

The Git repository intentionally excludes standalone binaries. Before packaging, prepare all of the following in `resources/bin/`:

| File                                 | Preparation                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ffmpeg.exe / ffprobe.exe             | Download and verify the Gyan essentials build using `node scripts/fetch-engines.mjs`. Extract the archive from `.cache/engines/ffmpeg.zip`, copy both binaries from its bin/ directory, and retain its LICENSE/README. |
| wgc-capture.exe / cursor-sampler.exe | Run `powershell -ExecutionPolicy Bypass -File scripts/build-native.ps1`. Requires Visual Studio 2022 C++, Windows SDK 10.0.22621+, and CMake.                                                                          |
| uv.exe                               | Obtain uv 0.6.5 Windows x64 from [the official release](https://github.com/astral-sh/uv/releases/tag/0.6.5) and retain its MIT/Apache license files.                                                                   |

首次公开版本使用 FFmpeg 9.0.2、uv 0.6.5 和 vendored OpenScreen C++ 捕获组件。精确 FFmpeg 来源与压缩包校验值在 `resources/bin/manifest.json`，第三方声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。开发时也可使用 PATH 或设置面板中的媒体引擎，但打包要求引擎随程序分发。

```powershell
pnpm build
pnpm test
pnpm test:smoke
pnpm dist:win
```

The installer is written to `release/TronCut Setup 0.2.0.exe`; the unpacked app is under `release/win-unpacked/`. Test the packaged app before uploading. Release asset names use hyphens for stable direct-download URLs.

```powershell
$env:FRAMECRAFT_PACKAGED_SMOKE='1'
$env:FRAMECRAFT_RECORDING_SMOKE='1'
pnpm test:smoke
```

Automated tests replace file dialogs only in their test process. Recording tests capture a short session; they are not a substitute for device synchronization, cursor accuracy, long-session, or performance tests.

## macOS

Build on a Mac with the matching Electron architecture, runnable FFmpeg/FFprobe and uv binaries, and their licenses in resources/bin. Then run `pnpm dist:mac`. The configuration exists, but no Mac artifact is published until real-device capture, permissions, export, and installation have been validated. Apple signing/notarization is not configured in this preview.

在 Mac 真机完成上述检查前，不将 Windows 上的源码检查视为 Mac 安装与录屏验收。

## Publishing / 发布

Release steps are manual. Check the version, licenses, source contents, and validation record; commit with `gitmoji + description`, tag `v<version>`, then publish a GitHub prerelease for preview builds. Upload the Windows installer, complete portable archive, source archive, third-party source information, and SHA256SUMS.txt. Verify the uploaded assets and remote tag after publishing.

发布不会由普通提交自动触发。未完成签名、Mac 或完整 Camtasia 导入的版本应在 Release 中明确标记为预发布，并与双语 README 的兼容说明保持一致。
