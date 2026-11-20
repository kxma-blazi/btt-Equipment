@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo กำลังลบโฟลเดอร์รหัสอุปกรณ์ชั้นนอกสุด (TO-* และ BTT-TO*)...

for /d %%D in (TO-* BTT-TO*) do (
    echo ลบโฟลเดอร์: %%D
    rd /s /q "%%D"
)

echo.
echo กำลังอัปเดตขึ้น GitHub...
git add -A
git commit -m "Remove root asset folders"
git push

echo.
echo เสร็จเรียบร้อย!
pause