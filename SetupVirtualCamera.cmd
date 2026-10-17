@echo off
cd /d "%~dp0"
py -3 --version >nul 2>&1
if errorlevel 1 (
 echo Install Python 3.10 or newer from python.org first.
 pause
 exit /b 1
)
py -3 -m venv .venv
if errorlevel 1 goto fail
".venv\Scripts\python.exe" -m pip install "pyvirtualcam>=0.14,<0.16" "numpy>=1.26,<3" "Pillow>=10.4,<13"
if errorlevel 1 goto fail
echo Ready. Install OBS Studio if not already installed, then run VirtualCamera.cmd.
pause
exit /b 0
:fail
echo Setup failed. Check your Python installation and internet connection.
pause
exit /b 1
