# TronCut 宣传视频制作 - 快速开始指南

> 5 分钟快速上手，制作一个专业的 TronCut 宣传视频

---

## 🎯 30 秒概览

**目标:** 制作 3-5 分钟的宣传视频，展示 TronCut 的 7 大核心功能

**方法:**
1. 用 TronCut 本身录屏演示
2. 生成配音和字幕
3. 添加文字和动画
4. 导出为 MP4

**时间:** 6-10 小时（取决于素材质量）

---

## 📦 文件结构

```
TronCut/
├── docs/
│   ├── PROMO-VIDEO-GUIDE.md          # 📘 完整制作指南
│   ├── PROMO-VIDEO-CHECKLIST.md      # ✅ 逐步检查清单
│   ├── AI-EXTERNAL-EDIT-WORKFLOW.md  # 🤖 AI 自动化工作流
│   └── PROMO-VIDEO-QUICK-START.md    # ⚡ 本文件
├── scripts/
│   ├── promo-video-plan.json         # 📋 工程计划
│   ├── extract-frames-plan.json      # 📸 抽帧配置
│   ├── voiceover-plan.json           # 🎙️ 配音配置
│   ├── generate-script.mjs           # 🤖 脚本生成
│   └── auto-create-video.mjs         # ⚙️ 自动化流程
└── assets/
    ├── demo_videos/                  # 演示视频
    ├── voiceovers/                   # 配音文件
    └── background_music/             # 背景音乐
```

---

## ⚡ 快速开始 (3 条路线选择)

### 路线 A: 完全手动制作 (推荐新手)
**适合:** 想要完全掌控整个过程

```bash
# 1. 准备素材
# 打开 TronCut，开始录屏演示各项功能

# 2. 编辑与制作
# 在 TronCut 中导入录屏，添加文字、动画、配音

# 3. 导出
# 设置 1080p / 30fps，选择 H.264，导出 MP4
```

**预期时间:** 8-10 小时
**优点:** 最灵活，完全掌控
**缺点:** 需要最多手动工作

---

### 路线 B: 混合工作流 (推荐中级)
**适合:** 想要自动化某些步骤

```bash
# 1. 录屏并粗切
pnpm --silent cli run --plan scripts/extract-frames-plan.json

# 2. 使用 AI 生成脚本和配音
node scripts/generate-script.mjs
pnpm --silent cli run --plan scripts/voiceover-plan.json

# 3. 手动在 TronCut 中组织
# 导入生成的配音和脚本，手动排列

# 4. 最终导出
pnpm --silent cli run --plan scripts/export-plan.json
```

**预期时间:** 4-6 小时
**优点:** 平衡手动和自动化
**缺点:** 需要中等技术水平

---

### 路线 C: 完全自动化 (推荐高级)
**适合:** 想要端到端自动化

```bash
# 一条命令完成所有
node scripts/auto-create-video.mjs

# 或通过 GitHub Actions
# 在 GitHub 上触发工作流
```

**预期时间:** 2-3 小时（处理时间）
**优点:** 最快，最少干预
**缺点:** 需要配置环境变量

---

## 🚀 立即开始（3 步）

### 第 1 步：准备环境 (10 分钟)

```bash
# 安装依赖
pnpm install

# 构建 TronCut
pnpm build

# 验证 CLI 可用
pnpm --silent cli help
```

### 第 2 步：录制素材 (1-2 小时)

使用 TronCut 本身录屏演示：

```
需要录制的场景：
□ 打开 VS Code/浏览器 (30s)
□ TronCut 录屏功能演示 (30s)
□ 编辑和动画功能演示 (30s)
□ 文字和字幕功能演示 (30s)
□ 配音功能演示 (30s)
□ 工程管理演示 (30s)
□ CLI 演示 (30s)
□ CTA 和结尾 (30s)

总计: 4-5 分钟素材
```

### 第 3 步：选择工作流

**选择 A（手动）:**
```bash
# 打开 TronCut UI
pnpm dev

# 创建新工程，导入素材，编辑，导出
```

**选择 B（混合）:**
```bash
# 查看清单
cat docs/PROMO-VIDEO-CHECKLIST.md

# 执行每个步骤
pnpm --silent cli run --plan scripts/voiceover-plan.json
```

**选择 C（自动）:**
```bash
# 配置环境
cp .env.example .env
# 编辑 .env 填入 API 密钥

# 运行自动化
node scripts/auto-create-video.mjs
```

---

## 📝 配音脚本（可复制使用）

### 完整脚本（120 秒）

**第 1 段（20 秒）**
> "欢迎来到 TronCut，一个为教程制作者设计的专业级本地视频编辑工具。它集录屏、剪辑、动画、转录和配音于一身。"

**第 2 段（20 秒）**
> "首先，TronCut 提供原生录屏功能。你可以自定义录制范围、编辑鼠标、添加自动缩放。录屏后，可以继续编辑——改变鼠标样式、大小或添加点击高亮。"

**第 3 段（20 秒）**
> "编辑非常直观。拖动媒体片段到多轨时间线。添加动画只需右键选择——淡入、缩放或滑入。启用自动动画后，修改位置和透明度就自动生成关键帧。"

**第 4 段（20 秒）**
> "文字处理有多种模板。用 Qwen3 ASR 或 SenseVoice 从音频自动生成准确字幕，完全离线。对于配音，可选系统语音、Kokoro 或 VITS 模型，还支持声音克隆。"

**第 5 段（20 秒）**
> "声音处理包括降噪、均衡、压缩和响度处理。工程采用可读 JSON 格式，媒体和轨迹在同一目录。支持相对路径便于迁移，还能导入 Camtasia 工程。"

**第 6 段（20 秒）**
> "高级用户可以使用完整的 CLI 接口。所有功能都返回结构化 JSON，为 AI 外部编辑打开大门。例如用 AI 根据截帧生成脚本，再由 TronCut 自动配音和导出。"

---

## 🎨 设计建议

### 配色方案
- 主色: 蓝绿 (#00BCD4 或 #009688)
- 辅色: 深灰 (#2C3E50)
- 背景: 深色 (#1A1A1A)
- 强调: 白色 (#FFFFFF)

### 字体建议
- 标题: 微软雅黑 / 思源黑体（粗体，48-56px）
- 正文: 微软雅黑 / 思源黑体（常规，24-28px）

### 动画建议
- 淡入淡出: 0.3-0.5 秒
- 滑入: 0.5-0.8 秒
- 缩放: 0.4-0.6 秒

---

## ✅ 关键检查点

在导出前检查以下内容：

- [ ] 视频时长 3-5 分钟
- [ ] 分辨率 1920x1080
- [ ] 帧率 30fps
- [ ] 所有文字清晰可读
- [ ] 配音清晰无噪音
- [ ] 所有动画流畅自然
- [ ] 音视频完全同步
- [ ] 整体色彩和谐
- [ ] 没有遗漏片段

---

## 📊 时间分解

| 任务 | 时间 | 难度 |
|------|------|------|
| 环境准备 | 10 分钟 | ⭐ |
| 录屏素材 | 1-2 小时 | ⭐⭐ |
| 基础编辑 | 1-2 小时 | ⭐⭐ |
| 配音与字幕 | 1 小时 | ⭐ |
| 动画与特效 | 1-2 小时 | ⭐⭐⭐ |
| 音频混音 | 30-45 分钟 | ⭐⭐ |
| 导出与验证 | 30-60 分钟 | ⭐ |
| **总计** | **6-10 小时** | - |

---

## 🤖 使用 AI 加速

### Claude AI 可以帮你：
1. **生成脚本** - 根据关键帧生成解说
2. **优化配音** - 改进文案的流畅性
3. **构建工作流** - 编写自动化脚本
4. **质量审查** - 检查视频的一致性

### 如何使用：
```bash
# 1. 提取关键帧
pnpm --silent cli run --plan scripts/extract-frames-plan.json

# 2. 上传到 Claude
# (手动或通过 API)

# 3. 获取生成的脚本
# 复制到 generated_script.json

# 4. 自动化处理
node scripts/organize-to-troncut.mjs
```

---

## 🆘 常见问题

**Q: 我没有配音设备怎么办？**
A: 使用 TronCut 的 TTS 功能——Windows 系统语音、Kokoro 或 VITS 都很不错。

**Q: 视频导出太慢？**
A: 启用硬件加速（NVIDIA NVENC 或 AMD VCE），或降低比特率。

**Q: 怎样从 GitHub Actions 自动生成？**
A: 参考 [AI 外部编辑工作流](AI-EXTERNAL-EDIT-WORKFLOW.md) 中的 GitHub Actions 配置。

**Q: 可以用中文配音吗？**
A: 完全可以！在 TTS 设置中选择中文语音即可。

---

## 🎁 模板和资源

### 下载预制模板
```bash
# 获取所有配置文件
ls scripts/*-plan.json

# 复制到你的项目
cp scripts/promo-video-plan.json my-project/
```

### 免费音乐和音效
- [Epidemicsound](https://www.epidemicsound.com/)
- [Artlist](https://artlist.io/)
- [Pixabay Music](https://pixabay.com/music/)
- [YouTube Audio Library](https://www.youtube.com/audiolibrary)

---

## 📚 深入学习

需要更多细节？查看：
- 📘 [完整制作指南](PROMO-VIDEO-GUIDE.md)
- ✅ [制作清单](PROMO-VIDEO-CHECKLIST.md)
- 🤖 [AI 工作流](AI-EXTERNAL-EDIT-WORKFLOW.md)
- 📖 [完整文档](README.md)

---

## 💬 需要帮助？

- 📞 GitHub Issues: https://github.com/Achuan-2/TronCut/issues
- 💭 讨论区: https://github.com/Achuan-2/TronCut/discussions
- 📧 邮件: [提交问题](https://github.com/Achuan-2/TronCut/issues/new/choose)

---

**准备好了？现在就开始制作你的 TronCut 宣传视频吧！🚀**
