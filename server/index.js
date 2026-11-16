'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const E = require('../public/engine.js');

const PORT = process.env.PORT || 8790;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'games.json');
const TTL_MS = 24 * 60 * 60 * 1000;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PALETTE = ['#1F7A63', '#C45B4A', '#C48E10', '#6B5C9E', '#3D7EA6', '#B5487A', '#5E8C31', '#D9772B', '#2F5D8C', '#8C4A2F', '#4A8C83', '#7A6A1F'];

const games = new Map(); // code -> game
const streams = new Map(); // code -> Set(res)

// ---------- persistence (JSON file; clients also keep a snapshot to restore after a wipe) ----------
function load() {
  try {
    const arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const now = Date.now();
    for (const g of arr) if (now - g.updatedAt < TTL_MS) games.set(g.code, g);
    console.log(`Loaded ${games.size} game(s) from disk`);
  } catch (e) { if (e.code !== 'ENOENT') console.warn('Could not read saved games:', e.message); }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify([...games.values()]));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.warn('Save failed:', e.message); }
  }, 300);
}
function sweep() {
  const now = Date.now();
  for (const [code, g] of games) if (now - g.updatedAt > TTL_MS) { games.delete(code); }
  save();
}
load();
setInterval(sweep, 60 * 60 * 1000).unref();

// ---------- helpers ----------
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newCode = () => { let c; do { c = Array.from(crypto.randomBytes(6), (b) => ALPHA[b % ALPHA.length]).join(''); } while (games.has(c)); return c; };
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const isHost = (g, token) => !!token && sha(token) === g.hostHash;
const publicGame = (g) => ({ ...g, claims: undefined, cidClaims: undefined });

function broadcast(g) {
  g.updatedAt = Date.now();
  g.version = (g.version || 0) + 1;
  save();
  const set = streams.get(g.code);
  if (!set) return;
  const msg = `data: ${JSON.stringify(publicGame(g))}\n\n`;
  for (const res of set) res.write(msg);
}
function viewers(code) { const s = streams.get(code); return s ? s.size : 0; }

function getGame(req, res) {
  const g = games.get(normCode(req.params.code));
  if (!g) { res.status(404).json({ error: 'not_found' }); return null; }
  return g;
}

// Validate a setup sent by the host (players, teams, order, settings).
function sanitizeSetup(body) {
  const mode = body.settings && body.settings.mode === 'flash' ? 'flash' : 'classic';
  const entry = body.settings && body.settings.entry === 'keeper' ? 'keeper' : 'everyone';
  const teamsOn = !!(body.settings && body.settings.teams);
  const raw = Array.isArray(body.players) ? body.players.slice(0, 12) : [];
  if (raw.length < 2) throw new Error('Need at least 2 players');
  const players = raw.map((p, i) => ({
    id: clean(p.id, 12) || 'p' + (i + 1),
    name: clean(p.name, 18) || 'Player ' + (i + 1),
    color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : PALETTE[i % PALETTE.length],
  }));
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) throw new Error('Duplicate player ids');
  let teams = [];
  if (teamsOn) {
    if (players.length < 4) throw new Error('Teams need at least 4 players');
    teams = (Array.isArray(body.teams) ? body.teams : []).slice(0, 6).map((t, i) => ({
      id: clean(t.id, 12) || 't' + (i + 1), name: clean(t.name, 20) || 'Team ' + (i + 1),
      color: /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : PALETTE[i % PALETTE.length],
      members: (Array.isArray(t.members) ? t.members : []).filter((m) => ids.has(m)),
    })).filter((t) => t.members.length);
    const seen = new Set(); teams.forEach((t) => t.members.forEach((m) => seen.add(m)));
    if (seen.size !== players.length || teams.length < 2) throw new Error('Every player needs a team (at least 2 teams)');
  }
  let order = Array.isArray(body.order) ? body.order.filter((x) => ids.has(x)) : [];
  if (new Set(order).size !== players.length) order = players.map((p) => p.id);
  return { settings: { mode, entry, teams: teamsOn }, players, teams, order };
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));
app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/manifest+json').send(JSON.stringify({
    name: 'BUNCO Together', short_name: 'BUNCO', id: '/', start_url: '/', scope: '/', display: 'standalone',
    background_color: '#0C3B2C', theme_color: '#0C3B2C', icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
  }));
});
app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'icons', 'apple-touch-icon.png')));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'icons', 'favicon.ico')));
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: false,
  setHeaders: (res, p) => {
    if (/\.(woff2|png|ico)$/.test(p)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Create a room (host). Status "setup" until the host taps Start.
app.post('/api/games', (req, res) => {
  const code = newCode();
  const hostToken = crypto.randomBytes(16).toString('hex');
  const g = {
    code, hostHash: sha(hostToken), status: 'setup', createdAt: Date.now(), updatedAt: Date.now(), version: 0, gameNo: 0,
    hostName: clean(req.body && req.body.hostName, 18),
    settings: { mode: req.body && req.body.mode === 'flash' ? 'flash' : 'classic', entry: 'everyone', teams: false },
    players: [], teams: [], order: [], log: [], seq: 0, claims: {},
  };
  games.set(code, g);
  save();
  res.json({ code, hostToken, game: publicGame(g) });
});

app.get('/api/games/:code', (req, res) => {
  const g = getGame(req, res); if (!g) return;
  res.json({ game: publicGame(g), viewers: viewers(g.code) });
});

// Live updates (Server-Sent Events). EventSource reconnects on its own; each connect gets the full state.
app.get('/api/games/:code/events', (req, res) => {
  const g = getGame(req, res); if (!g) return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  res.write(`data: ${JSON.stringify(publicGame(g))}\n\n`);
  if (!streams.has(g.code)) streams.set(g.code, new Set());
  streams.get(g.code).add(res);
  const hb = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(hb); const s = streams.get(g.code); if (s) { s.delete(res); if (!s.size) streams.delete(g.code); } });
});

// Host starts the game with the final setup.
app.post('/api/games/:code/start', (req, res) => {
  const g = getGame(req, res); if (!g) return;
  if (!isHost(g, req.body.hostToken)) return res.status(403).json({ error: 'host_only' });
  let setup; try { setup = sanitizeSetup(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  Object.assign(g, setup, { status: 'playing', log: [], seq: 0, startedAt: Date.now(), gameNo: (g.gameNo || 0) + 1 });
  broadcast(g);
  res.json({ ok: true, game: publicGame(g) });
});

function canEnter(g, body, pid) {
  if (isHost(g, body.hostToken)) return true;
  if (g.settings.entry === 'keeper') return false;
  const mine = Array.isArray(body.claims) ? body.claims : [];
  return mine.includes(pid);
}

// One tap = one entry for the current player.
app.post('/api/games/:code/entry', (req, res) => {
  const g = getGame(req, res); if (!g) return;
  if (g.status !== 'playing') return res.status(409).json({ error: 'not_playing', game: publicGame(g) });
  const b = req.body || {};
  const c = E.compute(g);
  if (b.expect !== g.log.length || b.pid !== c.currentPid) return res.status(409).json({ error: 'stale', game: publicGame(g) });
  if (!canEnter(g, b, b.pid)) return res.status(403).json({ error: g.settings.entry === 'keeper' ? 'keeper_only' : 'not_your_turn' });
  const kind = String(b.kind), value = kind === 'pts' ? Number(b.value) : 0;
  if (!E.validEntry(g.settings.mode, kind, value)) return res.status(400).json({ error: 'bad_entry' });
  g.seq = (g.seq || 0) + 1;
  g.log.push({ seq: g.seq, pid: b.pid, kind, value, at: Date.now(), cid: clean(b.cid, 40) });
  if (E.compute(g).finished) g.status = 'finished';
  broadcast(g);
  res.json({ ok: true, game: publicGame(g) });
});

// Undo the last entry (host, or the phone that entered it).
app.post('/api/games/:code/undo', (req, res) => {
  const g = getGame(req, res); if (!g) return;
  const b = req.body || {};
  const last = g.log[g.log.length - 1];
  if (!last) return res.status(409).json({ error: 'nothing_to_undo', game: publicGame(g) });
  if (b.expect !== g.log.length) return res.status(409).json({ error: 'stale', game: publicGame(g) });
  if (!isHost(g, b.hostToken) && !(b.cid && b.cid === last.cid)) return res.status(403).json({ error: 'host_only' });
  g.log.pop();
  g.status = 'playing';
  g.undoAt = Date.now();
  broadcast(g);
  res.json({ ok: true, game: publicGame(g) });
});

// Rematch: same players and settings, fresh scores.
app.post('/api/games/:code/rematch', (req, res) => {
  const g = getGame(req, res); if (!g) return;
  if (!isHost(g, req.body.hostToken)) return res.status(403).json({ error: 'host_only' });
  Object.assign(g, { status: 'playing', log: [], seq: 0, startedAt: Date.now(), gameNo: (g.gameNo || 0) + 1 });
  broadcast(g);
  res.json({ ok: true, game: publicGame(g) });
});

// Put a game back after the server lost it (free hosting restarts wipe the disk).
// Any phone that was in the game keeps a copy and can restore it; the host stays the host.
app.post('/api/games/:code/restore', (req, res) => {
  const code = normCode(req.params.code);
  const s = req.body && req.body.snapshot;
  if (games.has(code)) return res.json({ ok: true, game: publicGame(games.get(code)) });
  if (!s || normCode(s.code) !== code || typeof s.hostHash !== 'string' || !/^[a-f0-9]{64}$/.test(s.hostHash)) return res.status(400).json({ error: 'bad_snapshot' });
  if (Date.now() - (s.updatedAt || 0) > TTL_MS) return res.status(410).json({ error: 'expired' });
  let setup = { settings: s.settings, players: [], teams: [], order: [] };
  if (s.status !== 'setup') { try { setup = sanitizeSetup(s); } catch (e) { return res.status(400).json({ error: e.message }); } }
  const ids = new Set(setup.players.map((p) => p.id));
  const log = (Array.isArray(s.log) ? s.log : []).slice(0, 2000)
    .filter((e) => ids.has(e.pid) && E.validEntry(setup.settings.mode, e.kind, e.kind === 'pts' ? e.value : 0))
    .map((e, i) => ({ seq: i + 1, pid: e.pid, kind: e.kind, value: e.kind === 'pts' ? e.value : 0, at: e.at || Date.now(), cid: clean(e.cid, 40) }));
  const g = {
    code, hostHash: s.hostHash, status: ['setup', 'playing', 'finished'].includes(s.status) ? s.status : 'playing',
    createdAt: s.createdAt || Date.now(), updatedAt: Date.now(), version: s.version || 0, gameNo: s.gameNo || 1, hostName: clean(s.hostName, 18),
    ...setup, log, seq: log.length, claims: {}, restoredAt: Date.now(),
  };
  if (g.status !== 'setup') g.status = E.compute(g).finished ? 'finished' : 'playing';
  games.set(code, g);
  console.log(`Restored game ${code} from a player's phone (${log.length} entries)`);
  broadcast(g);
  res.json({ ok: true, game: publicGame(g) });
});

// Keep-alive during an active game only (phones ping while the app is open).
app.post('/api/games/:code/ping', (req, res) => { res.json({ ok: true, exists: games.has(normCode(req.params.code)) }); });

// SPA: every other GET serves the app shell.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`BUNCO Together listening on :${PORT} (data: ${DATA_FILE})`));
