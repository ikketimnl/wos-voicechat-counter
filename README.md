# 🎙️ WoS VoiceChat Counter

A Discord bot that coordinates synchronized attacks in **Whiteout Survival** by announcing a voice countdown so all players hit their targets at the same moment.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🎯 Synchronized timing | Calculates exact start times so every player arrives simultaneously |
| ⚔️ Attack groups | Organize players into independent groups |
| 🔢 Count direction | Toggle between **Count Down** (max→1) and **Count Up** (1→max) via `/settings` |
| 📢 Rally intro | Optional spoken intro before counting; enable/disable via `/settings` |
| 🔊 Voice generators | Choose from **local auto-detect**, **eSpeak NG**, **Festival**, **Piper neural TTS**, or **console** (see `DOCKER.md` for Piper setup) |
| 🎵 Custom audio | Upload your own WAV/MP3/OGG files for numbers, the intro, and the outro via `/audio upload` |
| ⚙️ Visual settings menu | Full interactive settings panel — `/settings` in Discord |
| 🆕 In-bot updates | `/botupdate` checks GitHub Releases and can pull + reinstall automatically |
| 💾 Persistent config | All settings survive restarts, saved in `config/settings.json` |

---

## 🚀 Quick Start

### Option A — Docker (recommended for servers)

```bash
git clone https://github.com/ikketimnl/wos-voicechat-counter.git
cd wos-voicechat-counter
node setup.js          # interactive wizard
docker compose up -d
```

### Option B — Local (Windows / macOS / Linux)

```bash
git clone https://github.com/ikketimnl/wos-voicechat-counter.git
cd wos-voicechat-counter
node setup.js
npm start
```

---

## 🤖 Discord Commands

### Player Management
| Command | Description |
|---|---|
| `/register <name> <seconds> [group]` | Register a player with their travel time |
| `/update <name> <seconds> [group]` | Update a player's travel time or group |
| `/remove <name>` | Remove a player |
| `/clear` | Remove all players |
| `/cleargroup <group>` | Remove all players in a group |
| `/list` | Show all registered players |

### Voice & Attack
| Command | Description |
|---|---|
| `/join` | Bot joins your voice channel |
| `/leave` | Bot leaves the voice channel |
| `/launch [group]` | Start the synchronized countdown |
| `/preview [group]` | Preview timing without starting |
| `/stop` | Stop an active countdown |
| `/status` | Show bot status and current settings |

### Settings & Management
| Command | Description |
|---|---|
| `/settings` | Open the interactive settings menu |
| `/botupdate` | Check for and apply updates from GitHub |
| `/audio list` | List uploaded custom audio files |
| `/audio upload` | Upload a custom WAV/MP3/OGG audio file |
| `/audio delete <filename>` | Delete a custom audio file |
| `/audio clear` | Delete all custom audio files |
| `/audio coverage` | Show which numbers (1–60) have custom audio |

---

## ⚙️ Settings Menu (`/settings`)

The interactive settings panel lets you change everything without restarting:

- **Voice Generator** — switch between `local`, `espeak`, `festival`, `piper`, `console`
- **Count Direction** — toggle Count Down ↓ or Count Up ↑
- **Rally Intro** — enable or disable the opening announcement
- **Cache Controls** — clear countdown cache or full library cache to free disk space

All settings are saved immediately to `config/settings.json`.

---

## 🎵 Custom Audio Files

Replace the TTS voice with your own audio clips:

```
/audio upload   ← attach a file named:
  5.wav         → plays instead of TTS "5"
  intro.wav     → plays as the opening announcement
  complete.wav  → plays at the end
```

**Naming rules:** Use `<number>.wav` for numbers (e.g. `1.wav` through `200.wav`), or `intro.wav` / `complete.wav` for special phrases. Supported formats: WAV, MP3, OGG, FLAC. Max 5 MB per file.

Files are stored in `config/custom_audio/` (Docker volume-mounted, survives rebuilds).

---

## 🔊 Voice Generators

| Provider | Quality | Notes |
|---|---|---|
| `local` | Good | Auto-detects SAPI (Win), say (Mac), espeak (Linux) |
| `espeak` | Robotic | Fast, always available in Docker |
| `festival` | Better | Deeper voice, always available in Docker |
| `piper` | Natural | Neural TTS — requires extra install (see `DOCKER.md`) |
| `console` | None | Logs only — useful for testing without audio |

Switch between them live with `/settings`. The number library regenerates automatically and cached files from the old engine are cleaned up.

---

## 🐳 Docker & Sysadmin

See **[DOCKER.md](DOCKER.md)** for:
- Full Docker deployment guide
- Installing Piper Neural TTS (step-by-step)
- Cache management and disk usage tips
- Volume structure
- Troubleshooting

---

## 📋 Example Workflow

```
/join
/register Alpha 30
/register Beta  20
/register Gamma 10
/preview        ← check timing before launching
/launch         ← Bot speaks: "Alpha ready. Three. Two. One. Go.
                               [counts] 10... 9... 8... ATTACK!"
```

All three players arrive at the same second. 🎯

---

## 📄 License

MIT — see [LICENSE](LICENSE)
