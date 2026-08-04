@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo 查询中，请稍后...
echo.
node src\query\query-usage-all.mjs --display=long --hide-on-monthly-exhausted=false --hide-on-no-active-plan=false
echo.
echo.
echo 按任意键退出...
pause >nul
