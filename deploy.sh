#!/bin/bash
# WoS VoiceChat Counter — Docker deployment helper
set -e

echo "🚀 WoS VoiceChat Counter — Docker Deployment"
echo "=============================================="

# Docker check (supports both v1 and v2)
if ! command -v docker &>/dev/null; then
  echo "❌ Docker is not installed. Please install Docker first."
  exit 1
fi

# Use 'docker compose' (v2 plugin) if available, fall back to docker-compose
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  echo "❌ Docker Compose not found. Install Docker Desktop or the compose plugin."
  exit 1
fi

# Create required directories
echo "📁 Creating directories..."
mkdir -p config config/custom_audio temp temp/library

# Check for config.json (root level — that's where the bot reads it)
if [ ! -f "config.json" ] || [ "$(cat config.json)" = '{"token":"","clientId":"","guildId":""}' ]; then
  echo ""
  echo "⚠️  config.json is empty or missing. Run the setup wizard first:"
  echo "   node setup.js"
  echo ""
  read -rp "Continue without config? (y/N): "
  [[ $REPLY =~ ^[Yy]$ ]] || exit 1
fi

# Build
echo ""
echo "🔨 Building Docker image..."
$COMPOSE build

echo ""
echo "🚀 Starting bot..."
$COMPOSE up -d

echo ""
echo "✅ Bot is running!"
echo ""
echo "Useful commands:"
echo "  $COMPOSE logs -f           — live logs"
echo "  $COMPOSE restart           — restart"
echo "  $COMPOSE down              — stop"
echo "  $COMPOSE up -d --build    — rebuild & restart"
