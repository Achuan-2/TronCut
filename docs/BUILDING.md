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

The installer is written to `release/TronCut Setup 0.4.1.exe`; the unpacked app is under `release/win-unpacked/`. Test the packaged app before uploading. Release asset names use hyphens for stable direct-download URLs.

```powershell
$env:FRAMECRAFT_PACKAGED_SMOKE='1'
$env:FRAMECRAFT_RECORDING_SMOKE='1'
pnpm test:smoke
```

Automated tests replace file dialogs only in their test process. Recording tests capture a short session; they are not a substitute for device synchronization, cursor accuracy, long-session, or performance tests.

## macOS

Build on a Mac with the matching Electron architecture, runnable FFmpeg/FFprobe and uv binaries, and their licenses in `resources/bin`, then run `pnpm dist:mac`. Release CI builds separate Apple Silicon and Intel DMGs on matching native runners. It downloads pinned, SHA256-verified FFmpeg/FFprobe 6.1.1 and uv 0.6.5 binaries before packaging.

Apple signing and notarization are not configured. The workflow deliberately publishes the unsigned DMGs without a packaged-app smoke test or real-device acceptance. Users must validate installation, Gatekeeper handling, permissions, recording, editing, and export on their Macs and report failures.

Mac 安装包不要求先完成本地验收。工作流直接构建并发布 arm64 与 x64 DMG，但不会把 CI 构建成功表述为真机安装、权限、录制或导出已经通过；这些项目交给使用者验证。

## Publishing / 发布

请求发布但未指定版本号时，默认将当前版本的末位（patch）加 1，例如 v0.4.1 → v0.4.2；明确指定版本号时按指定版本执行。

Release 标题填写在 GitHub 的标题栏；`docs/releases/v<version>.md` 正文直接从简介开始，不再添加 `# TronCut v<version>`，避免页面重复显示标题。

The [Build release workflow](../.github/workflows/release.yml) runs when a GitHub Release is published, including prereleases. It checks that `v<version>` matches `package.json` and checks out the exact tag commit. The Windows job downloads SHA256-verified FFmpeg 9.0.2 and uv 0.6.5, compiles the native capture helpers, runs tests and the packaged editing regression, and produces the x64 installer and portable ZIP. Native macOS jobs produce unsigned arm64 and x64 DMGs without local acceptance tests. The final job combines checksums before uploading all packages. Upload permissions are limited to that final job; no extra secret or personal access token is required.

发布正式 Release 或预发布后，GitHub Actions 会自动上传 Windows x64 安装包、免安装 ZIP、macOS arm64/x64 DMG、FFmpeg 上游源码及统一 SHA256 校验文件，不再生成或上传 `build-info.json`。TronCut 项目源码由 GitHub 版本标签提供，不再重复生成 `TronCut-<version>-source.zip`。先修改 `package.json` 版本并提交，推送对应 `v<version>` 标签，再在 GitHub 发布该标签的 Release。正式版不勾选预发布；普通提交或仅推送标签不会触发发版。

To rebuild an existing release, open **Actions → Build release → Run workflow**, select `main`, and enter the existing tag. Upload replaces assets with the same names and regenerates checksums; the Release description, visibility, and prerelease state are preserved. Uncheck **Upload packages** to build only: packages remain available as Actions artifacts for 14 days. A failed build does not run the upload job, and a failed upload can be retried without rebuilding by rerunning the failed job. This workflow does not create commits, tags, or Releases.

也可先创建 Release 草稿，再手动运行该工作流构建并上传附件，校验完成后公开正式版。草稿存在性检查由具有 `contents: write` 的上传任务执行，其余任务保留只读权限；源码按版本标签锁定。

已有版本补包：在 **Actions → Build release → Run workflow** 中选择 `main`，输入标签即可。取消 **Upload packages** 可只构建而不发附件，保留明确的“不发版”入口。工作流不会创建或修改提交、标签、Release 文案或预发布状态。同名附件会被替换，校验文件会同步更新；上传过程失败可能留下部分附件，重跑失败任务可以继续上传。

The first `v0.2.0` tag omitted `index.html`. Only this tag may restore that existing entry from the workflow commit. The Actions run records the source checkout and restoration step. Subsequent tags must contain their complete source. Windows and macOS CI packages remain unsigned; the Mac packages are also unnotarized. CI success does not replace installation, permission, capture, export, or performance acceptance on actual devices.

首次 `v0.2.0` 标签漏收了 `index.html`，仅该版本补包允许从工作流提交恢复现有入口，源码检出与恢复步骤保留在 Actions 运行记录中。后续版本缺少入口会直接报错。当前工作流发布 Windows x64 与 Mac arm64/x64，所有平台仍未配置代码签名，Mac 真机验收由使用者完成。
