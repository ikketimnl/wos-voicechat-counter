const { createAudioResource } = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const say = require('say');
const { exec, execFile } = require('child_process');

class TTSService {

  constructor() {
    this.provider = 'console'; // Default to console logging
    this.audioCache = new Map(); // key -> filePath
    this.numberLibrary = new Map(); // number -> filePath
    this.libraryInitialized = false;
    this.platform = process.platform;
  }

  // Set the TTS provider
  setProvider(provider) {
    this.provider = provider;
  }

  // Detect the first available Windows SAPI voice
  async getWindowsVoice() {
    return new Promise((resolve) => {
      const cmd = `powershell.exe -Command "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } | Select-Object -First 1"`;
      exec(cmd, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null); // No voice found, will use default
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  // Cross-platform TTS generation with fallbacks
  async generateCrossPlatformTTS(text, outputFile) {
    try {
      // Try the say package first with null voice (uses system default)
      return new Promise((resolve, reject) => {
        say.export(text, null, 1.0, outputFile, (error) => {
          if (error) {
            console.warn(`Say package failed: ${error.message}, trying platform-specific fallback...`);
            // Fall back to platform-specific commands
            this.generatePlatformSpecificTTS(text, outputFile)
              .then(resolve)
              .catch(reject);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      // If say package fails completely, use platform-specific fallback
      return this.generatePlatformSpecificTTS(text, outputFile);
    }
  }

  // Platform-specific TTS fallback
  async generatePlatformSpecificTTS(text, outputFile) {
    const platform = this.platform;

    try {
      if (platform === 'win32') {
        // Windows: detect first available voice dynamically
        const voice = await this.getWindowsVoice();
        const selectVoice = voice
          ? `$synthesizer.SelectVoice('${voice}');`
          : ''; // Skip SelectVoice if none found — uses system default
        const command = `powershell.exe -Command "Add-Type -AssemblyName System.Speech; $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${selectVoice} $synthesizer.SetOutputToWaveFile('${outputFile}'); $synthesizer.Speak('${text.replace(/'/g, "''")}'); $synthesizer.Dispose()"`;
        await new Promise((resolve, reject) => {
          exec(command, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });

      } else if (platform === 'darwin') {
        // macOS: Use say command with Samantha (valid here)
        const command = `say -o "${outputFile}" -v "Samantha" -r 170 "${text}"`;
        await new Promise((resolve, reject) => {
          exec(command, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });

      } else {
        // Linux: Try espeak, then festival
        try {
          const command = `espeak -w "${outputFile}" "${text}"`;
          await new Promise((resolve, reject) => {
            exec(command, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        } catch (espeakError) {
          const command = `echo "${text}" | festival --tts --output "${outputFile}"`;
          await new Promise((resolve, reject) => {
            exec(command, (error) => {
              if (error) reject(error);
              else resolve();
            });
          });
        }
      }

    } catch (error) {
      throw new Error(`Platform-specific TTS failed for ${platform}: ${error.message}`);
    }
  }

  // Initialize the number library (pre-generate numbers 1-200)
  async initializeNumberLibrary() {
    if (this.libraryInitialized) return;

    try {
      const { execFile } = require('child_process');
      const ffmpegPath = require('ffmpeg-static');

      // Ensure library directory exists
      const libraryDir = path.join(__dirname, '../temp/library');
      if (!fs.existsSync(libraryDir)) {
        fs.mkdirSync(libraryDir, { recursive: true });
      }

      const run = (cmd) => new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve({ stdout, stderr });
        });
      });

      const runFfmpeg = (args) => new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve({ stdout, stderr });
        });
      });

      console.log('🔊 Initializing number library (1-200)...');

      // Generate numbers 1-200
      for (let i = 1; i <= 200; i++) {
        const numberFile = path.join(libraryDir, `${i}.wav`);

        // Skip if already exists
        if (fs.existsSync(numberFile)) {
          this.numberLibrary.set(i, numberFile);
          continue;
        }

        // Generate the number using cross-platform TTS with fallbacks
        const rawFile = path.join(libraryDir, `raw_${i}.wav`);
        await this.generateCrossPlatformTTS(`${i}.`, rawFile);

        // Pad/truncate to exactly 1.000s with better quality settings
        await runFfmpeg(['-y', '-i', rawFile, '-af', 'apad=pad_dur=1,atrim=0:1', '-ar', '48000', '-ac', '2', '-sample_fmt', 's16', numberFile]);

        // Clean up raw file
        try { fs.unlinkSync(rawFile); } catch (_) {}

        this.numberLibrary.set(i, numberFile);
      }

      this.libraryInitialized = true;
      console.log('✅ Number library initialized!');

    } catch (error) {
      console.error('❌ Failed to initialize number library:', error);
      throw error;
    }
  }

  // Generate speech from text
  async generateSpeech(text, options = {}) {
    switch (this.provider) {
      case 'console':
        return this.consoleTTS(text);
      case 'local':
        return this.localTTS(text, options);
      case 'google':
        return this.googleTTS(text, options);
      case 'azure':
        return this.azureTTS(text, options);
      case 'polly':
        return this.amazonPollyTTS(text, options);
      default:
        return this.consoleTTS(text);
    }
  }

  // Console TTS (default - just logs to console)
  async consoleTTS(text) {
    console.log(`🔊 TTS: ${text}`);
    return null; // No audio resource
  }

  // Build a stable cache key for a given players/timing configuration
  buildCountdownCacheKey(players) {
    const normalized = [...players]
      .map(p => ({ name: String(p.name), t: Number(p.attackStartTime) }))
      .sort((a, b) => (a.t - b.t) || a.name.localeCompare(b.name));

    const payload = {
      v: 'sync-v6', // bumped version after voice fix
      rate: 170,
      platform: this.platform,
      players: normalized,
    };

    return crypto
      .createHash('sha1')
      .update(JSON.stringify(payload))
      .digest('hex');
  }

  // Generate a complete synchronized countdown sequence with precise 1-second ticks
  async generateSynchronizedCountdown(players, totalDuration) {
    try {
      // Initialize number library if needed
      await this.initializeNumberLibrary();

      // Check cache first
      const cacheKey = this.buildCountdownCacheKey(players);
      const cachedPath = this.audioCache.get(cacheKey);
      if (cachedPath && fs.existsSync(cachedPath)) {
        return createAudioResource(cachedPath);
      }

      const { execFile } = require('child_process');
      const ffmpegPath = require('ffmpeg-static');

      // Ensure temp dir
      const tempDir = path.join(__dirname, '../temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const runFfmpeg = (args) => new Promise((resolve, reject) => {
        execFile(ffmpegPath, args, (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr || err.message));
          resolve({ stdout, stderr });
        });
      });

      // Build simplified intro script
      const firstPlayer = players.find(p => p.attackStartTime === 0) || players[0];
      const maxTime = Math.max(...players.map(p => p.attackStartTime));

      let introScript = '';
      introScript += `Synchronized attack sequence. ${firstPlayer.name} starts first. `;
      players.forEach((p) => {
        if (p.attackStartTime === 0) introScript += `${p.name} starts immediately. `;
        else introScript += `${p.name} starts at second ${p.attackStartTime}. `;
      });
      introScript += `${firstPlayer.name} ready. Three. Two. One. Go. `;

      const ts = Date.now();
      const introRaw = path.join(tempDir, `intro_raw_${ts}.wav`);
      const introFile = path.join(tempDir, `intro_${ts}.wav`);

      await this.generateCrossPlatformTTS(introScript, introRaw);
      await runFfmpeg(['-y', '-i', introRaw, '-ar', '48000', '-ac', '2', '-sample_fmt', 's16', introFile]);
      try { fs.unlinkSync(introRaw); } catch (_) {}

      // Use pre-generated number library
      const numberFiles = [];
      for (let i = 1; i <= maxTime; i++) {
        const numberFile = this.numberLibrary.get(i);
        if (numberFile && fs.existsSync(numberFile)) {
          numberFiles.push(numberFile);
        } else {
          console.warn(`Number ${i} not found in library, generating...`);
          const raw = path.join(tempDir, `raw_${i}_${ts}.wav`);
          const seg = path.join(tempDir, `seg_${i}_${ts}.wav`);
          await this.generateCrossPlatformTTS(`${i}.`, raw);
          await runFfmpeg(['-y', '-i', raw, '-af', 'apad=pad_dur=1,atrim=0:1', '-ar', '48000', '-ac', '2', '-sample_fmt', 's16', seg]);
          numberFiles.push(seg);
          try { fs.unlinkSync(raw); } catch (_) {}
        }
      }

      const finalRaw = path.join(tempDir, `final_raw_${ts}.wav`);
      const finalWav = path.join(tempDir, `final_${ts}.wav`);
      await this.generateCrossPlatformTTS("Sequence complete.", finalRaw);
      await runFfmpeg(['-y', '-i', finalRaw, '-ar', '48000', '-ac', '2', '-sample_fmt', 's16', finalWav]);
      try { fs.unlinkSync(finalRaw); } catch (_) {}

      const listFile = path.join(tempDir, `list_${ts}.txt`);
      const outputFile = path.join(tempDir, `sync_countdown_${cacheKey}.wav`);
      const concatFiles = [introFile, ...numberFiles, finalWav];
      fs.writeFileSync(listFile, concatFiles.map(f => `file '${f.replace(/'/g, "\\'")}'`).join('\n'));

      await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', outputFile]);

      try { fs.unlinkSync(introFile); } catch (_) {}
      try { fs.unlinkSync(finalWav); } catch (_) {}
      try { fs.unlinkSync(listFile); } catch (_) {}

      for (const f of numberFiles) {
        if (f.includes(`seg_${ts}`)) {
          try { fs.unlinkSync(f); } catch (_) {}
        }
      }

      this.audioCache.set(cacheKey, outputFile);
      return createAudioResource(outputFile);

    } catch (error) {
      console.error('Synchronized countdown error:', error);
      throw error;
    }
  }

  // Local TTS using cross-platform TTS with fallbacks
  async localTTS(text, options = {}) {
    try {
      const tempDir = path.join(__dirname, '../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const outputFile = path.join(tempDir, `tts_${Date.now()}.wav`);
      await this.generateCrossPlatformTTS(text, outputFile);

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          if (fs.existsSync(outputFile)) {
            const audioResource = createAudioResource(outputFile);
            resolve(audioResource);
            setTimeout(() => {
              try { fs.unlinkSync(outputFile); } catch (cleanupError) {
                console.log('Cleanup error (non-critical):', cleanupError.message);
              }
            }, 10000);
          } else {
            reject(new Error('Audio file was not created'));
          }
        }, 500);
      });

    } catch (error) {
      console.error('Local TTS error:', error);
      return this.consoleTTS(text);
    }
  }

  // Google Cloud Text-to-Speech (placeholder)
  async googleTTS(text, options = {}) {
    try {
      console.log(`🔊 Google TTS: ${text}`);
      return null;
    } catch (error) {
      console.error('Google TTS error:', error);
      return this.consoleTTS(text);
    }
  }

  // Microsoft Azure Speech Services (placeholder)
  async azureTTS(text, options = {}) {
    try {
      console.log(`🔊 Azure TTS: ${text}`);
      return null;
    } catch (error) {
      console.error('Azure TTS error:', error);
      return this.consoleTTS(text);
    }
  }

  // Amazon Polly TTS (placeholder)
  async amazonPollyTTS(text, options = {}) {
    try {
      console.log(`🔊 Amazon Polly TTS: ${text}`);
      return null;
    } catch (error) {
      console.error('Amazon Polly TTS error:', error);
      return this.consoleTTS(text);
    }
  }

  // Get available TTS providers
  getAvailableProviders() {
    return ['console', 'local', 'google', 'azure', 'polly'];
  }

  isProviderAvailable(provider) {
    return this.getAvailableProviders().includes(provider);
  }

  getCurrentProvider() {
    return this.provider;
  }
}

module.exports = { TTSService };
