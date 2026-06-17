@echo off
setlocal EnableDelayedExpansion

:: Prevent spawnSync EINVAL errors by explicitly setting COMSPEC
if "%COMSPEC%"=="" set "COMSPEC=C:\WINDOWS\system32\cmd.exe"

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
echo  Windows Setup Wizard
echo ==============================%RESET%
echo.
echo %BLUE% This script will:
echo   1. Verify Node.js v22 is installed
echo   2. Clone the bot from GitHub
echo   3. Install dependencies
echo   4. Collect your Discord credentials
echo   5. Configure your TTS Engine and download models
echo   6. Create start.bat and stop.bat %RESET%
echo.
timeout /t 3 /nobreak >nul

:: ----------------------------------------
:: Node.js Version Check & Downgrade Logic
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

:: FLATTENED LOGIC: Prevents block-breaking parenthesis crashes
if "%NODE_MAJOR%"=="22" (
    echo %GREEN% Node.js v22 detected. Proceeding... %RESET%
    goto :clone_repo
)

if %NODE_MAJOR% LSS 22 goto :force_upgrade

:: If we reach this line, Node is version 23+
echo.
echo %RED% The bot is made based on Node.js v22 and it is recommended to use this version. %RESET%
echo %RED% Newer versions ^(v%NODE_MAJOR%^) might cause unexpected errors as they are not fully tested. %RESET%

set "downgrade=N"
set /p downgrade="%MAGENTA%Do you want to downgrade to Node.js v22 now? (Y/N): %RESET%"

if /i "!downgrade!"=="Y" goto :uninstall_and_downgrade

echo %GREEN% Proceeding with Node.js v%NODE_MAJOR% at your own risk... %RESET%
goto :clone_repo

:force_upgrade
echo %RED% Node.js v%NODE_MAJOR% detected but v22 is required. Upgrading... %RESET%
goto :install_node

:uninstall_and_downgrade
echo %BLUE% Uninstalling current Node.js version... (This may take a minute) %RESET%
:: FIX: Rewritten PowerShell command to prevent CMD quote-parsing crashes
powershell -NoProfile -ExecutionPolicy Bypass -Command "$app = Get-ItemProperty HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\* | Where-Object { $_.DisplayName -match 'Node.js' }; if ($app) { $u = $app.UninstallString -replace '/I', '/X'; $a = '/c ' + $u + ' /qn /norestart'; Start-Process cmd.exe -ArgumentList $a -Wait -NoNewWindow }"
timeout /t 3 >nul

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

echo %GREEN% Node.js v22 installed successfully! %RESET%
echo %RED% IMPORTANT: You must restart this script for the new environment variables to apply. %RESET%
echo %BLUE% Closing in 5 seconds... Please double-click the setup file again. %RESET%
timeout /t 5 >nul
exit /b 0

:: ----------------------------------------
:: Clone the repository
:: ----------------------------------------
:clone_repo
echo.
echo %BLUE% Checking for Git... %RESET%
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo %RED% Git not found. Please install Git manually from https://git-scm.com/ and re-run. %RESET%
    pause
    exit /b 1
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
call npm install --no-audit --no-fund
if %errorLevel% neq 0 (
    echo %RED% npm install failed. Check your internet connection and try again. %RESET%
    pause
    exit /b 1
)
echo %GREEN% Dependencies installed. %RESET%

:: ----------------------------------------
:: Collect Discord credentials
:: ----------------------------------------
cls
echo.
echo %MAGENTA% ==============================
echo  Discord Configuration
echo  ==============================%RESET%
echo.

if not exist config mkdir config

if exist config\config.json (
    echo %GREEN% Existing config.json detected! %RESET%
    set "keepConfig=Y"
    set /p keepConfig="%MAGENTA%Do you want to keep your existing Discord Bot credentials? (Y/N): %RESET%"
    if /i "!keepConfig!"=="Y" goto :tts_menu
)

echo %BLUE% You need three values from the Discord Developer Portal:
echo   - Bot Token       (Bot page ^> Token ^> Reset Token)
echo   - Application ID  (General Information ^> Application ID)
echo   - Server ID       (Right-click your server ^> Copy Server ID)%RESET%
echo.

set /p token="%GREEN%Enter your Discord Bot Token: %RESET%"
set /p clientId="%GREEN%Enter your Application ID:   %RESET%"
set /p guildId="%GREEN%Enter your Server ID:         %RESET%"

echo.
echo %BLUE% Writing config\config.json ... %RESET%
(
echo {
echo   "token": "%token%",
echo   "clientId": "%clientId%",
echo   "guildId": "%guildId%"
echo }
) > config\config.json
echo %GREEN% config\config.json saved. %RESET%

:: ----------------------------------------
:: Interactive TTS Configuration
:: ----------------------------------------
:tts_menu
echo.
echo %MAGENTA% ==============================
echo  TTS Configuration
echo  ==============================%RESET%
echo %BLUE% Choose your default TTS Engine:%RESET%
echo   1. local    - Auto-detect (Windows SAPI/say/espeak) [recommended]
echo   2. espeak   - eSpeak NG (fast, robotic - auto-installs via winget)
echo   3. festival - Festival TTS (not compatible with Windows)
echo   4. piper    - Piper neural TTS (natural, auto-installs models)
echo   5. console  - No audio, log-only (testing)

set "ttsChoice=1"
set /p ttsChoice="%GREEN%Select provider (1-5, default 1): %RESET%"

set "validChoice=false"
if "!ttsChoice!"=="1" set "validChoice=true"
if "!ttsChoice!"=="2" set "validChoice=true"
if "!ttsChoice!"=="3" set "validChoice=true"
if "!ttsChoice!"=="4" set "validChoice=true"
if "!ttsChoice!"=="5" set "validChoice=true"

if "!validChoice!"=="false" (
    echo.
    echo %RED% ERROR: Invalid selection '!ttsChoice!'. Please enter a number from 1 to 5. %RESET%
    timeout /t 3 >nul
    cls
    goto :tts_menu
)

set "ttsProvider=local"

if "!ttsChoice!"=="2" (
    set "ttsProvider=espeak"
    call :install_espeak
)
if "!ttsChoice!"=="3" (
    echo.
    echo %RED% ERROR: Festival TTS is not compatible with standard Windows systems. %RESET%
    echo %RED% It requires manual compilation from source or a native Linux context ^(WSL^). %RESET%
    echo %BLUE% Please select a compatible engine from the menu instead. %RESET%
    timeout /t 5 >nul
    cls
    goto :tts_menu
)
if "!ttsChoice!"=="4" (
    set "ttsProvider=piper"
    call :install_piper
)
if "!ttsChoice!"=="5" set "ttsProvider=console"

:: Smart update of settings.json using PowerShell
echo.
echo %BLUE% Updating config\settings.json ... %RESET%
if exist "config\settings.json" (
    powershell -NoProfile -Command "$file = 'config\settings.json'; $json = Get-Content $file -Raw | ConvertFrom-Json; $json.ttsProvider = '%ttsProvider%'; $json.piperModel = 'C:/Program Files/piper/voices/en_US-lessac-medium.onnx'; $json | ConvertTo-Json -Depth 10 | Set-Content $file"
    echo %GREEN% config\settings.json successfully updated! ^(Your previous settings were preserved^) %RESET%
) else (
    (
    echo {
    echo   "ttsProvider": "%ttsProvider%",
    echo   "countDirection": "down",
    echo   "introEnabled": true,
    echo   "introSpeed": "normal",
    echo   "voiceRate": 170,
    echo   "piperModel": "C:/Program Files/piper/voices/en_US-lessac-medium.onnx",
    echo   "customAudioDir": null,
    echo   "version": null
    echo }
    ) > config\settings.json
    echo %GREEN% config\settings.json created. %RESET%
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
echo :: Load environments for active session
echo set "PATH=%%PATH%%;C:\Program Files\piper;C:\Program Files\eSpeak NG"
echo node index.js
echo pause
) > start.bat
echo %GREEN% start.bat created. %RESET%

:: ----------------------------------------
:: Create stop.bat 
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
echo %GREEN% The bot is configured in: %CD% %RESET%
echo.
echo %RED% IMPORTANT: If your bot is currently running, you MUST RESTART IT %RESET%
echo %RED% by using stop.bat and then start.bat for the new TTS settings to apply! %RESET%
echo.
echo %BLUE% To start the bot:    double-click start.bat%RESET%
echo %BLUE% To stop the bot:     double-click stop.bat%RESET%
echo %BLUE% To change settings:  use /settings in Discord%RESET%
echo.
pause

endlocal
exit /b 0

:: ========================================
:: SUBROUTINES
:: ========================================

:install_espeak
echo.
echo %MAGENTA% Installing eSpeak NG via WinGet... %RESET%
winget install -e --id eSpeak-NG.eSpeak-NG --accept-source-agreements --accept-package-agreements
if %errorlevel% neq 0 (
    echo %RED% eSpeak NG installation failed. You may need to download the .msi manually. %RESET%
) else (
    :: Safely add to Windows System PATH
    echo %BLUE% Adding eSpeak NG to system PATH safely... %RESET%
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$path = [Environment]::GetEnvironmentVariable('PATH', 'Machine'); if ($path -notmatch '[regex]::Escape(''C:\Program Files\eSpeak NG'')') { [Environment]::SetEnvironmentVariable('PATH', $path + ';C:\Program Files\eSpeak NG', 'Machine') }"
    
    :: Inject into current session memory
    set "PATH=%PATH%;C:\Program Files\eSpeak NG"
    echo %GREEN% eSpeak NG successfully installed and configured! %RESET%
)
goto :EOF

:install_piper
echo.
echo %MAGENTA% Downloading and Installing Piper TTS... %RESET%

if exist "C:\Program Files\piper\piper.exe" (
    echo %GREEN% Piper is already installed! Skipping download... %RESET%
    goto :EOF
)

:: Download and extract Piper executable
echo %BLUE% Downloading Piper Windows Executable... %RESET%
curl -L --progress-bar -o "%TEMP%\piper.zip" "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"

echo %BLUE% Extracting Piper to C:\Program Files\piper ... %RESET%
tar -xf "%TEMP%\piper.zip" -C "C:\Program Files"
del "%TEMP%\piper.zip" >nul 2>&1

:: Create voices folder and download models
if not exist "C:\Program Files\piper\voices" mkdir "C:\Program Files\piper\voices"

echo %BLUE% Downloading voice model ^(en_US-lessac-medium.onnx^)... %RESET%
curl -L --progress-bar -o "C:\Program Files\piper\voices\en_US-lessac-medium.onnx" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx"

echo %BLUE% Downloading voice model JSON config... %RESET%
curl -L --progress-bar -o "C:\Program Files\piper\voices\en_US-lessac-medium.onnx.json" "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"

:: Safely add to Windows System PATH
echo %BLUE% Adding Piper to system PATH safely... %RESET%
powershell -NoProfile -ExecutionPolicy Bypass -Command "$path = [Environment]::GetEnvironmentVariable('PATH', 'Machine'); if ($path -notmatch '[regex]::Escape(''C:\Program Files\piper'')') { [Environment]::SetEnvironmentVariable('PATH', $path + ';C:\Program Files\piper', 'Machine') }"

:: Inject into current session memory
set "PATH=%PATH%;C:\Program Files\piper"
echo %GREEN% Piper TTS successfully installed and configured! %RESET%
goto :EOF
