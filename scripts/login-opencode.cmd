@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node src\login\login-opencode.mjs %*
echo 按任意键继续...
pause >nul
