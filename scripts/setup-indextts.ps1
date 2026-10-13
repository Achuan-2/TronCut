[CmdletBinding()]
param(
    [ValidateSet('cuda', 'cpu')][string]$Device = 'cuda',
    [switch]$Offline
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskUserData = Join-Path $taskRoot '.framecraft-dev'
$taskSource = Join-Path $taskRoot 'workers/indextts'
$taskWorker = Join-Path $taskUserData 'workers/indextts'
$taskModels = Join-Path $taskUserData 'models/indextts2_5'
$taskUv = Join-Path $taskRoot 'resources/bin/uv.exe'
if (-not (Test-Path -LiteralPath $taskUv)) {
    $taskUv = (Get-Command uv -ErrorAction Stop).Source
}
if ($Device -eq 'cuda') {
    $taskGpu = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if (-not $taskGpu) { throw '未找到 NVIDIA 驱动；可以使用 -Device cpu 准备 CPU 环境。' }
    & $taskGpu.Source --query-gpu=name,memory.total --format=csv,noheader
    if ($LASTEXITCODE -ne 0) { throw 'NVIDIA 驱动不可用，请检查驱动或使用 -Device cpu。' }
}

New-Item -ItemType Directory -Path $taskWorker -Force | Out-Null
foreach ($taskFile in @('pyproject.toml', 'uv.lock', 'models.py', 'synthesize.py')) {
    Copy-Item -LiteralPath (Join-Path $taskSource $taskFile) -Destination (Join-Path $taskWorker $taskFile)
}
$taskEnvironment = @{
    UV_PROJECT_ENVIRONMENT = Join-Path $taskWorker ".venv-indextts-$Device"
    UV_CACHE_DIR = Join-Path $taskUserData 'uv-cache'
    UV_PYTHON_INSTALL_DIR = Join-Path $taskUserData 'python'
    HF_HOME = Join-Path $taskUserData 'models/huggingface'
    HF_HUB_OFFLINE = $(if ($Offline) { '1' } else { '0' })
    PYTHONUTF8 = '1'
}
$taskPrevious = @{}
try {
    foreach ($taskKey in $taskEnvironment.Keys) {
        $taskPrevious[$taskKey] = [Environment]::GetEnvironmentVariable($taskKey, 'Process')
        [Environment]::SetEnvironmentVariable($taskKey, $taskEnvironment[$taskKey], 'Process')
    }
    $taskOfflineArguments = @()
    if ($Offline) { $taskOfflineArguments = @('--offline') }
    & $taskUv sync --project $taskWorker --python 3.11 --frozen --extra $Device @taskOfflineArguments
    if ($LASTEXITCODE -ne 0) { throw 'IndexTTS 依赖准备失败。' }
    $taskModelArguments = @('--model-dir', $taskModels)
    if ($Offline) { $taskModelArguments += '--offline' }
    & $taskUv run --project $taskWorker --python 3.11 --frozen --extra $Device @taskOfflineArguments python (Join-Path $taskWorker 'models.py') @taskModelArguments
    if ($LASTEXITCODE -ne 0) { throw 'IndexTTS 主模型或辅助模型准备失败。' }
    $taskCheck = "import torch; print('PyTorch:', torch.__version__, 'CUDA:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'); from indextts.infer_v2_5 import IndexTTS2"
    if ($Device -eq 'cuda') {
        $taskCheck += "; assert torch.cuda.is_available(), 'CUDA 初始化失败'; assert torch.cuda.is_bf16_supported(), 'GPU 不支持 BF16'"
    }
    & $taskUv run --project $taskWorker --python 3.11 --frozen --extra $Device @taskOfflineArguments python -c $taskCheck
    if ($LASTEXITCODE -ne 0) { throw 'IndexTTS 运行环境检查失败。' }
    Write-Host 'IndexTTS 2.5 已准备完成。运行 pnpm dev，在配音面板选择 IndexTTS 并导入参考音频。'
}
finally {
    foreach ($taskKey in $taskPrevious.Keys) {
        [Environment]::SetEnvironmentVariable($taskKey, $taskPrevious[$taskKey], 'Process')
    }
}
