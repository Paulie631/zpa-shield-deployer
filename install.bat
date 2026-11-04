@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  ZPA Shield Deployer — Windows Installer
::  Run as: install.bat  (or double-click)
:: ============================================================

title ZPA Shield Deployer Installer
echo.
echo  ==========================================
echo   ZPA Shield Deployer -- Windows Installer
echo  ==========================================
echo.

:: --- Check Node.js ---
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo  [ERROR] Node.js not found.
  echo.
  echo  Install Node.js 18+ from https://nodejs.org
  echo  Then re-run this installer.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.versions.node)"') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found

:: --- Check curl ---
where curl >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo  [ERROR] curl not found. Windows 10+ should include curl.
  echo  Download from https://curl.se/windows/
  pause
  exit /b 1
)

:: --- Check PowerShell for unzip ---
where powershell >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo  [ERROR] PowerShell not found. Required for extraction.
  pause
  exit /b 1
)

:: --- Fetch latest release info ---
echo.
echo  [..] Fetching latest release from GitHub...
set "API_URL=https://api.github.com/repos/Paulie631/zpa-shield-deployer/releases/latest"
set "TMP_JSON=%TEMP%\zpa-release.json"

curl -sf -H "User-Agent: zpa-shield-deployer-installer" "%API_URL%" -o "%TMP_JSON%"
if %ERRORLEVEL% neq 0 (
  echo  [ERROR] Could not fetch release info. Check your internet connection.
  pause
  exit /b 1
)

:: Extract version and zip URL via PowerShell
for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "& { $j = Get-Content '%TMP_JSON%' | ConvertFrom-Json; Write-Output $j.tag_name }"`) do set VERSION=%%a
for /f "usebackq tokens=*" %%a in (`powershell -NoProfile -Command "& { $j = Get-Content '%TMP_JSON%' | ConvertFrom-Json; $asset = $j.assets | Where-Object { $_.name -like '*.zip' } | Select-Object -First 1; Write-Output $asset.browser_download_url }"`) do set ZIP_URL=%%a

if "%ZIP_URL%"=="" (
  echo  [ERROR] Could not find release zip URL.
  pause
  exit /b 1
)

echo  [OK] Latest version: %VERSION%

:: --- Download zip ---
set "INSTALL_DIR=%USERPROFILE%\zpa-shield-deployer"
set "TMP_ZIP=%TEMP%\zpa-shield-%VERSION%.zip"
set "TMP_EXTRACT=%TEMP%\zpa-shield-extract"

echo  [..] Downloading %VERSION%...
curl -sL "%ZIP_URL%" -o "%TMP_ZIP%"
if %ERRORLEVEL% neq 0 (
  echo  [ERROR] Download failed.
  pause
  exit /b 1
)
echo  [OK] Downloaded

:: --- Extract ---
if exist "%INSTALL_DIR%" (
  echo.
  echo  [WARN] Existing installation found at %INSTALL_DIR%
  set /p CONFIRM="  Overwrite? (Y/N): "
  if /i not "!CONFIRM!"=="Y" (
    echo  Cancelled.
    pause
    exit /b 0
  )
  rmdir /s /q "%INSTALL_DIR%"
)

if exist "%TMP_EXTRACT%" rmdir /s /q "%TMP_EXTRACT%"
mkdir "%TMP_EXTRACT%"

echo  [..] Extracting...
powershell -NoProfile -Command "Expand-Archive -Path '%TMP_ZIP%' -DestinationPath '%TMP_EXTRACT%' -Force"

:: Move extracted folder contents to install dir
for /d %%d in ("%TMP_EXTRACT%\*") do (
  mkdir "%INSTALL_DIR%"
  xcopy "%%d\*" "%INSTALL_DIR%\" /E /I /Q /Y >nul
)

del "%TMP_ZIP%" >nul 2>&1
rmdir /s /q "%TMP_EXTRACT%" >nul 2>&1
echo  [OK] Extracted to %INSTALL_DIR%

:: --- npm install ---
echo  [..] Installing dependencies (this takes ~30 seconds)...
cd /d "%INSTALL_DIR%"
call npm run install:all
if %ERRORLEVEL% neq 0 (
  echo  [ERROR] npm install failed.
  pause
  exit /b 1
)
echo  [OK] Dependencies installed

:: --- Create start.bat ---
echo @echo off > "%INSTALL_DIR%\start.bat"
echo cd /d "%INSTALL_DIR%" >> "%INSTALL_DIR%\start.bat"
echo echo Starting ZPA Shield Deployer... >> "%INSTALL_DIR%\start.bat"
echo echo Open http://localhost:3000 in your browser >> "%INSTALL_DIR%\start.bat"
echo echo. >> "%INSTALL_DIR%\start.bat"
echo npm run dev >> "%INSTALL_DIR%\start.bat"

:: --- Create Desktop shortcut ---
powershell -NoProfile -Command "& { $WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\Desktop\ZPA Shield Deployer.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\start.bat'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.IconLocation = 'shell32.dll,44'; $Shortcut.Description = 'ZPA Shield Deployer'; $Shortcut.Save() }" 2>nul

:: --- Done ---
echo.
echo  ==========================================
echo   ZPA Shield Deployer %VERSION% installed!
echo  ==========================================
echo.
echo   To start:
echo     cd %INSTALL_DIR%
echo     npm run dev
echo     -- or --
echo     Double-click "ZPA Shield Deployer" on your Desktop
echo     -- or --
echo     Run: %INSTALL_DIR%\start.bat
echo.
echo   Then open: http://localhost:3000
echo  ==========================================
echo.
pause
