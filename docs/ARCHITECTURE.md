# 架构与工程协议

## 分层

`src/` 是 React 编辑器，负责用户交互、时间线状态和原生媒体元素预览。`shared/model.ts` 定义带版本号的工程 schema，并用 Zod 验证 ID、引用、数值、颜色和范围；`shared/editor.ts` 处理源时间、拆分、变速、吸附、关键帧与平滑插值。模型不依赖 Electron，因此后续可以独立回归测试或更换渲染器。

`shared/timeline.ts` 管理多选、组合、同步移动、批量拆分与复制、删除后的时间映射；`shared/effects.ts` 管理裁切/颜色/翻转与淡入淡出。波纹删除先求删除范围并集，再扣除任何剩余片段占用范围，避免剪掉未选中媒体。锁定轨道不移动。`groupId` 是同步选择关系，尚不等同于独立嵌套序列。

`electron/preload.ts` 只暴露明确的业务接口，界面不能读取任意文件、执行命令或访问 Node。主进程校验调用来源，只接收经原生文件对话框、工程读取和内部录制登记的媒体路径。自定义媒体协议按素材 ID 访问，禁止由 URL 直接映射任意本地路径；保存与打开限制工程相对路径越界及符号链接逃逸。新增 IPC 必须继续遵守这些边界。

`electron/project-store.ts` 收集工程素材并原子替换 JSON；`media.ts` 通过 FFprobe 探测实际媒体；`camtasia.ts` 做保守的基础转换，并保留原 JSON 和逐项报告；`export.ts` 把同一关键帧模型转换为 FFmpeg 表达式。外部进程用参数数组启动，`shell:false`，支持取消，stderr 有长度上限。文字图层用 Pango 测量和 rasterize，再合成描边与透明度，避免把字幕固定在底部。

`workers/onnx/` 是字幕与配音共用的 sherpa-onnx CPU 工作进程，由 uv 管理 Python 3.12 与锁定依赖。显式依赖 `sherpa-onnx-core`，确保安装配套 ONNX Runtime 原生库。运行时复制到应用数据目录的 `workers/onnx/`，避免向应用安装目录写虚拟环境。模型只从用户指定的目录或应用数据目录的 `models/onnx/` 读取；默认缓存缺失时按需下载，离线模式同时禁止 uv 与模型下载。

模型准备通过 `speech:downloadModel` IPC 与 `workers/onnx/prepare.py` 执行，校验模型枚举后复用同一运行环境；ASR 准备时额外下载共享 VAD。完整文件以临时路径下载，TTS 模型包在暂存目录安全解压并检查必要文件，准备完成后才替换所选缓存模型。缓存完整时跳过下载，主进程共用后台任务互斥与进程树取消。

`electron/transcription.ts` 通过 `electron/timeline-audio.ts` 合成全时间线的 16 kHz 单声道 PCM16 混音，与视频导出共用音频滤镜，保留片段开始时间、裁剪、速度、音量和效果，跳过静音与隐藏轨道。Silero VAD 以 512 个样本为窗口流式读取，单段语音最多八秒，结尾调用 flush 保留尾句。Qwen3-ASR 0.6B 与 SenseVoiceSmall 通过 sherpa-onnx 返回识别结果；Qwen3-ASR 使用 128 维特征、卷积前端和 INT8 encoder/decoder。识别优先采用真实 token 时间戳断句；时间信息缺失或不一致时保留完整文字与 VAD 边界，结果直接使用工程时间。CLI 默认全局识别，也可显式通过 clipIds 限定参与混音的片段。

Qwen3-ASR 显式选择 `device: "cuda"` 时，由 `workers/onnx/qwen_gpu.py` 加载官方 Transformers 模型，使用 PyTorch CUDA FP16；默认 `auto` 和 `cpu` 保持 sherpa-onnx CPU 路径。`qwen-gpu` 可选依赖安装到独立 `.venv-cuda/`，避免配音任务同步依赖时卸载 GPU 组件。GPU 模型在自身缓存的 `qwen3-asr-0.6b-cuda/` 中解析或下载；两种后端共用 CPU VAD 与工程时间映射。GPU 每批最多处理 4 段，独立保留各段起止时间，并在末尾处理不足一批的语音；没有词级对齐时间时保留语音段边界。官方包中当前不用的日语强制对齐依赖通过标准 Python LazyLoader 延迟加载。未检测到 CUDA 或显存不足时显式报错，不静默转为 CPU。

桌面字幕后处理由 `shared/caption-processing.ts` 和 `electron/caption-processing.ts` 执行，支持规则/字数/不限长/AI 语义断句，以及独立的纠错精修和润色。AI 按批次返回带 ID 的文字结果，程序校验内容与条目后再映射时间；缺少词时间时仅在原语音段内部估算。无效批次回退，取消时整次操作不落盘。`electron/ai.ts` 通过主进程发送有超时与响应大小限制的兼容 Chat Completions 请求；`electron/preferences.ts` 独立保存配置，密钥通过 Electron safeStorage 加密，渲染端只收到是否存在密钥，更换服务 origin 不复用旧密钥。AI 配置和密钥均不写入工程。

`electron/synthesis.ts` 调用同一运行环境中的 Kokoro / VITS ONNX 工作进程，文稿通过 JSON 请求文件传递，分段写出 PCM16 WAV，再由 FFmpeg 应用一次语速并统一为 48 kHz 单声道。素材保留文稿、模型、音色、目录与语速参数，运行记录包含模型路径、CPU、精度、加载与生成耗时。旧 Kokoro/Qwen/IndexTTS 工程参数保留解析能力；新生成仅使用 ONNX，读取旧参数时提示重新选择音色。当前模型每次任务重新加载。

## 时间、空间与动画

轨道是通用容器，不再使用轨道 `kind` 限制片段类别；素材和片段仍保留各自类别，以决定解码、预览和导出方式。旧工程中的轨道类别在读取时忽略，ID、顺序和片段引用保持不变。轨道名称按自底向上的位置统一编号，顶部新增轨道不会改变原有轨道编号。系统剪贴板图片和视频优先使用完全空白且可编辑的最顶层轨道，否则新增顶部轨道；普通媒体添加按占用时间、隐藏和锁定状态选择可用轨道，外部拖入优先使用指定轨道。

时间一律使用秒，`start` 为时间线位置，`duration` 为时间线上占用长度，`sourceIn` 为源素材起点，`speed` 为播放倍率。源时间等于 `sourceIn + localTime × speed`。改变速度时同步修改占用时长与关键帧时间，不更改源素材长度。

`speedEffect` 标记附加的剪辑速度效果，1 倍时也可保留；旧工程 `speed !== 1` 自动识别为已有变速。`shared/clip-speed.ts` 按固定源区间计算倍速与时长，关键帧、动画偏移和淡入淡出同比缩放。时间线效果条使用局部拖动草稿，松开时一次性提交，展开轨道的高度参与轨道栏、滚动定位和跨轨道位移计算。

位置为画布的归一化中心坐标，`x=0.5,y=0.5` 表示居中。视频/图片先适应画布，再乘 `scale`；文本与形状使用自身尺寸。`opacity` 范围 0…1。上下轨道的层叠关系与导出一致。

关键帧保存完整变换快照，帧间使用 smoothstep 插值。`animationOffset` 用于非破坏裁剪与拆分：右片段保持原有控制点，并将动画采样时间偏移到裁剪位置。不能在切点重新生成 smoothstep 区间，否则动画加速度会变化。时间线可以保留位于裁剪区域之外的控制点，以支持恢复裁剪与保持曲线；预览和导出必须使用相同偏移。

## 性能取舍

Windows `electron/native-recording.ts` 启动 MIT 授权的独立 WGC / Media Foundation 捕获进程和鼠标采样进程，不通过渲染进程传输屏幕帧。主进程管理启动、暂停、停止及异常生命周期。鼠标按源归一化坐标与秒记录，静止跨度保留首尾点。`shared/cursor.ts` 二分定位并采样；`electron/cursor-export.ts` 为每层生成流式 sendcmd 文件，鼠标先叠加到源画面，再进入裁切/旋转/缩放。sendcmd 放在当前帧完成合成之后以设置下一帧坐标，防止 FFmpeg framesync 预读导致提前应用后续坐标。工程保存将数据写入 media/ 下独立 JSON，打开时继续验证路径和 schema。

录制以一秒为间隔流式传到主进程写文件，不收集整段录屏为一个巨大 Blob。单条录制最多允许八个待写数据块，持续写入跟不上时停止并保留数据。结束时重新封装 WebM 修复时长元数据，不重新编码。

导出由独立 FFmpeg 进程完成，优先试运行实际硬件编码器，再选择 NVENC/QSV/AMF 或 VideoToolbox；硬件初始化或完整导出失败时回退到 libx264。目前合成仍使用 CPU 滤镜，硬件编码不意味着整条渲染链已 GPU 化。某些带透明动画的图层使用 geq，未来应换成统一 GPU 合成。

时间线现在按横向可视区加缓冲筛选片段与刻度 DOM，媒体缩略图/概览波形缓存以文件路径、大小、mtime 和类型作为键，后台串行解码。波形是低采样率概览，不是采样级音频编辑视图。尚无代理媒体、轨道垂直虚拟化、完整任务队列或统一预览缓存；必须测量帧时间、内存、录制掉帧和 A/V 同步后才可评价 4K/长工程性能。

## 已知预览边界

画布预览使用浏览器字体与解码器，导出文字使用系统 Pango 字体和 FFmpeg 解码。字体缺失、行高、抗锯齿及少数色彩空间会产生差异；目前已验证中文文字与描边能进入视频，但未进行所有字体的像素一致性验收。音频画布播放原音，处理后试听和导出使用相同 DSP/变速滤镜。

## Camtasia 兼容原则

以实际 JSON 的 `editRate` 将 tick 转成秒，以 `sourceBin` 关联媒体，以 `timeline.sceneTrack.scenes[].csml.tracks[].medias[]` 构建基础轨道。VMFile 和 AMFile 对应独立的画面/声音源轨，不能因二者引用同一个 MP4 而重复混音。嵌套组、未知素材或专有效果列入报告，不做无依据的扁平化。完整原数据保留只是可追溯措施，不等于效果支持。
