@echo off
chcp 65001 >nul
cd /d "%~dp0.."
node src\login\login-qwen.mjs %*
echo 按任意键退出...
pause >nul
