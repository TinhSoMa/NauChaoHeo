param(
  [string]$PythonVersion = "3.12.9"
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
  param([string]$PathValue)
  if (-not (Test-Path -LiteralPath $PathValue)) {
    New-Item -ItemType Directory -Path $PathValue -Force | Out-Null
  }
}

function Invoke-CommandChecked {
  param(
    [string]$Command,
    [string[]]$Arguments
  )

  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $Command $($Arguments -join ' ')"
  }
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resourcesDir = Join-Path $projectRoot "resources"
$pythonBaseDir = Join-Path $resourcesDir "python"
$cacheDir = Join-Path $pythonBaseDir "cache"
$runtimeDir = Join-Path $pythonBaseDir "win32-x64\runtime"
$licensesDir = Join-Path $resourcesDir "licenses\python"
$requirementsPath = Join-Path $projectRoot "requirements-pycapcut-lock.txt"
$memoryWorkerSourcePath = Join-Path $projectRoot "src\main\services\memoryContext\python\mem0_context_worker.py"

Ensure-Directory -PathValue $resourcesDir
Ensure-Directory -PathValue $pythonBaseDir
Ensure-Directory -PathValue $cacheDir

if (-not (Test-Path -LiteralPath $requirementsPath)) {
  throw "Missing requirements file: $requirementsPath"
}
if (-not (Test-Path -LiteralPath $memoryWorkerSourcePath)) {
  throw "Missing memory context worker source: $memoryWorkerSourcePath"
}

$embedZipName = "python-$PythonVersion-embed-amd64.zip"
$embedZipUrl = "https://www.python.org/ftp/python/$PythonVersion/$embedZipName"
$embedZipPath = Join-Path $cacheDir $embedZipName
$getPipPath = Join-Path $cacheDir "get-pip.py"

Write-Host "[Python Runtime] Project root: $projectRoot"
Write-Host "[Python Runtime] Python version: $PythonVersion"

if (-not (Test-Path -LiteralPath $embedZipPath)) {
  Write-Host "[Python Runtime] Downloading embedded Python: $embedZipUrl"
  Invoke-WebRequest -Uri $embedZipUrl -OutFile $embedZipPath
}
else {
  Write-Host "[Python Runtime] Using cached embedded Python zip."
}

if (Test-Path -LiteralPath $runtimeDir) {
  Write-Host "[Python Runtime] Removing old runtime: $runtimeDir"
  Remove-Item -LiteralPath $runtimeDir -Recurse -Force
}

Ensure-Directory -PathValue $runtimeDir
Write-Host "[Python Runtime] Extracting runtime..."
Expand-Archive -Path $embedZipPath -DestinationPath $runtimeDir -Force

$pthFile = Get-ChildItem -LiteralPath $runtimeDir -Filter "python*._pth" | Select-Object -First 1
if (-not $pthFile) {
  throw "Cannot find python*._pth in runtime directory."
}

$pthLines = Get-Content -LiteralPath $pthFile.FullName
$updatedPthLines = [System.Collections.Generic.List[string]]::new()
foreach ($line in $pthLines) {
  if ($line -match '^\s*#\s*import site\s*$') {
    $updatedPthLines.Add('import site')
  }
  else {
    $updatedPthLines.Add($line)
  }
}

if (-not ($updatedPthLines -contains 'Lib')) {
  $updatedPthLines.Add('Lib')
}
if (-not ($updatedPthLines -contains 'Lib\site-packages')) {
  $updatedPthLines.Add('Lib\site-packages')
}
if (-not ($updatedPthLines | Where-Object { $_ -match '^\s*import site\s*$' })) {
  $updatedPthLines.Add('import site')
}

Set-Content -LiteralPath $pthFile.FullName -Value $updatedPthLines -Encoding Ascii

$pythonExe = Join-Path $runtimeDir "python.exe"
if (-not (Test-Path -LiteralPath $pythonExe)) {
  throw "Embedded python.exe not found at: $pythonExe"
}

# Prevent embedded runtime from loading user/site Python packages.
$env:PYTHONNOUSERSITE = "1"

$sitePackages = Join-Path $runtimeDir "Lib\site-packages"
Ensure-Directory -PathValue $sitePackages

if (-not (Test-Path -LiteralPath $getPipPath)) {
  Write-Host "[Python Runtime] Downloading get-pip.py..."
  Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPipPath
}

Write-Host "[Python Runtime] Installing pip..."
Invoke-CommandChecked -Command $pythonExe -Arguments @($getPipPath, "--disable-pip-version-check", "--no-warn-script-location")

Write-Host "[Python Runtime] Upgrading pip/setuptools/wheel..."
Invoke-CommandChecked -Command $pythonExe -Arguments @("-m", "pip", "--isolated", "install", "--upgrade", "pip", "setuptools", "wheel", "--disable-pip-version-check")

Write-Host "[Python Runtime] Installing locked pycapcut dependencies..."
Invoke-CommandChecked -Command $pythonExe -Arguments @("-m", "pip", "--isolated", "install", "-r", $requirementsPath, "--disable-pip-version-check", "--no-warn-script-location")

Write-Host "[Python Runtime] Installing Gemini Web API + TTS dependencies..."
Invoke-CommandChecked -Command $pythonExe -Arguments @("-m", "pip", "--isolated", "install", "gemini-webapi", "browser-cookie3", "edge-tts", "aiohttp", "--disable-pip-version-check", "--no-warn-script-location")

Write-Host "[Python Runtime] Installing memory context dependencies (mem0ai[nlp], underthesea, spaCy model)..."
Invoke-CommandChecked -Command $pythonExe -Arguments @("-m", "pip", "--isolated", "install", "mem0ai[nlp]", "--disable-pip-version-check", "--no-warn-script-location")
Invoke-CommandChecked -Command $pythonExe -Arguments @("-m", "pip", "--isolated", "install", "underthesea", "--disable-pip-version-check", "--no-warn-script-location")
Invoke-CommandChecked -Command $pythonExe -Arguments @("-m", "spacy", "download", "xx_ent_wiki_sm")

Write-Host "[Python Runtime] Removing unused heavy packages (torch, transformers, scipy, onnxruntime) to reduce runtime size..."
Invoke-CommandChecked -Command $pythonExe -Arguments @("-m", "pip", "--isolated", "uninstall", "-y", "torch", "torchvision", "torchaudio", "transformers", "scipy", "onnxruntime", "onnxruntime-directml", "funasr-onnx", "--disable-pip-version-check")

Write-Host "[Python Runtime] Running smoke test..."
Invoke-CommandChecked -Command $pythonExe -Arguments @(
  "-c",
  "import sys,pycapcut,ebooklib,numpy,pymediainfo,uiautomation,mem0,spacy,underthesea,edge_tts,gemini_webapi; nlp=spacy.load('xx_ent_wiki_sm'); print('OK runtime=' + sys.version + ' spacy=' + nlp.meta.get('name', 'xx_ent_wiki_sm') + ' underthesea=' + getattr(underthesea, '__version__', 'unknown'))"
)

Write-Host "[Python Runtime] Writing memory runtime build stamp..."
$memoryBuildStampJson = & $pythonExe -c @"
import json, platform
import mem0, spacy, underthesea
nlp = spacy.load('xx_ent_wiki_sm')
print(json.dumps({
  'generatedAt': __import__('datetime').datetime.utcnow().isoformat() + 'Z',
  'pythonVersion': platform.python_version(),
  'mem0Version': getattr(mem0, '__version__', 'unknown'),
  'spacyVersion': getattr(spacy, '__version__', 'unknown'),
  'spacyModelName': nlp.meta.get('name', 'xx_ent_wiki_sm'),
  'undertheseaVersion': getattr(underthesea, '__version__', 'unknown'),
  'runtimeDir': r'$runtimeDir'
}, ensure_ascii=False))
"@
if ($LASTEXITCODE -ne 0) {
  throw "Failed to generate memory runtime build stamp."
}
$memoryBuildStampPath = Join-Path $runtimeDir "memory-context-build.json"
Set-Content -LiteralPath $memoryBuildStampPath -Value $memoryBuildStampJson -Encoding UTF8

if (-not (Test-Path -LiteralPath $memoryBuildStampPath)) {
  throw "Memory runtime build stamp was not created: $memoryBuildStampPath"
}

if (Test-Path -LiteralPath $licensesDir) {
  Remove-Item -LiteralPath $licensesDir -Recurse -Force
}
Ensure-Directory -PathValue $licensesDir

$pythonLicensePath = Join-Path $runtimeDir "LICENSE.txt"
if (Test-Path -LiteralPath $pythonLicensePath) {
  Copy-Item -LiteralPath $pythonLicensePath -Destination (Join-Path $licensesDir "PYTHON_LICENSE.txt") -Force
}

$packages = @("pycapcut", "ebooklib", "imageio", "pymediainfo", "uiautomation", "comtypes", "numpy", "pillow", "mem0ai", "spacy", "underthesea")
foreach ($pkg in $packages) {
  $pkgDir = Join-Path $licensesDir $pkg
  Ensure-Directory -PathValue $pkgDir

  $pipShowPath = Join-Path $pkgDir "pip-show.txt"
  $pipShowOutput = & $pythonExe -m pip --isolated show $pkg | Out-String
  Set-Content -LiteralPath $pipShowPath -Value $pipShowOutput -Encoding UTF8

  $candidateDistInfos = @(
    Get-ChildItem -LiteralPath $sitePackages -Directory -Filter "$pkg-*.dist-info" -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $sitePackages -Directory -Filter "$($pkg.Replace('-', '_'))-*.dist-info" -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $sitePackages -Directory -Filter "$($pkg.ToLower())-*.dist-info" -ErrorAction SilentlyContinue
  ) | Select-Object -Unique

  $distInfo = $candidateDistInfos | Select-Object -First 1
  if (-not $distInfo) {
    continue
  }

  $licensePatterns = @("LICENSE*", "COPYING*", "NOTICE*", "METADATA")
  foreach ($pattern in $licensePatterns) {
    Get-ChildItem -LiteralPath $distInfo.FullName -File -Filter $pattern -ErrorAction SilentlyContinue |
      ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $pkgDir $_.Name) -Force
      }
  }

  $licenseSubDir = Join-Path $distInfo.FullName "licenses"
  if (Test-Path -LiteralPath $licenseSubDir) {
    Copy-Item -LiteralPath $licenseSubDir -Destination (Join-Path $pkgDir "licenses") -Recurse -Force
  }
}

$runtimeVersion = (& $pythonExe --version) | Out-String
$buildMeta = @{
  generatedAt = (Get-Date).ToString("o")
  pythonVersion = $runtimeVersion.Trim()
  runtimeDir = $runtimeDir
  requirements = (Get-Content -LiteralPath $requirementsPath)
}
$buildMeta | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $licensesDir "_build_meta.json") -Encoding UTF8

Write-Host "[Python Runtime] Complete."
Write-Host "[Python Runtime] Runtime: $runtimeDir"
Write-Host "[Python Runtime] Licenses: $licensesDir"
