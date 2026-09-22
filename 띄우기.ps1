# 다이아를 띄운다. 밖에 열어 둘 때 쓰는 것.
#
# 고치면 다시 읽는 기능(debug)은 꺼진 채로 돈다 — 켜 두면 오류 화면에서
# 이 컴퓨터의 파이썬을 실행할 수 있어서 밖에 열어 두면 안 된다.
#
# 처음 한 번은 아래를 먼저 한다.
#   pip install -r requirements.txt
#   static\avatar.vrm 과 static\body.vrm 을 넣는다 (저장소에 없다)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# 모델 서버. 쓰는 서버가 다르면 이 한 줄만 고친다.
if (-not $env:OLLAMA_URL) {
    $env:OLLAMA_URL = "http://cju.nezip.co.kr:11434/api/chat"
}

# 아무나 계정을 못 만들게 하려면 암호를 정한다. 비워 두면 누구나 만든다.
# $env:SIGNUP_CODE = "정한암호"

$missing = @()
foreach ($f in @("static\avatar.vrm", "static\body.vrm")) {
    if (-not (Test-Path (Join-Path $PSScriptRoot $f))) { $missing += $f }
}

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "  아바타 파일이 없습니다:" -ForegroundColor Yellow
    foreach ($f in $missing) { Write-Host ("    - " + $f) -ForegroundColor Yellow }
    Write-Host "  넣지 않으면 화면은 떠도 다이아가 안 나옵니다." -ForegroundColor Yellow
    Write-Host ""
}

Write-Host ""
Write-Host "  다이아" -ForegroundColor Cyan
Write-Host ("  모델 서버: " + $env:OLLAMA_URL) -ForegroundColor DarkGray
Write-Host "  포트 5000 · 끝내려면 Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

python main.py
