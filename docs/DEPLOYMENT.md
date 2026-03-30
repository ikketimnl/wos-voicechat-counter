# Deployment Guide — WoS VoiceChat Counter

## Prerequisites

- Node.js 20 or higher (22 LTS recommended)
- A Discord account with a bot application created
- Docker + Docker Compose (for server deployment)

---

## Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, give it a name, click **Create**
3. Go to the **Bot** section and click **Add Bot**
4. Under **Privileged Gateway Intents**, enable:
   - Server Members Intent
   - Message Content Intent
5. Copy the **Bot Token** — you'll need it in Step 3

---

## Step 2: Invite the Bot to Your Server

1. Go to **OAuth2 → URL Generator**
2. Under **Scopes**, select `bot` and `applications.commands`
3. Under **Bot Permissions**, select:
   - Send Messages
   - Use Slash Commands
   - Connect
   - Speak
   - Use Voice Activity
4. Copy the generated URL, open it, select your server, and authorize

---

## Step 3: Get Your IDs

- **Bot Token** — from the Bot section (Step 1)
- **Client ID** — from General Information → Application ID
- **Guild ID** — right-click your server in Discord → Copy Server ID  
  *(Enable Developer Mode first: User Settings → Advanced → Developer Mode)*

---

## Step 4: Configure & Run

### Option A — Windows (recommended for home users)

Run `windowsautosetup.bat` as Administrator. It will install all dependencies,
prompt for your credentials, build the Docker container, and create `start.bat`
/ `stop.bat` shortcuts.

### Option B — Docker (recommended for servers / Pelican / Pterodactyl)

```bash
git clone https://github.com/ikketimnl/wos-voicechat-counter.git
cd wos-voicechat-counter
node setup.js        # interactive wizard
docker compose up -d
docker compose logs -f
```

See **[DOCKER.md](DOCKER.md)** for full Docker and Pelican/Pterodactyl instructions,
including how to install Piper Neural TTS and manage the audio cache.

### Option C — Local (no Docker)

```bash
git clone https://github.com/ikketimnl/wos-voicechat-counter.git
cd wos-voicechat-counter
node setup.js
npm start
```

Requires `espeak-ng` (Linux) or uses the built-in `say` (macOS) / SAPI (Windows).

---

## Step 5: Verify

1. The bot should appear online in your server
2. Run `/status` — it will show provider, count direction, and player count
3. Use `/join` to pull the bot into your voice channel
4. Register some players with `/register`, then try `/preview`

---

## Voice Generator Options

Use `/settings` in Discord to switch between them at any time:

| Provider  | Quality   | Works on                  |
|-----------|-----------|---------------------------|
| `local`   | Good      | Windows / macOS / Linux   |
| `espeak`  | Robotic   | Linux / Docker            |
| `festival`| Better    | Linux / Docker            |
| `piper`   | Natural   | Linux / Docker (extra install — see DOCKER.md) |
| `console` | None      | All (testing/debug only)  |

---

## Custom Audio Files

Use `/audio upload` in Discord to replace TTS with your own clips:

- `5.wav` → spoken instead of TTS "5"
- `intro.wav` → opening announcement
- `complete.wav` → closing phrase

Supported formats: WAV, MP3, OGG, FLAC. Max 5 MB per file.

---

## In-Bot Updates

Use `/botupdate` to check for new versions and apply them automatically.
Requires the bot to have been started from a `git clone` (not a plain download).

---

## Useful Commands

```bash
docker compose logs -f          # live logs
docker compose restart          # restart
docker compose down             # stop
docker compose up -d --build    # rebuild and restart
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Bot not responding to slash commands | Wait 30 s after first start for commands to register; restart if needed |
| No audio in voice channel | Check logs for TTS errors; try `/settings` → switch to `espeak` |
| "Missing Permissions" | Re-invite with the URL Generator using the permissions above |
| "Voice Connection Failed" | Ensure bot has Connect + Speak permissions in the channel |
| Container exits immediately | Run `docker compose logs` to see the error; likely a bad token in config.json |

---

## Security Notes

- Never share your bot token publicly
- `config.json` is git-ignored by default — keep it out of version control
- Regularly rotate your bot token in the Discord Developer Portal
