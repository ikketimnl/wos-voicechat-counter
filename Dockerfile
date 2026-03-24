# ──────────────────────────────────────────────────────────────────────────────
# wos-voicechat-counter — Dockerfile
# ──────────────────────────────────────────────────────────────────────────────
FROM ubuntu:22.04

# Avoid interactive timezone prompt
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# ── System packages ────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    git \
    build-essential \
    python3 \
    python3-pip \
    # Audio tools
    ffmpeg \
    # TTS engines (espeak-ng is the modern successor to espeak)
    espeak-ng \
    espeak-ng-data \
    festival \
    festvox-kallpc16k \
    # libasound for audio output (required by some TTS libs)
    libasound2-dev \
    # Used by sodium-native build
    libsodium-dev \
    # Misc
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ── Node.js 20 LTS ─────────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ─────────────────────────────────────────────────────────────────────────────
# Optional: Piper Neural TTS
#
# Uncomment the block below to install Piper inside the container.
# Piper produces significantly more natural speech than espeak/festival.
#
# SYSADMIN NOTE: Piper requires ~300 MB of disk space for the binary + voice
# model. The model (en_US-lessac-medium.onnx) is downloaded at build time.
# If you add Piper, rebuild the image with:  docker compose build
# Then set TTS_PROVIDER=piper in docker-compose.yml (or /settings in Discord).
#
# RUN mkdir -p /opt/piper/voices \
#     && wget -q -O /tmp/piper.tar.gz \
#        https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_linux_x86_64.tar.gz \
#     && tar -xzf /tmp/piper.tar.gz -C /opt/piper --strip-components=1 \
#     && rm /tmp/piper.tar.gz \
#     && chmod +x /opt/piper/piper \
#     && ln -s /opt/piper/piper /usr/local/bin/piper
#
# RUN wget -q -O /opt/piper/voices/en_US-lessac-medium.onnx \
#        https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
#     && wget -q -O /opt/piper/voices/en_US-lessac-medium.onnx.json \
#        https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
#
# ENV PIPER_MODEL=/opt/piper/voices/en_US-lessac-medium.onnx
# ─────────────────────────────────────────────────────────────────────────────

# ── App setup ──────────────────────────────────────────────────────────────────
WORKDIR /app

COPY package*.json ./

# Install production dependencies; native addons compile here
RUN npm ci --omit=dev

COPY . .

# Create writable directories
RUN mkdir -p temp/library config/custom_audio

# Non-root user
RUN useradd -m -u 1000 botuser \
    && chown -R botuser:botuser /app
USER botuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('./src/BotSettings')" || exit 1

CMD ["node", "index.js"]
