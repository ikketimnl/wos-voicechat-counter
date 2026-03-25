#!/usr/bin/env node
'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

console.log('');
console.log('🚀 WoS VoiceChat Counter — Setup Wizard');
console.log('==========================================\n');

async function setup() {
  try {
    const configDir  = path.join(process.cwd(), 'config');
    const configPath = path.join(configDir, 'config.json');
    // Legacy: also check root config.json
    const legacyPath = path.join(process.cwd(), 'config.json');

    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    fs.mkdirSync(path.join(configDir, 'custom_audio'), { recursive: true });

    const existingPath = fs.existsSync(configPath) ? configPath : (fs.existsSync(legacyPath) ? legacyPath : null);
    if (existingPath) {
      const overwrite = await ask('config.json already exists. Overwrite? (y/N): ');
      if (overwrite.toLowerCase() !== 'y') {
        console.log('Setup cancelled.');
        rl.close(); return;
      }
    }

    console.log('\n📋 Discord Bot Configuration');
    console.log('─────────────────────────────');
    const token    = await ask('Discord Bot Token : ');
    const clientId = await ask('Discord Client ID  : ');
    const guildId  = await ask('Discord Server ID  : ');

    const config = { token, clientId, guildId };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    // Keep a root-level copy for backward compat with CommandHandler
    fs.writeFileSync(legacyPath, JSON.stringify(config, null, 2));
    console.log('\n✅ config.json saved!');

    console.log('\n🔊 TTS Provider');
    console.log('─────────────────');
    console.log('  1. local    — Auto-detect (SAPI/say/espeak) [recommended]');
    console.log('  2. espeak   — eSpeak NG (fast, robotic)');
    console.log('  3. festival — Festival TTS (deeper voice)');
    console.log('  4. piper    — Piper neural TTS (natural, requires installation)');
    console.log('  5. console  — No audio, log-only (testing)');
    const ttsChoice = await ask('\nChoose provider (1–5, default 1): ');
    const providers = { '1': 'local', '2': 'espeak', '3': 'festival', '4': 'piper', '5': 'console' };
    const ttsProvider = providers[ttsChoice] ?? 'local';

    console.log('\n🔢 Count Direction');
    console.log('───────────────────');
    console.log('  1. down  — Countdown (max → 1) [default]');
    console.log('  2. up    — Count up (1 → max)');
    const dirChoice = await ask('Choose direction (1–2, default 1): ');
    const countDirection = dirChoice === '2' ? 'up' : 'down';

    console.log('\n📢 Rally Intro');
    console.log('───────────────');
    const introChoice = await ask('Enable the rally intro announcement? (Y/n): ');
    const introEnabled = introChoice.toLowerCase() !== 'n';

    // Write settings.json
    const settingsPath = path.join(configDir, 'settings.json');
    const settings = { ttsProvider, countDirection, introEnabled, voiceRate: 170, version: null };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log('\n✅ settings.json saved!');

    // .env file
    const envContent = [
      '# Discord Bot Configuration',
      `DISCORD_TOKEN=${token}`,
      `DISCORD_CLIENT_ID=${clientId}`,
      `DISCORD_GUILD_ID=${guildId}`,
      '',
      '# TTS Service Configuration',
      `TTS_PROVIDER=${ttsProvider}`,
      '',
      '# Piper model path (only needed if TTS_PROVIDER=piper)',
      '# PIPER_MODEL=/opt/piper/voices/en_US-lessac-medium.onnx',
    ].join('\n');
    fs.writeFileSync(path.join(process.cwd(), '.env'), envContent);
    console.log('✅ .env saved!');

    // Dependencies
    const installDeps = await ask('\n📦 Install dependencies now? (Y/n): ');
    if (installDeps.toLowerCase() !== 'n') {
      console.log('Installing…');
      execSync('npm install', { stdio: 'inherit' });
      console.log('✅ Dependencies installed!');
    }

    console.log('\n🎉 Setup complete!');
    console.log('──────────────────');
    console.log('  npm start          — start the bot');
    console.log('  /join              — join your voice channel');
    console.log('  /register          — register players');
    console.log('  /launch            — start the countdown');
    console.log('  /settings          — visual settings menu (in Discord)');
    console.log('  /botupdate         — check for and apply updates');
    console.log('  /audio upload      — upload custom number audio files');

    if (ttsProvider === 'piper') {
      console.log('\n⚠️  Piper TTS requires extra installation steps.');
      console.log('   See DOCKER.md for sysadmin instructions.');
    }

  } catch (err) {
    console.error('\n❌ Setup failed:', err.message);
  } finally {
    rl.close();
  }
}

setup();
