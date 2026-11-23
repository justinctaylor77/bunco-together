// Local screenshots + API checks for the Nov 22 updates. Does not touch production data.
import { chromium } from '/tmp/pw/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const SHOTDIR = new URL('../screens-nov22/', import.meta.url).pathname;
fs.mkdirSync(SHOTDIR, { recursive: true });

const results = [];
const ok = (cond, msg) => { results.push({ ok: !!cond, msg }); console.log((cond ? 'PASS ' : 'FAIL ') + msg); };

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const players = ['Justin', 'Sarah', 'Mike', 'Rose'].map((name, i) => ({ id: 'p' + (i + 1), name, color: ['#1F7A63', '#C45B4A', '#C48E10', '#6B5C9E'][i] }));

async function startGame(mode) {
  const created = await api('POST', '/api/games', { mode, hostName: 'Justin' });
  const { code, hostToken } = created.data;
  const started = await api('POST', `/api/games/${code}/start`, {
    hostToken, settings: { mode, entry: 'everyone', teams: false }, players, order: players.map((p) => p.id), teams: [],
  });
  return { code, hostToken, game: started.data.game };
}

async function enter(code, hostToken, pid, kind, value = 0, expect) {
  return api('POST', `/api/games/${code}/entry`, { hostToken, pid, kind, value, expect, cid: 'test' });
}

// ----- API checks -----
{
  const L = await startGame('lightning');
  ok(L.game && L.game.settings.mode === 'lightning', 'create+start lightning game');
  let expect = 0; let last;
  for (let i = 0; i < 6; i++) {
    last = await enter(L.code, L.hostToken, 'p1', 'bunco', 0, expect);
    expect++;
    ok(last.ok, `lightning bunco ${i + 1}`);
  }
  const c = last.data.game;
  ok(c.status === 'finished', 'lightning finishes after 6 buncos');
  ok((c.log || []).length === 6, 'lightning log has 6 entries');
}

{
  const g = await startGame('flash');
  const ended = await api('POST', `/api/games/${g.code}/end`, { hostToken: g.hostToken, claims: ['p1'] });
  ok(ended.ok && ended.data.game.status === 'cancelled', 'end with no rounds played cancels the game');
}

{
  const g = await startGame('classic');
  const r1 = await enter(g.code, g.hostToken, 'p1', 'bunco', 0, 0);
  ok(r1.ok && r1.data.game.status === 'playing', 'classic still playing after one bunco');
  const ended = await api('POST', `/api/games/${g.code}/end`, { hostToken: g.hostToken, claims: ['p1'] });
  ok(ended.ok && ended.data.game.status === 'finished' && ended.data.game.endedEarly, 'end after a round finishes early and keeps results');
}

{
  const tg = Date.parse('2026-11-26T18:00:00-07:00');
  const dec = Date.parse('2026-12-05T19:00:00-07:00');
  const fake = {
    version: 1,
    games: [
      { id: 'FAKE01:1', code: 'FAKE01', gameNo: 1, mode: 'flash', endedAt: tg, players: [
        { name: 'Justin', color: '#1F7A63', points: 210, rounds: 6, bunco: 3, mini: 2, gameWin: true },
        { name: 'Sarah', color: '#C45B4A', points: 180, rounds: 3, bunco: 2, mini: 1, gameWin: false },
        { name: 'Julie', color: '#B5487A', points: 160, rounds: 2, bunco: 1, mini: 3, gameWin: false },
        { name: 'Levi', color: '#3D7EA6', points: 150, rounds: 1, bunco: 1, mini: 2, gameWin: false },
      ]},
      { id: 'FAKE02:1', code: 'FAKE02', gameNo: 1, mode: 'lightning', endedAt: dec, players: [
        { name: ' justin ', color: '#1F7A63', points: 90, rounds: 3, bunco: 2, mini: 1, gameWin: false },
        { name: 'Julie', color: '#B5487A', points: 110, rounds: 4, bunco: 1, mini: 2, gameWin: true },
        { name: 'Levi', color: '#3D7EA6', points: 80, rounds: 1, bunco: 0, mini: 1, gameWin: false },
        { name: 'Sarah', color: '#C45B4A', points: 70, rounds: 1, bunco: 4, mini: 0, gameWin: false },
      ]},
    ],
  };
  const r = await api('POST', '/api/season/restore', { snapshot: fake });
  ok(r.ok, 'restored local fake season data');
  const justin = (r.data.standings.rows || []).find((x) => x.name.toLowerCase() === 'justin');
  ok(justin && justin.games === 1 && justin.rounds === 9, 'season merges Justin across casings (1 game win, 9 rounds)');
  ok(!r.data.standings.champion, 'no champion before Christmas');
}

// ----- Screenshots -----
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
await ctx.addInitScript(() => { try { sessionStorage.setItem('bt.splash', '1'); } catch (e) {} });
const page = await ctx.newPage();
page.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); results.push({ ok: false, msg: 'page error: ' + e.message }); });

async function shot(name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTDIR}${name}.png` });
  console.log('  shot', name);
}

await page.goto(BASE + '/');
await page.waitForSelector('#splash', { state: 'detached', timeout: 8000 });
await page.waitForSelector('.mode.favorite');
const modes = await page.$$eval('.mode h2', (els) => els.map((e) => e.textContent));
ok(modes[0] === 'Family Favorite' && modes.includes('Lightning') && modes.includes('Classic 21'), 'mode picker: Family Favorite first, Lightning present → ' + modes.join(', '));
await shot('01-mode-picker');

const live = await startGame('flash');
// Give Justin 6, Sarah 3 so this-round column has real numbers
await enter(live.code, live.hostToken, 'p1', 'pts', 6, 0);
await enter(live.code, live.hostToken, 'p2', 'pts', 3, 1);
await page.addInitScript(({ code, hostToken }) => {
  try {
    const all = JSON.parse(localStorage.getItem('bt.games') || '{}');
    all[code] = { ...(all[code] || {}), hostToken, claims: ['p3'], picked: true, at: Date.now() };
    localStorage.setItem('bt.games', JSON.stringify(all));
  } catch (e) {}
}, { code: live.code, hostToken: live.hostToken });
await page.goto(BASE + '/g/' + live.code);
await page.waitForSelector('#splash', { state: 'detached', timeout: 8000 });
if (await page.$('[data-act="pick-done"]')) await page.click('[data-act="pick-done"]');
await page.waitForSelector('.prow .stat.this-round', { timeout: 10000 });
ok(await page.$('.this-round-h'), 'scoreboard has a This round column header');
const vals = await page.$$eval('.prow .stat.this-round', (els) => els.map((e) => e.textContent.trim()));
ok(vals.includes('6') && vals.includes('3'), 'this-round column shows 6 and 3 → ' + vals.join(','));
await shot('02-scoreboard-this-round');

// Open turn entry (host can enter for current player, who should be p3 after two pts entries)
await page.click('.next-cta');
await page.waitForSelector('.entry .nothing');
const nothingBox = await page.$eval('.nothing', (el) => {
  const r = el.getBoundingClientRect();
  const parent = el.closest('.entry').getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { h: r.height, parentH: parent.height, ratio: r.height / parent.height, bg: cs.backgroundColor, top: r.top, numsTop: document.querySelector('.nums').getBoundingClientRect().top };
});
ok(nothingBox.top > nothingBox.numsTop, 'Nothing button is below the number pad');
ok(nothingBox.ratio >= 0.20 && nothingBox.ratio <= 0.40, 'Nothing button is about 25% of the entry area (ratio ' + nothingBox.ratio.toFixed(2) + ')');
ok(/rgb\(\s*193,\s*107,\s*99\s*\)/.test(nothingBox.bg) || /#c16b63/i.test(nothingBox.bg), 'Nothing button is muted red (' + nothingBox.bg + ')');
await shot('03-score-entry-nothing');

await page.click('[data-act="end-game"]');
await page.waitForSelector('#sheet, .sheet');
const sheetText = await page.$eval('.sheet', (el) => el.innerText);
ok(/End this game for everyone\?/.test(sheetText) && /Cancel/.test(sheetText) && /End game/.test(sheetText), 'end-game confirm copy is correct');
await shot('04-end-game-confirm');
await page.click('[data-act="sheet-close"]');

await page.goto(BASE + '/season');
await page.waitForSelector('#splash', { state: 'detached', timeout: 8000 });
await page.waitForSelector('#leaderboard .board, .board');
await page.waitForFunction(() => document.querySelectorAll('.brow').length >= 2);
ok((await page.$$('.brow')).length >= 3, 'season leaderboard shows ranked players');
await shot('05-season-leaderboard');

// Local preview of the post-Christmas champion banner (does not write to the server)
await page.evaluate(() => {
  const st = window.BT.S.standings;
  st.seasonOver = true;
  st.champion = st.rows[0];
  window.BT.S.view = 'season';
  window.BT.render();
});
await page.waitForSelector('.champ-banner');
await shot('06-champion-banner-preview');
await page.click('.champ-banner');
await page.waitForSelector('#trophy');
await shot('07-trophy-preview');

await browser.close();

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
if (fails.length) fails.forEach((f) => console.log('  FAIL', f.msg));
process.exit(fails.length ? 1 : 0);
