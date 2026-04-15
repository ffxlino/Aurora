@echo off
chcp 65001 > nul 2>&1
title CraftSync Launcher

node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found.
    echo Download from: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\node-7z" (
    echo New packages detected. Reinstalling dependencies...
    if exist "node_modules" rmdir /s /q node_modules
    npm install --no-audit --no-fund
    echo Dependencies installed.
    echo.
)

echo Starting CraftSync...
npm start
