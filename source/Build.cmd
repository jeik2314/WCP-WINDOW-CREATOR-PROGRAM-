@echo off
cd /d "%~dp0\.."
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /out:"WINDOW CREATOR PROGRAM.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll source\Program.cs
pause
