'use strict';

const {
  joinVoiceChannel,
  createAudioPlayer,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const { EmbedBuilder } = require('discord.js');
const { TTSService }   = require('./TTSService');

class VoiceManager {

  /**
   * @param {import('discord.js').Client} client
   * @param {import('./BotSettings').BotSettings} settings
   * @param {import('./CustomAudioManager').CustomAudioManager} customAudio
   */
  constructor(client, settings, customAudio) {
    this.client      = client;
    this.settings    = settings;
    this.connections = new Map();   // guildId → VoiceConnection
    this.audioPlayers = new Map();  // guildId → AudioPlayer
    this.countdownTimers = new Map(); // guildId → timeout handle
    this.ttsService  = new TTSService(settings, customAudio);
  }

  // ── Voice channel management ─────────────────────────────────────────────

  async joinVoiceChannel(interaction) {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      throw new Error('You need to be in a voice channel to use this command!');
    }

    const connection = joinVoiceChannel({
      channelId:       voiceChannel.id,
      guildId:         voiceChannel.guild.id,
      adapterCreator:  voiceChannel.guild.voiceAdapterCreator,
      selfDeaf:        false,
      selfMute:        false,
    });

    const audioPlayer = createAudioPlayer();
    connection.subscribe(audioPlayer);

    this.connections.set(interaction.guildId, connection);
    this.audioPlayers.set(interaction.guildId, audioPlayer);

    connection.on('stateChange', (oldState, newState) => {
      console.log(`[VoiceManager] ${oldState.status} → ${newState.status}`);
    });

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 10_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 10_000),
        ]);
      } catch {
        connection.destroy();
        this.connections.delete(interaction.guildId);
        this.audioPlayers.delete(interaction.guildId);
      }
    });

    // Wait for the connection to be fully established (up to 60 s).
    // On some nodes UDP negotiation cycles through connecting → connecting
    // several times before settling; 30 s was not always enough.
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 60_000);
    } catch {
      connection.destroy();
      this.connections.delete(interaction.guildId);
      this.audioPlayers.delete(interaction.guildId);
      throw new Error('Timed out waiting for voice connection. The bot joined successfully — try /join again.');
    }

    return connection;
  }

  leaveVoiceChannel(guildId) {
    const connection = this.connections.get(guildId);
    if (connection) {
      connection.destroy();
      this.connections.delete(guildId);
      this.audioPlayers.delete(guildId);
    }
    this._clearTimer(guildId);
  }

  isInVoiceChannel(guildId) { return this.connections.has(guildId); }

  getConnection(guildId) { return this.connections.get(guildId); }

  // ── Countdown management ─────────────────────────────────────────────────

  isCountdownActive(guildId) { return this.countdownTimers.has(guildId); }

  _clearTimer(guildId) {
    const t = this.countdownTimers.get(guildId);
    if (t) { clearTimeout(t); this.countdownTimers.delete(guildId); }
  }

  async startAttackCountdown(interaction, attackTiming) {
    if (!this.connections.has(interaction.guildId)) {
      throw new Error('Bot is not in a voice channel. Use /join first.');
    }

    const { players, totalDuration, attackGroup } = attackTiming;
    const groupText = attackGroup ? `Attack Group ${attackGroup}` : 'All Groups';
    const dir       = this.settings.countDirection;
    const intro     = this.settings.introEnabled;

    const embed = new EmbedBuilder()
      .setTitle('🚀 Attack Sequence Initiated!')
      .setColor('#FF6B6B')
      .setDescription(
        `**${groupText}** | **${totalDuration}s total** | **${players.length} players**\n` +
        `🔊 Direction: **${dir === 'up' ? 'Count Up ↑' : 'Count Down ↓'}** | ` +
        `Intro: **${intro ? 'Enabled' : 'Disabled'}**`,
      )
      .addFields(players.map(p => ({
        name:   `Player ${p.attackOrder}: ${p.name} (Group ${p.attackGroup})`,
        value:  `Starts in: **${p.attackStartTime}s** | Arrives in: **${p.timeToDestination}s**`,
        inline: false,
      })))
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
    await this.playSynchronizedCountdown(interaction.guildId, players, totalDuration);
  }

  async stopAttackCountdown(guildId) {
    this._clearTimer(guildId);
    const player = this.audioPlayers.get(guildId);
    if (player) player.stop();
    return true;
  }

  async playSynchronizedCountdown(guildId, players, totalDuration) {
    const connection  = this.connections.get(guildId);
    const audioPlayer = this.audioPlayers.get(guildId);

    if (!connection || !audioPlayer) throw new Error('Voice connection not available.');

    if (connection.state.status !== VoiceConnectionStatus.Ready) {
      console.log('[VoiceManager] Waiting for connection to be ready…');
      await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
    }

    const audioResource = await this.ttsService.generateSynchronizedCountdown(players, totalDuration);

    if (!audioResource) {
      throw new Error('Failed to generate countdown audio (check TTS provider).');
    }

    connection.subscribe(audioPlayer);

    const timer = setTimeout(() => this.countdownTimers.delete(guildId), (totalDuration + 5) * 1_000);
    this.countdownTimers.set(guildId, timer);

    audioPlayer.play(audioResource);

    return new Promise((resolve) => {
      audioPlayer.once(AudioPlayerStatus.Idle, () => {
        this._clearTimer(guildId);
        resolve();
      });
      audioPlayer.once('error', (err) => {
        console.error('[AudioPlayer] Error:', err.message);
        this._clearTimer(guildId);
        resolve();
      });
    });
  }

  async speakText(guildId, text) {
    const player = this.audioPlayers.get(guildId);
    if (!player) return;
    const resource = await this.ttsService.generateSpeech(text);
    if (!resource) return;
    player.play(resource);
    return new Promise(resolve => player.once(AudioPlayerStatus.Idle, resolve));
  }

  // Expose TTS service so CommandHandler can call cache operations
  getTTSService() { return this.ttsService; }
}

module.exports = { VoiceManager };
