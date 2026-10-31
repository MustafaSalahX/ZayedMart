@echo off
chcp 65001 >nul
title زايد مارت - نظام التشغيل والمراقبة
cd /d "%~dp0"
echo جاري تشغيل نظام زايد مارت...
if not exist "dist\index.html" (
  call npm run build
)
start "" http://localhost:3001
node server/index.js
pause
