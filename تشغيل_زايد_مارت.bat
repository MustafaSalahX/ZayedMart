@echo off
chcp 65001 >nul
title زايد مارت - نظام التشغيل والمراقبة واللاسلكي الحي
cd /d "%~dp0"
echo جاري إغلاق أي خادم قديم عالق على المنفذ 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
echo جاري تحديث واجهة النظام (Build)...
call npm run build
echo جاري تشغيل خادم زايد مارت واللاسلكي الحي على http://localhost:3001 ...
start "" http://localhost:3001
node --watch server/index.js
pause
