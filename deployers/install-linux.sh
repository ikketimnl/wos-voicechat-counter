#!/usr/bin/env bash
# WoS VoiceChat Counter — Linux Installer
# Supports: Debian/Ubuntu, RHEL/Fedora/CentOS/Rocky/Alma, Arch, openSUSE, Alpine
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
echo " Linux Installer"
echo "=============================="
echo -e "${RESET}"

# ── Distro detection ─────────────────────────────────────────────────────────
detect_distro() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO_ID="${ID,,}"
    DISTRO_LIKE="${ID_LIKE,,}"
  elif command -v lsb_release &>/dev/null; then
    DISTRO_ID="$(lsb_release -si | tr '[:upper:]' '[:lower:]')"
    DISTRO_LIKE=""
  else
    DISTRO_ID="unknown"
    DISTRO_LIKE=""
  fi
}

is_like() {
  [[ "$DISTRO_ID" == *"$1"* ]] || [[ "$DISTRO_LIKE" == *"$1"* ]]
}

detect_distro
echo -e "${BLUE} Detected distro: ${DISTRO_ID}${RESET}"

# ── Privilege escalation ──────────────────────────────────────────────────────
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo &>/dev/null; then
    SUDO="sudo"
  else
    echo -e "${RED} Not running as root and sudo is not available. Please run as root.${RESET}"
    exit 1
  fi
fi

# ── Package manager helpers ───────────────────────────────────────────────────
pkg_update() {
  if is_like "debian" || is_like "ubuntu"; then
    $SUDO apt-get update -qq
  elif is_like "fedora" || is_like "rhel" || is_like "centos"; then
    $SUDO dnf check-update -q || true
  elif is_like "arch"; then
    $SUDO pacman -Sy --noconfirm
  elif is_like "opensuse" || is_like "suse"; then
    $SUDO zypper refresh -q
  elif is_like "alpine"; then
    $SUDO apk update -q
  fi
}

pkg_install() {
  if is_like "debian" || is_like "ubuntu"; then
    $SUDO apt-get install -y -qq "$@"
  elif is_like "fedora" || is_like "rhel" || is_like "centos"; then
    $SUDO dnf install -y -q "$@"
  elif is_like "arch"; then
    $SUDO pacman -S --noconfirm --needed "$@"
  elif is_like "opensuse" || is_like "suse"; then
    $SUDO zypper install -y -q "$@"
  elif is_like "alpine"; then
    $SUDO apk add -q "$@"
  else
    echo -e "${RED} Unknown distro '${DISTRO_ID}'. Install Node.js 22 and git manually, then re-run.${RESET}"
    exit 1
  fi
}

# ── Node.js 22 ────────────────────────────────────────────────────────────────
install_node() {
  echo -e "${BLUE} Installing Node.js v22...${RESET}"

  if is_like "debian" || is_like "ubuntu"; then
    pkg_install curl ca-certificates
    curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - >/dev/null 2>&1
    pkg_install nodejs

  elif is_like "fedora" || is_like "rhel" || is_like "centos"; then
    pkg_install curl
    curl -fsSL https://rpm.nodesource.com/setup_22.x | $SUDO bash - >/dev/null 2>&1
    pkg_install nodejs

  elif is_like "arch"; then
    pkg_install nodejs npm

  elif is_like "opensuse" || is_like "suse"; then
    pkg_install nodejs22 npm22

  elif is_like "alpine"; then
    pkg_install nodejs npm

  else
    echo -e "${RED} Cannot auto-install Node.js on '${DISTRO_ID}'. Please install Node.js 22 manually.${RESET}"
    exit 1
  fi
}

check_node() {
  if ! command -v node &>/dev/null; then
    echo -e "${BLUE} Node.js not found.${RESET}"
    pkg_update
    install_node
    return
  fi

  NODE_MAJOR=$(node --version | cut -d. -f1 | tr -d 'v')
  echo -e "${BLUE} Found Node.js major version: ${NODE_MAJOR}${RESET}"

  if [ "$NODE_MAJOR" -lt 18 ]; then
    echo -e "${RED} Node.js v${NODE_MAJOR} is too old (need >=18). Upgrading to v22...${RESET}"
    pkg_update
    install_node
  elif [ "$NODE_MAJOR" -ne 22 ]; then
    echo -e "${BLUE} Node.js v${NODE_MAJOR} is compatible but v22 is recommended.${RESET}"
  else
    echo -e "${GREEN} Node.js v22 already installed.${RESET}"
  fi
}

check_node

# ── Git ───────────────────────────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  echo -e "${BLUE} Installing git...${RESET}"
  pkg_update
  pkg_install git
fi

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
