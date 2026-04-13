'use strict';

const { createAudioResource } = require('@discordjs/voice');
const fs                      = require('fs');
const path                    = require('path');
const crypto                  = require('crypto');
const { execFile }            = require('child_process');

// ── Safe text helpers ─────────────────────────────────────────────────────────
// All TTS providers receive text as a process argument, never through a shell.
// These helpers strip or replace characters that specific engines mis-read.

/** Strip characters that cause Festival to mispronounce or error. */
function sanitiseForFestival(text) {
  return text
    .replace(/_/g, ' ')          // festival reads underscores aloud
    .replace(/['"\\]/g, ' ');    // strip quotes and backslashes
}

/** Strip characters that confuse espeak argument parsing (no shell involved). */
function sanitiseForEspeak(text) {
  return text.replace(/['"\\]/g, ' ');
}

/** Strip characters that confuse PowerShell SAPI (no shell involved). */
function sanitiseForSAPI(text) {
  return text.replace(/['"\\]/g, ' ');
}

// ── TTSService ─────────────────────────────────────────────────────────────────

class TTSService {
  constructor(settings, customAudio) {
    this.settings           = settings;
    this.customAudio        = customAudio;
    this.audioCache         = new Map();
    this.numberLibrary      = new Map();
    this.libraryInitialized = false;
    this._generationId      = 0;   // incremented by resetLibrary() to cancel in-flight builds
    this.platform           = process.platform;
    this.windowsVoice       = null;
    this._cleanTempDir();
  }

  get provider() { return this.settings.ttsProvider; }

  /** Delete a file, ignoring ENOENT. Logs other unexpected errors. */
  _safeUnlink(filePath) {
    try { fs.unlinkSync(filePath); }
    catch (err) { if (err.code !== 'ENOENT') console.warn(`[TTSService] Failed to delete ${filePath}: ${err.message}`); }
  }

  get tempDir() {
    const d = path.join(__dirname, '../../temp');
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }

  get libraryDir() {
    const d = path.join(this.tempDir, 'library');
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    return d;
  }

  _cleanTempDir() {
    try {
      const d = path.join(__dirname, '../../temp');
      if (!fs.existsSync(d)) return;
      for (const f of fs.readdirSync(d)) {
        if (/^(intro_|final_|sync_countdown_|seg_|raw_|list_|tts_|intro_norm_|complete_norm_)|_spd_raw\.wav$/.test(f)) {
          this._safeUnlink(path.join(d, f));
        }
      }
    } catch (err) {
      console.warn('[TTSService] _cleanTempDir error:', err.message);
    }
  }

  // ── Windows voice detection (no shell, pure PowerShell execFile) ───────────

  async _getWindowsVoice() {
    if (this.windowsVoice !== null) return this.windowsVoice;
    return new Promise((resolve) => {
      execFile('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -AssemblyName System.Speech; ' +
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
        '$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } | Select-Object -First 1',
      ], { timeout: 15_000 }, (err, stdout) => {
        this.windowsVoice = (!err && stdout.trim()) ? stdout.trim() : null;
        resolve(this.windowsVoice);
      });
    });
  }

  // ── TTS dispatch ───────────────────────────────────────────────────────────

  async _ttsToWav(text, outputFile) {
    const p = this.provider;
    if (p === 'espeak')   return this._espeakTTS(text, outputFile);
    if (p === 'festival') return this._festivalTTS(text, outputFile);
    if (p === 'piper')    return this._piperTTS(text, outputFile);
    return this._platformTTS(text, outputFile);
  }

  // ── Intro speed helpers ────────────────────────────────────────────────────

  _speedAtempo() {
    const speed = this.settings.introSpeed ?? 'normal';
    if (speed === 'slower')  return 0.80;
    if (speed === 'slow')    return 0.65;
    if (speed === 'slowest') return 0.40;
    return 1.0;
  }

  async _ttsToWavIntro(text, outputFile) {
    const atempo = this._speedAtempo();
    if (atempo === 1.0) return this._ttsToWav(text, outputFile);

    const rawPath = outputFile.replace(/\.wav$/, '_spd_raw.wav');
    await this._ttsToWav(text, rawPath);
    await this._runFfmpeg([
      '-y', '-i', rawPath,
      '-af', `atempo=${atempo}`,
      '-ar', '48000', '-ac', '2', '-sample_fmt', 's16',
      outputFile,
    ]);
    this._safeUnlink(rawPath);
  }

  // ── Platform TTS: execFile only, no shell ──────────────────────────────────

  async _platformTTS(text, outputFile) {
    if (this.platform === 'win32') {
      const voice     = await this._getWindowsVoice();
      const safeText  = sanitiseForSAPI(text);
      // Sanitise the voice name the same way as spoken text — a voice name
      // containing a quote or semicolon would break out of the PS string.
      const safeVoice = voice ? sanitiseForSAPI(voice) : null;

      // Output path and spoken text are passed via environment variables so
      // they never touch the PowerShell script string, eliminating all
      // remaining interpolation risk regardless of path characters.
      const script =
        'Add-Type -AssemblyName System.Speech; ' +
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
        (safeVoice ? `$s.SelectVoice('${safeVoice}'); ` : '') +
        '$s.SetOutputToWaveFile($env:TTS_OUT); ' +
        '$s.Speak($env:TTS_TEXT); ' +
        '$s.Dispose()';

      return new Promise((resolve, reject) => {
        execFile('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { timeout: 30_000, env: { ...process.env, TTS_OUT: outputFile, TTS_TEXT: safeText } },
          (err) => {
            if (err) return reject(new Error(`Windows TTS failed: ${err.message}`));
            if (!fs.existsSync(outputFile)) return reject(new Error('Windows TTS produced no file'));
            resolve();
          });
      });
    }

    if (this.platform === 'darwin') {
      // Validate voiceRate is a safe positive integer before use
      const rawRate = this.settings.get('voiceRate');
      const rate    = Number.isInteger(rawRate) && rawRate > 0 ? rawRate : 170;
      const safeText = sanitiseForEspeak(text); // strip shell-dangerous chars
      return new Promise((resolve, reject) => {
        execFile('say',
          ['-o', outputFile, '-v', 'Samantha', '-r', String(rate), safeText],
          { timeout: 30_000 },
          (err) => err ? reject(new Error(`macOS TTS failed: ${err.message}`)) : resolve());
      });
    }

    // Linux: try espeak-ng, espeak, then festival
    return this._espeakTTS(text, outputFile).catch(() => this._festivalTTS(text, outputFile));
  }

  /** eSpeak / eSpeak-NG — uses execFile, no shell */
  _espeakTTS(text, outputFile) {
    const safeText = sanitiseForEspeak(text);
    return new Promise((resolve, reject) => {
      // Try espeak-ng first; fall back to espeak if not found
      const tryEspeak = (bin) => new Promise((res, rej) => {
        execFile(bin, ['-w', outputFile, safeText], { timeout: 30_000 }, (err) => {
          if (err) return rej(err);
          if (!fs.existsSync(outputFile)) return rej(new Error(`${bin} produced no file`));
          res();
        });
      });
      tryEspeak('espeak-ng')
        .catch(() => tryEspeak('espeak'))
        .then(resolve)
        .catch(() => reject(new Error('eSpeak failed: neither espeak-ng nor espeak is available')));
    });
  }

  /** Festival text2wave — uses execFile + stdin pipe, no shell interpolation */
  _festivalTTS(text, outputFile) {
    const safeText = sanitiseForFestival(text);
    return new Promise((resolve, reject) => {
      const proc = execFile(
        'text2wave',
        ['-o', outputFile],
        { timeout: 30_000 },
        (err) => {
          if (err) return reject(new Error(`Festival failed: ${err.message}`));
          if (!fs.existsSync(outputFile)) return reject(new Error('Festival produced no file'));
          resolve();
        },
      );
      proc.stdin.write(safeText);
      proc.stdin.end();
    });
  }

  /** Piper neural TTS — uses execFile + stdin pipe, no shell interpolation */
  _piperTTS(text, outputFile) {
    const modelPath = this.settings.get('piperModel') || '/usr/local/bin/voices/en_US-lessac-medium.onnx';
    const safeText  = text.replace(/['"\\]/g, ' ');
    return new Promise((resolve, reject) => {
      const proc = execFile(
        'piper',
        ['--model', modelPath, '--sentence_silence', '0.5', '--output_file', outputFile],
        { timeout: 60_000 },
        (err) => {
          if (err) return reject(new Error(`Piper TTS failed: ${err.message}`));
          if (!fs.existsSync(outputFile)) return reject(new Error('Piper produced no output'));
          resolve();
        },
      );
      proc.stdin.write(safeText);
      proc.stdin.end();
    });
  }

  // ── FFmpeg helpers ─────────────────────────────────────────────────────────

  get _ffmpegPath() { return require('ffmpeg-static'); }

  _runFfmpeg(args) {
    return new Promise((resolve, reject) => {
      execFile(this._ffmpegPath, args, { maxBuffer: 10 * 1024 * 1024 }, (err, _out, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve();
      });
    });
  }

  async _normaliseWav(input, output) {
    await this._runFfmpeg(['-y', '-i', input, '-ar', '48000', '-ac', '2', '-sample_fmt', 's16', output]);
  }

  async _normaliseNumber(input, output) {
    await this._runFfmpeg(['-y', '-i', input, '-af', 'apad=pad_dur=1,atrim=0:1', '-ar', '48000', '-ac', '2', '-sample_fmt', 's16', output]);
  }

  // ── Library management ─────────────────────────────────────────────────────

  _libraryCacheKey() {
    return `.provider-${this.provider}-${this.platform}`;
  }

  async initializeNumberLibrary() {
    const genId      = this._generationId; // snapshot — if resetLibrary() is called mid-build we abort
    const markerFile = path.join(this.libraryDir, this._libraryCacheKey());
    const existingMarkers = fs.readdirSync(this.libraryDir).filter(f => f.startsWith('.provider-'));

    if (!existingMarkers.includes(path.basename(markerFile))) {
      console.log('🔄 TTS provider changed — clearing number library…');
      for (const f of fs.readdirSync(this.libraryDir)) {
        if (!f.startsWith('.provider-') || f !== path.basename(markerFile)) {
          try { fs.unlinkSync(path.join(this.libraryDir, f)); }
          catch (err) { if (err.code !== 'ENOENT') console.warn(`[TTSService] cleanup: ${err.message}`); }
        }
      }
      this.numberLibrary.clear();
      this.libraryInitialized = false;
    }

    if (this.libraryInitialized) return;

    if (this.provider === 'console') {
      this.libraryInitialized = true;
      return;
    }

    // Require at least 150 MB free before building a 200-number library (~50–100 MB)
    try {
      const { bfree, bsize } = fs.statfsSync(this.libraryDir);
      const freeBytes = bfree * bsize;
      const MIN_FREE  = 150 * 1024 * 1024;
      if (freeBytes < MIN_FREE) {
        throw new Error(`Insufficient disk space: ${Math.round(freeBytes / 1024 / 1024)} MB free, need at least 150 MB.`);
      }
    } catch (err) {
      if (err.message.startsWith('Insufficient')) throw err;
      // statfsSync not available (Node <18 or unsupported FS) — skip check
      console.warn('[TTSService] Could not check disk space (skipping):', err.message);
    }

    console.log('🔊 Initialising number library (1–200)…');

    const toGenerate = [];
    for (let i = 1; i <= 200; i++) {
      const customFile = this.customAudio.getNumberFile(i);
      if (customFile) { this.numberLibrary.set(i, customFile); continue; }
      const libFile = path.join(this.libraryDir, `${i}.wav`);
      if (fs.existsSync(libFile)) { this.numberLibrary.set(i, libFile); continue; }
      toGenerate.push(i);
    }

    if (toGenerate.length > 0) {
      const isSlow      = this.provider === 'piper' || this.provider === 'festival';
      const CONCURRENCY = isSlow ? 1 : 4;
      if (isSlow) {
        console.log('⚠️  Piper uses ~350 MB RAM per process. Building library sequentially to avoid OOM.');
        console.log(`⚠️  This will take ~${toGenerate.length * 2}–${toGenerate.length * 4}s. Library is cached after first build.`);
      }
      let completed = 0;

      for (let j = 0; j < toGenerate.length; j += CONCURRENCY) {
        const chunk = toGenerate.slice(j, j + CONCURRENCY);
        await Promise.all(chunk.map(async (i) => {
          const rawFile = path.join(this.libraryDir, `raw_${i}.wav`);
          const libFile = path.join(this.libraryDir, `${i}.wav`);
          try {
            await this._ttsToWav(`${i}`, rawFile);
            await this._normaliseNumber(rawFile, libFile);
            this._safeUnlink(rawFile);
            this.numberLibrary.set(i, libFile);
          } catch (err) {
            console.warn(`⚠️  Number ${i} failed: ${err.message}`);
            this._safeUnlink(rawFile);
          }
          completed++;
          if (completed % 40 === 0)
            console.log(`🔊 Library progress: ${completed}/${toGenerate.length}…`);
        }));
      }
    }

    // If resetLibrary() was called while we were building, discard this result.
    if (this._generationId !== genId) {
      console.log('[TTSService] Library build was superseded by a reset — discarding.');
      return;
    }
    try { fs.writeFileSync(markerFile, this.provider); }
    catch (err) { console.warn(`[TTSService] Could not write library marker: ${err.message}`); }
    this.libraryInitialized = true;
    console.log('✅ Number library ready!');
  }

  resetLibrary() {
    this._generationId++;          // invalidates any in-flight initializeNumberLibrary() call
    this.libraryInitialized = false;
    this.numberLibrary.clear();
    this.audioCache.clear();
  }

  // ── Cache key ──────────────────────────────────────────────────────────────

  _buildCacheKey(players) {
    const normalised = [...players]
      .map(p => ({ n: String(p.name), t: Number(p.attackStartTime) }))
      .sort((a, b) => a.t - b.t || a.n.localeCompare(b.n));

    return crypto.createHash('sha1').update(JSON.stringify({
      v:          'sync-v9',
      provider:   this.provider,
      platform:   this.platform,
      direction:  this.settings.countDirection,
      intro:      this.settings.introEnabled,
      introSpeed: this.settings.introSpeed ?? 'normal',
      players:    normalised,
    })).digest('hex');
  }

  // ── Countdown generation ───────────────────────────────────────────────────

  async generateSynchronizedCountdown(players, totalDuration) {
    if (this.provider === 'console') {
      console.log(`🔊 [console] countdown: ${players.length} players, ${totalDuration}s`);
      return null;
    }

    await this.initializeNumberLibrary();

    const cacheKey   = this._buildCacheKey(players);
    const cachedPath = this.audioCache.get(cacheKey);
    if (cachedPath && fs.existsSync(cachedPath)) return createAudioResource(cachedPath);

    const ts    = Date.now();
    const parts = [];

    // ── Intro ─────────────────────────────────────────────────────────────────
    if (this.settings.introEnabled) {
      const customIntro = this.customAudio.getSpecialFile('intro');
      if (customIntro) {
        const normIntro = path.join(this.tempDir, `intro_norm_${ts}.wav`);
        await this._normaliseWav(customIntro, normIntro);
        parts.push(normIntro);
      } else {
        const first  = players.find(p => p.attackStartTime === 0) ?? players[0];
        let script   = `Synchronized attack sequence.  ${first.name} starts first.  `;
        players.forEach(p => {
          script += p.attackStartTime === 0
            ? `${p.name} starts immediately after the countdown.  `
            : `${p.name} starts at second ${p.attackStartTime}.  `;
        });
        script += `${first.name}, get ready.  Three. Two. One. Go.  `;
        const introRaw  = path.join(this.tempDir, `intro_raw_${ts}.wav`);
        const introNorm = path.join(this.tempDir, `intro_${ts}.wav`);
        await this._ttsToWavIntro(script, introRaw);
        await this._normaliseWav(introRaw, introNorm);
        this._safeUnlink(introRaw);
        parts.push(introNorm);
      }
    }

    // ── Count sequence ─────────────────────────────────────────────────────────
    const maxTime  = Math.max(...players.map(p => p.attackStartTime));
    const countDir = this.settings.countDirection;
    const sequence = countDir === 'up'
      ? Array.from({ length: maxTime }, (_, i) => i + 1)
      : Array.from({ length: maxTime }, (_, i) => maxTime - i);

    for (const n of sequence) {
      const libFile = this.numberLibrary.get(n);
      if (libFile && fs.existsSync(libFile)) {
        parts.push(libFile);
      } else {
        const raw = path.join(this.tempDir, `raw_${n}_${ts}.wav`);
        const seg = path.join(this.tempDir, `seg_${n}_${ts}.wav`);
        await this._ttsToWav(`${n}`, raw);
        await this._normaliseNumber(raw, seg);
        this._safeUnlink(raw);
        parts.push(seg);
      }
    }

    // ── Outro ──────────────────────────────────────────────────────────────────
    const customComplete = this.customAudio.getSpecialFile('complete');
    if (customComplete) {
      const normComplete = path.join(this.tempDir, `complete_norm_${ts}.wav`);
      await this._normaliseWav(customComplete, normComplete);
      parts.push(normComplete);
    } else {
      const finalRaw  = path.join(this.tempDir, `final_raw_${ts}.wav`);
      const finalNorm = path.join(this.tempDir, `final_${ts}.wav`);
      await this._ttsToWavIntro('Sequence complete.', finalRaw);
      await this._normaliseWav(finalRaw, finalNorm);
      this._safeUnlink(finalRaw);
      parts.push(finalNorm);
    }

    // ── Concat ─────────────────────────────────────────────────────────────────
    const listFile   = path.join(this.tempDir, `list_${ts}.txt`);
    const outputFile = path.join(this.tempDir, `sync_countdown_${cacheKey}.wav`);

    fs.writeFileSync(listFile,
      parts.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n'));

    await this._runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', outputFile]);

    this._safeUnlink(listFile);
    for (const f of parts) {
      if (new RegExp(`_${ts}\\.wav$`).test(f)) this._safeUnlink(f);
    }

    this.audioCache.set(cacheKey, outputFile);
    return createAudioResource(outputFile);
  }

  async generateSpeech(text) {
    if (this.provider === 'console') {
      console.log(`🔊 TTS: ${text}`);
      return null;
    }
    try {
      const outputFile = path.join(this.tempDir, `tts_${Date.now()}.wav`);
      await this._ttsToWav(text, outputFile);
      await new Promise(r => setTimeout(r, 200));
      if (!fs.existsSync(outputFile)) throw new Error('Audio file not created');
      const resource = createAudioResource(outputFile);
      setTimeout(() => this._safeUnlink(outputFile), 15_000);
      return resource;
    } catch (err) {
      console.error('TTS error:', err.message);
      return null;
    }
  }

  // ── Cache management ───────────────────────────────────────────────────────

  clearCountdownCache() {
    let count = 0;
    try {
      for (const f of fs.readdirSync(this.tempDir)) {
        if (f.startsWith('sync_countdown_') && f.endsWith('.wav')) {
          this._safeUnlink(path.join(this.tempDir, f));
          count++;
        }
      }
    } catch (err) {
      console.warn('[TTSService] clearCountdownCache error:', err.message);
    }
    this.audioCache.clear();
    return count;
  }

  clearAllCache() {
    let count = this.clearCountdownCache();
    try {
      for (const f of fs.readdirSync(this.libraryDir)) {
        if (f.endsWith('.wav') || f.startsWith('.provider-')) {
          this._safeUnlink(path.join(this.libraryDir, f));
          count++;
        }
      }
    } catch (err) {
      console.warn('[TTSService] clearAllCache error:', err.message);
    }
    this.numberLibrary.clear();
    this.libraryInitialized = false;
    return count;
  }

  getCacheStats() {
    const countdownFiles = fs.existsSync(this.tempDir)
      ? fs.readdirSync(this.tempDir).filter(f => f.startsWith('sync_countdown_')).length : 0;
    const libraryFiles = fs.existsSync(this.libraryDir)
      ? fs.readdirSync(this.libraryDir).filter(f => f.endsWith('.wav')).length : 0;
    return { countdownFiles, libraryFiles };
  }
}

module.exports = { TTSService };
