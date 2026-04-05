# WoS VoiceChat Counter — main Dockerfile (for standalone Docker deployments)
FROM nikolaik/python-nodejs:python3.14-nodejs22-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

#       ffmpeg  espeak espeak-ng espeak-ng-data festival festvox-kallpc16k libasound2 libsodium-dev all unnecessary in build phase
RUN apt-get update && apt-get install -y --no-install-recommends \
        wget \
        dumb-init \
        build-essential \
        python3-pip \
        pipx \
        ca-certificates

RUN pip install piper-tts pathvalidate --break-system-packages

RUN pip wheel --no-clean --wheel-dir=/tmp/wheelhouse piper-tts pathvalidate

RUN mkdir -p /usr/local/bin/voices

RUN wget -q -O /usr/local/bin/voices/en_US-lessac-medium.onnx \
        https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
     && wget -q -O /usr/local/bin/voices/en_US-lessac-medium.onnx.json \
        https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

WORKDIR /app

COPY --chown=pn:pn ./package*.json .
RUN npm ci --omit=dev

FROM nikolaik/python-nodejs:python3.14-nodejs22-slim

ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

COPY --from=builder /usr/bin/dumb-init /usr/bin/dumb-init
COPY --from=builder /tmp/wheelhouse /tmp/wheelhouse

RUN pip install --root-user-action ignore --no-index --find-links=/tmp/wheelhouse piper-tts pathvalidate

COPY --chown=pn:pn --from=builder /usr/local/bin/voices/en_US-lessac-medium.onnx /usr/local/bin/voices/en_US-lessac-medium.onnx
COPY --chown=pn:pn --from=builder /usr/local/bin/voices/en_US-lessac-medium.onnx.json /usr/local/bin/voices/en_US-lessac-medium.onnx.json

COPY --chown=pn:pn --from=builder /app/package*.json /app/
COPY --chown=pn:pn --from=builder /app/node_modules /app/node_modules

RUN apt-get update

RUN apt-get install -y --no-install-recommends \
         ca-certificates

# FFMPEG Segment (490MB) - Is speed scaling really worth it? - waiiit.... it's installed via node dependency!!! This is completely superfluous?
#RUN apt-get install -y --no-install-recommends \
#         ffmpeg

# ESPEAK SEGMENT (70MB)
RUN apt-get install -y --no-install-recommends \
         espeak \
         espeak-ng \
         espeak-ng-data

# FESTIVAL SEGMENT (60MB) - This one is poor quality, and thrashes the disk on a memory-constrained system - Treating it like Piper and it works well enough (and faster)
RUN apt-get install -y --no-install-recommends \
        festival \
        festvox-kallpc16k

# LIBS OMITTED:
#  - libasound2 is not needed in docker environment, docker is not interfacing with audio hardware
#  - libsodium is packaged with the node dependencies
#RUN apt-get install -y --no-install-recommends \
#        libasound2 \
#        libsodium-dev

WORKDIR /app

COPY --chown=pn:pn ./src/ ./src

RUN chown -R pn:pn /app

USER pn

RUN mkdir -p temp/library config/custom_audio

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('./src/svc/BotSettings')" || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD [ "node", "src/index.js"]
