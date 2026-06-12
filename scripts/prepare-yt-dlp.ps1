$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $root "resources\\yt-dlp\\win64"
$targetFile = Join-Path $targetDir "yt-dlp.exe"

if (!(Test-Path $targetDir)) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

if (Test-Path $targetFile) {
  Write-Host "[prepare-yt-dlp] yt-dlp.exe already exists at $targetFile"
  exit 0
}

$downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
Write-Host "[prepare-yt-dlp] Downloading yt-dlp from $downloadUrl"

Invoke-WebRequest -Uri $downloadUrl -OutFile $targetFile

if (Test-Path $targetFile) {
  Write-Host "[prepare-yt-dlp] Saved to $targetFile"
} else {
  throw "[prepare-yt-dlp] Download failed"
}
