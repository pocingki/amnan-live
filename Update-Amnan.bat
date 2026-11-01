@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AMNAN LIVE - pembaruan

where git >nul 2>nul
if errorlevel 1 (
  echo Git belum terpasang. Pasang Git for Windows dari https://git-scm.com lalu jalankan file ini lagi.
  pause
  exit /b 1
)

echo Pastikan Mulai-Amnan.bat sudah ditutup sebelum memperbarui.
pause

git pull
if errorlevel 1 (
  echo Gagal mengambil pembaruan. Periksa koneksi internet dan akses ke repositori.
  pause
  exit /b 1
)
call npm ci
call npm run build:css

echo.
echo Pembaruan selesai. Jalankan Mulai-Amnan.bat lagi. Data dan pengaturan Anda tidak berubah.
pause
