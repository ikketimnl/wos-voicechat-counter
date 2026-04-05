'use strict';

/**
 * test.js — offline unit tests (no Discord connection needed)
 * Run with: node test.js
 */

const { PlayerManager }      = require('./svc/PlayerManager');
const { BotSettings }        = require('./svc/BotSettings');
const { CustomAudioManager } = require('./svc/CustomAudioManager');
const { UpdateManager }      = require('./svc/UpdateManager');

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

  assertThrows(() => pm.removePlayer('GHOST'),   'remove non-existent throws');
  assertThrows(() => pm.updatePlayer('GHOST', 5),'update non-existent throws');

  pm.clearAllPlayers();
  assertThrows(() => pm.calculateAttackTiming(), 'timing with 0 players throws');

  pm.registerPlayer('Solo', 15, 1);
  const solo = pm.calculateAttackTiming();
  assert(solo.players[0].attackStartTime === 0, 'solo player starts at 0');

  assertThrows(() => pm.calculateAttackTiming(99), 'timing for non-existent group throws');

  // ── BotSettings ────────────────────────────────────────────────────────────
  console.log('\n2. BotSettings');
  const s = new BotSettings();

  assert(typeof s.ttsProvider    === 'string',  'ttsProvider is string');
  assert(typeof s.introEnabled   === 'boolean', 'introEnabled is boolean');
  assert(typeof s.countDirection === 'string',  'countDirection is string');

  s.introEnabled   = false;
  s.countDirection = 'up';
  s.ttsProvider    = 'espeak';
  assert(s.introEnabled   === false,   'introEnabled setter');
  assert(s.countDirection === 'up',    'countDirection setter');
  assert(s.ttsProvider    === 'espeak','ttsProvider setter');

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
  assert(um.getCurrentVersion() === '2.1.1', 'reads version from package.json: Returned ' + um.getCurrentVersion());
  assert(um._compareVersions('2.0.0', '1.9.9')  ===  1, '2.0.0 > 1.9.9');
  assert(um._compareVersions('1.0.0', '1.0.0')  ===  0, '1.0.0 == 1.0.0');
  assert(um._compareVersions('1.0.0', '2.0.0')  === -1, '1.0.0 < 2.0.0');
  assert(um._compareVersions('v2.1.0','2.0.9')  ===  1, 'v-prefix handled');
  assert(um._compareVersions('1.10.0','1.9.0')  ===  1, '1.10 > 1.9 (no false sort)');

  const noGitResult = await (async () => {
    const fs  = require('fs');
    const orig = fs.existsSync;
    fs.existsSync = (p) => !p.endsWith('/.git') && orig(p);
    const r = await um.performUpdate();
    fs.existsSync = orig;
    return r;
  })();
  assert(!noGitResult.success,              'performUpdate fails without .git');
  assert(noGitResult.output.includes('.git'),'performUpdate error mentions .git');

  // ── CustomAudioManager ─────────────────────────────────────────────────────
  console.log('\n4. CustomAudioManager');
  const ca = new CustomAudioManager();

  assert(Array.isArray(ca.listFiles()),        'listFiles returns array');
  assert(ca.getNumberFile(9999) === null,      'missing number returns null');
  assert(ca.getSpecialFile('nonexistent') === null, 'missing special returns null');

  const { covered, missing } = ca.getNumberCoverage(1, 5);
  assert(Array.isArray(covered) && Array.isArray(missing), 'coverage returns arrays');
  assert(covered.length + missing.length === 5, 'coverage covers full range');

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
    console.log('  node setup.js      — configure the bot');
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
