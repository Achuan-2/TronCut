# Windows 捕获来源

本目录的 CMakeLists.txt 和 src/ 原样来自 MIT 授权的 OpenScreen：
https://github.com/getopenscreen/openscreen ，提交 bd04d3a7a05453b52d7f33c1d9c9b4b932ff05e3。

保留原作者版权和完整 LICENSE。TronCut 自己的录制生命周期、项目格式、鼠标预览与导出代码位于 electron/native-recording.ts 和 shared/cursor.ts，不依赖 OpenScreen 的应用代码。

构建要求 Visual Studio 2022 C++ 工具链、Windows SDK 10.0.22621+、CMake 3.20+。
使用 CMake 配置到 `.cache/native-win`，仅构建 `wgc-capture` 与 `cursor-sampler` 两个目标，并将 Release 可执行文件复制到 resources/bin。静态 CRT 避免依赖额外 VC++ 运行时。
