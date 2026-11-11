@echo off
rem Desktop usage board - launcher (double click)
setlocal
set "ELECTRON_RUN_AS_NODE="
pushd "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [X] Electron runtime not found.
  echo     Run: pnpm install
  pause
  popd
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" .
popd
exit /b 0
