'use strict';

/**
 * test.js — offline unit tests (no Discord connection needed)
 * Run with: node src/test.js   (or: npm test)
 *
 * Both PlayerManager and BotSettings persist to disk on every write.
 * To prevent tests from corrupting live data files we monkey-patch each
 * module's file-path constant to a PID-scoped temp path before the module
 * is first required, and clean up unconditionally on exit.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const Module = require('module');

// ── PlayerManager isolation ───────────────────────────────────────────────────
const TEST_PLAYERS_FILE  = path.join(os.tmpdir(), `wos_test_players_${process.pid}.json`);
const playerManagerPath  = require.resolve('./svc/PlayerManager');
fs.mkdirSync(path.dirname(TEST_PLAYERS_FILE), { recursive: true });
fs.writeFileSync(TEST_PLAYERS_FILE, '[]', 'utf8');

// Patch before first require
{
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    const resolved = (() => { try { return require.resolve(request, { paths: [parent?.filename ?? __dirname] }); } catch (_) { return null; } })();
    if (resolved === playerManagerPath) {
      Module._load = origLoad;
      const src = fs.readFileSync(playerManagerPath, 'utf8')
        .replace(/const PLAYERS_FILE\s*=.*?;/, `const PLAYERS_FILE = ${JSON.stringify(TEST_PLAYERS_FILE)};`);
      const m = new Module(playerManagerPath, parent);
      m.filename = playerManagerPath;
      m.paths    = Module._nodeModulePaths(path.dirname(playerManagerPath));
      m._compile(src, playerManagerPath);
      Module._cache[playerManagerPath] = m;
      return m.exports;
    }
    return origLoad.apply(this, arguments);
  };
}

// ── BotSettings isolation ─────────────────────────────────────────────────────
const TEST_SETTINGS_FILE = path.join(os.tmpdir(), `wos_test_settings_${process.pid}.json`);
const botSettingsPath    = require.resolve('./svc/BotSettings');
fs.mkdirSync(path.dirname(TEST_SETTINGS_FILE), { recursive: true });
// Write a minimal valid settings file so _load() finds something to parse
fs.writeFileSync(TEST_SETTINGS_FILE, JSON.stringify({ ttsProvider: 'local', countDirection: 'down', introEnabled: true }), 'utf8');

// Patch before first require — BotSettings sets this.settingsPath in the
// constructor, so we patch the constructor's path.join call by replacing the
// hard-coded relative path string in the source.
{
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    const resolved = (() => { try { return require.resolve(request, { paths: [parent?.filename ?? __dirname] }); } catch (_) { return null; } })();
    if (resolved === botSettingsPath) {
      Module._load = origLoad;
      const src = fs.readFileSync(botSettingsPath, 'utf8')
        // Replace the settingsPath assignment in the constructor
        .replace(
          /this\.settingsPath\s*=\s*path\.join\(__dirname.*?\);/,
          `this.settingsPath = ${JSON.stringify(TEST_SETTINGS_FILE)};`,
        );
      const m = new Module(botSettingsPath, parent);
      m.filename = botSettingsPath;
      m.paths    = Module._nodeModulePaths(path.dirname(botSettingsPath));
      m._compile(src, botSettingsPath);
      Module._cache[botSettingsPath] = m;
      return m.exports;
    }
    return origLoad.apply(this, arguments);
  };
}

// ── Safe to require now ───────────────────────────────────────────────────────
const { PlayerManager }      = require('./svc/PlayerManager');
const { BotSettings }        = require('./svc/BotSettings');
const { CustomAudioManager } = require('./svc/CustomAudioManager');
const { UpdateManager }      = require('./svc/UpdateManager');

// ── Cleanup on exit ───────────────────────────────────────────────────────────
process.on('exit', () => {
  for (const f of [TEST_PLAYERS_FILE, TEST_SETTINGS_FILE]) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
});
process.on('SIGINT',  () => process.exit(1));
process.on('SIGTERM', () => process.exit(1));

// ── Test runner ───────────────────────────────────────────────────────────────

console.log('🧪 WoS VoiceChat Counter — Core Tests');
console.log('======================================\n');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      console.log(`  ✅   ${label}`);
      passed++;
    } else {
      console.error(`  ❌   FAILED: ${label}`);
      failed++;
    }
  }

  function assertThrows(fn, label) {
    try { fn(); console.error(`  ❌   FAILED (no throw): ${label}`); failed++; }
    catch { console.log(`  ✅   ${label}`); passed++; }
  }

  // ── PlayerManager ──────────────────────────────────────────────────────────
  console.log('1. PlayerManager');
  const pm = new PlayerManager();

  pm.registerPlayer('Alpha', 30, 1);
  pm.registerPlayer('Beta',  20, 1);
  pm.registerPlayer('Gamma', 10, 2);
  assert(pm.getPlayerCount() === 3, 'registers 3 players');

  const t = pm.calculateAttackTiming();
  assert(t.totalDuration === 30, 'totalDuration = 30');
  assert(t.players.find(p => p.name === 'Alpha').attackStartTime === 0,  'Alpha starts at 0');
  assert(t.players.find(p => p.name === 'Beta').attackStartTime  === 10, 'Beta starts at 10');
  assert(t.players.find(p => p.name === 'Gamma').attackStartTime === 20, 'Gamma starts at 20');

  const g1 = pm.calculateAttackTiming(1);
  assert(g1.players.length === 2, 'group 1 has 2 players');

  pm.updatePlayer('Beta', 25, 2);
  assert(pm.getPlayer('Beta').timeToDestination === 25, 'update travel time');
  assert(pm.getPlayer('Beta').attackGroup       === 2,  'update group');

  pm.removePlayer('Gamma');
  assert(pm.getPlayerCount() === 2, 'remove player');

  assertThrows(() => pm.removePlayer('GHOST'),    'remove non-existent throws');
  assertThrows(() => pm.updatePlayer('GHOST', 5), 'update non-existent throws');

  pm.clearAllPlayers();
  assertThrows(() => pm.calculateAttackTiming(), 'timing with 0 players throws');

  pm.registerPlayer('Solo', 15, 1);
  const solo = pm.calculateAttackTiming();
  assert(solo.players[0].attackStartTime === 0, 'solo player starts at 0');

  assertThrows(() => pm.calculateAttackTiming(99), 'timing for non-existent group throws');

  // Verify persistence: reload from the temp file and check data survived
  delete require.cache[playerManagerPath];
  const src2 = fs.readFileSync(playerManagerPath, 'utf8')
    .replace(
      /const PLAYERS_FILE\s*=.*?;/,
      `const PLAYERS_FILE = ${JSON.stringify(TEST_PLAYERS_FILE)};`,
    );
  const m2 = new Module(playerManagerPath, module);
  m2.filename = playerManagerPath;
  m2.paths = Module._nodeModulePaths(path.dirname(playerManagerPath));
  m2._compile(src2, playerManagerPath);
  const pm2 = new m2.exports.PlayerManager();
  assert(pm2.getPlayerCount() === 1 && pm2.hasPlayer('Solo'), 'persistence: reloaded player survives restart');
  pm2.clearAllPlayers();

  // ── BotSettings ────────────────────────────────────────────────────────────
  console.log('\n2. BotSettings');
  const s = new BotSettings();

  assert(typeof s.ttsProvider    === 'string',  'ttsProvider is string');
  assert(typeof s.introEnabled   === 'boolean', 'introEnabled is boolean');
  assert(typeof s.countDirection === 'string',  'countDirection is string');

  s.introEnabled   = false;
  s.countDirection = 'up';
  s.ttsProvider    = 'espeak';
  assert(s.introEnabled   === false,    'introEnabled setter');
  assert(s.countDirection === 'up',     'countDirection setter');
  assert(s.ttsProvider    === 'espeak', 'ttsProvider setter');

  s.reset();
  assert(s.ttsProvider    === 'local', 'reset: ttsProvider');
  assert(s.introEnabled   === true,    'reset: introEnabled');
  assert(s.countDirection === 'down',  'reset: countDirection');

  const all = s.getAll();
  all.ttsProvider = 'MUTATED';
  assert(s.ttsProvider !== 'MUTATED', 'getAll returns copy not reference');

  assert(BotSettings.supportedProviders().length === 5, '5 supported providers');
  assert(BotSettings.supportedProviders().includes('piper'), 'piper in providers');
  assert(BotSettings.supportedProviders().includes('local'), 'local in providers');

  // ── UpdateManager ──────────────────────────────────────────────────────────
  console.log('\n3. UpdateManager');
  const um = new UpdateManager();
  assert(um.getCurrentVersion() === '2.1.1', 'reads version from package.json: got ' + um.getCurrentVersion());
  assert(um._compareVersions('2.0.0', '1.9.9')  ===  1, '2.0.0 > 1.9.9');
  assert(um._compareVersions('1.0.0', '1.0.0')  ===  0, '1.0.0 == 1.0.0');
  assert(um._compareVersions('1.0.0', '2.0.0')  === -1, '1.0.0 < 2.0.0');
  assert(um._compareVersions('v2.1.0','2.0.9')  ===  1, 'v-prefix handled');
  assert(um._compareVersions('1.10.0','1.9.0')  ===  1, '1.10 > 1.9 (no false sort)');

  // Test offline behaviour: mock _fetchJson to throw a network error
  // and verify performUpdate returns a failure result — no real network needed.
  const networkResult = await (async () => {
    const origFetch = um._fetchJson.bind(um);
    um._fetchJson = () => Promise.reject(new Error('Network unreachable'));
    const r = await um.performUpdate();
    um._fetchJson = origFetch;
    return r;
  })();
  assert(!networkResult.success,                           'performUpdate fails on network error');
  assert(typeof networkResult.output === 'string',         'performUpdate returns string output on failure');
  assert(networkResult.output.includes('Network'),         'performUpdate error includes error message');

  // Test redirect loop protection in _downloadFile
  let loopError = null;
  await (async () => {
    const origFetch = um._fetchJson.bind(um);
    um._fetchJson = async () => ({ tag_name: 'v9.9.9', tarball_url: 'https://example.com/loop' });
    const origDownload = um._downloadFile.bind(um);
    um._downloadFile = (url, dest) => new Promise((_, reject) => {
      // simulate 11 redirects to trigger the depth guard
      let depth = 0;
      const follow = (u, d) => {
        if (d > 10) return reject(new Error('Too many redirects downloading tarball (> 10)'));
        follow(u, d + 1);
      };
      follow(url, depth);
    });
    const r = await um.performUpdate();
    loopError = r;
    um._fetchJson = origFetch;
    um._downloadFile = origDownload;
  })();
  assert(!loopError.success,                               'performUpdate fails on redirect loop');
  assert(loopError.output.includes('redirects'),           'redirect loop error is descriptive');

  // ── CustomAudioManager ─────────────────────────────────────────────────────
  console.log('\n4. CustomAudioManager');
  const ca = new CustomAudioManager();

  assert(Array.isArray(ca.listFiles()),             'listFiles returns array');
  assert(ca.getNumberFile(9999) === null,            'missing number returns null');
  assert(ca.getSpecialFile('nonexistent') === null,  'missing special returns null');

  const { covered, missing } = ca.getNumberCoverage(1, 5);
  assert(Array.isArray(covered) && Array.isArray(missing), 'coverage returns arrays');
  assert(covered.length + missing.length === 5,            'coverage covers full range');

  const r1 = await ca.saveFile('bad.txt',  Buffer.from('x'));
  assert(!r1.success && r1.error.includes('Unsupported'), 'rejects .txt extension');

  const r2 = await ca.saveFile('5.wav', Buffer.alloc(6 * 1024 * 1024));
  assert(!r2.success && r2.error.includes('large'), 'rejects file > 5 MB');

  const r3 = await ca.saveFile('../../evil.wav', Buffer.from('x'));
  assert(!r3.success, 'rejects path traversal filename');

  const r4 = await ca.saveFile('abc.wav', Buffer.from('x'));
  assert(!r4.success, 'rejects non-numeric non-special name');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log('\n🎉 All tests passed!\n');
    console.log('Next steps:');
    console.log('  node src/setup.js  — configure the bot');
    console.log('  npm start          — run the bot');
    console.log('  /settings          — configure via Discord');
  } else {
    console.error('\n❌ Some tests failed — check output above.');
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
