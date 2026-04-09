'use strict';

const fs   = require('fs');
const path = require('path');

const PLAYERS_FILE = path.join(__dirname, '../../config/players.json');

class PlayerManager {
  constructor() {
    this.players = new Map();
    this._ensureDir();
    this._load();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  _ensureDir() {
    const dir = path.dirname(PLAYERS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _load() {
    try {
      if (fs.existsSync(PLAYERS_FILE)) {
        const raw = fs.readFileSync(PLAYERS_FILE, 'utf8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const p of list) {
            if (p && typeof p.name === 'string') {
              this.players.set(p.name, p);
            }
          }
          console.log(`✅ Loaded ${this.players.size} player(s) from disk.`);
        }
      }
    } catch (err) {
      console.warn(`⚠️  Could not load players.json (${err.message}), starting empty.`);
    }
  }

  _save() {
    try {
      fs.writeFileSync(
        PLAYERS_FILE,
        JSON.stringify(Array.from(this.players.values()), null, 2),
        'utf8',
      );
    } catch (err) {
      console.error(`❌ Failed to save players.json: ${err.message}`);
    }
  }

  // ── Write methods ──────────────────────────────────────────────────────────

  registerPlayer(playerName, timeToDestination, attackGroup = 1) {
    if (timeToDestination <= 0) throw new Error('Time to destination must be greater than 0');
    if (attackGroup <= 0)       throw new Error('Attack group must be greater than 0');

    this.players.set(playerName, {
      name: playerName,
      timeToDestination,
      attackGroup,
      registeredAt: Date.now(),
    });
    this._save();
    return this.players.get(playerName);
  }

  updatePlayer(playerName, newTimeToDestination, newAttackGroup = null) {
    if (!this.players.has(playerName)) throw new Error(`Player ${playerName} not found`);
    if (newTimeToDestination <= 0)     throw new Error('Time to destination must be greater than 0');
    if (newAttackGroup !== null && newAttackGroup <= 0)
      throw new Error('Attack group must be greater than 0');

    const player = this.players.get(playerName);
    player.timeToDestination = newTimeToDestination;
    if (newAttackGroup !== null) player.attackGroup = newAttackGroup;
    player.updatedAt = Date.now();
    this._save();
    return player;
  }

  removePlayer(playerName) {
    if (!this.players.has(playerName)) throw new Error(`Player ${playerName} not found`);
    const ok = this.players.delete(playerName);
    this._save();
    return ok;
  }

  /** Remove all players and persist. Returns count removed. */
  clearAllPlayers() {
    const count = this.players.size;
    this.players.clear();
    this._save();
    return count;
  }

  /** Alias for clearAllPlayers — used by the /wipe command. */
  wipeAllPlayers() {
    return this.clearAllPlayers();
  }

  // ── Read-only helpers ──────────────────────────────────────────────────────

  getAllPlayers()       { return Array.from(this.players.values()); }
  getPlayer(name)       { return this.players.get(name); }
  hasPlayer(name)       { return this.players.has(name); }
  getPlayerCount()      { return this.players.size; }

  getPlayersByGroup(attackGroup) {
    return this.getAllPlayers().filter(p => p.attackGroup === attackGroup);
  }

  getAttackGroups() {
    const groups = new Set(this.getAllPlayers().map(p => p.attackGroup));
    return Array.from(groups).sort((a, b) => a - b);
  }

  getPlayerCountByGroup(attackGroup) {
    return this.getPlayersByGroup(attackGroup).length;
  }

  calculateAttackTiming(attackGroup = null) {
    if (this.players.size === 0) throw new Error('No players registered');

    let players;
    if (attackGroup !== null) {
      players = this.getPlayersByGroup(attackGroup);
      if (players.length === 0)
        throw new Error(`No players found in attack group ${attackGroup}`);
    } else {
      players = this.getAllPlayers();
    }

    const maxTime = Math.max(...players.map(p => p.timeToDestination));

    const attackTiming = players.map(player => ({
      ...player,
      attackStartTime: maxTime - player.timeToDestination,
      attackOrder:     0,
    }));

    attackTiming.sort((a, b) => a.attackStartTime - b.attackStartTime);
    attackTiming.forEach((p, i) => { p.attackOrder = i + 1; });

    return {
      players:       attackTiming,
      totalDuration: maxTime,
      launchTime:    Date.now(),
      attackGroup,
    };
  }
}

module.exports = { PlayerManager };
