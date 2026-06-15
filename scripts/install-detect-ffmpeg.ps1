param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = "Continue"

$targetDir = Join-Path $InstallDir "resources\ffmpeg-nvenc"
$ffmpegTarget = Join-Path $targetDir "ffmpeg.exe"

if (Test-Path $ffmpegTarget) {
  Write-Host "[install-detect-ffmpeg] Legacy FFmpeg already exists at $targetDir"
  exit 0
}

$driverVersion = $null

# Try nvidia-smi first
try {
  $smi = & nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null
  if ($smi) {
    if ($smi -match '(\d+\.\d+)') {
      $driverVersion = [double]$Matches[1]
    }
  }
} catch {}

# Fallback: WMI
if (-not $driverVersion) {
  try {
    $wmi = Get-WmiObject Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | Select-Object -First 1
    if ($wmi -and $wmi.DriverVersion) {
      $parts = $wmi.DriverVersion.Split('.')
      if ($parts.Count -ge 4) {
        $build = [int]$parts[3]
        if ($build -gt 0) {
          $driverVersion = $build / 100
        }
      }
    }
  } catch {}
}

# Check if we need legacy FFmpeg
if ($driverVersion -and $driverVersion -ge 610) {
  Write-Host "[install-detect-ffmpeg] NVIDIA driver $driverVersion >= 610, base FFmpeg is sufficient"
  exit 0
}

if ($driverVersion) {
  Write-Host "[install-detect-ffmpeg] NVIDIA driver $driverVersion < 610, downloading legacy FFmpeg..."
} else {
  Write-Host "[install-detect-ffmpeg] Could not detect NVIDIA driver, downloading legacy FFmpeg as fallback..."
}

# Download legacy FFmpeg
$zipUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/2024-06-01/ffmpeg-master-latest-win64-gpl.zip"
$zipPath = Join-Path $env:TEMP "nauchaoheo-ffmpeg-install.zip"

try {
  Write-Host "[install-detect-ffmpeg] Downloading from $zipUrl"
  Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing -TimeoutSec 120
} catch {
  Write-Host "[install-detect-ffmpeg] Download failed: $_"
  exit 1
}

if (-not (Test-Path $zipPath)) {
  Write-Host "[install-detect-ffmpeg] Download failed: zip not found"
  exit 1
}

# Extract
$extractDir = Join-Path $env:TEMP "nauchaoheo-ffmpeg-install-extract"
if (Test-Path $extractDir) {
  Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
}

try {
  Write-Host "[install-detect-ffmpeg] Extracting..."
  Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
} catch {
  Write-Host "[install-detect-ffmpeg] Extract failed: $_"
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  exit 1
}

# Find ffmpeg.exe in extracted folder
$foundFfmpeg = Get-ChildItem $extractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
if (-not $foundFfmpeg) {
  Write-Host "[install-detect-ffmpeg] Could not find ffmpeg.exe in extracted files"
  Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
  Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue
  exit 1
}

$foundFfprobe = Get-ChildItem $extractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1

# Copy to target
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
Copy-Item $foundFfmpeg.FullName $ffmpegTarget -Force
if ($foundFfprobe) {
  Copy-Item $foundFfprobe.FullName (Join-Path $targetDir "ffprobe.exe") -Force
}

# Cleanup temp files
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item $extractDir -Recurse -Force -ErrorAction SilentlyContinue

if (Test-Path $ffmpegTarget) {
  Write-Host "[install-detect-ffmpeg] Legacy FFmpeg ready at $targetDir"
  exit 0
} else {
  Write-Host "[install-detect-ffmpeg] Copy failed: ffmpeg.exe not found at target"
  exit 1
}
