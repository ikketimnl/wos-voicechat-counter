@echo off
setlocal

:: Force elevation — UAC prompt if not already admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs -WindowStyle Normal -WorkingDirectory '%~dp0'"
    exit /b
)

:: Force working directory to script location after elevation
cd /d "%~dp0"

for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "BLUE=%ESC%[34m"
set "GREEN=%ESC%[32m"
set "MAGENTA=%ESC%[35m"
set "RED=%ESC%[31m"
set "RESET=%ESC%[0m"

echo %MAGENTA%==============================
echo  WoS VoiceChat Counter
echo  Windows Setup
echo ==============================%RESET%
echo.
echo %BLUE% This script will:
echo   1. Install Node.js v22 if needed
echo   2. Clone the bot from GitHub
echo   3. Install dependencies
echo   4. Collect your Discord credentials
echo   5. Create start.bat and stop.bat %RESET%
echo.
timeout /t 3 /nobreak >nul

:: ----------------------------------------
:: Node.js v22 check and install
:: ----------------------------------------
echo.
echo %BLUE% Checking Node.js version... %RESET%

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED% Node.js not found. Installing v22... %RESET%
    goto :install_node
)

for /f "tokens=1 delims=." %%a in ('node --version') do set "NODE_VER_RAW=%%a"
set "NODE_MAJOR=%NODE_VER_RAW:~1%"
echo %BLUE% Detected Node.js major version: %NODE_MAJOR% %RESET%

if "%NODE_MAJOR%"=="22" (
    echo %GREEN% Node.js v22 already installed. %RESET%
    goto :clone_repo
)

echo %RED% Node.js v%NODE_MAJOR% detected but v22 is required. Upgrading... %RESET%

:install_node
echo %BLUE% Downloading Node.js v22.14.0... %RESET%
curl -L --progress-bar -o "%TEMP%\node-installer.msi" "https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi"
if %errorlevel% neq 0 (
    echo %RED% Failed to download Node.js installer. Check your internet connection. %RESET%
    pause
    exit /b 1
)

echo %BLUE% Installing Node.js v22.14.0... %RESET%
start /wait msiexec /i "%TEMP%\node-installer.msi" /passive /norestart
if %errorlevel% neq 0 (
    echo %RED% Node.js installation failed. %RESET%
    pause
    exit /b 1
)
del "%TEMP%\node-installer.msi" >nul 2>&1

:: Refresh PATH so node is available in this session
set "PATH=%PATH%;C:\Program Files\nodejs"

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED% Node.js installed but PATH not updated yet. %RESET%
    echo %BLUE% Please close this window and re-run the script. %RESET%
    pause
    exit /b 0
)
echo %GREEN% Node.js v22 installed successfully! %RESET%

:: ----------------------------------------
:: Clone the repository
:: ----------------------------------------
:clone_repo
echo.
echo %BLUE% Checking for Git... %RESET%
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %BLUE% Git not found. Installing via winget... %RESET%
    winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
    :: Refresh PATH
    set "PATH=%PATH%;C:\Program Files\Git\cmd"
)

echo %BLUE% Cloning bot repository... %RESET%
if exist counterbotVC (
    echo %BLUE% counterbotVC folder already exists — pulling latest... %RESET%
    cd counterbotVC
    git pull
) else (
    git clone https://github.com/ikketimnl/wos-voicechat-counter.git counterbotVC
    cd counterbotVC
)

:: ----------------------------------------
:: Install Node dependencies
:: ----------------------------------------
echo.
echo %BLUE% Installing dependencies... %RESET%
npm install --no-audit --no-fund --no-warnings
if %errorLevel% neq 0 (
    echo %RED% npm install failed. Check your internet connection and try again. %RESET%
    pause
    exit /b 1
)
echo %GREEN% Dependencies installed. %RESET%

:: ----------------------------------------
:: Collect Discord credentials and write config
:: ----------------------------------------
cls
echo.
echo %MAGENTA% ==============================
echo  Discord Configuration
echo  ==============================%RESET%
echo.
echo %BLUE% You need three values from the Discord Developer Portal:
echo   - Bot Token       (Bot page ^> Token ^> Reset Token)
echo   - Application ID  (General Information ^> Application ID)
echo   - Server ID       (Right-click your server ^> Copy Server ID)%RESET%
echo.
echo %RED% CLICK ON THIS WINDOW BEFORE TYPING! %RESET%
echo.

if not exist config mkdir config

set /p token=%GREEN%Enter your Discord Bot Token: %RESET%
set /p clientId=%GREEN%Enter your Application ID:   %RESET%
set /p guildId=%GREEN%Enter your Server ID:         %RESET%

echo.
echo %BLUE% Writing config\config.json ... %RESET%

(
echo {
echo   "token": "%token%",
echo   "clientId": "%clientId%",
echo   "guildId": "%guildId%"
echo }
) > config\config.json

echo %GREEN% config\config.json created. %RESET%

:: ----------------------------------------
:: Write default settings.json if absent
:: ----------------------------------------
if not exist config\settings.json (
    echo %BLUE% Writing default config\settings.json ... %RESET%
    (
    echo {
    echo   "ttsProvider": "local",
    echo   "countDirection": "down",
    echo   "introEnabled": true,
    echo   "introSpeed": "normal",
    echo   "voiceRate": 170,
    echo   "piperModel": "C:\\Program Files\\piper\\voices\\en_US-lessac-medium.onnx",
    echo   "customAudioDir": null,
    echo   "version": null
    echo }
    ) > config\settings.json
    echo %GREEN% config\settings.json created with defaults. %RESET%
)

if not exist config\custom_audio mkdir config\custom_audio

:: ----------------------------------------
:: Create start.bat
:: ----------------------------------------
echo.
echo %BLUE% Creating start.bat ... %RESET%
(
echo @echo off
echo cd /d "%%~dp0"
echo echo.
echo echo Starting WoS VoiceChat Counter...
echo echo Press Ctrl+C to stop.
echo echo.
echo npm start
echo pause
) > start.bat
echo %GREEN% start.bat created. %RESET%

:: ----------------------------------------
:: Create stop.bat  (sends Ctrl+C to any node index.js process)
:: ----------------------------------------
echo %BLUE% Creating stop.bat ... %RESET%
(
echo @echo off
echo echo Stopping WoS VoiceChat Counter...
echo taskkill /f /im node.exe /fi "WINDOWTITLE eq WoS VoiceChat Counter*" >nul 2>^&1
echo taskkill /f /im node.exe /fi "WINDOWTITLE eq npm*" >nul 2>^&1
echo echo Done.
echo pause
) > stop.bat
echo %GREEN% stop.bat created. %RESET%

:: ----------------------------------------
:: Done
:: ----------------------------------------
cls
echo %MAGENTA% ==============================
echo  Setup complete!
echo  ==============================%RESET%
echo.
echo %GREEN% The bot is installed in: %CD% %RESET%
echo.
echo %BLUE% To start the bot:    double-click start.bat%RESET%
echo %BLUE% To stop the bot:     double-click stop.bat%RESET%
echo %BLUE% To change settings:  use /settings in Discord%RESET%
echo.
echo %BLUE% First-time startup will generate TTS audio files (1-200).
echo This takes a few minutes and is cached for future runs.%RESET%
echo.
pause

endlocal
