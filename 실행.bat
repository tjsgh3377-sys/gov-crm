@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 고객관리 센터  (이 창을 닫으면 종료됩니다)
echo ============================================================
echo    고객관리 센터
echo ============================================================
echo.
echo  프로그램을 시작합니다. 잠시 후 브라우저가 자동으로 열립니다.
echo  주소: http://localhost:8741/
echo.
echo  * 이 검은 창을 닫으면 프로그램이 종료됩니다.
echo  * 로그인 비밀번호는 사용안내.txt 를 참고하세요.
echo ------------------------------------------------------------
echo.
start "" /b cmd /c "timeout /t 2 >nul & start "" http://localhost:8741/"
powershell -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
echo.
echo  프로그램이 종료되었습니다.
pause
