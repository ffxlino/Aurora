# build-all.ps1 — собирает CraftSync под Windows и Linux
# Требования: Node.js, Docker Desktop (запущен)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     CraftSync — Сборка всех платформ ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Windows ──────────────────────────────────────────────────────────────────
Write-Host "► Windows (NSIS + Portable)..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "✖ Ошибка сборки Windows!" -ForegroundColor Red
    exit 1
}
Write-Host "✔ Windows готов" -ForegroundColor Green
Write-Host ""

# ── Linux (через Docker) ─────────────────────────────────────────────────────
Write-Host "► Linux (AppImage + zip) через Docker..." -ForegroundColor Yellow

# Проверяем что Docker запущен
$dockerRunning = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "✖ Docker не запущен! Запусти Docker Desktop и попробуй снова." -ForegroundColor Red
    exit 1
}

docker run --rm `
    -v "${PWD}:/project" `
    -w /project `
    electronuserland/builder `
    sh -c "rm -rf node_modules && npm install && npm run build:linux-full"

if ($LASTEXITCODE -ne 0) {
    Write-Host "✖ Ошибка сборки Linux!" -ForegroundColor Red
    exit 1
}
Write-Host "✔ Linux готов" -ForegroundColor Green
Write-Host ""

# ── Итог ─────────────────────────────────────────────────────────────────────
Write-Host "╔══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║  ✔ Все сборки готовы в папке dist/   ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

Write-Host "Файлы:" -ForegroundColor White
Get-ChildItem -Path "dist" -File | Where-Object { $_.Extension -in ".exe", ".AppImage", ".zip" } | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 1)
    Write-Host "  $($_.Name)  ($size MB)" -ForegroundColor Gray
}
Write-Host ""
