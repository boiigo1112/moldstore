@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  MoldStore - Quick Start (Windows)
echo ============================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [x] ไม่พบ Python
  echo     โหลดที่ https://www.python.org/downloads/ ^(เวอร์ชัน 3.10 ขึ้นไป^)
  echo     ** ตอนติดตั้งให้ติ๊ก "Add python.exe to PATH" **
  echo     แล้วเปิดไฟล์นี้ใหม่อีกครั้ง
  pause
  exit /b 1
)
python -c "import bcrypt" 2>nul
if errorlevel 1 (
  echo [*] ติดตั้ง bcrypt ครั้งแรก...
  pip install bcrypt
)

where node >nul 2>nul
if errorlevel 1 (
  echo [x] ไม่พบ Node.js
  echo     โหลดที่ https://nodejs.org ^(เลือก LTS^) แล้วเปิดไฟล์นี้ใหม่อีกครั้ง
  pause
  exit /b 1
)

echo [1/3] API หลัก (port 8080)...
start "MoldStore API :8080" "api\moldstore-api.exe"

echo [2/3] Workflow sidecar (port 8081)...
start "MoldStore Workflow :8081" python wf\server.py

echo [3/3] หน้าเว็บ (port 5173)...
cd web
if not exist node_modules (
  echo [*] ติดตั้ง node_modules ครั้งแรก (รอสักครู่)...
  call npm install
)
start "MoldStore Web :5173" cmd /k npm run dev
cd ..

echo.
echo รอประมาณ 10 วินาที แล้วเปิดเบราว์เซอร์...
timeout /t 10 >nul
start http://localhost:5173/
echo.
echo ============================================
echo  เข้าสู่ระบบ: admin / admin123
echo  (ช่าง: tech01 / tech123)
echo  ปิดหน้าต่างดำทั้ง 3 บาน = หยุดระบบ
echo ============================================
pause
