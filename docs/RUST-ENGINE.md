# Rust 引擎与性能迁移

TronCut 采用 Rust 引擎配合现有 React 界面。参考 Filmcraft 的分层与共享引擎思路，逐步替换性能敏感路径，保留现有录屏、字幕、配音和 JSON 工程。当前 Rust 已接管时间线和转场接点查询，并改进动画采样、动画标记绘制与缩略图缓存；尚未完成全部后端迁移。

## 当前实现

`crates/troncut-engine` 是零第三方依赖的 Rust crate，可编译为原生库与 WebAssembly。`shared/rust-engine.ts` 封装版本化数值 ABI，`shared/project-index.ts` 将现有片段映射为区间索引。React 播放预览与时间线视口筛选直接调用同进程 Wasm，不经过 Electron IPC，不在每帧序列化整个工程。

每条轨道使用带子树最大结束时间的平衡区间树，支持长片段覆盖短片段、同轨重叠、随机跳转和轨道查询。查询只访问可能命中的树节点；结果按原片段顺序返回，保持绘制与层叠顺序。剪辑数组变化时重建索引，播放头变化不重建。缓存最多保存两份片段数组的索引，淘汰时立即释放 Rust 分配，独立于撤销历史和 JS GC。Wasm 线性内存不会主动缩小，已释放空间供后续索引复用。

预览索引包括成对转场延伸的区间，保留选中关键帧片尾的显示；没有成对转场时直接复用普通区间索引。缩放预览草稿复用源时间索引，查询后解析当前变换。视口查询保留两端边界和正在拖动的片段。源时间、关键帧、变速和工程序列化仍由原有模型处理，继续使用 v1 工程的秒值，未擅自切换时间单位。时长改用循环求最大值，避免十万片段展开成函数参数造成栈溢出；播放期间缓存时长、轨道高度、视口结果和选中片段查询表。

Wasm 字节在构建时嵌入本地 JS，安装包无需 Rust、网络、额外进程或 Wasm 文件请求。CSP 只增加 `wasm-unsafe-eval` 以允许 Wasm 编译，未开放 JavaScript `unsafe-eval`。Rust 源码没有 `unsafe` 块或裸输入指针；输出仅提供由 Rust 管理的结果数组地址，JS 立即复制后返回，不持有跨查询的内存视图。

转场使用 `shared/transition-index.ts`：把片头和片尾接点放入 Rust 区间索引，按配对 ID 缓存成员，避免预览、整理和导出准备反复扫描全部片段。候选查询后仍执行原有严格时间容差，并保留重叠时原数组中第一个片段的优先级。接点索引另保留最多两份数组；`normalizeTransitions` 入口主动失效，兼容旧调用方就地修改数组后重新整理的行为。

`createTransformSampler` 为预览和属性面板预处理关键帧排序、可选字段和隐含零时刻，再用二分查找采样；切换片段或编辑后创建新采样器。公共 `transformAt` 保留即时计算，继续支持调用方修改输入。时间线动画范围在片段变化时计算，屏幕外箭头通过二分视口查询剔除；保留原始序号作为组件 key，并额外挂载指针拖动中的目标，避免滚动时把操作转移到其他箭头。

缩略图与概览波形在主进程增加 LRU 内存缓存，最多 512 项、32 MiB 数据 URL 字符载荷，按 UTF-16 每字符两字节计预算（不含 Map 等对象开销）。命中前仍检查源文件大小、mtime、素材类别和取样时间；文件变化会重新生成，并发请求合并、失败后可重试。热命中跳过 PNG 文件读取、base64 编码和解码队列，磁盘缓存继续保留。

## 构建与验证

开发需要 Rust 1.85+、Node.js 22+ 和 pnpm。Rust 可通过官方 rustup 安装，Windows 原生测试还需要 MSVC C++ 工具链。首次执行：

```powershell
rustup target add wasm32-unknown-unknown
pnpm install --frozen-lockfile
pnpm build
```

`pnpm dev`、`pnpm build`、`pnpm test` 和 `pnpm typecheck` 会先构建 Rust Wasm 引擎。生成的 `shared/generated/rust-engine.ts` 和 `target/` 不提交 Git。直接运行 `pnpm exec vitest` 前需先执行 `pnpm build:rust`。脚本也支持当前工作区 `.cache/rust` 下的隔离工具链，不修改系统 PATH。

```powershell
pnpm test:rust      # Rust 原生测试和随机区间校验
pnpm test          # 包括真实 Wasm ABI、转场和撤销回归
pnpm bench:engine  # 100 / 1000 / 10000 / 100000 片段基准
pnpm bench:editor  # 构建并测量一万片段的 Electron 界面，保留 JSON 与截图
pnpm bench:hotpaths # 对比关键帧采样与转场整理，校验输出一致
pnpm bench:ui-compare # 对比四图层复杂动画的界面刷新和主线程任务时间
```

基准使用 32 条轨道和固定查询序列，比对旧线性算法与实际 JS→Wasm→JS 调用。分别报告首次构建耗时、活跃片段查询 P95、全部轨道视口查询 P95，并核对命中数量。结果保存到 `test-output/engine-benchmark.json`，包含 CPU、平台和 Node 版本。首次构建和预览索引准备单独计时，不混入稳定查询成绩。

后两项基准从 Git 提交 `7a3b29f` 读取旧实现，在 `.cache/` 构建对照模块或界面，不改写工作区文件。需要本地 Git 历史包含该提交，浅克隆需先获取对应历史。算法基准逐项比对采样和转场结果，保存到 `test-output/hotpaths-benchmark.json`；桌面对照使用同一 Electron 主进程和合成工程，仅替换界面构建，保存到 `test-output/ui-comparison.json`。rAF 帧间隔与 Performance 任务时长属于界面指标，后者同时记录实际测量窗口，不等于媒体解码 FPS、GPU 吞吐或进程 CPU 使用率。

## 后续性能工作与验收边界

| 路径 | 当前状态 | 后续重点 |
| --- | --- | --- |
| 预览活跃片段查询、时间线视口筛选 | Rust Wasm 区间索引已接入 | 增量维护索引，测量编辑后的重建延迟 |
| React 界面与播放头 | 保留 React；缓存部分工程派生数据 | 隔离播放时钟订阅、轨道垂直虚拟化，测量真实帧时间 |
| 视频解码、拖动定位 | Chromium 媒体元素 | 原生媒体 worker、代理媒体、按字节预算缓存、取消过时 seek 请求 |
| 预览合成与导出 | DOM 预览、FFmpeg CPU 合成与可用硬件编码 | 统一 GPU 合成，验证与现有效果、字体和音频输出的一致性 |
| 字幕、配音、原生录屏 | 保留现有 Python / Windows 组件 | 在可复现实测显示瓶颈后迁移，保持本机语音和模型行为 |

时间线查询加速不能推导为相同比例的视频播放或导出加速。整体性能还需用真实素材验证：1080p/4K、多个同时播放的视频轨道、长录屏、多字幕、变速与动画混合工程，记录 UI 帧时间 P50/P95、seek 响应、A/V 偏差、掉帧、峰值内存、导出耗时与取消延迟。索引构建仍与片段数量相关，极大工程首次打开和编辑后的延迟需要单独评估。

## 参考

- [Filmcraft 架构](https://github.com/storytold/filmcraft/blob/main/docs/architecture.md)：独立引擎、可替换界面与分层媒体管线。本次实现自行编写，未复制其源码或编解码器。
- [Rust 安装](https://rust-lang.org/tools/install/)：开发工具链；终端用户无需安装。
