@echo off
chcp 65001 >nul
echo กำลังสร้างโฟลเดอร์ตั้งแต่ TO-001 ถึง TO-999 ...

for /L %%i in (1,1,999) do (
    if %%i LSS 10 (
        mkdir "TO-00"%%i
    ) else if %%i LSS 100 (
        mkdir "TO-0"%%i
    ) else (
        mkdir "TO-%%i"
    )
)

echo สร้างโฟลเดอร์ทั้งหมดเสร็จเรียบร้อยแล้ว!
pause