'use strict';

const https          = require('https');
const { execFile }   = require('child_process');
const path           = require('path');
const fs             = require('fs');

const REPO_OWNER = 'ikketimnl';
const REPO_NAME  = 'wos-voicechat-counter';
const GITHUB_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;

// ── Platform detection ────────────────────────────────────────────────────────

/**
 * Detect the deployment environment so we can adapt the update strategy.
 *
 *  'pterodactyl' — Pterodactyl / Pelican game panel  (/home/container exists)
 *  'docker'      — Plain Docker / docker-compose      (/.dockerenv exists)
 *  'windows'     — Win32 host (bare-metal or PM2 on Windows)
 *  'linux'       — Bare-metal / PM2 on Linux or macOS
 */
function detectPlatform() {
  if (process.platform === 'win32')     return 'windows';
  if (fs.existsSync('/home/container')) return 'pterodactyl';
  if (fs.existsSync('/.dockerenv'))     return 'docker';
  return 'linux';
}

/**
 * Resolve the absolute path of the npm executable.
 *
 * Pterodactyl / Docker containers often run with a stripped PATH, so we probe
 * known absolute locations before falling back to whatever is on $PATH.
 * We always prefer the npm binary that lives next to the running node binary —
 * this guarantees version compatibility and works even in nvm / fnm setups.
 */
function findNpm() {
  if (process.platform === 'win32') {
    const sibling = path.join(path.dirname(process.execPath), 'npm.cmd');
    return fs.existsSync(sibling) ? sibling : 'npm.cmd';
  }

  const candidates = [
    path.join(path.dirname(process.execPath), 'npm'),
    '/usr/local/bin/npm',
    '/usr/bin/npm',
    '/opt/nodejs/bin/npm',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'npm';
}

/**
 * Files and directories that must never be overwritten by an update.
 * Paths are relative to the app root.
 */
const PROTECTED = new Set([
  'config.json',
  'config/settings.json',
  'config/custom_audio',
]);

/**
 * Files and directories that are platform-specific and should be skipped
 * when not running on that platform.
 *
 * Keys are the platforms to EXCLUDE the files on (i.e. if you're NOT on
 * that platform, skip these paths).
 */
const PLATFORM_EXCLUDES = {
  // Only needed on Windows hosts
  windows: {
    excludeOnOtherPlatforms: ['windowsautosetup.bat'],
  },
  // Only needed for Docker/Pterodactyl deployments
  container: {
    excludeOnOtherPlatforms: ['Dockerfile', 'Dockerfile.yolk', 'docker-compose.yml', 'deploy.sh', '.github'],
  },
};

/**
 * Build the set of paths (relative, normalised to forward slashes) that
 * should be skipped during extraction for the current platform.
 */
function buildExcludeList(platform) {
  const excluded = [];

  // Non-Windows platforms don't need Windows-specific files
  if (platform !== 'windows') {
    excluded.push(...PLATFORM_EXCLUDES.windows.excludeOnOtherPlatforms);
  }

  // Non-container platforms don't need Docker/CI files
  if (platform !== 'docker' && platform !== 'pterodactyl') {
    excluded.push(...PLATFORM_EXCLUDES.container.excludeOnOtherPlatforms);
  }

  return excluded;
}

// ── UpdateManager ─────────────────────────────────────────────────────────────

class UpdateManager {
  constructor() {
    this.pkgPath  = path.join(__dirname, '../package.json');
    this.platform = detectPlatform();
    this.npmPath  = findNpm();
    console.log(`[UpdateManager] platform=${this.platform}  npm=${this.npmPath}`);
  }

  // ── Version helpers ─────────────────────────────────────────────────────────

  getCurrentVersion() {
    try {
      return JSON.parse(fs.readFileSync(this.pkgPath, 'utf8')).version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  /** Semver compare. Returns 1 if a > b, -1 if a < b, 0 if equal. */
  _compareVersions(a, b) {
    const parse = (v) => String(v).replace(/^v/, '').split('.').map(Number);
    const pa = parse(a);
    const pb = parse(b);
    for (let i = 0; i < 3; i++) {
      const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (diff !== 0) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  // ── Network helpers ─────────────────────────────────────────────────────────

  /** Fetch a URL and parse the response body as JSON. Times out after 15 s. */
  _fetchJson(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': `${REPO_NAME}-bot`,
          'Accept':     'application/vnd.github+json',
        },
      }, (res) => {
        let raw = '';
        res.on('data',  (chunk) => (raw += chunk));
        res.on('end',   () => {
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
        });
        res.on('error', reject);
      });

      req.setTimeout(15_000, () => {
        req.destroy();
        reject(new Error('GitHub API request timed out (15 s)'));
      });
      req.on('error', reject);
    });
  }

  /**
   * Download a URL to destPath, following HTTP 301/302 redirects.
   * GitHub's tarball_url always issues a redirect to S3.
   * Times out after 60 s of inactivity.
   */
  _downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const follow = (currentUrl) => {
        const req = https.get(currentUrl, {
          headers: { 'User-Agent': `${REPO_NAME}-bot` },
        }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            req.destroy();
            return follow(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} downloading tarball`));
          }
          const out = fs.createWriteStream(destPath);
          res.pipe(out);
          out.on('finish', resolve);
          out.on('error',  reject);
          res.on('error',  reject);
        });

        req.setTimeout(60_000, () => {
          req.destroy();
          reject(new Error('Tarball download timed out (60 s)'));
        });
        req.on('error', reject);
      };
      follow(url);
    });
  }

  // ── Extraction ──────────────────────────────────────────────────────────────

  /**
   * Extract the tarball into a staging directory, then selectively copy files
   * to the app directory — skipping protected files and platform-irrelevant
   * files, and never touching config.json or user data.
   */
  async _extractAndInstall(tarPath, appDir) {
    const stagingDir = path.join(appDir, 'temp', '_update_staging');
    const excludes   = buildExcludeList(this.platform);

    // Clean and recreate staging dir
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    try {
      // 1. Extract the full tarball into staging (safe — app dir untouched so far)
      await this._runExecFile('tar', ['-xzf', tarPath, '--strip-components=1', '-C', stagingDir], 60_000);

      // 2. Walk staging dir and copy files to appDir selectively
      this._copySelective(stagingDir, appDir, stagingDir, excludes);

      // 3. Run npm ci with suppressed noise
      await this._runNpmCi(appDir);

    } finally {
      // Always clean up staging dir
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
    }
  }

  /**
   * Recursively copy files from src to dest, skipping:
   *  - protected paths (config.json, settings.json, custom_audio)
   *  - platform-excluded paths
   */
  _copySelective(srcDir, destDir, stagingRoot, excludes) {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const srcPath  = path.join(srcDir,  entry.name);
      const destPath = path.join(destDir, entry.name);

      // Compute the relative path from the staging root for matching
      const relPath = path.relative(stagingRoot, srcPath).replace(/\\/g, '/');

      // Skip protected files — never overwrite user config/data
      if (PROTECTED.has(relPath) || PROTECTED.has(entry.name)) continue;

      // Skip platform-irrelevant files
      if (excludes.some(ex => relPath === ex || relPath.startsWith(ex + '/'))) continue;

      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) fs.mkdirSync(destPath, { recursive: true });
        this._copySelective(srcPath, destPath, stagingRoot, excludes);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Run npm ci with:
   *  - stdio stdin closed (never hangs waiting for input)
   *  - --omit=dev (no devDependencies)
   *  - --no-audit (skip audit network call and output)
   *  - --no-fund (suppress funding messages)
   *  - --loglevel=error (only print actual errors, no warnings or progress)
   */
  _runNpmCi(appDir) {
    return new Promise((resolve, reject) => {
      execFile(this.npmPath, ['ci', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
        cwd:     appDir,
        timeout: 120_000,
        env:     { ...process.env },
        stdio:   ['ignore', 'pipe', 'pipe'],
      }, (err, _stdout, stderr) => {
        if (err) {
          // On failure, return stderr so the caller can show it
          return reject(new Error(stderr.trim() || err.message));
        }
        resolve();
      });
    });
  }

  /** Generic execFile wrapper that inherits the full process environment. */
  _runExecFile(bin, args, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
      execFile(bin, args, {
        timeout: timeoutMs,
        env:     { ...process.env },
        stdio:   ['ignore', 'pipe', 'pipe'],
      }, (err, _stdout, stderr) => {
        if (err) return reject(new Error(stderr.trim() || err.message));
        resolve();
      });
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Check GitHub Releases for a newer version.
   *
   * The current version comes from local package.json.
   * The latest version comes exclusively from the GitHub release tag —
   * never from a remote package.json or branch file.
   *
   * Resolves with:
   *   { current, latest, updateAvailable, releaseUrl, body, tarballUrl }
   * or on network error:
   *   { current, latest: null, updateAvailable: false, error }
   */
  async checkForUpdate() {
    const current = this.getCurrentVersion();
    try {
      const release = await this._fetchJson(GITHUB_API);
      const latest  = String(release.tag_name ?? '').replace(/^v/, '');

      if (!latest) {
        return { current, latest: null, updateAvailable: false, error: 'No release tag found on GitHub.' };
      }

      return {
        current,
        latest,
        updateAvailable: this._compareVersions(latest, current) > 0,
        releaseUrl:  release.html_url    ?? `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
        body:        release.body        ?? '',
        tarballUrl:  release.tarball_url ?? null,
      };
    } catch (err) {
      return { current, latest: null, updateAvailable: false, error: err.message };
    }
  }

  /**
   * Download and apply the latest GitHub release.
   *
   * Steps:
   *   1. Fetch release metadata (tarball URL + tag) from GitHub API
   *   2. Download the release tarball into temp/
   *   3. Extract into a staging directory (app dir untouched until verified)
   *   4. Selectively copy files to app dir:
   *        - config.json is never touched
   *        - config/settings.json is never touched
   *        - config/custom_audio is never touched
   *        - platform-irrelevant files are skipped
   *   5. Run npm ci (silent on success, errors only on failure)
   *
   * Returns { success: boolean, output: string }
   */
  async performUpdate() {
    const appDir  = path.join(__dirname, '..');
    const tmpDir  = path.join(appDir, 'temp');
    const tarPath = path.join(tmpDir, '_update.tar.gz');

    // Ensure temp dir exists
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    // Clean up any tarball left from a previous failed attempt
    try { fs.unlinkSync(tarPath); } catch (_) {}

    try {
      // 1. Fetch release metadata
      const release    = await this._fetchJson(GITHUB_API);
      const tarballUrl = release.tarball_url;
      const latest     = String(release.tag_name ?? '').replace(/^v/, '');

      if (!tarballUrl) {
        return { success: false, output: '❌ GitHub API returned no tarball URL.' };
      }

      // 2. Download tarball
      await this._downloadFile(tarballUrl, tarPath);

      // 3 + 4 + 5. Stage, selective copy, npm ci
      await this._extractAndInstall(tarPath, appDir);

      // Clean up tarball
      try { fs.unlinkSync(tarPath); } catch (_) {}

      return {
        success: true,
        output:  `Successfully updated to v${latest}.`,
      };

    } catch (err) {
      try { fs.unlinkSync(tarPath); } catch (_) {}
      return { success: false, output: `❌ Update failed:\n${err.message}` };
    }
  }
}

module.exports = { UpdateManager };
