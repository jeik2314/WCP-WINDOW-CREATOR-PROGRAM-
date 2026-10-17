@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
 echo Run SetupVirtualCamera.cmd first.
 pause
 exit /b 1
)
".venv\Scripts\python.exe" virtual_camera.py
pause
