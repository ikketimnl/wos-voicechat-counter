'use strict';

const { Client, GatewayIntentBits, MessageFlags } = require('discord.js');
const path = require('path');
const fs   = require('fs');

// ── Config loading ─────────────────────────────────────────────────────────
// Env vars take precedence over config.json so Docker/CI deployments can pass
// credentials without writing a config file.
let config = {};
const configPath = path.join(__dirname, '../config/config.json');
if (fs.existsSync(configPath)) {
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch (err) { console.error(`❌ Failed to parse config/config.json: ${err.message}`); process.exit(1); }
}
const token    = process.env.DISCORD_TOKEN    || config.token;
const clientId = process.env.DISCORD_CLIENT_ID || config.clientId;
const guildId  = process.env.DISCORD_GUILD_ID  || config.guildId;

if (!token || !clientId || !guildId) {
  console.error(
    '❌ Missing Discord credentials.\n' +
    '   Provide DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID env vars,\n' +
    '   or run: node src/setup.js to create config/config.json',
  );
  process.exit(1);
}
// Merge resolved values back so downstream code (CommandHandler) can still read config.token etc.
config = { ...config, token, clientId, guildId };

// ── FFmpeg validation ──────────────────────────────────────────────────────
const ffmpegPath = require('ffmpeg-static');
if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
  console.error('❌ ffmpeg binary not found. The ffmpeg-static package may be corrupt — try: npm ci');
  process.exit(1);
}

// ── Service imports ────────────────────────────────────────────────────────
const { PlayerManager }      = require('./svc/PlayerManager');
const { BotSettings }        = require('./svc/BotSettings');
const { CustomAudioManager } = require('./svc/CustomAudioManager');
const { VoiceManager }       = require('./svc/VoiceManager');
const { CommandHandler }     = require('./svc/CommandHandler');

// ── Initialise services ────────────────────────────────────────────────────
const settings    = new BotSettings();
const customAudio = new CustomAudioManager();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Attach managers to client so they share a single instance
client.playerManager  = new PlayerManager();
client.voiceManager   = new VoiceManager(client, settings, customAudio);
client.commandHandler = new CommandHandler(client, settings, customAudio);
client.settings       = settings;

// ── Events ─────────────────────────────────────────────────────────────────
client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.commandHandler.registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await client.commandHandler.handleCommand(interaction);
    } else if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      await client.commandHandler.handleComponentInteraction(interaction);
    }
  } catch (err) {
    console.error('Unhandled interaction error:', err);
    const reply = { content: '❌ An unexpected error occurred.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(reply);
      else await interaction.reply(reply);
    } catch (_) {}
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
const shutdown = () => {
  console.log('\n🛑 Shutting down…');
  client.destroy();
  process.exit(0);
};
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);

// ── Login ──────────────────────────────────────────────────────────────────
client.login(token).catch((err) => {
  console.error('❌ Login failed:', err.message);
  process.exit(1);
});
