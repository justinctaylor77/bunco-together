'use strict';
const fs = require('fs');
const path = require('path');
const E = require('../public/engine.js');

const TZ = 'America/Denver';
const SEASON_START = '2026-11-26'; // Thanksgiving
const SEASON_END = '2026-12-25';   // Christmas (inclusive)
const SEASON_FILE = process.env.SEASON_FILE || path.join(__dirname, '..', 'data', 'season.json');
const MAX_GAMES = 200;

function denverDate(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}
function inSeason(ts) {
  const d = denverDate(ts || Date.now());
  return d >= SEASON_START && d <= SEASON_END;
}
function seasonOver(ts) {
  return denverDate(ts || Date.now()) > SEASON_END;
}
function nameKey(n) { return String(n || '').trim().toLowerCase().slice(0, 18); }

function empty() { return { version: 1, games: [] }; }

function loadFile() {
  try {
    const raw = JSON.parse(fs.readFileSync(SEASON_FILE, 'utf8'));
    if (raw && Array.isArray(raw.games)) return { version: 1, games: raw.games };
  } catch (e) { if (e.code !== 'ENOENT') console.warn('Could not read season file:', e.message); }
  return empty();
}

let state = loadFile();
let saveTimer = null;
let remoteTimer = null;

function saveFile() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(SEASON_FILE), { recursive: true });
      const tmp = SEASON_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, SEASON_FILE);
    } catch (e) { console.warn('Season save failed:', e.message); }
    queueRemote();
  }, 200);
}

function snapshot() { return { version: 1, games: state.games.slice() }; }

function mergeGames(into, incoming) {
  const map = new Map();
  for (const g of into) if (g && g.id) map.set(g.id, g);
  for (const g of incoming || []) {
    if (!g || !g.id || !Array.isArray(g.players) || !g.endedAt) continue;
    if (!inSeason(g.endedAt)) continue;
    const cleanPlayers = g.players.slice(0, 12).map((p) => ({
      name: String(p.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18),
      color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#1F7A63',
      points: Math.max(0, Math.min(100000, p.points | 0)),
      rounds: Math.max(0, Math.min(12, p.rounds | 0)),
      bunco: Math.max(0, Math.min(1000, p.bunco | 0)),
      mini: Math.max(0, Math.min(1000, p.mini | 0)),
      gameWin: !!p.gameWin,
    })).filter((p) => p.name);
    if (!cleanPlayers.length) continue;
    const id = String(g.id).replace(/[^\w:.-]/g, '').slice(0, 40);
    const next = {
      id,
      code: String(g.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
      gameNo: Math.max(1, g.gameNo | 0),
      mode: E.parseMode(g.mode),
      teams: !!g.teams,
      endedAt: Number(g.endedAt) || Date.now(),
      endedEarly: !!g.endedEarly,
      players: cleanPlayers,
    };
    const prev = map.get(id);
    if (!prev || next.endedAt >= prev.endedAt) map.set(id, next);
  }
  return [...map.values()].sort((a, b) => a.endedAt - b.endedAt).slice(-MAX_GAMES);
}

function mergeSnapshot(incoming) {
  const games = mergeGames(state.games, incoming && incoming.games);
  if (games.length !== state.games.length || games.some((g, i) => g !== state.games[i])) {
    state = { version: 1, games };
    saveFile();
  }
  return snapshot();
}

function recordGame(game, c) {
  if (!game || game.status !== 'finished') return snapshot();
  c = c || E.compute(game);
  if (!c.finished || c.roundsPlayed <= 0) return snapshot();
  const endedAt = game.endedAt || Date.now();
  if (!inSeason(endedAt)) return snapshot();
  const win = new Set(E.gameWinnerIds(game, c));
  const teamsOn = !!game.settings.teams;
  const players = game.players.map((p) => {
    const st = c.players[p.id];
    const rounds = teamsOn && c.teamOf[p.id] ? (c.teams[c.teamOf[p.id]] || { won: [] }).won.length : st.won.length;
    return {
      name: p.name, color: p.color, points: st.points, rounds,
      bunco: st.bunco, mini: st.mini, gameWin: win.has(p.id),
    };
  });
  return mergeSnapshot({
    games: [{
      id: `${game.code}:${game.gameNo || 1}`,
      code: game.code, gameNo: game.gameNo || 1, mode: game.settings.mode,
      teams: teamsOn, endedAt, endedEarly: !!game.endedEarly, players,
    }],
  });
}

function standings(now) {
  const byKey = new Map();
  for (const g of state.games) {
    if (!inSeason(g.endedAt)) continue;
    for (const p of g.players) {
      const k = nameKey(p.name);
      if (!k) continue;
      let row = byKey.get(k);
      if (!row) { row = { key: k, name: p.name, color: p.color, games: 0, rounds: 0, points: 0, bunco: 0, mini: 0 }; byKey.set(k, row); }
      const nicer = (a, b) => {
        const caps = (n) => /[A-Z]/.test(n || '');
        if (caps(a) && !caps(b)) return a;
        return b || a;
      };
      row.name = nicer(row.name, p.name);
      if (p.color) row.color = p.color;
      if (p.gameWin) row.games++;
      row.rounds += p.rounds;
      row.points += p.points;
      row.bunco += p.bunco;
      row.mini += p.mini;
    }
  }
  const rows = [...byKey.values()].sort((a, b) => (b.games - a.games) || (b.rounds - a.rounds) || (b.points - a.points) || a.name.localeCompare(b.name));
  const nights = state.games.filter((g) => inSeason(g.endedAt)).map((g) => {
    const winners = g.players.filter((p) => p.gameWin);
    return { id: g.id, endedAt: g.endedAt, mode: g.mode, winners: winners.map((w) => ({ name: w.name, color: w.color })) };
  });
  return {
    start: SEASON_START, end: SEASON_END, tz: TZ,
    inSeason: inSeason(now), seasonOver: seasonOver(now),
    gameCount: nights.length, rows, nights, champion: (seasonOver(now) && rows[0] && (rows[0].games > 0 || rows[0].points > 0)) ? rows[0] : null,
  };
}

// Optional durable backup: a JSON file in a GitHub repo, if a token is set as an env var.
async function loadRemote() {
  const token = process.env.SEASON_GITHUB_TOKEN;
  if (!token) return;
  const repo = process.env.SEASON_GITHUB_REPO || 'justinctaylor77/bunco-together';
  const filePath = process.env.SEASON_GITHUB_PATH || 'data/season.json';
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'bunco-together' },
    });
    if (!res.ok) { if (res.status !== 404) console.warn('Season remote load:', res.status); return; }
    const body = await res.json();
    const raw = Buffer.from(body.content || '', 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    mergeSnapshot(parsed);
    console.log(`Loaded season standings from GitHub (${state.games.length} game(s))`);
  } catch (e) { console.warn('Season remote load failed:', e.message); }
}

async function saveRemote() {
  const token = process.env.SEASON_GITHUB_TOKEN;
  if (!token) return;
  const repo = process.env.SEASON_GITHUB_REPO || 'justinctaylor77/bunco-together';
  const filePath = process.env.SEASON_GITHUB_PATH || 'data/season.json';
  try {
    const get = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'bunco-together' },
    });
    const prev = get.ok ? await get.json() : {};
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'bunco-together', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Update holiday season standings',
        content: Buffer.from(JSON.stringify(state, null, 2)).toString('base64'),
        sha: prev.sha,
      }),
    });
    if (!res.ok) console.warn('Season remote save:', res.status);
  } catch (e) { console.warn('Season remote save failed:', e.message); }
}

function queueRemote() {
  if (!process.env.SEASON_GITHUB_TOKEN) return;
  clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => { saveRemote().catch(() => {}); }, 1500);
}

loadRemote().catch(() => {});

module.exports = {
  TZ, SEASON_START, SEASON_END, inSeason, seasonOver, denverDate,
  snapshot, mergeSnapshot, recordGame, standings,
};
