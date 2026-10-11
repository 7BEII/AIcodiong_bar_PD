@echo off
title AIcodiong_bar_PD Launcher
cd /d "%~dp0"
echo.
echo ==========================================
echo    AIcodiong_bar_PD is starting...
echo ==========================================
echo.

:: Check if node_modules exists, if not, try to install
if not exist node_modules (
    echo node_modules not found, running npm install...
    call npm install
)

:: Run the project
call npm start

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Application exited with error code %errorlevel%
    pause
)
