$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $root "resources\aria2c\win64"
$targetFile = Join-Path $targetDir "aria2c.exe"
$tempZip = Join-Path $env:TEMP "aria2c-win64.zip"

if (!(Test-Path $targetDir)) {
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}

if (Test-Path $targetFile) {
  Write-Host "[prepare-aria2c] aria2c.exe already exists at $targetFile"
  exit 0
}

$apiUrl = "https://api.github.com/repos/aria2/aria2/releases/latest"
Write-Host "[prepare-aria2c] Querying latest aria2 release..."
$release = Invoke-RestMethod -Uri $apiUrl

$asset = $release.assets |
  Where-Object { $_.name -match "win-64bit-build1\.zip$" } |
  Select-Object -First 1

if (-not $asset) {
  throw "[prepare-aria2c] Cannot find win64 aria2 zip asset from latest release"
}

Write-Host "[prepare-aria2c] Downloading $($asset.name)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempZip

$extractDir = Join-Path $env:TEMP ("aria2_extract_" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

Expand-Archive -Path $tempZip -DestinationPath $extractDir -Force

$exe = Get-ChildItem -Path $extractDir -Recurse -Filter "aria2c.exe" | Select-Object -First 1
if (-not $exe) {
  throw "[prepare-aria2c] aria2c.exe not found after extraction"
}

Copy-Item -Path $exe.FullName -Destination $targetFile -Force

if (Test-Path $targetFile) {
  Write-Host "[prepare-aria2c] Saved to $targetFile"
} else {
  throw "[prepare-aria2c] Install failed"
}

try {
  Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $extractDir -Force -Recurse -ErrorAction SilentlyContinue
} catch {
  # ignore cleanup errors
}
