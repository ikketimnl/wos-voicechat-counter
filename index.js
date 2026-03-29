'use strict';

const { Client, GatewayIntentBits, MessageFlags } = require('discord.js');
const path = require('path');
const fs   = require('fs');

// ── Config loading ─────────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('❌ config.json not found. Run: node setup.js');
  process.exit(1);
}
const config = require(configPath);
if (!config.token || !config.clientId || !config.guildId) {
  console.error('❌ config.json is incomplete. Run: node setup.js');
  process.exit(1);
}

// ── Service imports ────────────────────────────────────────────────────────
const { PlayerManager }      = require('./src/PlayerManager');
const { BotSettings }        = require('./src/BotSettings');
const { CustomAudioManager } = require('./src/CustomAudioManager');
const { VoiceManager }       = require('./src/VoiceManager');
const { CommandHandler }     = require('./src/CommandHandler');

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
client.login(config.token).catch((err) => {
  console.error('❌ Login failed:', err.message);
  process.exit(1);
});
