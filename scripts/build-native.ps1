param([string]$CMake = 'cmake')
$ErrorActionPreference = 'Stop'
if (-not (Get-Command $CMake -ErrorAction SilentlyContinue)) {
    $bundledCMake = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    if (Test-Path -LiteralPath $bundledCMake) { $CMake = $bundledCMake }
    else { throw '请安装 Visual Studio C++ 工具链与 CMake。' }
}
& $CMake -S native/windows -B .cache/native-troncut -G 'Visual Studio 17 2022' -A x64
if ($LASTEXITCODE -ne 0) { throw '原生捕获配置失败' }
& $CMake --build .cache/native-troncut --config Release --target wgc-capture cursor-sampler -j 4
if ($LASTEXITCODE -ne 0) { throw '原生捕获构建失败' }
foreach ($binary in @('wgc-capture', 'cursor-sampler')) {
    Copy-Item -LiteralPath ".cache/native-troncut/Release/$binary.exe" -Destination "resources/bin/$binary.exe"
}
Copy-Item -LiteralPath native/windows/LICENSE -Destination resources/bin/OpenScreen-LICENSE.txt
