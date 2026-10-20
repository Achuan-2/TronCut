# 多轨项目预览性能与媒体播放

2026-10-18，使用 `export/TronCut宣传片-20261017/TronCut宣传片-v12-丝滑版.troncut`（48 秒、160 个片段）验证。本次保留项目格式、素材原文件和时间线编辑能力，不将项目烘焙成单一视频。

## 问题与处理

时间线原来只有横向虚拟化，屏幕外的轨道仍挂载大量动画箭头、端点和 SVG 控件。隐藏这些控件的对照实验让界面刷新间隔从约 67–117 ms 恢复到约 16.7 ms。现在保留完整轨道占位与滚动几何，只挂载垂直视区及上下 100 px 内的片段控件；拖动中的片段保留挂载。播放指针使用独立合成层的横向 transform 移动。

媒体播放拆为 `PreviewMedia` 和独立同步控制器。异步加载完成后按最新播放头定位；解码器正在 seek 时合并后续请求，避免逐帧重置 seek 导致无法完成解码；加载、可播放和 seek 完成事件会重试被加载打断的播放。播放失败显示具体素材名。

媒体按轨道、素材和重叠关系分配稳定槽位。相邻剪切复用解码器，重叠片段保持各自槽位，避免前一片段结束时后一片段被重新挂载。预加载未来 1.5 秒内的空闲槽位，最多 6 个，保持隐藏、暂停和静音；不占用仍在播放的槽位。查找从时间二分定位开始。

预览媒体的 `revision=0` 固定读取原片，`revision=1` 在代理就绪后读取代理。代理生成不能改变原片 URL 后续 Range 请求的文件来源。播放中的可用解码器延迟到暂停后切代理，尚未出帧或预加载中的解码器可以立即切换。代理缓存采用新版本标识、15 帧 GOP 和有限编码线程，旧缓存不会冒充新编码配置。

## 本机验证

同一 4–9 秒区间的 Electron 桌面采样：

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 界面 rAF 间隔中位数 | 116.8 ms | 16.7 ms |
| 界面 rAF 间隔 P95 | 150.3 ms | 17.3 ms |
| 5 秒采样中超过 50 ms 的间隔数 | 42 | 3 |
| 当时挂载的时间线片段控件 | 122 | 14 |

两轮 48 秒连续播放验证：界面间隔中位数 16.7 ms，P95 为 17.0 ms；9 个视频片段均持续产生解码帧，采样未检测到暂停、未就绪或错误，视频时间与播放头的最大偏差小于 45 ms。关键画面截图也确认录屏内容正常显示。

相关 49 项单元与集成测试、跨素材解码像素与定位测试、时间线滚动与缩放、真实音视频暂停与继续、代理 Range 来源固定和播放中延迟切换测试通过。另验证已缓存的 GIF 代理在背景预览打开时仍可获取。

播放重构的完整生产构建曾通过。收尾时工作区出现其他并行修改，最后一次全量构建及类型检查被 `shared/annotations.ts:266` 的 `AnnotationPreset` 类型不匹配阻塞；未修改该文件。本次最后的 Electron 构建与代理兼容性实测已独立通过。

rAF 数据描述界面响应，不能等同于每个素材的实际解码帧率；视频推进另用 `getVideoPlaybackQuality()` 和 `currentTime` 验证。连续播放测试会关闭测试窗口的后台节流，防止自动化失去系统焦点后被 Chromium 限速至 1 Hz。本机结果不代表其他设备的性能，也不构成安装包验收。

## 复测

```powershell
pnpm run build
node scripts/bench-project-playback.mjs 'export/TronCut宣传片-20261017/TronCut宣传片-v12-丝滑版.troncut' 4
node scripts/smoke-project-playback.mjs 'export/TronCut宣传片-20261017/TronCut宣传片-v12-丝滑版.troncut'
node scripts/smoke-preview-media-switch.mjs
node scripts/smoke-preview-proxy-switch.mjs
node scripts/test-playback-ui.mjs
node scripts/smoke-timeline-scroll.mjs
```

`smoke-project-playback.mjs` 接受 JSON 项目，记录每个视频片段的连续播放状态，并输出关键时间点截图与 JSON 报告。临时素材、独立测试配置、代理和报告保存在 `test-output`，不改写输入项目。
