@echo off
setlocal

rem Rebuild frontend\dist, which the running server serves.
cd /d "%~dp0frontend"

rem First run: install the dependencies. After a pull that changed
rem package-lock.json, run "npm ci" in frontend\ yourself.
if not exist node_modules\.bin\vite.cmd (
  call npm ci || exit /b 1
)
call npm run build || exit /b 1

endlocal
