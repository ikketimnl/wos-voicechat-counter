#!/usr/bin/env bash
# WoS VoiceChat Counter — macOS Installer
# Requires macOS 12+ (Monterey or newer)
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  BLUE='\033[34m'; GREEN='\033[32m'; MAGENTA='\033[35m'
  RED='\033[31m';  RESET='\033[0m'
else
  BLUE=''; GREEN=''; MAGENTA=''; RED=''; RESET=''
fi

echo -e "${MAGENTA}"
echo "=============================="
echo " WoS VoiceChat Counter"
echo " macOS Installer"
echo "=============================="
echo -e "${RESET}"

# ── Xcode Command Line Tools (provides git) ───────────────────────────────────
if ! command -v git &>/dev/null; then
  echo -e "${BLUE} Installing Xcode Command Line Tools (provides git)...${RESET}"
  xcode-select --install 2>/dev/null || true
  echo -e "${BLUE} A dialog may have opened. Click Install and wait for it to finish.${RESET}"
  read -rp "Press Enter once the Xcode tools installation is complete..."
fi

# ── Homebrew ──────────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  echo -e "${BLUE} Installing Homebrew...${RESET}"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  # Add Homebrew to PATH for Apple Silicon and Intel
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
  elif [ -f /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  echo -e "${GREEN} Homebrew installed.${RESET}"
else
  echo -e "${GREEN} Homebrew already installed.${RESET}"
fi

# ── Node.js 22 via Homebrew ───────────────────────────────────────────────────
check_node() {
  if ! command -v node &>/dev/null; then
    echo -e "${BLUE} Node.js not found. Installing v22...${RESET}"
    brew install node@22
    brew link --overwrite --force node@22
    return
  fi

  NODE_MAJOR=$(node --version | cut -d. -f1 | tr -d 'v')
  echo -e "${BLUE} Found Node.js major version: ${NODE_MAJOR}${RESET}"

  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${RED} Node.js v${NODE_MAJOR} is too old (need >=18). Upgrading to v22...${RESET}"
    brew install node@22
    brew link --overwrite --force node@22
  elif [ "$NODE_MAJOR" -ne 22 ]; then
    echo -e "${BLUE} Node.js v${NODE_MAJOR} is compatible but v22 is recommended.${RESET}"
  else
    echo -e "${GREEN} Node.js v22 already installed.${RESET}"
  fi
}

check_node

# ── Clone / update ────────────────────────────────────────────────────────────
echo -e "\n${BLUE} Cloning bot repository...${RESET}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")/counterbotVC"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${BLUE} Directory exists — pulling latest...${RESET}"
  git -C "$INSTALL_DIR" pull
else
  git clone https://github.com/ikketimnl/wos-voicechat-counter.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# ── Dependencies ──────────────────────────────────────────────────────────────
echo -e "\n${BLUE} Installing Node dependencies...${RESET}"
npm install --no-audit --no-fund
echo -e "${GREEN} Dependencies installed.${RESET}"

# ── Config ────────────────────────────────────────────────────────────────────
mkdir -p config/custom_audio

echo ""
echo -e "${MAGENTA} =============================="
echo  " Discord Configuration"
echo -e " ==============================${RESET}"
echo ""
echo -e "${BLUE} You need three values from the Discord Developer Portal:"
echo "   - Bot Token       (Bot page → Token → Reset Token)"
echo "   - Application ID  (General Information → Application ID)"
echo -e "   - Server ID       (Right-click server → Copy Server ID)${RESET}"
echo ""

read -rp "$(echo -e "${GREEN}Enter your Discord Bot Token: ${RESET}")" token
read -rp "$(echo -e "${GREEN}Enter your Application ID:   ${RESET}")" clientId
read -rp "$(echo -e "${GREEN}Enter your Server ID:         ${RESET}")" guildId

cat > config/config.json << JSON
{
  "token": "${token}",
  "clientId": "${clientId}",
  "guildId": "${guildId}"
}
JSON
echo -e "${GREEN} config/config.json created.${RESET}"

# ── Default settings ──────────────────────────────────────────────────────────
if [ ! -f config/settings.json ]; then
  cat > config/settings.json << JSON
{
  "ttsProvider": "local",
  "countDirection": "down",
  "introEnabled": true,
  "introSpeed": "normal",
  "voiceRate": 170,
  "piperModel": "/usr/local/bin/voices/en_US-lessac-medium.onnx",
  "customAudioDir": null,
  "version": null
}
JSON
  echo -e "${GREEN} config/settings.json created with defaults.${RESET}"
fi

# ── start / stop scripts ──────────────────────────────────────────────────────
cat > start.sh << 'SH'
#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "Starting WoS VoiceChat Counter... (Ctrl+C to stop)"
npm start
SH
chmod +x start.sh

cat > stop.sh << 'SH'
#!/usr/bin/env bash
pkill -f "node src/index.js" && echo "Bot stopped." || echo "Bot was not running."
SH
chmod +x stop.sh

echo -e "${GREEN} start.sh and stop.sh created.${RESET}"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${MAGENTA} =============================="
echo  " Setup complete!"
echo -e " ==============================${RESET}"
echo ""
echo -e "${GREEN} Bot installed in: ${INSTALL_DIR}${RESET}"
echo ""
echo -e "${BLUE} To start the bot:  ./start.sh"
echo  " To stop the bot:   ./stop.sh"
echo -e " To change settings: use /settings in Discord${RESET}"
echo ""
echo -e "${BLUE} First-time startup will generate TTS audio files (1-200)."
echo -e " This takes a few minutes and is cached for future runs.${RESET}"
echo ""
