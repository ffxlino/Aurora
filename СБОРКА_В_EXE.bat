@echo off
cd /d "%~dp0"

:: Отключаем подпись кода (не нужна для личного использования)
set CSC_IDENTITY_AUTO_DISCOVERY=false
set WIN_CSC_LINK=
set CSC_LINK=
set CSC_KEY_PASSWORD=

:: Удаляем битый кэш winCodeSign если есть
set CACHE_DIR=%LOCALAPPDATA%\electron-builder\Cache\winCodeSign
if exist "%CACHE_DIR%" (
    echo Clearing broken winCodeSign cache...
    rmdir /s /q "%CACHE_DIR%"
)

cmd /k "echo. & echo === CraftSync Build === & echo. & node --version & echo. & echo Installing deps... & npm install --no-audit --no-fund & echo. & echo Building EXE (no code signing)... & npx electron-builder --win --x64 & echo. & echo DONE. Check dist folder. & echo."
