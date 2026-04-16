@echo off
setlocal

cd /d "%~dp0"

python fix_bmp_bitdepth.py . --recursive
set "exit_code=%ERRORLEVEL%"

echo.
if "%exit_code%"=="0" (
    echo Done. All BMP conversions finished successfully.
) else (
    echo Finished with exit code: %exit_code%
)

pause
exit /b %exit_code%
