param(
    [string]$OutputName = "NovelSub-extension.zip"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputPath = Join-Path $scriptDir $OutputName

if (Test-Path $outputPath) {
    Remove-Item -LiteralPath $outputPath -Force
}

$manifestPath = Join-Path $scriptDir "manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "Không tìm thấy manifest.json trong thư mục: $scriptDir"
}

$items = Get-ChildItem -LiteralPath $scriptDir -Force |
    Where-Object {
        $_.Name -ne $OutputName -and
        $_.Name -ne ".git" -and
        $_.Name -ne ".github"
    }

if (-not $items) {
    throw "Không có file nào để đóng gói."
}

Compress-Archive -Path ($items.FullName) -DestinationPath $outputPath -Force

Write-Host "Đã tạo gói:" $outputPath
Write-Host "Kiểm tra: manifest.json nằm ở root của file ZIP."
