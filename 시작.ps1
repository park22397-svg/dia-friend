# 다이아를 만드는 동안 띄우는 것.
#
# 고치면 저절로 다시 읽는다(DIA_DEBUG=1). 밖에 열어 둘 판은
# 이것 말고 "띄우기.ps1" 을 쓴다.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$env:DIA_DEBUG = "1"

Write-Host ""
Write-Host "  다이아 (만드는 중)" -ForegroundColor Cyan
Write-Host "  http://127.0.0.1:5000" -ForegroundColor DarkGray
Write-Host "  끝내려면 Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

python main.py
