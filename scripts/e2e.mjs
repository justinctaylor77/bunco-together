// End-to-end: 4 phones (browser contexts) play full games in every mode combo.
// Usage: BASE=http://127.0.0.1:8797 node scripts/e2e.mjs [classic-ind-everyone ...]  SHOTS=1 to save screenshots
import { chromium } from '/tmp/pw/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8797';
const SHOTS = process.env.SHOTS === '1';
const SHOTDIR = new URL('../screenshots/', import.meta.url).pathname;
const NAMES = ['Justin', 'Sarah', 'Mike', 'Rose'];
const results = [];
const ok = (cond, msg) => { results.push({ ok: !!cond, msg }); console.log((cond ? 'PASS ' : 'FAIL ') + msg); };
let shotN = 0;
async function shot(page, name) { if (!SHOTS) return; await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTDIR}${name}.png` }); console.log('  shot', name); }

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await ctx.addInitScript(() => {
    window.__celebs = [];
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('celeb-layer')) window.__celebs.push(n.id); }))).observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); results.push({ ok: false, msg: 'page error: ' + e.message }); });
  return { ctx, page };
}
const S = (page) => page.evaluate(() => { const s = window.BT.S; return { view: s.view, code: s.code, status: s.game && s.game.status, logLen: s.game && s.game.log.length, roundIdx: s.comp && s.comp.roundIdx, cur: s.comp && s.comp.currentPid, finished: s.comp && s.comp.finished, gameNo: s.game && s.game.gameNo }; });
async function clearCelebs(page) {
  for (let i = 0; i < 12; i++) { const el = await page.$('.celeb-layer:not(.out)'); if (!el) { if (!(await page.$('.celeb-layer'))) return; await page.waitForTimeout(150); continue; } await el.click({ force: true }).catch(() => {}); await page.waitForTimeout(380); }
}
async function waitFor(page, fn, arg, timeout = 8000) { await page.waitForFunction(fn, arg, { timeout }); }

async function hostSetup(host, { mode, teams, entry, n = 4 }, shots) {
  const p = host.page;
  await p.goto(BASE + '/');
  if (shots) { await p.waitForTimeout(700); await shot(p, '00-splash'); }
  await p.waitForSelector('#splash', { state: 'detached', timeout: 8000 });
  if (shots) await shot(p, '01-start');
  await p.click(`.mode.${mode}`);
  await p.waitForSelector('.name-row');
  for (let i = 0; i < n; i++) await p.fill(`[data-name="${i}"]`, NAMES[i]);
  await waitFor(p, () => !document.querySelector('.room .code.pending'));
  if (shots) await shot(p, '02-setup-players');
  await p.click('[data-act="setup-next"]');
  if (entry === 'keeper') await p.click('[data-act="entry"][data-v="keeper"]');
  if (teams) await p.click('[data-act="teams"][data-v="1"]');
  if (shots) await shot(p, '03-setup-options');
  await p.click('[data-act="setup-next"]');
  if (teams) {
    await p.waitForSelector('.team-board');
    // swap Mike (p3) with Rose (p4)... first pairing is J+S / M+R; swap Sarah and Rose -> J+R / M+S
    await p.click('[data-act="swap"][data-p="p2"]'); await p.click('[data-act="swap"][data-p="p4"]');
    await p.click('[data-act="rename"][data-t="t1"]'); await p.fill('.team-name-input', 'Lucky Dogs'); await p.click('[data-act="rename"][data-t="t1"]');
    const boards = await p.$$eval('.team-board', (bs) => bs.map((b) => b.innerText.replace(/\s+/g, ' ')));
    ok(boards[0].includes('Justin') && boards[0].includes('Rose') && boards[1].includes('Mike') && boards[1].includes('Sarah'), 'team swap puts Justin+Rose vs Mike+Sarah');
    if (shots) await shot(p, '04-setup-teams');
    await p.click('[data-act="setup-next"]');
  }
  await p.waitForSelector('.order-row');
  // arrows: move row 2 down then back; drag first row down one spot then back via arrow
  const before = await p.$$eval('.order-row .who', (r) => r.map((x) => x.innerText.split('\n')[0]));
  await p.click('[data-act="mv"][data-i="0"][data-d="1"]');
  const after = await p.$$eval('.order-row .who', (r) => r.map((x) => x.innerText.split('\n')[0]));
  ok(after[0] === before[1] && after[1] === before[0], 'turn order arrow moves a player down');
  // drag row 0 handle down by one row
  const h = await p.$('[data-drag="0"]'); const bb = await h.boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 + 66, { steps: 6 }); await p.mouse.up();
  const dragged = await p.$$eval('.order-row .who', (r) => r.map((x) => x.innerText.split('\n')[0]));
  ok(dragged[1] === after[0] && dragged[0] === after[1], 'turn order drag handle reorders');
  // restore the intended order with arrows (back to "before")
  await p.click('[data-act="mv"][data-i="0"][data-d="1"]');
  await p.click('[data-act="shuffle"]');
  const sh = await p.$$eval('.order-row .who', (r) => r.length);
  ok(sh === n, 'shuffle keeps every player');
  if (shots) await shot(p, '05-setup-order');
  await p.click('[data-act="start"]');
  await p.waitForSelector('#sheet .code');
  if (shots) await shot(p, '06-room-open');
  const code = (await S(p)).code;
  await p.click('[data-act="sheet-close"]');
  await p.waitForSelector('.prow');
  return code;
}

async function joinAll(phones, code, entry, shots) {
  for (let i = 1; i < phones.length; i++) {
    const p = phones[i].page;
    if (i === 1) { await p.goto(BASE + '/join'); await p.waitForSelector('#splash', { state: 'detached' }); await p.fill('#codein', code.toLowerCase()); if (shots) await shot(p, '07-join'); await p.click('[data-act="join"]'); }
    else await p.goto(BASE + '/g/' + code);
    if (entry === 'everyone') {
      await p.waitForSelector('.pick-row');
      await p.click(`.pick-row[data-p="p${i + 1}"]`);
      if (shots && i === 1) await shot(p, '08-pick-player');
      await p.click('[data-act="pick-done"]');
    }
    await p.waitForSelector('.prow');
  }
}

// deterministic "dice"
function rng(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); }

async function playGame(phones, cfg, label, shots) {
  const host = phones[0].page; const r = rng(cfg.seed || 42);
  const pidToPhone = (pid) => (cfg.entry === 'keeper' ? phones[0] : phones[Number(pid.slice(1)) - 1]);
  let winnerChecks = 0; const winnerFails = []; let n = 0, sawAdvance = false, undoTested = false, reconnectTested = false, restoreTested = !cfg.restore, celebShot = {};
  let st = await S(host);
  while (!st.finished && n < 600) {
    const pid = st.cur; const ph = pidToPhone(pid).page;
    // other phones must not be able to enter (everyone mode)
    if (cfg.entry === 'everyone' && n === 1) {
      const other = phones.find((x) => x !== pidToPhone(pid) && x !== phones[0]);
      await clearCelebs(other.page);
      const dis = await other.page.$eval('.next-cta', (b) => b.disabled);
      ok(dis, `${label}: a phone that isn't up can't enter`);
    }
    if (cfg.entry === 'keeper' && n === 1) {
      await clearCelebs(phones[2].page);
      const dis = await phones[2].page.$eval('.next-cta', (b) => b.disabled && /Scorekeeper/.test(b.textContent));
      ok(dis, `${label}: watchers can't enter in scorekeeper mode`);
    }
    await clearCelebs(ph);
    await ph.waitForSelector('.next-cta:not([disabled])', { timeout: 8000 });
    await ph.click('.next-cta');
    await ph.waitForSelector('.entry');
    if (shots && n === 3 && !celebShot.turn) { celebShot.turn = 1; await shot(ph, cfg.teams ? '09b-turn-entry-team' : '09-turn-entry'); }
    const x = r(); let kind, value = 0;
    if (x < 0.12) kind = 'none'; else if (x < 0.22) kind = 'mini'; else if (x < 0.27) kind = 'bunco'; else { kind = 'pts'; value = 1 + Math.floor(r() * (cfg.mode === 'flash' ? 4 : 8)); }
    const before = await S(host);
    if (kind === 'pts') await ph.click(`.nums button[data-v="${value}"], .n21-wrap button[data-v="${value}"]`);
    else await ph.click(`[data-act="${kind}"]`);
    n++;
    await waitFor(host, (len) => window.BT.S.game.log.length === len, before.logLen + 1);
    st = await S(host);
    if (st.roundIdx > before.roundIdx) { sawAdvance = true; if (!st.finished) { winnerChecks++; if (st.cur !== pid) winnerFails.push(`round ${before.roundIdx + 1}: winner ${pid}, next turn ${st.cur}`); } }
    else if (!st.finished) { const o = await host.evaluate(() => window.BT.S.comp.order); if (st.cur !== o[(o.indexOf(pid) + 1) % o.length]) winnerFails.push(`order broke after ${pid}`); }
    // screenshots of celebrations as they play
    if (shots && (kind === 'bunco' || kind === 'mini') && !celebShot[kind]) {
      const w = phones[1].page; await w.waitForSelector(`.celeb-layer#${kind}`, { timeout: 4000 }).catch(() => {}); await w.waitForTimeout(1700);
      await shot(w, kind === 'bunco' ? '13-celebration-bunco' : '12-celebration-mini'); celebShot[kind] = 1;
    }
    if (shots && st.roundIdx > before.roundIdx && !celebShot.round && kind === 'pts') {
      const w = phones[1].page; await w.waitForSelector('.celeb-layer#round', { timeout: 4000 }).catch(() => {}); await w.waitForTimeout(1500);
      await shot(w, '14-celebration-round-cleared'); celebShot.round = 1;
    }
    // table appears on all phones after a roll
    if (n === 5) {
      for (const q of phones) { await clearCelebs(q.page); }
      const views = await Promise.all(phones.map((q) => S(q.page)));
      ok(views.every((v) => v.view === 'table' && v.logLen === st.logLen), `${label}: every phone shows the table and the same entry count after a roll`);
      if (shots) { await shot(phones[1].page, cfg.teams ? '15-team-score-table' : '10-score-table'); }
      if (shots && !cfg.teams) { await phones[1].page.click('.jump .avatar[data-p="p1"]'); await phones[1].page.waitForSelector('.big-score'); await shot(phones[1].page, '11-player-card'); await phones[1].page.click('.topbar .back'); }
    }
    // undo test: after a round advance, host undoes it, then re-enters the same thing
    if (!undoTested && st.roundIdx > before.roundIdx) {
      undoTested = true;
      await clearCelebs(host);
      await host.click('[data-act="undo"]'); await host.click('[data-act="undo-yes"]');
      await waitFor(host, (len) => window.BT.S.game.log.length === len, before.logLen);
      const others = await Promise.all(phones.map((q) => q.page.waitForFunction((len) => window.BT.S.game.log.length === len, before.logLen, { timeout: 8000 }).then(() => S(q.page))));
      ok(others.every((o) => o.roundIdx === before.roundIdx && o.cur === pid), `${label}: undo reopens the round on every phone`);
      // redo it
      await clearCelebs(ph); await ph.click('.next-cta'); await ph.waitForSelector('.entry');
      if (kind === 'pts') await ph.click(`.nums button[data-v="${value}"], .n21-wrap button[data-v="${value}"]`); else await ph.click(`[data-act="${kind}"]`);
      await waitFor(host, (len) => window.BT.S.game.log.length === len, before.logLen + 1);
      st = await S(host);
      ok(st.roundIdx === before.roundIdx + 1 || st.finished, `${label}: re-entering advances everyone to the next round`);
      ok(st.finished || st.cur === pid, `${label}: after undo + redo the round winner (${pid}) starts the next round`);
    }
    // reconnect test: reload phone 3 mid-game
    if (!reconnectTested && n === 20) {
      reconnectTested = true;
      const q = phones[2].page; await q.reload(); await q.waitForSelector('.prow', { timeout: 15000 });
      const s2 = await S(q);
      ok(s2.logLen === st.logLen && s2.roundIdx === st.roundIdx && s2.cur === st.cur, `${label}: refresh restores the same game state`);
      const claims = await q.evaluate(() => ((JSON.parse(localStorage.getItem('bt.games')) || {})[window.BT.S.code] || {}).claims || []);
      ok(cfg.entry === 'keeper' || claims.includes('p3'), `${label}: refresh remembers who is on the phone`);
    }
    if (!restoreTested && n === 30 && cfg.restore) {
      restoreTested = true;
      await cfg.restore(); // server restarted with an empty disk
      await new Promise((res) => setTimeout(res, 4500));
      await waitFor(host, () => window.BT.S.conn === true, null, 20000);
      const r2 = await fetch(`${BASE}/api/games/${st.code}`).then((x) => x.json()).catch(() => ({}));
      ok(r2.game && r2.game.log.length === st.logLen, `${label}: game restored from a phone after the server lost it (${r2.game ? r2.game.log.length : 'none'} entries)`);
      st = await S(host);
    }
  }
  ok(sawAdvance, `${label}: rounds auto-advanced`);
  ok(winnerChecks >= 10 && !winnerFails.length, `${label}: round winner took the first turn of the next round in ${winnerChecks}/${winnerChecks} round changes, set order otherwise ${winnerFails.join('; ')}`);
  ok(st.finished, `${label}: finished all 12 rounds in ${n} entries`);
  const roundsTotal = await host.evaluate(() => { const c = window.BT.S.comp; return (window.BT.S.game.settings.teams ? Object.values(c.teams) : Object.values(c.players)).reduce((a, x) => a + x.won.length, 0); });
  ok(roundsTotal === 12, `${label}: exactly 12 rounds were won`);
  // results on every phone
  for (const q of phones) { await clearCelebs(q.page); await q.page.waitForSelector('.awards', { timeout: 10000 }); }
  const awards = await phones[1].page.$$eval('.award', (a) => a.map((x) => x.innerText.replace(/\s+/g, ' ')));
  ok(awards.length === 4, `${label}: four winners shown → ${awards.join(' | ')}`);
  const celebs = await phones[1].page.evaluate(() => window.__celebs);
  const counts = celebs.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
  ok(counts.round >= (cfg.entry === 'keeper' ? 2 : 10), `${label}: celebrations fired on a watching phone ${JSON.stringify(counts)}`);
  const hc = await host.evaluate(() => window.__celebs.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {}));
  ok(hc.round >= 12, `${label}: host phone saw every round-cleared celebration ${JSON.stringify(hc)}`);
  if (shots) { await host.evaluate(() => window.scrollTo(0, 0)); await shot(host, cfg.teams ? '16b-final-results-teams' : '16-final-results'); }
  // rematch
  const hasRematchOther = await phones[1].page.$('[data-act="rematch"]');
  ok(!hasRematchOther, `${label}: only the host sees Rematch`);
  await host.click('[data-act="rematch"]');
  for (const q of phones) await q.page.waitForFunction(() => window.BT.S.game.log.length === 0 && window.BT.S.game.status === 'playing' && window.BT.S.view === 'table', null, { timeout: 8000 });
  const names = await phones[3].page.$$eval('.prow .nm', (x) => x.map((y) => y.textContent));
  ok(names.length === 4, `${label}: rematch keeps the same players with fresh scores on every phone`);
}

const combos = {
  'classic-ind-everyone': { mode: 'classic', teams: false, entry: 'everyone', seed: 7, shots: true, restore: true },
  'flash-teams-keeper': { mode: 'flash', teams: true, entry: 'keeper', seed: 11, shots: true },
  'classic-teams-everyone': { mode: 'classic', teams: true, entry: 'everyone', seed: 23 },
  'flash-ind-keeper': { mode: 'flash', teams: false, entry: 'keeper', seed: 31 },
};
const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(combos);
for (const name of want) {
  const cfg = { ...combos[name] };
  console.log('\n=== ' + name + ' ===');
  if (cfg.restore && process.env.RESTART_CMD) { const { execSync } = await import('node:child_process'); cfg.restore = async () => { execSync(process.env.RESTART_CMD); }; } else delete cfg.restore;
  const phones = []; for (let i = 0; i < 4; i++) phones.push(await phone());
  try {
    const code = await hostSetup(phones[0], cfg, SHOTS && cfg.shots);
    ok(/^[A-Z0-9]{6}$/.test(code), `${name}: room code ${code}`);
    await joinAll(phones, code, cfg.entry, SHOTS && cfg.shots && name === 'classic-ind-everyone');
    if (SHOTS && cfg.shots && name === 'classic-ind-everyone') {
      // waiting screen: a fresh phone joining a room still in setup
      const w = await phone(); const r = await fetch(BASE + '/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'classic', hostName: 'Justin' }) }).then((x) => x.json());
      await w.page.goto(BASE + '/g/' + r.code); await w.page.waitForSelector('.wait-body h2'); await w.page.waitForTimeout(900); await shot(w.page, '08b-waiting-for-host'); await w.ctx.close();
    }
    await playGame(phones, cfg, name, SHOTS && cfg.shots);
  } catch (e) { ok(false, `${name}: crashed: ${e.message.split('\n')[0]}`); for (let i = 0; i < 4; i++) await phones[i].page.screenshot({ path: `/tmp/bt-fail-${name}-${i}.png` }).catch(() => {}); }
  for (const p of phones) await p.ctx.close();
}
await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} checks passed`);
fs.writeFileSync('/tmp/bt-e2e-results.json', JSON.stringify(results, null, 1));
process.exit(fails.length ? 1 : 0);
