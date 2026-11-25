@echo off
setlocal
chcp 65001 >nul
title Xynapse Code

rem Launcher used by the desktop / Start menu shortcut made by the Xynapse installer.
rem 1) Node.js 18+ if it is installed.  2) Otherwise the Node runtime built into the Xynapse app,
rem    so nothing else has to be installed.

set "CODE_DIR=%~dp0"
set "NODE_MAJOR=0"
where node >nul 2>nul
if not errorlevel 1 (
  for /f "usebackq delims=" %%v in (`node -p "parseInt(process.versions.node)"`) do set "NODE_MAJOR=%%v"
)

if %NODE_MAJOR% GEQ 18 (
  node "%CODE_DIR%bin\xynapse.js" %*
  goto :finish
)

set "APP_EXE=%CODE_DIR%..\..\Xynapse.exe"
if not exist "%APP_EXE%" (
  echo Xynapse Code needs Node.js 18 or newer, or the Xynapse desktop app next to it.
  echo Install Node.js from https://nodejs.org and try again.
  pause
  exit /b 1
)

set "ELECTRON_RUN_AS_NODE=1"
start "" /b /wait "%APP_EXE%" "%CODE_DIR%bin\xynapse.js" %*

:finish
if errorlevel 1 pause
endlocal
