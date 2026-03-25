'use strict';

const https  = require('https');
const { exec } = require('child_process');
const path   = require('path');
const fs     = require('fs');

const REPO_OWNER  = 'ikketimnl';
const REPO_NAME   = 'wos-voicechat-counter';
const GITHUB_API  = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
const RAW_PKG_URL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/package.json`;

/**
 * UpdateManager checks the GitHub Releases API for the latest version tag,
 * compares it with the currently running package.json version, and can
 * trigger a `git pull` + `npm ci` update from within the container.
 */
class UpdateManager {
  constructor() {
    this.pkgPath = path.join(__dirname, '../package.json');
  }

  // ── Version helpers ────────────────────────────────────────────────────────

  getCurrentVersion() {
    try {
      const pkg = JSON.parse(fs.readFileSync(this.pkgPath, 'utf8'));
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  /** Simple semver-ish compare: returns 1 if a > b, -1 if a < b, 0 if equal */
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

  // ── Network helpers ────────────────────────────────────────────────────────

  _fetchJson(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': `${REPO_NAME}-bot`,
          'Accept': 'application/vnd.github+json',
        },
      };
      https.get(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
        });
      }).on('error', reject);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Check if a newer version is available.
   * Resolves with { current, latest, updateAvailable, releaseUrl, body }
   */
  async checkForUpdate() {
    const current = this.getCurrentVersion();
    try {
      const release = await this._fetchJson(GITHUB_API);
      const latest  = String(release.tag_name ?? '').replace(/^v/, '');
      const updateAvailable = this._compareVersions(latest, current) > 0;
      return {
        current,
        latest,
        updateAvailable,
        releaseUrl: release.html_url ?? `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`,
        body: release.body ?? '',
      };
    } catch (err) {
      return { current, latest: null, updateAvailable: false, error: err.message };
    }
  }

  /**
   * Pull the latest code and reinstall dependencies.
   * Returns { success, output } — output is the combined stdout/stderr.
   *
   * For Docker deployments this requires the container was started with
   * the repo mounted (not just copied) OR that `git` is available inside
   * the container and the working directory is a git repo.
   */
  async performUpdate() {
    const appDir = path.join(__dirname, '..');
    const isGitRepo = fs.existsSync(path.join(appDir, '.git'));

    if (!isGitRepo) {
      return {
        success: false,
        output: '❌ No .git directory found. To use the in-bot update feature the ' +
                'container must have the repository checked out via git (not just ' +
                'COPYed by Docker). See DEPLOYMENT.md for details.',
      };
    }

    return new Promise((resolve) => {
      const cmd = `cd "${appDir}" && git pull --rebase && npm ci --omit=dev 2>&1`;
      exec(cmd, { timeout: 120_000 }, (error, stdout, stderr) => {
        const output = (stdout + stderr).trim();
        if (error) {
          resolve({ success: false, output: `❌ Update failed:\n${output}` });
        } else {
          resolve({ success: true, output: `✅ Update successful:\n${output}` });
        }
      });
    });
  }
}

module.exports = { UpdateManager };
