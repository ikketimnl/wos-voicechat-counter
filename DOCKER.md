# Docker Deployment Guide

## Pelican / Pterodactyl (yolk image)

If you're running the bot on a **Pelican** or **Pterodactyl** panel, use the pre-built yolk image published to the GitHub Container Registry:

```
ghcr.io/ikketimnl/wos-vc-yolk:nodejs_22
```

This image is rebuilt automatically by GitHub Actions on every push to `main` using `Dockerfile.yolk`. It includes `espeak-ng`, `festival`, `ffmpeg`, and `libsodium-dev` on top of the standard `yolks:nodejs_22` base.

To enable **Piper Neural TTS** in the yolk image, uncomment the Piper block in `Dockerfile.yolk`, commit, and push to `main` — the CI pipeline will rebuild and publish the updated image automatically.

---

## Quick Start

```bash
# 1. Clone and configure
git clone https://github.com/ikketimnl/wos-voicechat-counter.git
cd wos-voicechat-counter
node setup.js

# 2. Build and run
docker compose up -d

# 3. Check logs
docker compose logs -f counterbot-vc
```

---

## Voice Generator (TTS) Options

The bot supports four audio engines. All can be switched at runtime via `/settings`
in Discord **without rebuilding the container** (except Piper, see below).

| Provider  | Quality   | Install needed? | Notes |
|-----------|-----------|-----------------|-------|
| `local`   | Good      | ✅ Pre-installed | Auto-detects espeak-ng / festival |
| `espeak`  | Robotic   | ✅ Pre-installed | Fastest, lowest CPU |
| `festival`| Better    | ✅ Pre-installed | Slightly deeper voice |
| `piper`   | Natural   | ⚠️ Extra steps  | Neural TTS, most realistic |
| `console` | None      | ✅ Always        | Testing/debug only |

### Switching providers at runtime

Use `/settings` in Discord → dropdown selector. The number library will
automatically regenerate with the new voice. Cached files from the old provider
are deleted to free disk space.

---

## Sysadmin: Installing Piper Neural TTS

Piper produces noticeably more natural speech. It requires an extra ~350 MB
of disk space (binary + voice model).

### Step 1 — Enable Piper in the Dockerfile

Open `Dockerfile` and uncomment the Piper block (~lines 40–60):

```dockerfile
RUN mkdir -p /opt/piper/voices \
    && wget -q -O /tmp/piper.tar.gz \
       https://github.com/rhasspy/piper/releases/download/v1.2.0/piper_linux_x86_64.tar.gz \
    && tar -xzf /tmp/piper.tar.gz -C /opt/piper --strip-components=1 \
    && rm /tmp/piper.tar.gz \
    && chmod +x /opt/piper/piper \
    && ln -s /opt/piper/piper /usr/local/bin/piper

RUN wget -q -O /opt/piper/voices/en_US-lessac-medium.onnx \
       https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
    && wget -q -O /opt/piper/voices/en_US-lessac-medium.onnx.json \
       https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

ENV PIPER_MODEL=/opt/piper/voices/en_US-lessac-medium.onnx
```

### Step 2 — Rebuild the container

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Step 3 — Activate in Discord

Use `/settings` → change **Voice Generator** → select **Piper Neural TTS**.
The number library will regenerate automatically (takes ~2–5 minutes on first run).

### Alternative: Different Piper voice

Replace the model URLs with any voice from
https://huggingface.co/rhasspy/piper-voices and update the `PIPER_MODEL`
environment variable accordingly.

---

## Clearing the audio cache

Generated WAV files accumulate in `temp/` over time.

**From Discord (easiest):**
- `/settings` → **Clear Countdown Cache** — removes only final countdown files
- `/settings` → **Clear ALL Cache** — removes library + countdowns (forces full regeneration)

**From host shell:**
```bash
# Remove only final countdown files (library stays)
docker exec counterbot-vc find /app/temp -maxdepth 1 -name 'sync_countdown_*.wav' -delete

# Remove everything under temp/ (full regeneration on next launch)
docker exec counterbot-vc rm -rf /app/temp/library /app/temp/sync_countdown_*.wav

# Or from the host (if volumes are mounted at ./temp):
rm -rf ./temp/library ./temp/sync_countdown_*.wav
```

---

## Custom Audio Files

Users can upload custom WAV/MP3/OGG files via `/audio upload` in Discord.

Files are stored in `config/custom_audio/` which is volume-mounted, so they
survive container rebuilds. No sysadmin action is needed.

**Naming convention (users must follow this):**
- `1.wav` through `200.wav` — replace TTS for that number
- `intro.wav` — replaces the opening announcement
- `complete.wav` — replaces the "Sequence complete" closing

---

## Volumes

```yaml
volumes:
  - ./config:/app/config   # settings.json, config.json, custom_audio/
  - ./temp:/app/temp        # number library WAVs, countdown cache
```

Both are mounted from the host so rebuilding the image does **not** wipe settings
or the audio cache.

---

## Bot Updates (In-Bot)

The `/botupdate` command checks GitHub Releases and can pull updates automatically.

**Requirement:** The container must have been started from a git-cloned working
directory (not a Docker-image-only copy). This is the default when following
this guide (`git clone` → `docker compose up`).

If you see *"No .git directory found"*, the update must be applied manually:

```bash
git pull
docker compose build --no-cache
docker compose up -d
```

---

## Resource Limits

```yaml
deploy:
  resources:
    limits:
      memory: 768M
    reservations:
      memory: 256M
```

Piper uses slightly more CPU during generation. Consider increasing the limit
to `1G` if you experience timeouts when the library is first built.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No audio in voice channel | TTS failed silently | Check `docker compose logs` for TTS errors |
| "eSpeak produced no file" | espeak-ng not found | Ensure espeak-ng is installed (it is in the default Dockerfile) |
| Piper says "command not found" | Piper block not uncommented | Follow Piper installation steps above |
| Cache files filling disk | Old countdown files | Use `/settings` → Clear Cache |
| Bot disconnects after ~5 min | Discord idle disconnect | Use `/join` again; bot auto-reconnects on next launch |
