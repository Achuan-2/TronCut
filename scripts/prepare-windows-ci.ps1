# Run from the release source directory. Downloads are pinned and SHA256 checked.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$cacheDirectory = Join-Path (Get-Location) '.cache/ci-engines'
$binaryDirectory = Join-Path (Get-Location) 'resources/bin'
New-Item -ItemType Directory -Path $cacheDirectory, $binaryDirectory -Force | Out-Null

function Get-VerifiedArchive {
    param([string]$Name, [string]$Url, [string]$Sha256)
    $archive = Join-Path $cacheDirectory $Name
    if (-not (Test-Path -LiteralPath $archive)) {
        Invoke-WebRequest -Uri $Url -OutFile $archive -MaximumRetryCount 3 -RetryIntervalSec 5
    }
    $actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Sha256) { throw "SHA256 mismatch for $Name : $actual" }
    return $archive
}

$ffmpegUrl = 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip'
$ffmpegSha256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
$ffmpegArchive = Get-VerifiedArchive 'ffmpeg-9.0.2.zip' $ffmpegUrl $ffmpegSha256
$ffmpegDirectory = Join-Path $cacheDirectory 'ffmpeg'
Expand-Archive -LiteralPath $ffmpegArchive -DestinationPath $ffmpegDirectory -Force
$ffmpegRoot = Join-Path $ffmpegDirectory 'ffmpeg-9.0.2-essentials_build'
foreach ($binary in @('ffmpeg.exe', 'ffprobe.exe')) {
    Copy-Item -LiteralPath (Join-Path $ffmpegRoot "bin/$binary") -Destination (Join-Path $binaryDirectory $binary)
}
Copy-Item -LiteralPath (Join-Path $ffmpegRoot 'LICENSE') -Destination (Join-Path $binaryDirectory 'FFmpeg-LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $ffmpegRoot 'README.txt') -Destination (Join-Path $binaryDirectory 'FFmpeg-README.txt')

$uvUrl = 'https://github.com/astral-sh/uv/releases/download/0.6.5/uv-x86_64-pc-windows-msvc.zip'
$uvSha256 = 'a3e9f0913189c38b804bf6bb3d348af305a8ceabc690be92b6e111245a821640'
$uvArchive = Get-VerifiedArchive 'uv-0.6.5.zip' $uvUrl $uvSha256
$uvDirectory = Join-Path $cacheDirectory 'uv'
Expand-Archive -LiteralPath $uvArchive -DestinationPath $uvDirectory -Force
Copy-Item -LiteralPath (Join-Path $uvDirectory 'uv.exe') -Destination (Join-Path $binaryDirectory 'uv.exe')

# The corresponding uv license texts are tracked in resources/bin.
@{
    ffmpeg = @{ version = '9.0.2'; url = $ffmpegUrl; sha256 = $ffmpegSha256; source = '946fcce07b' }
    uv = @{ version = '0.6.5'; url = $uvUrl; sha256 = $uvSha256 }
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $binaryDirectory 'manifest.json') -Encoding utf8
