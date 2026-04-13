'use strict';

const fs   = require('fs');
const path = require('path');

const CUSTOM_AUDIO_DIR = path.join(__dirname, '../../config/custom_audio');
const ALLOWED_EXT      = new Set(['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a']);
const MAX_FILE_SIZE    = 5 * 1024 * 1024; // 5 MB per file

/**
 * Validate that a buffer's magic bytes match the declared audio extension.
 * Returns an error string if the check fails, or null if it passes.
 */
function checkMagicBytes(ext, buf) {
  if (buf.length < 12) return 'File is too small to be a valid audio file.';
  switch (ext) {
    case '.wav':
      // RIFF....WAVE
      if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
          buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) return null;
      return 'File does not appear to be a WAV (missing RIFF/WAVE header).';
    case '.mp3':
      // ID3 tag or sync frame (FF FB / FF F3 / FF F2 / FF FA)
      if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return null; // ID3
      if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return null;           // sync frame
      return 'File does not appear to be an MP3 (missing ID3 tag or sync frame).';
    case '.ogg':
      // OggS
      if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return null;
      return 'File does not appear to be an OGG (missing OggS header).';
    case '.flac':
      // fLaC
      if (buf[0] === 0x66 && buf[1] === 0x4C && buf[2] === 0x61 && buf[3] === 0x43) return null;
      return 'File does not appear to be a FLAC (missing fLaC header).';
    case '.aac':
      // ADTS sync word or ID3
      if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return null; // ID3
      if (buf[0] === 0xFF && (buf[1] & 0xF0) === 0xF0) return null;           // ADTS
      return 'File does not appear to be an AAC file.';
    case '.m4a':
      // ISO Base Media (ftyp box at offset 4-7)
      if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return null;
      return 'File does not appear to be an M4A (missing ftyp box).';
    default:
      return null; // unknown extension — already blocked by ALLOWED_EXT, skip
  }
}

/**
 * Manages user-uploaded audio files for number announcements.
 *
 * Expected file naming: <number>.wav  (e.g. 1.wav, 2.wav … 200.wav)
 * Other special files: intro.wav, complete.wav
 *
 * Files are stored in config/custom_audio/ which is volume-mounted in Docker
 * so they survive container rebuilds.
 */
class CustomAudioManager {
  constructor() {
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(CUSTOM_AUDIO_DIR)) {
      fs.mkdirSync(CUSTOM_AUDIO_DIR, { recursive: true });
    }
  }

  getDir() {
    return CUSTOM_AUDIO_DIR;
  }

  /**
   * List all valid audio files in the custom audio directory.
   * Returns array of { filename, number|null, sizeKb, path }
   */
  listFiles() {
    this._ensureDir();
    const files = [];
    for (const f of fs.readdirSync(CUSTOM_AUDIO_DIR)) {
      const ext = path.extname(f).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;
      const fullPath = path.join(CUSTOM_AUDIO_DIR, f);
      const stat     = fs.statSync(fullPath);
      const base     = path.basename(f, ext);
      const num      = /^\d+$/.test(base) ? parseInt(base, 10) : null;
      files.push({ filename: f, number: num, sizeKb: Math.round(stat.size / 1024), path: fullPath });
    }
    return files.sort((a, b) => {
      if (a.number !== null && b.number !== null) return a.number - b.number;
      if (a.number !== null) return -1;
      if (b.number !== null) return 1;
      return a.filename.localeCompare(b.filename);
    });
  }

  /**
   * Returns the path to a custom audio file for a number, or null if not available.
   */
  getNumberFile(n) {
    this._ensureDir();
    for (const ext of ['.wav', '.mp3', '.ogg', '.flac']) {
      const p = path.join(CUSTOM_AUDIO_DIR, `${n}${ext}`);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Returns the path to a special file (intro | complete), or null.
   */
  getSpecialFile(name) {
    this._ensureDir();
    for (const ext of ['.wav', '.mp3', '.ogg', '.flac']) {
      const p = path.join(CUSTOM_AUDIO_DIR, `${name}${ext}`);
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /**
   * Save a Buffer (from a Discord attachment download) as a custom audio file.
   * Returns { success, filename, error? }
   */
  async saveFile(filename, buffer) {
    this._ensureDir();
    const ext  = path.extname(filename).toLowerCase();
    const base = path.basename(filename, ext);

    if (!ALLOWED_EXT.has(ext)) {
      return { success: false, error: `Unsupported file type ${ext}. Allowed: ${[...ALLOWED_EXT].join(', ')}` };
    }
    if (buffer.length > MAX_FILE_SIZE) {
      return { success: false, error: `File too large (${Math.round(buffer.length / 1024)} KB). Max 5 MB.` };
    }

    // Validate magic bytes so a renamed non-audio file is rejected early.
    const magicErr = checkMagicBytes(ext, buffer);
    if (magicErr) return { success: false, error: magicErr };

    // Sanitise: only allow numeric names or known specials
    const allowedNames = new Set(['intro', 'complete']);
    const isNumeric    = /^\d+$/.test(base);
    if (!isNumeric && !allowedNames.has(base)) {
      return { success: false, error: `Invalid filename "${base}". Use a number (e.g. 5.wav) or "intro"/"complete".` };
    }

    const dest = path.join(CUSTOM_AUDIO_DIR, `${base}${ext}`);
    try {
      fs.writeFileSync(dest, buffer);
      return { success: true, filename: `${base}${ext}` };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete a single custom audio file.
   */
  deleteFile(filename) {
    const safe = path.basename(filename);
    const dest = path.join(CUSTOM_AUDIO_DIR, safe);
    if (!fs.existsSync(dest)) return { success: false, error: 'File not found.' };
    try {
      fs.unlinkSync(dest);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Delete ALL custom audio files.
   */
  clearAll() {
    this._ensureDir();
    let count = 0;
    for (const f of fs.readdirSync(CUSTOM_AUDIO_DIR)) {
      const ext = path.extname(f).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) continue;
      try { fs.unlinkSync(path.join(CUSTOM_AUDIO_DIR, f)); count++; }
      catch (err) { if (err.code !== 'ENOENT') console.warn(`[CustomAudio] Failed to delete ${f}: ${err.message}`); }
    }
    return count;
  }

  /**
   * How many numeric files are present?
   */
  getNumberCoverage(min = 1, max = 60) {
    const covered = [];
    const missing = [];
    for (let i = min; i <= max; i++) {
      if (this.getNumberFile(i)) covered.push(i);
      else missing.push(i);
    }
    return { covered, missing };
  }
}

module.exports = { CustomAudioManager };
