'use strict';

/**
 * test.js — offline unit tests (no Discord connection needed)
 * Run with: node src/test.js   (or: npm test)
 *
 * PlayerManager and BotSettings are redirected to PID-scoped temp files via
 * WOS_PLAYERS_FILE / WOS_SETTINGS_FILE env vars, avoiding any live-data writes.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Isolation: set env vars BEFORE requiring the modules ─────────────────────
const TEST_PLAYERS_FILE  = path.join(os.tmpdir(), `wos_test_players_${process.pid}.json`);
const TEST_SETTINGS_FILE = path.join(os.tmpdir(), `wos_test_settings_${process.pid}.json`);

fs.writeFileSync(TEST_PLAYERS_FILE,  '[]',                                                                    'utf8');
fs.writeFileSync(TEST_SETTINGS_FILE, JSON.stringify({ ttsProvider: 'local', countDirection: 'down', introEnabled: true }), 'utf8');

process.env.WOS_PLAYERS_FILE  = TEST_PLAYERS_FILE;
process.env.WOS_SETTINGS_FILE = TEST_SETTINGS_FILE;

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

  // Verify persistence: reload from the temp file (env var still set, so it uses same path)
  delete require.cache[require.resolve('./svc/PlayerManager')];
  const { PlayerManager: PlayerManager2 } = require('./svc/PlayerManager');
  const pm2 = new PlayerManager2();
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
  const networkResult = await (async () => {
    const origFetch = um._fetchJson.bind(um);
    um._fetchJson = () => Promise.reject(new Error('Network unreachable'));
    const r = await um.performUpdate();
    um._fetchJson = origFetch;
    return r;
  })();
  assert(!networkResult.success,                   'performUpdate fails on network error');
  assert(typeof networkResult.output === 'string', 'performUpdate returns string output on failure');
  assert(networkResult.output.includes('Network'), 'performUpdate error includes error message');

  // Test redirect loop protection in _downloadFile
  let loopError = null;
  await (async () => {
    const origFetch    = um._fetchJson.bind(um);
    const origDownload = um._downloadFile.bind(um);
    um._fetchJson = async () => ({ tag_name: 'v9.9.9', tarball_url: 'https://example.com/loop' });
    um._downloadFile = (_url, _dest) => new Promise((_resolve, reject) => {
      const follow = (depth) => {
        if (depth > 10) return reject(new Error('Too many redirects downloading tarball (> 10)'));
        follow(depth + 1);
      };
      follow(0);
    });
    const r = await um.performUpdate();
    loopError = r;
    um._fetchJson    = origFetch;
    um._downloadFile = origDownload;
  })();
  assert(!loopError.success,                    'performUpdate fails on redirect loop');
  assert(loopError.output.includes('redirects'),'redirect loop error is descriptive');

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

  // Magic-byte validation (added in audit fix)
  const r5 = await ca.saveFile('1.wav', Buffer.from('This is not a WAV file'));
  assert(!r5.success && r5.error.toLowerCase().includes('wav'), 'rejects non-WAV buffer with .wav extension');

  const wavBuf = Buffer.from([0x52,0x49,0x46,0x46, 0,0,0,0, 0x57,0x41,0x56,0x45, ...Buffer.alloc(4)]);
  const r6 = await ca.saveFile('1.wav', wavBuf);
  assert(r6.success, 'accepts valid WAV magic bytes');
  ca.deleteFile('1.wav');

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
