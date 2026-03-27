# WoS VoiceChat Counter — main Dockerfile (for standalone Docker deployments)
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        wget \
        git \
        build-essential \
        python3 \
        python3-pip \
        ffmpeg \
        espeak \
        espeak-ng \
        espeak-ng-data \
        festival \
        festvox-kallpc16k \
        libasound2-dev \
        libsodium-dev \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Optional: Piper Neural TTS
# comment to remove Piper (~350 MB). Then unset TTS_PROVIDER=piper in
# docker-compose.yml or use /settings in Discord.
#
RUN mkdir -p /opt/piper/voices \
     && wget -q -O /tmp/piper.tar.gz \
        https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
     && tar -xzf /tmp/piper.tar.gz -C /opt/piper --strip-components=1 \
     && rm /tmp/piper.tar.gz \
     && chmod +x /opt/piper/piper \
     && ln -s /opt/piper/piper /usr/local/bin/piper

 RUN wget -q -O /opt/piper/voices/en_US-lessac-medium.onnx \
        https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
     && wget -q -O /opt/piper/voices/en_US-lessac-medium.onnx.json \
        https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

 ENV PIPER_MODEL=/opt/piper/voices/en_US-lessac-medium.onnx

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p temp/library config/custom_audio

RUN useradd -m -u 1000 botuser \
    && chown -R botuser:botuser /app
USER botuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('./src/BotSettings')" || exit 1

CMD ["node", "index.js"]
