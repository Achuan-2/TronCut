# 构建与发布 / Building and releases

## Development / 开发

Use Node.js 22+, pnpm, and Rust 1.85+. Install the Wasm target with `rustup target add wasm32-unknown-unknown`, run `pnpm install --frozen-lockfile`, then `pnpm dev`. Development data stays in `.framecraft-dev/`; this legacy directory name is retained for compatibility. Installed builds use the OS application-data directory.

使用 Node.js 22+、pnpm 与 Rust 1.85+，首次构建前执行 `rustup target add wasm32-unknown-unknown`。`pnpm dev` 和 `pnpm build` 自动构建并嵌入 Rust 时间线引擎，终端用户无需 Rust。详见 [Rust 引擎与性能](RUST-ENGINE.md)。语音环境使用 uv 与 Python 3.11/3.12，独立模型在第一次转录时下载；不要将模型或虚拟环境提交到源码仓库。

## Windows engines / Windows 引擎

The Git repository intentionally excludes standalone binaries. Before packaging, prepare all of the following in `resources/bin/`:

| File                                 | Preparation                                                                                                                                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ffmpeg.exe / ffprobe.exe             | Download and verify the Gyan essentials build using `node scripts/fetch-engines.mjs`. Extract the archive from `.cache/engines/ffmpeg.zip`, copy both binaries from its bin/ directory, and retain its LICENSE/README. |
| wgc-capture.exe / cursor-sampler.exe / recording-border.exe | Run `powershell -ExecutionPolicy Bypass -File scripts/build-native.ps1`. Requires Visual Studio 2022 C++, Windows SDK 10.0.22621+, and CMake.                                                                          |
| uv.exe                               | Obtain uv 0.6.5 Windows x64 from [the official release](https://github.com/astral-sh/uv/releases/tag/0.6.5) and retain its MIT/Apache license files.                                                                   |

首次公开版本使用 FFmpeg 9.0.2、uv 0.6.5 和 vendored OpenScreen C++ 捕获组件。精确 FFmpeg 来源与压缩包校验值在 `resources/bin/manifest.json`，第三方声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。开发时也可使用 PATH 中的媒体引擎，但打包要求引擎随程序分发。

```powershell
pnpm build
pnpm test
pnpm test:smoke
pnpm dist:win
```

The installer is written to `release/TronCut Setup 0.6.3.exe`; the unpacked app is under `release/win-unpacked/`. Test the packaged app before uploading. Release asset names use hyphens for stable direct-download URLs.

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

默认发布只更新版本和发布说明，完成本地 Git commit 并在该提交上创建对应标签；不自动推送，不创建 GitHub Release，不触发、查询、等待或重试 GitHub Actions，也不以云端构建或附件上传作为完成条件。GitHub Actions 暂时不可用；需要推送、构建安装包或上传附件时，按当次明确要求执行。

The default release consists of version/release-note updates, a local Git commit, and a matching annotated tag. Do not automatically push, create a GitHub Release, or trigger, inspect, wait for, or retry GitHub Actions. Build or upload installers only when explicitly requested.

请求发布但未指定版本号时，默认在最近已发布版本上递增 patch；如果工作区已经准备了下一版本且尚无对应标签，就完成该版本，不再重复递增。明确指定版本号时按指定版本执行。

发布前核对版本、说明和已完成的本地验证，仅暂存发布相关文件；保留用户其他修改。提交格式为 `🔖 v<version> / <yyyyMMdd>`，随后执行 `git tag -a v<version> -m "TronCut v<version>"`，最后核对标签指向该发布提交。

### Optional GitHub Actions / 可选工作流（当前不使用）

Release 标题填写在 GitHub 的标题栏；`docs/releases/v<version>.md` 正文直接从简介开始，不再添加 `# TronCut v<version>`，避免页面重复显示标题。

The [Build release workflow](../.github/workflows/release.yml) runs only through manual dispatch. Publishing a GitHub Release does not trigger builds or uploads. It checks that `v<version>` matches `package.json` and checks out the exact tag commit. The Windows job downloads SHA256-verified FFmpeg 9.0.2 and uv 0.6.5, compiles the native capture helpers, and builds the x64 installer and portable ZIP. Run the full test suite and packaged desktop regressions separately before publishing; the current workflow only builds, packages, and verifies release assets. Native macOS jobs produce unsigned arm64 and x64 DMGs without local acceptance tests. The final job combines checksums before uploading all packages when explicitly enabled. Upload permissions are limited to that final job; no extra secret or personal access token is required.

发布正式 Release 或预发布均不会触发 GitHub Actions，允许 Release 仅包含更新说明。本地 Windows 打包使用 `pnpm build`、`node scripts/check-packaging.mjs` 和 `pnpm exec electron-builder --win nsis --x64 --publish never`，生成的 EXE 仅保存在本地。只有明确要求云端构建或上传时，才手动运行工作流；**Upload packages** 默认关闭。启用上传后会发布 Windows x64 安装包、免安装 ZIP、macOS arm64/x64 DMG、FFmpeg 上游源码及统一 SHA256 校验文件。TronCut 项目源码由 GitHub 版本标签提供，不再重复生成源码 ZIP 或 `build-info.json`。

To rebuild an existing release, open **Actions → Build release → Run workflow**, select `main`, and enter the existing tag. Upload replaces assets with the same names and regenerates checksums; the Release description, visibility, and prerelease state are preserved. Uncheck **Upload packages** to build only: packages remain available as Actions artifacts for 14 days. A failed build does not run the upload job, and a failed upload can be retried without rebuilding by rerunning the failed job. This workflow does not create commits, tags, or Releases.

也可先创建 Release 草稿，再手动运行该工作流构建并上传附件，校验完成后公开正式版。草稿存在性检查由具有 `contents: write` 的上传任务执行，其余任务保留只读权限；源码按版本标签锁定。

已有版本补包：在 **Actions → Build release → Run workflow** 中选择 `main`，输入标签即可。取消 **Upload packages** 可只构建而不发附件，保留明确的“不发版”入口。工作流不会创建或修改提交、标签、Release 文案或预发布状态。同名附件会被替换，校验文件会同步更新；上传过程失败可能留下部分附件，重跑失败任务可以继续上传。

重新发布已有版本并纳入新改动时，先完成验证和提交，将原版本标签更新到该完整提交 SHA，并同步更新 Release 的目标提交和说明，再触发上述工作流。构建完成后确认 Windows 安装包与免安装包、macOS 两种架构的 DMG 及统一校验文件均已替换；只重跑旧标签的工作流不会包含工作区新代码。

The first `v0.2.0` tag omitted `index.html`. Only this tag may restore that existing entry from the workflow commit. The Actions run records the source checkout and restoration step. Subsequent tags must contain their complete source. Windows and macOS CI packages remain unsigned; the Mac packages are also unnotarized. CI success does not replace installation, permission, capture, export, or performance acceptance on actual devices.

首次 `v0.2.0` 标签漏收了 `index.html`，仅该版本补包允许从工作流提交恢复现有入口，源码检出与恢复步骤保留在 Actions 运行记录中。后续版本缺少入口会直接报错。当前工作流发布 Windows x64 与 Mac arm64/x64，所有平台仍未配置代码签名，Mac 真机验收由使用者完成。
