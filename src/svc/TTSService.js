'use strict';

const { createAudioResource } = require('@discordjs/voice');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { exec, execFile } = require('child_process');

class TTSService {
  constructor(settings, customAudio) {
    this.settings    = settings;
    this.customAudio = customAudio;
    this.audioCache  = new Map();
    this.numberLibrary = new Map();
    this.libraryInitialized = false;
    this.platform    = process.platform;
    this.windowsVoice = null;
    this._cleanTempDir();
  }

  get provider() { return this.settings.ttsProvider; }

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
        if (/^(intro_|final_|sync_countdown_|seg_|raw_|list_)/.test(f)) {
          try { fs.unlinkSync(path.join(d, f)); } catch (_) {}
        }
      }
    } catch (_) {}
  }

  async _getWindowsVoice() {
    if (this.windowsVoice !== null) return this.windowsVoice;
    return new Promise((resolve) => {
      const cmd = 'powershell.exe -Command "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name } | Select-Object -First 1"';
      exec(cmd, (err, stdout) => {
        const voice = (!err && stdout.trim()) ? stdout.trim() : null;
        this.windowsVoice = voice;
        resolve(voice);
      });
    });
  }

  async _ttsToWav(text, outputFile) {
    const p = this.provider;
    if (p === 'espeak')   return this._espeakTTS(text, outputFile);
    if (p === 'festival') return this._festivalTTS(text, outputFile);
    if (p === 'piper')    return this._piperTTS(text, outputFile);
    return this._platformTTS(text, outputFile);
  }

  // ── Intro speed helpers ──────────────────────────────────────────────────

  /** Maps introSpeed setting to ffmpeg atempo value (< 1.0 = slower). */
  _speedAtempo() {
    const speed = this.settings.get('introSpeed') ?? 'normal';
    if (speed === 'slower') return 0.80;
    if (speed === 'slow')   return 0.65;
    if (speed === 'slowest')   return 0.40;
    return 1.0;
  }

  /**
   * Like _ttsToWav but applies the introSpeed setting via ffmpeg atempo.
   * Used only for intro/outro speech — numbers always stay at normal speed.
   */
  async _ttsToWavIntro(text, outputFile) {
    const atempo = this._speedAtempo();
    if (atempo === 1.0) return this._ttsToWav(text, outputFile);

    // Generate at normal speed into a temp file, then re-pitch with ffmpeg
    const rawPath = outputFile.replace(/\.wav$/, '_spd_raw.wav');
    await this._ttsToWav(text, rawPath);
    await this._runFfmpeg([
      '-y', '-i', rawPath,
      '-af', `atempo=${atempo}`,
      '-ar', '48000', '-ac', '2', '-sample_fmt', 's16',
      outputFile,
    ]);
    try { fs.unlinkSync(rawPath); } catch (_) {}
  }

  async _platformTTS(text, outputFile) {
    if (this.platform === 'win32') {
      const voice = await this._getWindowsVoice();
      const selectVoice = voice ? `$synthesizer.SelectVoice('${voice}');` : '';
      const safeText = text.replace(/'/g, "''");
      const safePath = outputFile.replace(/\\/g, '\\\\');
      const cmd = `powershell.exe -Command "Add-Type -AssemblyName System.Speech; $synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${selectVoice} $synthesizer.SetOutputToWaveFile('${safePath}'); $synthesizer.Speak('${safeText}'); $synthesizer.Dispose()"`;
      return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 30_000 }, (err) => {
          if (err) return reject(new Error(`Windows TTS failed: ${err.message}`));
          if (!fs.existsSync(outputFile)) return reject(new Error('Windows TTS produced no file'));
          resolve();
        });
      });
    }

    if (this.platform === 'darwin') {
      const rate = this.settings.get('voiceRate') ?? 170;
      const safe = text.replace(/"/g, '\\"');
      return new Promise((resolve, reject) => {
        exec(`say -o "${outputFile}" -v "Samantha" -r ${rate} "${safe}"`, (err) =>
          err ? reject(new Error(`macOS TTS failed: ${err.message}`)) : resolve());
      });
    }

    // Linux — try espeak-ng, espeak, then festival
    return this._espeakTTS(text, outputFile).catch(() => this._festivalTTS(text, outputFile));
  }

  _espeakTTS(text, outputFile) {
    const safe = text.replace(/"/g, '\\"');
    return new Promise((resolve, reject) => {
      exec(`espeak-ng -w "${outputFile}" "${safe}" 2>/dev/null || espeak -w "${outputFile}" "${safe}"`, (err) => {
        if (err) return reject(new Error(`eSpeak failed: ${err.message}`));
        if (!fs.existsSync(outputFile)) return reject(new Error('eSpeak produced no file'));
        resolve();
      });
    });
  }

  _festivalTTS(text, outputFile) {
    // festival --tts does not support --output; use text2wave instead which
    // is the standard Festival utility for writing WAV output to a file.
    const safe = text.replace(/'/g, "'\''").replaceAll("_", ""); // Extra handling for underscores that festival will read out loud.
    return new Promise((resolve, reject) => {
      exec(`echo '${safe}' | text2wave -o "${outputFile}"`, (err) => {
        if (err) return reject(new Error(`Festival failed: ${err.message}`));
        if (!fs.existsSync(outputFile)) return reject(new Error('Festival produced no file'));
        resolve();
      });
    });
  }

  _piperTTS(text, outputFile) {
    const safe = text.replace(/"/g, '\\"');
    const modelPath = this.settings.piperModel || '/usr/local/bin/voices/en_US-lessac-medium.onnx';
    return new Promise((resolve, reject) => {
      exec(`echo "${safe}" | piper --model "${modelPath}" --sentence_silence 0.5 --output_file "${outputFile}"`, (err) => {
        if (err) return reject(new Error(`Piper TTS failed: ${err.message}`));
        if (!fs.existsSync(outputFile)) return reject(new Error('Piper produced no output'));
        resolve();
      });
    });
  }

  get _ffmpegPath() { return require('ffmpeg-static'); }

  _runFfmpeg(args) {
    return new Promise((resolve, reject) => {
      execFile(this._ffmpegPath, args, (err, _out, stderr) => {
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

  _libraryCacheKey() {
    return `.provider-${this.provider}-${this.platform}`;
  }

  async initializeNumberLibrary() {
    const markerFile = path.join(this.libraryDir, this._libraryCacheKey());
    const existingMarkers = fs.readdirSync(this.libraryDir).filter(f => f.startsWith('.provider-'));

    if (!existingMarkers.includes(path.basename(markerFile))) {
      console.log('🔄 TTS provider changed — clearing number library…');
      for (const f of fs.readdirSync(this.libraryDir)) {
        if (!f.startsWith('.provider-') || f !== path.basename(markerFile)) {
          try { fs.unlinkSync(path.join(this.libraryDir, f)); } catch (_) {}
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

    console.log('🔊 Initialising number library (1–200)…');

    // Collect numbers that still need generating
    const toGenerate = [];
    for (let i = 1; i <= 200; i++) {
      const customFile = this.customAudio.getNumberFile(i);
      if (customFile) { this.numberLibrary.set(i, customFile); continue; }
      const libFile = path.join(this.libraryDir, `${i}.wav`);
      if (fs.existsSync(libFile)) { this.numberLibrary.set(i, libFile); continue; }
      toGenerate.push(i);
    }

    if (toGenerate.length > 0) {
      // Piper loads a ~350 MB ONNX model per process — limit to 1 concurrent
      // on memory-constrained containers. Other providers are lightweight and
      // can safely run at higher concurrency.
      const isSlow = this.provider === 'piper' || this.provider === 'festival';
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
            await this._ttsToWav(`${i}.`, rawFile);
            await this._normaliseNumber(rawFile, libFile);
            try { fs.unlinkSync(rawFile); } catch (_) {}
            this.numberLibrary.set(i, libFile);
          } catch (err) {
            console.warn(`⚠️  Number ${i} failed: ${err.message}`);
            try { fs.unlinkSync(rawFile); } catch (_) {}
          }
          completed++;
          if (completed % 40 === 0)
            console.log(`🔊 Library progress: ${completed}/${toGenerate.length}…`);
        }));
      }
    }

    try { fs.writeFileSync(markerFile, this.provider); } catch (_) {}
    this.libraryInitialized = true;
    console.log('✅ Number library ready!');
  }

  resetLibrary() {
    this.libraryInitialized = false;
    this.numberLibrary.clear();
    this.audioCache.clear();
  }

  _buildCacheKey(players) {
    const normalised = [...players]
      .map(p => ({ n: String(p.name), t: Number(p.attackStartTime) }))
      .sort((a, b) => a.t - b.t || a.n.localeCompare(b.n));

    return crypto.createHash('sha1').update(JSON.stringify({
      v:         'sync-v9',
      provider:  this.provider,
      platform:  this.platform,
      direction: this.settings.countDirection,
      intro:     this.settings.introEnabled,
      introSpeed: this.settings.get('introSpeed') ?? 'normal',
      players:   normalised,
    })).digest('hex');
  }

  async generateSynchronizedCountdown(players, totalDuration) {

    if (this.provider === 'console') { // Moving to avoid errors with uninitialized number library when the provider is ... not generating audio files
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
        const first = players.find(p => p.attackStartTime === 0) ?? players[0];
        let script = `Synchronized attack sequence. ___  ${first.name} starts first. ___  `;
        players.forEach(p => {
          script += p.attackStartTime === 0
            ? `${p.name} starts immediately after the countdown. ___  `
            : `${p.name} starts at second ${p.attackStartTime}. ___  `;
        });
        script += `${first.name}, get ready. ___ Three. Two. One. Go, ___ .  ___  `;
        const introRaw  = path.join(this.tempDir, `intro_raw_${ts}.wav`);
        const introNorm = path.join(this.tempDir, `intro_${ts}.wav`);
        await this._ttsToWavIntro(script, introRaw);
        await this._normaliseWav(introRaw, introNorm);
        try { fs.unlinkSync(introRaw); } catch (_) {}
        parts.push(introNorm);
      }
    }

    // ── Count sequence ────────────────────────────────────────────────────────
    const maxTime = Math.max(...players.map(p => p.attackStartTime));
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
        await this._ttsToWav(`${n}.`, raw);
        await this._normaliseNumber(raw, seg);
        try { fs.unlinkSync(raw); } catch (_) {}
        parts.push(seg);
      }
    }

    // ── Outro ─────────────────────────────────────────────────────────────────
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
      try { fs.unlinkSync(finalRaw); } catch (_) {}
      parts.push(finalNorm);
    }

    // ── Concat ────────────────────────────────────────────────────────────────
    const listFile   = path.join(this.tempDir, `list_${ts}.txt`);
    const outputFile = path.join(this.tempDir, `sync_countdown_${cacheKey}.wav`);

    fs.writeFileSync(listFile,
      parts.map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "\\'")}'`).join('\n'));

    await this._runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', outputFile]);

    try { fs.unlinkSync(listFile); } catch (_) {}
    // Clean per-run temp files (not library files)
    for (const f of parts) {
      if (/_${ts}\.wav$/.test(f)) try { fs.unlinkSync(f); } catch (_) {}
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
      setTimeout(() => { try { fs.unlinkSync(outputFile); } catch (_) {} }, 15_000);
      return resource;
    } catch (err) {
      console.error('TTS error:', err.message);
      return null;
    }
  }

  clearCountdownCache() {
    let count = 0;
    try {
      for (const f of fs.readdirSync(this.tempDir)) {
        if (f.startsWith('sync_countdown_') && f.endsWith('.wav')) {
          try { fs.unlinkSync(path.join(this.tempDir, f)); count++; } catch (_) {}
        }
      }
    } catch (_) {}
    this.audioCache.clear();
    return count;
  }

  clearAllCache() {
    let count = this.clearCountdownCache();
    try {
      for (const f of fs.readdirSync(this.libraryDir)) {
        if (f.endsWith('.wav') || f.startsWith('.provider-')) {
          try { fs.unlinkSync(path.join(this.libraryDir, f)); count++; } catch (_) {}
        }
      }
    } catch (_) {}
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
