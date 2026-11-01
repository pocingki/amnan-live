@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AMNAN LIVE - jangan tutup jendela ini selama bot dipakai

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang.
  echo Pasang Node.js 22 LTS dari https://nodejs.org lalu jalankan file ini lagi.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Memasang komponen aplikasi, mohon tunggu. Butuh koneksi internet...
  call npm ci
  if errorlevel 1 (
    echo Gagal memasang komponen. Periksa koneksi internet lalu coba lagi.
    pause
    exit /b 1
  )
)

if not exist .env (
  node scripts\setup-laptop.js
  if errorlevel 1 (
    echo Pengaturan awal gagal.
    pause
    exit /b 1
  )
)

if not exist public\assets\css\tailwind.css call npm run build:css

set PORT=8080
for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"PORT=" .env') do set PORT=%%b

echo.
echo AMNAN LIVE berjalan di http://localhost:%PORT%
echo Jendela ini harus tetap terbuka dan laptop harus menyala agar bot membalas pesan.
echo Untuk berhenti, tutup jendela ini atau tekan Ctrl+C.
echo.
start "" cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:%PORT%"
node server.js

echo.
echo Server berhenti.
pause
