$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $root "resources\ffmpeg-nvenc\win64"
$tempDir = Join-Path $env:TEMP "nauchaoheo-ffmpeg-nvenc"

# Target paths
$ffmpegTarget = Join-Path $targetDir "ffmpeg.exe"
$ffprobeTarget = Join-Path $targetDir "ffprobe.exe"

# Old FFmpeg build (pre-NVENC SDK 13.1, works with driver < 610)
$buildTag = "2024-06-01"
$downloadUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/$buildTag/ffmpeg-master-latest-win64-gpl.zip"

# Check if already installed
if (Test-Path $ffmpegTarget -and (Test-Path $ffprobeTarget)) {
  Write-Host "[prepare-ffmpeg-nvenc] Already exists at $targetDir"
  exit 0
}

# Create directories
if (!(Test-Path $targetDir)) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}
if (!(Test-Path $tempDir)) {
  New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
}

# Download
$zipPath = Join-Path $tempDir "ffmpeg-nvenc.zip"
Write-Host "[prepare-ffmpeg-nvenc] Downloading legacy FFmpeg from $downloadUrl"
Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

# Extract
$extractDir = Join-Path $tempDir "extracted"
if (Test-Path $extractDir) {
  Remove-Item -Recurse -Force $extractDir
}
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

Write-Host "[prepare-ffmpeg-nvenc] Extracting..."
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

# Find ffmpeg.exe in extracted folder
$foundFfmpeg = Get-ChildItem -Path $extractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
$foundFfprobe = Get-ChildItem -Path $extractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1

if (!$foundFfmpeg -or !$foundFfprobe) {
  throw "[prepare-ffmpeg-nvenc] Could not find ffmpeg.exe or ffprobe.exe in extracted zip"
}

Copy-Item -Path $foundFfmpeg.FullName -Destination $ffmpegTarget -Force
Copy-Item -Path $foundFfprobe.FullName -Destination $ffprobeTarget -Force

Write-Host "[prepare-ffmpeg-nvenc] Saved to $targetDir"

# Verify
$version = & $ffmpegTarget -version 2>&1 | Select-Object -First 1
Write-Host "[prepare-ffmpeg-nvenc] Verified: $version"
