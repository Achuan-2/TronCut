# 参与 TronCut / Contributing to TronCut

[简体中文](#简体中文) · [English](#english)

## 简体中文

感谢参与。请先查看 [功能清单](docs/FEATURES.md)，将问题或改动限定为一个明确目标。

### 报告问题

请在 [Issues](https://github.com/Achuan-2/TronCut/issues/new/choose) 提供软件版本、系统与硬件、复现步骤、预期与实际结果。录屏、字幕和导入问题请附素材格式、时长与导入报告；如提供样本，先移除敏感信息并确认有权分享。

### 提交代码

1. 从 `main` 创建分支，使用 pnpm 管理 Node 依赖、uv 管理语音环境。
2. 保持改动集中，保留既有工程和素材；不要提交 `references/` 克隆、模型、缓存、私人工程或构建二进制。
3. 运行 `pnpm build`，以及与行为改动相关的测试。`pnpm test` 包含真实 FFmpeg 测试，需要可用媒体引擎。
4. 原生录制、预览与导出变更需要对应平台的实际测试；明确区分源码检查、自动化和真机验证。
5. 提交信息使用 `gitmoji + 内容描述`；PR 说明问题、最终行为和验证结果。英文提交说明也可以。

GitHub 上的源码许可为 AGPL-3.0-only；第三方文件保留原许可。贡献者须有权提交相关代码，不要引入来源不明的资产或代码。

## English

Please check the [feature checklist](docs/FEATURES.md) first and keep each issue or change focused on one clear objective.

### Report a problem

Use [Issues](https://github.com/Achuan-2/TronCut/issues/new/choose) and include the app version, OS and hardware, reproduction steps, and expected versus actual behavior. For recording, captions, or import problems, include media format, duration, and the import report. Remove sensitive information and make sure you can share any sample.

### Submit code

1. Branch from `main`. Use pnpm for Node dependencies and uv for speech environments.
2. Keep changes focused and preserve existing projects and media. Do not commit reference clones, models, caches, private projects, or build binaries.
3. Run `pnpm build` and relevant behavioral tests. `pnpm test` includes real FFmpeg tests and requires working media engines.
4. Native recording, preview, and export changes need testing on the relevant platform. Distinguish source checks, automation, and real-device validation.
5. Use `gitmoji + description` for commit messages. Describe the problem, final behavior, and validation in your PR; English is welcome.

Original repository code is AGPL-3.0-only; third-party files retain their licenses. Only submit code and assets you are authorized to contribute.
