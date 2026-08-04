@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node src\tools\preview.mjs
echo.
echo 按任意键退出...
pause >nul
