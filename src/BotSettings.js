'use strict';

const fs = require('fs');
const path = require('path');

/**
 * BotSettings — persistent key/value store backed by settings.json.
 * All bot configuration (TTS provider, count direction, intro toggle,
 * custom audio paths, etc.) is kept here so it survives restarts.
 */
class BotSettings {
  constructor() {
    this.settingsPath = path.join(__dirname, '../config/settings.json');
    this._ensureDir();
    this._settings = this._load();
  }

  // ── Defaults ──────────────────────────────────────────────────────────────

  _defaults() {
    return {
      ttsProvider:      'local',      // local | espeak | festival | piper | console
      countDirection:   'down',       // down | up
      introEnabled:     true,         // play rally intro before countdown
      introSpeed:       'normal',    // normal | slower | slow
      customAudioDir:   null,         // path to user-supplied WAV files (null = use TTS)
      voiceRate:        170,          // words-per-minute hint for macOS say
      version:          null,         // set after first run by UpdateManager
    };
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  _ensureDir() {
    const dir = path.dirname(this.settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _load() {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, 'utf8');
        return { ...this._defaults(), ...JSON.parse(raw) };
      }
    } catch (err) {
      console.warn(`⚠️  Could not read settings.json (${err.message}), using defaults.`);
    }
    return this._defaults();
  }

  _save() {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this._settings, null, 2), 'utf8');
    } catch (err) {
      console.error(`❌ Failed to save settings: ${err.message}`);
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get(key) {
    return this._settings[key] ?? this._defaults()[key];
  }

  set(key, value) {
    this._settings[key] = value;
    this._save();
  }

  getAll() {
    return { ...this._settings };
  }

  reset() {
    this._settings = this._defaults();
    this._save();
  }

  // ── Convenience getters / setters ─────────────────────────────────────────

  get ttsProvider()    { return this.get('ttsProvider'); }
  set ttsProvider(v)   { this.set('ttsProvider', v); }

  get countDirection() { return this.get('countDirection'); }
  set countDirection(v){ this.set('countDirection', v); }

  get introEnabled()   { return this.get('introEnabled'); }
  set introEnabled(v)  { this.set('introEnabled', Boolean(v)); }

  get introSpeed()     { return this.get('introSpeed'); }
  set introSpeed(v)    { this.set('introSpeed', v); }

  get customAudioDir() { return this.get('customAudioDir'); }
  set customAudioDir(v){ this.set('customAudioDir', v); }

  // Supported providers list (used for validation and display)
  static supportedProviders() {
    return ['local', 'espeak', 'festival', 'piper', 'console'];
  }

  static providerLabel(p) {
    const labels = {
      local:    'Local (auto-detect: SAPI/say/espeak)',
      espeak:   'eSpeak NG',
      festival: 'Festival',
      piper:    'Piper Neural TTS',
      console:  'Console only (no audio)',
    };
    return labels[p] ?? p;
  }
}

module.exports = { BotSettings };
