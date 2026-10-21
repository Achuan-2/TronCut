# README 功能截图

`editor.png` 和 `feature-*.png` 来自当前 TronCut Electron 桌面程序的实际界面，中英文 README 共用。演示项目使用脚本创建的背景、可编辑标题、示例字幕和实际合成的 Windows 系统旁白，不读取个人项目。录屏美化图仅截取设置区域，不包含桌面与其他窗口缩略图。

在 Windows 上准备好项目依赖、FFmpeg、FFprobe 和可用的系统音色后，重新生成：

```powershell
pnpm build
node scripts/capture-readme-screenshots.mjs
```

脚本使用 `test-output/readme-screenshots-<时间戳>/` 下的独立项目和用户配置，依次操作媒体、标注、行为、动画、视觉效果、字幕、旁白、导出与录屏设置，再更新本目录的截图。截图仅做尺寸调整和 PNG 压缩，不修改界面内容。重新生成后应人工检查图片清晰度、控件状态和 README 中的说明；截图不作为录屏、识别或导出功能的完整验收。
