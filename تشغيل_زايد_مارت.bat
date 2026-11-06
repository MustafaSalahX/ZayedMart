@echo off
chcp 65001 >nul
title زايد مارت - Turborepo NestJS + Supabase Cloud
cd /d "%~dp0"
echo جاري إغلاق أي خادم قديم عالق على المنفذ 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)
echo جاري بناء حزم Turborepo (Shared + NestJS API + React PWA)...
call npx turbo run build
if %ERRORLEVEL% NEQ 0 (
  echo حدث خطأ أثناء البناء! راجع الرسائل أعلاه.
  pause
  exit /b %ERRORLEVEL%
)
echo جاري تشغيل خادم NestJS واللاسلكي العالمي على http://localhost:3001 ...
start "" http://localhost:3001
node apps/api/dist/main.js
pause
