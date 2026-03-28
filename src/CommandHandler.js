'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const { BotSettings }        = require('./BotSettings');
const { UpdateManager }      = require('./UpdateManager');
const { CustomAudioManager } = require('./CustomAudioManager');

class CommandHandler {
  constructor(client, settings, customAudio) {
    this.client        = client;
    this.settings      = settings;
    this.customAudio   = customAudio;
    this.updateManager = new UpdateManager();
    this.commands      = new Map();
    this._initCommands();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Command definitions
  // ═══════════════════════════════════════════════════════════════════════════

  _initCommands() {
    const cmd = (name, desc) => new SlashCommandBuilder().setName(name).setDescription(desc);
    const str = (opt, name, desc, req = true) =>
      opt.setName(name).setDescription(desc).setRequired(req);
    const int = (opt, name, desc, req = true, min = 1) =>
      opt.setName(name).setDescription(desc).setRequired(req).setMinValue(min);

    // Player management
    this.commands.set('register', cmd('register', 'Register a player with their travel time')
      .addStringOption(o => str(o, 'playername', 'Name of the player'))
      .addIntegerOption(o => int(o, 'seconds', 'Travel time in seconds'))
      .addIntegerOption(o => int(o, 'group', 'Attack group (default: 1)', false))
      .toJSON());

    this.commands.set('update', cmd('update', "Update a player's time/group")
      .addStringOption(o => str(o, 'playername', 'Player name'))
      .addIntegerOption(o => int(o, 'seconds', 'New travel time'))
      .addIntegerOption(o => int(o, 'group', 'New attack group', false))
      .toJSON());

    this.commands.set('remove', cmd('remove', 'Remove a player')
      .addStringOption(o => str(o, 'playername', 'Player name'))
      .toJSON());

    this.commands.set('clear', cmd('clear', 'Remove all players').toJSON());

    this.commands.set('cleargroup', cmd('cleargroup', 'Remove all players in a group')
      .addIntegerOption(o => int(o, 'group', 'Group number'))
      .toJSON());

    this.commands.set('list', cmd('list', 'List registered players').toJSON());

    // Voice
    this.commands.set('join',  cmd('join',  'Join your voice channel').toJSON());
    this.commands.set('leave', cmd('leave', 'Leave the voice channel').toJSON());

    // Attack
    this.commands.set('launch', cmd('launch', 'Launch synchronized attack')
      .addIntegerOption(o => int(o, 'group', 'Group to launch (default: all)', false))
      .toJSON());

    this.commands.set('preview', cmd('preview', 'Preview attack sequence without launching')
      .addIntegerOption(o => int(o, 'group', 'Group to preview (default: all)', false))
      .toJSON());

    this.commands.set('stop', cmd('stop', 'Stop active countdown').toJSON());

    this.commands.set('status', cmd('status', 'Show bot status').toJSON());

    this.commands.set('settings', cmd('settings', 'Open the bot settings menu').toJSON());

    this.commands.set('botupdate', cmd('botupdate', 'Check for and apply bot updates').toJSON());

    this.commands.set('audio', cmd('audio', 'Manage custom audio files')
      .addSubcommand(s => s.setName('list').setDescription('List uploaded custom audio files'))
      .addSubcommand(s => s
        .setName('upload')
        .setDescription('Upload a custom audio file (attach the file to this command)')
        .addAttachmentOption(o => o.setName('file').setDescription('WAV/MP3/OGG file').setRequired(true))
      )
      .addSubcommand(s => s
        .setName('delete')
        .setDescription('Delete a custom audio file')
        .addStringOption(o => o.setName('filename').setDescription('Filename to delete (e.g. 5.wav)').setRequired(true))
      )
      .addSubcommand(s => s.setName('clear').setDescription('Delete ALL custom audio files'))
      .addSubcommand(s => s.setName('coverage').setDescription('Show which numbers (1–60) have custom audio'))
      .toJSON());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Command registration
  // ═══════════════════════════════════════════════════════════════════════════

  async registerCommands() {
    const { REST, Routes } = require('discord.js');
    const config = require(path.join(__dirname, '../config.json'));
    const rest   = new REST({ version: '10' }).setToken(config.token);

    console.log('🔄 Registering slash commands…');
    try {
      await rest.put(
        Routes.applicationGuildCommands(config.clientId, config.guildId),
        { body: Array.from(this.commands.values()) },
      );
      console.log('✅ Slash commands registered.');
    } catch (err) {
      console.error('❌ Command registration failed:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Dispatch
  // ═══════════════════════════════════════════════════════════════════════════

  async handleCommand(interaction) {
    try {
      switch (interaction.commandName) {
        case 'register':   return await this._handleRegister(interaction);
        case 'update':     return await this._handleUpdate(interaction);
        case 'remove':     return await this._handleRemove(interaction);
        case 'clear':      return await this._handleClear(interaction);
        case 'cleargroup': return await this._handleClearGroup(interaction);
        case 'list':       return await this._handleList(interaction);
        case 'join':       return await this._handleJoin(interaction);
        case 'leave':      return await this._handleLeave(interaction);
        case 'launch':     return await this._handleLaunch(interaction);
        case 'preview':    return await this._handlePreview(interaction);
        case 'stop':       return await this._handleStop(interaction);
        case 'status':     return await this._handleStatus(interaction);
        case 'settings':   return await this._handleSettings(interaction);
        case 'botupdate':  return await this._handleBotUpdate(interaction);
        case 'audio':      return await this._handleAudio(interaction);
        default:
          await interaction.reply({ content: '❓ Unknown command.', flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      console.error(`[CommandHandler] Error in ${interaction.commandName}:`, err);
      const reply = { content: `❌ ${err.message}`, flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
  }

  // Handle button/select-menu interactions (called from index.js)
  async handleComponentInteraction(interaction) {
    const id = interaction.customId;

    if (id === 'settings_refresh') return this._sendSettingsMenu(interaction, true);

    if (id === 'settings_toggle_intro') {
      this.settings.introEnabled = !this.settings.introEnabled;
      this.client.voiceManager.getTTSService().audioCache.clear();
      return this._sendSettingsMenu(interaction, true);
    }

    if (id === 'settings_cycle_intro_speed') {
      const speeds  = ['normal', 'slower', 'slow', 'slowest'];
      const current = this.settings.introSpeed ?? 'normal';
      const next    = speeds[(speeds.indexOf(current) + 1) % speeds.length];
      this.settings.introSpeed = next;
      this.client.voiceManager.getTTSService().audioCache.clear();
      return this._sendSettingsMenu(interaction, true);
    }

    if (id === 'settings_toggle_direction') {
      this.settings.countDirection = this.settings.countDirection === 'down' ? 'up' : 'down';
      this.client.voiceManager.getTTSService().audioCache.clear();
      return this._sendSettingsMenu(interaction, true);
    }

    if (id === 'settings_clear_cache') {
      const n = this.client.voiceManager.getTTSService().clearCountdownCache();
      await interaction.reply({ content: `🗑️ Cleared **${n}** cached countdown file(s).`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (id === 'settings_clear_all_cache') {
      const n = this.client.voiceManager.getTTSService().clearAllCache();
      await interaction.reply({ content: `🗑️ Cleared **${n}** cached file(s) (library + countdowns).`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (id === 'settings_tts_select') {
      const provider = interaction.values[0];
      if (!BotSettings.supportedProviders().includes(provider)) {
        return interaction.reply({ content: '❌ Invalid provider.', flags: MessageFlags.Ephemeral });
      }
      this.settings.ttsProvider = provider;
      this.client.voiceManager.getTTSService().resetLibrary();
      return this._sendSettingsMenu(interaction, true);
    }

    // Unknown component — reply so Discord doesn't mark the interaction as failed
    await interaction.reply({ content: '❓ This button is no longer active.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Player commands
  // ═══════════════════════════════════════════════════════════════════════════

  async _handleRegister(interaction) {
    const name    = interaction.options.getString('playername');
    const seconds = interaction.options.getInteger('seconds');
    const group   = interaction.options.getInteger('group') ?? 1;

    // Warn if overwriting an existing player
    const exists = this.client.playerManager.hasPlayer(name);
    const player = this.client.playerManager.registerPlayer(name, seconds, group);

    const embed = new EmbedBuilder()
      .setTitle(exists ? '🔄 Player Updated!' : '✅ Player Registered!')
      .setColor(exists ? '#FF9800' : '#4CAF50')
      .setDescription(
        exists
          ? `**${name}** already existed — updated to **${seconds}s** in **Attack Group ${group}**.`
          : `**${name}** registered with **${seconds}s** travel time in **Attack Group ${group}**.`,
      )
      .addFields(
        { name: 'Total Players', value: String(this.client.playerManager.getPlayerCount()), inline: true },
        { name: 'Attack Group',  value: `Group ${group}`, inline: true },
        { name: 'Registered At', value: new Date(player.registeredAt).toLocaleString(), inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  async _handleUpdate(interaction) {
    const name    = interaction.options.getString('playername');
    const seconds = interaction.options.getInteger('seconds');
    const group   = interaction.options.getInteger('group');
    const player  = this.client.playerManager.updatePlayer(name, seconds, group);

    let desc = `**${name}** updated to **${seconds}s**.`;
    if (group !== null) desc += ` Moved to **Attack Group ${group}**.`;

    const embed = new EmbedBuilder()
      .setTitle('🔄 Player Updated!')
      .setColor('#FF9800')
      .setDescription(desc)
      .addFields({ name: 'Updated At', value: new Date(player.updatedAt).toLocaleString(), inline: true })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  async _handleRemove(interaction) {
    const name = interaction.options.getString('playername');
    this.client.playerManager.removePlayer(name);

    const embed = new EmbedBuilder()
      .setTitle('🗑️ Player Removed!')
      .setColor('#F44336')
      .setDescription(`**${name}** removed.`)
      .addFields({ name: 'Remaining Players', value: String(this.client.playerManager.getPlayerCount()), inline: true })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  async _handleClear(interaction) {
    const count = this.client.playerManager.clearAllPlayers();
    const embed = new EmbedBuilder()
      .setTitle('🧹 All Players Cleared!')
      .setColor('#9C27B0')
      .setDescription(`**${count} player(s)** removed.`)
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  async _handleClearGroup(interaction) {
    const group   = interaction.options.getInteger('group');
    const players = this.client.playerManager.getPlayersByGroup(group);

    if (players.length === 0) {
      return interaction.reply({ content: `❌ No players in Attack Group ${group}.`, flags: MessageFlags.Ephemeral });
    }

    players.forEach(p => this.client.playerManager.removePlayer(p.name));

    const embed = new EmbedBuilder()
      .setTitle('🧹 Attack Group Cleared!')
      .setColor('#9C27B0')
      .setDescription(`**${players.length} player(s)** removed from **Attack Group ${group}**.`)
      .addFields({ name: 'Removed', value: players.map(p => p.name).join(', ') })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  async _handleList(interaction) {
    const players = this.client.playerManager.getAllPlayers();
    const groups  = this.client.playerManager.getAttackGroups();

    if (players.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📋 Player List')
        .setColor('#607D8B')
        .setDescription('No players registered yet.')
        .setTimestamp();
      return interaction.reply({ embeds: [embed] });
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Registered Players')
      .setColor('#2196F3')
      .setDescription(`**${players.length} player(s)** | Groups: **${groups.join(', ')}**`)
      .addFields(players.map(p => ({
        name:   `${p.name} (Group ${p.attackGroup})`,
        value:  `⏱️ **${p.timeToDestination}s** | Registered: ${new Date(p.registeredAt).toLocaleString()}`,
        inline: true,
      })))
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Voice commands
  // ═══════════════════════════════════════════════════════════════════════════

  async _handleJoin(interaction) {
    // Defer immediately — joinVoiceChannel can take several seconds and
    // Discord will invalidate the interaction token after 3 s if unreplied.
    await interaction.deferReply();
    try {
      await this.client.voiceManager.joinVoiceChannel(interaction);
    } catch (err) {
      await interaction.editReply({ content: `❌ ${err.message}` });
      return;
    }
    const embed = new EmbedBuilder()
      .setTitle('🎤 Voice Channel Joined!')
      .setColor('#4CAF50')
      .setDescription('Ready for synchronized attacks!')
      .setTimestamp();
    await interaction.editReply({ embeds: [embed] });
  }

  async _handleLeave(interaction) {
    this.client.voiceManager.leaveVoiceChannel(interaction.guildId);
    const embed = new EmbedBuilder()
      .setTitle('👋 Voice Channel Left!')
      .setColor('#F44336')
      .setDescription('Bot has disconnected.')
      .setTimestamp();
    await interaction.reply({ embeds: [embed] });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Attack commands
  // ═══════════════════════════════════════════════════════════════════════════

  async _handleLaunch(interaction) {
    const group = interaction.options.getInteger('group');

    if (!this.client.voiceManager.isInVoiceChannel(interaction.guildId)) {
      return interaction.reply({ content: '❌ Join a voice channel first (`/join`).', flags: MessageFlags.Ephemeral });
    }
    if (this.client.playerManager.getPlayerCount() === 0) {
      return interaction.reply({ content: '❌ No players registered (`/register`).', flags: MessageFlags.Ephemeral });
    }

    const timing = this.client.playerManager.calculateAttackTiming(group);
    await this.client.voiceManager.startAttackCountdown(interaction, timing);
  }

  async _handlePreview(interaction) {
    const group = interaction.options.getInteger('group');

    if (this.client.playerManager.getPlayerCount() === 0) {
      return interaction.reply({ content: '❌ No players registered (`/register`).', flags: MessageFlags.Ephemeral });
    }

    const { players, totalDuration, attackGroup } = this.client.playerManager.calculateAttackTiming(group);
    const groupText = attackGroup ? `Attack Group ${attackGroup}` : 'All Groups';
    const dir       = this.settings.countDirection;
    const intro     = this.settings.introEnabled;

    const embed = new EmbedBuilder()
      .setTitle('👁️ Attack Sequence Preview')
      .setColor('#9C27B0')
      .setDescription(
        `**${groupText}** | **${totalDuration}s** | **${players.length} players**\n` +
        `Direction: **${dir === 'up' ? 'Count Up ↑' : 'Count Down ↓'}** | ` +
        `Intro: **${intro ? 'Enabled' : 'Disabled'}**\n\n*Preview only — no countdown started.*`,
      )
      .addFields(
        ...players.map(p => ({
          name:   `Player ${p.attackOrder}: ${p.name} (Group ${p.attackGroup})`,
          value:  `Starts in: **${p.attackStartTime}s** | Arrives in: **${p.timeToDestination}s**`,
          inline: false,
        })),
        { name: '🎤 Voice', value: this.client.voiceManager.isInVoiceChannel(interaction.guildId) ? '✅ Connected' : '❌ Not Connected', inline: true },
        { name: '🚀 Ready', value: this.client.voiceManager.isInVoiceChannel(interaction.guildId) ? '✅ Yes' : '❌ Use /join', inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  async _handleStop(interaction) {
    if (!this.client.voiceManager.isCountdownActive(interaction.guildId)) {
      return interaction.reply({ content: '❌ No active countdown.', flags: MessageFlags.Ephemeral });
    }
    await this.client.voiceManager.stopAttackCountdown(interaction.guildId);

    const embed = new EmbedBuilder()
      .setTitle('⏹️ Countdown Stopped!')
      .setColor('#F44336')
      .setDescription('The synchronized attack countdown has been cancelled.')
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  async _handleStatus(interaction) {
    const players     = this.client.playerManager.getPlayerCount();
    const groups      = this.client.playerManager.getAttackGroups();
    const inVoice     = this.client.voiceManager.isInVoiceChannel(interaction.guildId);
    const countdownOn = this.client.voiceManager.isCountdownActive(interaction.guildId);
    const cacheStats  = this.client.voiceManager.getTTSService().getCacheStats();
    const provider    = this.settings.ttsProvider;
    const dir         = this.settings.countDirection;
    const intro       = this.settings.introEnabled;

    const embed = new EmbedBuilder()
      .setTitle('📊 Bot Status')
      .setColor('#2196F3')
      .addFields(
        { name: '🎮 Players',     value: String(players),    inline: true },
        { name: '⚔️ Groups',     value: groups.length ? groups.join(', ') : 'None', inline: true },
        { name: '🎤 Voice',       value: inVoice     ? '✅ Connected' : '❌ Not Connected', inline: true },
        { name: '⏱️ Countdown',  value: countdownOn ? '🔄 Running'   : '⏹️ Idle',         inline: true },
        { name: '🔊 TTS',         value: BotSettings.providerLabel(provider),               inline: true },
        { name: '🔢 Direction',   value: dir === 'up' ? 'Count Up ↑' : 'Count Down ↓',     inline: true },
        { name: '📢 Intro',       value: intro ? '✅ Enabled' : '❌ Disabled',              inline: true },
        { name: '🐢 Intro Speed', value: { normal: 'Normal', slower: 'Slower', slow: 'Slow', slowest: 'Slowest' }[this.settings.get('introSpeed') ?? 'normal'], inline: true },
        { name: '💾 Cache',       value: `${cacheStats.libraryFiles} lib / ${cacheStats.countdownFiles} countdowns`, inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Settings menu
  // ═══════════════════════════════════════════════════════════════════════════

  async _handleSettings(interaction) {
    await this._sendSettingsMenu(interaction, false);
  }

  async _sendSettingsMenu(interaction, isUpdate) {
    const provider    = this.settings.ttsProvider;
    const dir         = this.settings.countDirection;
    const intro       = this.settings.introEnabled;
    const stats       = this.client.voiceManager.getTTSService().getCacheStats();
    const customFiles = this.customAudio.listFiles();

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Bot Settings')
      .setColor('#5865F2')
      .setDescription('Use the controls below to configure the bot. Changes take effect immediately.')
      .addFields(
        {
          name:   '🔊 Voice Generator (TTS Provider)',
          value:  `**Current:** \`${BotSettings.providerLabel(provider)}\`\n` +
                  `Use the dropdown to switch. Library will regenerate automatically.`,
          inline: false,
        },
        {
          name:   '🔢 Count Direction',
          value:  `**Current:** ${dir === 'up' ? '**Count Up ↑** (1 → max)' : '**Count Down ↓** (max → 1)'}`,
          inline: true,
        },
        {
          name:   '📢 Rally Intro',
          value:  `**Current:** ${intro ? '✅ Enabled' : '❌ Disabled'}`,
          inline: true,
        },
        {
          name:   '🐢 Intro Speed',
          value:  `**Current:** ${{ normal: '🐇 Normal', slower: '🐢 Slower', slow: '🐌 Slow', slowest: '🦥 Slowest' }[this.settings.introSpeed ?? 'normal']}`,
          inline: true,
        },
        {
          name:   '💾 Audio Cache',
          value:  `Library: **${stats.libraryFiles}** files\nCountdowns: **${stats.countdownFiles}** files`,
          inline: true,
        },
        {
          name:   '🎵 Custom Audio Files',
          value:  customFiles.length
            ? `**${customFiles.length}** file(s) uploaded.\nUse \`/audio list\` for details.`
            : 'No custom audio. Use `/audio upload` to add files.',
          inline: false,
        },
        {
          name:   '📖 How to use Custom Audio',
          value:  'Name files `<number>.wav` (e.g. `5.wav`) to replace TTS for that number.\n' +
                  'Use `intro.wav` and `complete.wav` for the opening/closing phrases.',
          inline: false,
        },
      )
      .setFooter({ text: 'Changes are saved automatically to config/settings.json' })
      .setTimestamp();

    // TTS provider select menu
    const providerSelect = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('settings_tts_select')
        .setPlaceholder('Change voice generator…')
        .addOptions(BotSettings.supportedProviders().map(p => ({
          label:       BotSettings.providerLabel(p),
          value:       p,
          description: p === 'local' ? 'Auto-detects fastest and best available' :
                       p === 'piper' ? 'Best quality but slow on first generation' : undefined,
          default:     p === provider,
        }))),
    );

    // Button row 1
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_toggle_intro')
        .setLabel(intro ? '📢 Disable Intro' : '📢 Enable Intro')
        .setStyle(intro ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('settings_toggle_direction')
        .setLabel(dir === 'down' ? '🔢 Switch to Count Up' : '🔢 Switch to Count Down')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('settings_cycle_intro_speed')
        .setLabel(`🐢 Intro Speed: ${{ normal: 'Normal', slower: 'Slower', slow: 'Slow', slowest: 'Slowest' }[this.settings.introSpeed ?? 'normal']}`)
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('settings_refresh')
        .setLabel('🔄 Refresh')
        .setStyle(ButtonStyle.Secondary),
    );

    // Button row 2 — cache controls
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('settings_clear_cache')
        .setLabel('🗑️ Clear Countdown Cache')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('settings_clear_all_cache')
        .setLabel('🗑️ Clear ALL Cache (incl. library)')
        .setStyle(ButtonStyle.Danger),
    );

    const payload = {
      embeds:     [embed],
      components: [providerSelect, row1, row2],
      flags:      MessageFlags.Ephemeral,
    };

    if (isUpdate) {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => interaction.followUp({ ...payload }));
      } else {
        await interaction.update(payload).catch(() => interaction.reply(payload));
      }
    } else {
      await interaction.reply(payload);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Bot update command
  // ═══════════════════════════════════════════════════════════════════════════

  async _handleBotUpdate(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const check = await this.updateManager.checkForUpdate();

    if (check.error) {
      return interaction.editReply(`❌ Could not reach GitHub: ${check.error}`);
    }

    if (!check.updateAvailable) {
      return interaction.editReply(
        `✅ Bot is up to date!\n**Version:** \`${check.current}\``,
      );
    }

    // Update available — show embed with confirm button
    const embed = new EmbedBuilder()
      .setTitle('🆕 Update Available!')
      .setColor('#FF9800')
      .addFields(
        { name: 'Current Version', value: `\`${check.current}\``, inline: true },
        { name: 'Latest Version',  value: `\`${check.latest}\``,  inline: true },
        { name: 'Release Notes',   value: check.body ? check.body.slice(0, 800) : 'No notes.', inline: false },
      )
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('botupdate_confirm')
        .setLabel('⬇️ Update Now')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setLabel('📄 View Release')
        .setStyle(ButtonStyle.Link)
        .setURL(check.releaseUrl),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    // Wait for the confirm button click (60 s window)
    let btn;
    try {
      const msg = await interaction.fetchReply();
      btn = await msg.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id && i.customId === 'botupdate_confirm',
        time:   60_000,
      });
    } catch {
      // Timed out — remove buttons so they can't be clicked later
      return interaction.editReply({
        content:    '⏱️ Update cancelled (timed out).',
        embeds:     [],
        components: [],
      });
    }

    // Acknowledge the button with deferUpdate so Discord doesn't show
    // "interaction failed". We keep using the original interaction token
    // for all further status edits — btn.update() would shift the token
    // to btn and make interaction.editReply() fail silently.
    await btn.deferUpdate();
    await interaction.editReply({
      content:    '⏳ Downloading and applying update…',
      embeds:     [],
      components: [],
    });

    const result = await this.updateManager.performUpdate();

    await interaction.editReply({
      content: result.success
        ? `✅ **Update complete!** Restart the bot to apply.\n\`\`\`\n${result.output.slice(0, 1500)}\n\`\`\``
        : `❌ **Update failed:**\n\`\`\`\n${result.output.slice(0, 1500)}\n\`\`\``,
      embeds:     [],
      components: [],
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Custom audio commands
  // ═══════════════════════════════════════════════════════════════════════════

  async _handleAudio(interaction) {
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'list':     return this._audioList(interaction);
      case 'upload':   return this._audioUpload(interaction);
      case 'delete':   return this._audioDelete(interaction);
      case 'clear':    return this._audioClear(interaction);
      case 'coverage': return this._audioCoverage(interaction);
      default:
        return interaction.reply({ content: '❓ Unknown audio subcommand.', flags: MessageFlags.Ephemeral });
    }
  }

  async _audioList(interaction) {
    const files = this.customAudio.listFiles();
    if (files.length === 0) {
      return interaction.reply({
        content: '📂 No custom audio files uploaded yet.\nUse `/audio upload` to add files.',
        flags:   MessageFlags.Ephemeral,
      });
    }
    const lines = files.map(f =>
      `• \`${f.filename}\` — ${f.sizeKb} KB${f.number !== null ? ` (number ${f.number})` : ''}`,
    );
    const embed = new EmbedBuilder()
      .setTitle(`🎵 Custom Audio Files (${files.length})`)
      .setColor('#00BCD4')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Files are stored in config/custom_audio/' })
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  async _audioUpload(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const attachment = interaction.options.getAttachment('file');
    if (!attachment) return interaction.editReply('❌ No file attached.');

    const sizeLimit = 5 * 1024 * 1024;
    if (attachment.size > sizeLimit) {
      return interaction.editReply(`❌ File too large (${Math.round(attachment.size / 1024)} KB). Max 5 MB.`);
    }

    const buffer = await this._downloadBuffer(attachment.url);
    const result = await this.customAudio.saveFile(attachment.name, buffer);

    if (!result.success) {
      return interaction.editReply(`❌ ${result.error}`);
    }

    this.client.voiceManager.getTTSService().resetLibrary();

    await interaction.editReply(
      `✅ Uploaded \`${result.filename}\` successfully!\n` +
      `The number library will regenerate on next launch to include your file.`,
    );
  }

  async _audioDelete(interaction) {
    const filename = interaction.options.getString('filename');
    const result   = this.customAudio.deleteFile(filename);

    if (!result.success) {
      return interaction.reply({ content: `❌ ${result.error}`, flags: MessageFlags.Ephemeral });
    }

    this.client.voiceManager.getTTSService().resetLibrary();
    await interaction.reply({ content: `🗑️ Deleted \`${filename}\`.`, flags: MessageFlags.Ephemeral });
  }

  async _audioClear(interaction) {
    const count = this.customAudio.clearAll();
    this.client.voiceManager.getTTSService().resetLibrary();
    await interaction.reply({
      content: `🗑️ Deleted **${count}** custom audio file(s).`,
      flags:   MessageFlags.Ephemeral,
    });
  }

  async _audioCoverage(interaction) {
    const { covered, missing } = this.customAudio.getNumberCoverage(1, 60);
    const embed = new EmbedBuilder()
      .setTitle('📊 Custom Audio Coverage (1–60)')
      .setColor('#4CAF50')
      .addFields(
        { name: `✅ Covered (${covered.length})`, value: covered.length ? covered.join(', ') : 'None',               inline: false },
        { name: `❌ Missing (${missing.length})`,  value: missing.length  ? missing.join(', ')  : 'None — all covered!', inline: false },
      )
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ── Helper: download attachment buffer ──────────────────────────────────────

  _downloadBuffer(url) {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        const chunks = [];
        res.on('data',  c  => chunks.push(c));
        res.on('end',   () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.setTimeout(30_000, () => {
        req.destroy();
        reject(new Error('Attachment download timed out'));
      });
      req.on('error', reject);
    });
  }
}

module.exports = { CommandHandler };
