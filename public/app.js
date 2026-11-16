/* BUNCO Together client */
(function () {
  'use strict';
  const E = window.BuncoEngine;
  const PALETTE = ['#1F7A63', '#C45B4A', '#C48E10', '#6B5C9E', '#3D7EA6', '#B5487A', '#5E8C31', '#D9772B', '#2F5D8C', '#8C4A2F', '#4A8C83', '#7A6A1F'];
  const TEAM_NAMES = ['Lucky Dogs', 'High Rollers', 'Dice Queens', 'Snake Eyes', 'Hot Streaks', 'Wild Sixes'];
  const TEAM_COLORS = ['#1F7A63', '#C48E10', '#C45B4A', '#6B5C9E', '#3D7EA6', '#B5487A'];
  const CONFETTI = ['#F0C14B', '#E14A3A', '#FFFFFF', '#1F7A63', '#F8E4A8', '#6B5C9E', '#3D7EA6'];

  // ---------- small helpers ----------
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtCode = (c) => (c ? c.slice(0, 3) + '–' + c.slice(3) : '');
  const initial = (n) => (String(n || '?').trim().charAt(0) || '?').toUpperCase();
  const poss = (n) => n + '\u2019s';
  function fg(hex) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.58 ? '#1A1612' : '#FFFBF4';
  }
  const av = (p, size, extra) => `<div class="avatar ${size || ''}" ${extra || ''} style="background:${p.color};color:${fg(p.color)}">${esc(initial(p.name))}</div>`;
  const die = (face, cls, style) => `<div class="die ${cls || ''}" data-face="${face}" aria-hidden="true"${style ? ` style="${style}"` : ''}></div>`;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const rid = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join('');
  let cid = store.get('bt.cid');
  if (!cid) { cid = rid(16); store.set('bt.cid', cid); }

  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 2400);
  }
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    let data = {}; try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data };
  }

  // ---------- state ----------
  const S = {
    view: 'home', code: null, game: null, comp: null, cardPid: null, es: null, conn: true,
    lastSeq: 0, gameNo: 0, celebQ: [], celebOn: false, afterCeleb: null, busy: false,
    setup: null, swapPick: null, renaming: null, err: '',
  };
  const sess = (code) => (store.get('bt.games', {})[code] || {});
  function setSess(code, patch) { const all = store.get('bt.games', {}); all[code] = { ...(all[code] || {}), ...patch, at: Date.now() }; store.set('bt.games', all); }
  const hostToken = () => (S.code ? sess(S.code).hostToken : null);
  const isHost = () => !!hostToken();
  const myClaims = () => (S.code ? sess(S.code).claims || [] : []);
  const pById = (id) => (S.game ? S.game.players.find((p) => p.id === id) : null);
  const tById = (id) => (S.game ? (S.game.teams || []).find((t) => t.id === id) : null);
  function canEnterFor(pid) {
    if (!S.game || S.game.status !== 'playing') return false;
    if (isHost()) return true;
    return S.game.settings.entry === 'everyone' && myClaims().includes(pid);
  }

  // ---------- navigation ----------
  function go(view, opts) {
    S.view = view; S.err = '';
    if (opts && opts.pid) S.cardPid = opts.pid;
    const path = S.code && !['home', 'join'].includes(view) && !view.startsWith('setup') ? '/g/' + S.code : view === 'join' ? '/join' : '/';
    if (location.pathname !== path) history.pushState({ view }, '', path);
    render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('popstate', () => {
    const m = location.pathname.match(/^\/g\/([A-Za-z0-9]{6})/);
    if (m) { if (S.code !== m[1].toUpperCase()) openGame(m[1].toUpperCase()); else { S.view = S.game && S.game.status === 'finished' ? 'results' : 'table'; render(); } }
    else { leaveGame(); S.view = location.pathname === '/join' ? 'join' : 'home'; render(); }
  });

  // ---------- realtime ----------
  function leaveGame() { if (S.es) { S.es.close(); S.es = null; } S.code = null; S.game = null; S.comp = null; }
  async function openGame(code, preferView) {
    code = code.toUpperCase();
    if (S.es) { S.es.close(); S.es = null; }
    S.code = code; S.game = null; S.comp = null; S.lastSeq = -1;
    store.set('bt.last', code);
    S.pendingView = preferView || null;
    const r = await api('GET', `/api/games/${code}`).catch(() => ({ ok: false, status: 0 }));
    if (r.status === 404) {
      const snap = store.get('bt.snap.' + code);
      if (snap) {
        const rr = await api('POST', `/api/games/${code}/restore`, { snapshot: snap }).catch(() => ({ ok: false }));
        if (rr.ok) { toast('Game restored from this phone'); return connect(code); }
      }
      S.code = null; S.view = 'join'; S.err = `We couldn\u2019t find room ${fmtCode(code)}. Games expire after a day.`;
      history.replaceState({}, '', '/join'); render(); return;
    }
    connect(code);
  }
  function connect(code) {
    if (S.es) S.es.close();
    const es = new EventSource(`/api/games/${code}/events`);
    S.es = es;
    es.onmessage = (e) => { setConn(true); try { onGame(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    es.onopen = () => setConn(true);
    es.onerror = () => {
      setConn(false);
      if (es.readyState === 2 && S.es === es) setTimeout(() => { if (S.es === es && S.code === code) openGame(code, S.view); }, 2000);
    };
  }
  function setConn(on) { if (S.conn !== on) { S.conn = on; const el = $('#connpill'); if (el) render(); } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.code) {
      if (!S.es || S.es.readyState === 2) openGame(S.code, S.view);
      else api('GET', `/api/games/${S.code}`).then((r) => { if (r.ok) onGame(r.data.game); else if (r.status === 404) openGame(S.code, S.view); }).catch(() => {});
    }
  });
  // Keep the free server awake only while a game is open on screen.
  setInterval(() => { if (S.code && document.visibilityState === 'visible') api('POST', `/api/games/${S.code}/ping`).catch(() => {}); }, 4 * 60 * 1000);

  const lastSeqOf = (g) => (g.log.length ? g.log[g.log.length - 1].seq : 0);

  function onGame(g) {
    const first = !S.game || S.game.code !== g.code;
    const prevStatus = S.game && S.game.status;
    if (S.game && !first && (g.version || 0) < (S.game.version || 0) && g.gameNo === S.game.gameNo) return; // older copy
    S.game = g; S.comp = E.compute(g);
    store.set('bt.snap.' + g.code, g);
    const ls = lastSeqOf(g);
    if (first || S.lastSeq < 0) {
      S.lastSeq = ls; S.gameNo = g.gameNo;
      S.view = defaultView(S.pendingView); S.pendingView = null;
      if (location.pathname !== '/g/' + g.code) history.replaceState({}, '', '/g/' + g.code);
      render(); return;
    }
    if (g.gameNo !== S.gameNo) {
      S.gameNo = g.gameNo; S.lastSeq = ls; S.celebQ = [];
      if (prevStatus === 'setup' || S.view === 'waiting') { S.view = defaultView(); render(); return; }
      toast('Rematch! Fresh scores, same table'); S.view = 'table'; render(); return;
    }
    if (ls > S.lastSeq) {
      const fresh = S.comp.events.filter((e) => e.seq > S.lastSeq);
      S.lastSeq = ls;
      fresh.forEach((ev) => { if (Date.now() - (ev.at || 0) < 45000) queueCelebrations(ev); });
      if (S.view !== 'card' || g.status === 'finished') S.view = 'table';
      if (g.status === 'finished') S.afterCeleb = 'results';
      render(); playNext(); return;
    }
    if (ls < S.lastSeq) {
      S.lastSeq = ls; toast('Last entry undone');
      if (['turn', 'results'].includes(S.view)) S.view = 'table';
    }
    if (g.status === 'finished' && S.view === 'turn') S.view = 'table';
    render();
  }
  function defaultView(prefer) {
    const g = S.game;
    if (g.status === 'setup') return isHost() ? 'table' : 'waiting';
    if (prefer && ['table', 'turn', 'card', 'results'].includes(prefer)) return prefer === 'turn' ? 'table' : prefer;
    if (!isHost() && g.settings.entry === 'everyone' && !sess(g.code).picked) return 'pick';
    return g.status === 'finished' ? 'results' : 'table';
  }

  // ---------- celebrations ----------
  function queueCelebrations(ev) {
    const p = pById(ev.pid); if (!p) return;
    if (ev.kind === 'bunco') S.celebQ.push({ type: 'bunco', ev, p });
    else if (ev.kind === 'mini') S.celebQ.push({ type: 'mini', ev, p });
    if (ev.cleared) S.celebQ.push({ type: 'round', ev, p });
    while (S.celebQ.length > 3) S.celebQ.shift();
  }
  function confetti(n, seed) {
    let s = seed || 7; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    let out = '';
    for (let i = 0; i < n; i++) {
      const w = [6, 7, 8, 10][Math.floor(rnd() * 4)], h = i % 3 === 0 ? w : [9, 11, 13, 15][Math.floor(rnd() * 4)];
      out += `<i style="--x:${Math.round(3 + rnd() * 94)}%;--d:${(2.1 + rnd() * 1.7).toFixed(2)}s;--delay:${(rnd() * 1.3).toFixed(2)}s;--w:${w}px;--h:${h}px;--r:${Math.round(-50 + rnd() * 100)}deg;--c:${CONFETTI[i % CONFETTI.length]};--rad:${i % 3 === 0 ? '50%' : '1.5px'}"></i>`;
    }
    return out;
  }
  const sparks = (list) => list.map((n) => `<span class="spark s${n}"></span>`).join('');
  function celebHTML(c) {
    const { ev, p } = c; const n = ev.number, w = E.word(n);
    const team = ev.tid ? tById(ev.tid) : null;
    if (c.type === 'bunco') return { id: 'bunco', cls: 'felt-bg', ms: 3800, html: `<div class="overlay"><div class="rays"></div><div class="confetti">${confetti(36, ev.seq + 3)}</div><div class="sparkles">${sparks([1, 2, 3, 4, 5, 6, 7])}</div>
      <div class="celeb-body"><div class="celeb-dice">${die(n)}${die(n, 'die-red')}${die(n)}</div>
      <div class="celeb-kicker">${esc(p.name)} rolled it</div><div class="celeb-word">Bunco!</div>
      <div class="celeb-sub">Three ${w} · the whole table saw that</div><div class="pts-bubble">+21</div></div></div>` };
    if (c.type === 'mini') return { id: 'mini', cls: 'cream-bg', ms: 2600, html: `<div class="overlay"><div class="rays"></div><div class="confetti">${confetti(22, ev.seq + 5)}</div><div class="sparkles">${sparks([1, 2, 5, 6])}</div>
      <div class="celeb-body"><div class="celeb-dice">${die(n, 'die-gold')}${die(n, 'die-gold')}</div>
      <div class="celeb-kicker">${esc(p.name)} rolled it</div><div class="celeb-word">Mini<br>Bunco</div>
      <div class="celeb-sub">Five points on the board</div><div class="pts-bubble">+5</div></div></div>` };
    const who = team ? team.name : p.name;
    const lastRound = ev.roundIdx >= 11;
    const next = lastRound ? 'That was the last round!' : `Everyone moves on to ${E.word(E.ROUNDS[ev.roundIdx + 1])}`;
    return { id: 'round', cls: 'felt-bg', ms: 3000, html: `<div class="overlay"><div class="rays"></div><div class="confetti">${confetti(30, ev.seq + 11)}</div><div class="sparkles">${sparks([1, 2, 3, 4, 5, 7])}</div>
      <div class="celeb-body"><div class="celeb-dice">${die(n, 'die-gold')}</div>
      <div class="celeb-kicker">Round ${ev.roundIdx + 1} cleared</div><div class="celeb-word">${esc(who)}<br>${team ? 'take' : 'takes'} the ${n}s</div>
      <div class="celeb-sub">${team ? esc(p.name) + ' sealed it · ' : ''}${next}</div><div class="pts-bubble">Round won</div></div></div>` };
  }
  function playNext() {
    if (S.celebOn) return;
    let c = S.celebQ.shift();
    // If rolls came in faster than the party, skip stale ones (keep the newest).
    while (c && S.celebQ.length && Date.now() - (c.ev.at || 0) > 12000) c = S.celebQ.shift();
    if (!c) {
      if (S.afterCeleb) { const v = S.afterCeleb; S.afterCeleb = null; if (S.game && S.game.status === 'finished') { S.view = v; render(); window.scrollTo(0, 0); } }
      return;
    }
    S.celebOn = true;
    const h = celebHTML(c);
    const el = document.createElement('div');
    el.className = `phone ${h.cls} is-playing celeb-layer`; el.id = h.id;
    el.innerHTML = h.html + '<div class="tap-hint">Tap to continue</div>';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
    document.body.appendChild(el);
    let done = false;
    const close = () => { if (done) return; done = true; el.classList.add('out'); setTimeout(() => { el.remove(); S.celebOn = false; playNext(); }, 330); };
    el.addEventListener('click', close);
    setTimeout(close, h.ms);
  }

  // ---------- setup (host, local until Start) ----------
  function newSetup(mode) {
    const s = { mode, n: 4, names: ['', '', '', ''], entry: 'everyone', teamsOn: false, teams: [], order: [], code: null };
    return s;
  }
  const setupPlayers = () => Array.from({ length: S.setup.n }, (_, i) => ({ id: 'p' + (i + 1), name: (S.setup.names[i] || '').trim() || 'Player ' + (i + 1), color: PALETTE[i % PALETTE.length] }));
  function autoSplit(shuffle) {
    const ids = setupPlayers().map((p) => p.id);
    if (shuffle) shuffleArr(ids);
    const k = Math.floor(ids.length / 2);
    const old = S.setup.teams;
    const teams = Array.from({ length: k }, (_, i) => ({ id: 't' + (i + 1), name: (old[i] && old[i].name) || TEAM_NAMES[i], color: TEAM_COLORS[i % TEAM_COLORS.length], members: [] }));
    ids.forEach((id, i) => teams[Math.min(Math.floor(i / 2), k - 1)].members.push(id));
    S.setup.teams = teams;
  }
  function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function defaultOrder() {
    const ids = setupPlayers().map((p) => p.id);
    if (!S.setup.teamsOn) return ids;
    // Alternate teams so teammates don't roll back to back.
    const lists = S.setup.teams.map((t) => t.members.slice()); const out = [];
    while (lists.some((l) => l.length)) lists.forEach((l) => { if (l.length) out.push(l.shift()); });
    return out;
  }
  function syncOrder() {
    const ids = setupPlayers().map((p) => p.id);
    const keep = (S.setup.order || []).filter((x) => ids.includes(x));
    if (keep.length !== ids.length) S.setup.order = defaultOrder();
  }
  function saveSetup() { store.set('bt.setup', S.setup); }

  async function ensureRoom() {
    if (S.setup.code) return;
    const r = await api('POST', '/api/games', { mode: S.setup.mode }).catch(() => ({ ok: false }));
    if (r.ok) {
      S.setup.code = r.data.code; setSess(r.data.code, { hostToken: r.data.hostToken, claims: [] }); saveSetup();
      const box = $('.room'); // update in place so typing isn't interrupted
      if (box) { const tmp = document.createElement('div'); tmp.innerHTML = roomBox(); box.replaceWith(tmp.firstElementChild); }
    }
    else setTimeout(() => { if (S.setup && !S.setup.code && S.view.startsWith('setup')) ensureRoom(); }, 3000);
  }
  async function startGame() {
    if (!S.setup.code) { toast('Opening your room… one sec'); await ensureRoom(); if (!S.setup.code) return; }
    const players = setupPlayers();
    const body = {
      hostToken: sess(S.setup.code).hostToken,
      settings: { mode: S.setup.mode, entry: S.setup.entry, teams: S.setup.teamsOn },
      players, teams: S.setup.teamsOn ? S.setup.teams : [], order: S.setup.order,
    };
    S.busy = true; render();
    const r = await api('POST', `/api/games/${S.setup.code}/start`, body).catch(() => ({ ok: false, data: {} }));
    S.busy = false;
    if (!r.ok) {
      if (r.status === 404) { S.setup.code = null; await ensureRoom(); toast('Room refreshed, tap Start again'); render(); return; }
      S.err = (r.data && r.data.error) || 'Couldn\u2019t start. Check your connection and try again.'; render(); return;
    }
    const code = S.setup.code;
    store.del('bt.setup');
    S.setup = null;
    S.code = code; S.lastSeq = -1;
    S.pendingView = 'table';
    history.pushState({}, '', '/g/' + code);
    onGame(r.data.game);
    connect(code);
    setTimeout(() => shareSheet(true), 400);
  }

  async function share(code) {
    const url = location.origin + '/g/' + code;
    const text = `Join our BUNCO Together game! Room code ${fmtCode(code)}`;
    if (navigator.share) { try { await navigator.share({ title: 'BUNCO Together', text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Link copied, paste it in your family chat'); } catch (e) { toast(url, 5000); }
  }
  function shareSheet(started) {
    if (!S.code) return;
    sheet(`<h3>${started ? 'The table is open!' : 'Invite the family'}</h3>
      <p>Everyone opens the link on their phone, or taps <b>Join a game</b> and types the code.</p>
      <div class="room" style="margin-top:14px"><div><div class="kicker">Room code</div><div class="code">${fmtCode(S.code)}</div></div><div class="share" data-act="share">Share</div></div>
      <div class="row"><button class="cta gold" data-act="sheet-close">Let\u2019s roll</button></div>`);
  }
  function sheet(html) {
    closeSheet();
    const el = document.createElement('div'); el.className = 'sheet-back'; el.id = 'sheet';
    el.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
    el.addEventListener('click', (e) => { if (e.target === el) closeSheet(); });
    document.body.appendChild(el);
  }
  function closeSheet() { const s = $('#sheet'); if (s) s.remove(); }

  // ---------- game actions ----------
  async function enter(kind, value) {
    if (S.busy) return;
    const pid = S.comp.currentPid;
    S.busy = true; const entryEl = $('.entry'); if (entryEl) entryEl.classList.add('busy');
    const r = await api('POST', `/api/games/${S.code}/entry`, { cid, hostToken: hostToken(), claims: myClaims(), pid, kind, value, expect: S.game.log.length }).catch(() => ({ ok: false, status: 0, data: {} }));
    S.busy = false;
    if (r.ok) { onGame(r.data.game); return; }
    if (entryEl) entryEl.classList.remove('busy');
    if (r.status === 409 && r.data.game) { toast('That turn was already logged'); onGame(r.data.game); S.view = 'table'; render(); return; }
    if (r.status === 403) { toast(r.data.error === 'keeper_only' ? 'Only the scorekeeper\u2019s phone can enter scores' : 'It\u2019s not your turn on this phone'); S.view = 'table'; render(); return; }
    toast('Couldn\u2019t save that. Check your connection and tap again.');
  }
  function confirmUndo() {
    const last = S.comp.last; if (!last) return;
    const p = pById(last.pid);
    sheet(`<h3>Undo the last entry?</h3><p>${esc(p ? p.name : '')}: ${esc(entryLabel(last))}${last.cleared ? ' · this also reopens the round' : ''}. Everyone\u2019s table updates.</p>
      <div class="row"><button class="cta ghost" data-act="sheet-close">Keep it</button><button class="cta danger" data-act="undo-yes">Undo</button></div>`);
  }
  async function undo() {
    closeSheet();
    const r = await api('POST', `/api/games/${S.code}/undo`, { cid, hostToken: hostToken(), expect: S.game.log.length }).catch(() => ({ ok: false, data: {} }));
    if (r.ok) { onGame(r.data.game); return; }
    if (r.data && r.data.game) onGame(r.data.game);
    toast(r.status === 403 ? 'Only the host or the phone that entered it can undo' : 'Couldn\u2019t undo, try again');
  }
  async function rematch() {
    const r = await api('POST', `/api/games/${S.code}/rematch`, { hostToken: hostToken() }).catch(() => ({ ok: false }));
    if (r.ok) onGame(r.data.game); else toast('Couldn\u2019t start the rematch, try again');
  }
  const entryLabel = (e) => (e.kind === 'none' ? 'Nothing' : e.kind === 'mini' ? 'Mini Bunco (+5)' : e.kind === 'bunco' ? 'Bunco (+21)' : `${e.value} point${e.value === 1 ? '' : 's'}`);

  // ---------- shared view bits ----------
  const sbar = '<div class="sbar"></div>';
  function track(kind, pid) {
    const c = S.comp; let out = '';
    E.ROUNDS.forEach((n, i) => {
      if (i === 6) out += '<span class="tok-gap"></span>';
      let cls = 'soon';
      const done = c.finished || i < c.roundIdx, now = !c.finished && i === c.roundIdx;
      if (kind === 'card') {
        const won = (S.game.settings.teams ? c.teams[c.teamOf[pid]] : c.players[pid]).won.includes(i);
        cls = won ? 'mine' : done ? 'lost' : now ? 'now' : 'soon';
      } else cls = done ? 'done' : now ? 'now' : 'soon';
      out += `<span class="tok ${cls}">${n}</span>`;
    });
    return `<div class="track" aria-label="Rounds">${out}</div>`;
  }
  const wonBadges = (won) => `<div class="won-badges">${won.map((i) => `<b>${E.ROUNDS[i]}s</b>`).join('')}</div>`;
  function leadText(list, key, nameOf) {
    const b = E.leaders(list, key);
    if (!b.ids.length) return '—';
    if (b.ids.length > 1) return `Tied · ${b.ids.length === 2 ? b.value + '–' + b.value : b.value}`;
    return `${esc(nameOf(b.ids[0]))} · ${b.value}`;
  }
  function roundProgOf(pid) {
    const c = S.comp; const tid = c.teamOf[pid];
    return S.game.settings.teams && tid ? c.teams[tid].round : c.players[pid].round;
  }

  // ---------- views ----------
  const V = {};

  V.home = () => {
    document.body.className = 'cream';
    const last = store.get('bt.last'); const ls = last && sess(last);
    const resume = last && ls && Date.now() - (ls.at || 0) < 20 * 3600e3 ? `<div class="resume" data-act="resume" data-code="${last}"><span>Back to your game</span><b>${fmtCode(last)} ›</b></div>` : '';
    const draft = store.get('bt.setup');
    return `<div class="phone cream-bg" id="start">${sbar}
      <div class="glow"></div>
      <div class="hero"><div class="hero-dice">${die(5, '', '--tilt:-16deg;--lift:10px')}${die(6, 'die-red center', '--tilt:5deg;--lift:0px')}${die(3, '', '--tilt:18deg;--lift:12px')}</div>
        <div class="wordmark"><span class="bunco">BUNCO</span><span class="together">Together</span></div>
        <p class="tagline">Keep score together,<br>wherever you roll.</p></div>
      <div class="modes">
        <div class="mode classic" data-act="mode" data-mode="classic" role="button"><div class="mode-badge">21</div><div><h2>Classic 21</h2><p>Twelve rounds. First to 21 wins the number, then everyone moves on.</p><span class="pill">Family favorite</span></div></div>
        <div class="mode flash" data-act="mode" data-mode="flash" role="button"><div class="mode-badge">10<small>Flash</small></div><div><h2>Flash 10</h2><p>The same twelve rounds, twice the pace. First to 10 takes it.</p><span class="pill">Quick play</span></div></div>
      </div>
      ${resume}
      ${draft && draft.code ? `<a class="join-link" data-act="resume-setup">Finish setting up room ${fmtCode(draft.code)}</a>` : ''}
      <a class="join-link" data-act="go" data-view="join">Have a room code? Join a game</a>
      <div class="start-foot">Played over FaceTime · scored together</div></div>`;
  };

  V.join = () => {
    document.body.className = 'cream';
    return `<div class="phone cream-bg">${sbar}
      <div class="topbar"><div class="back" data-act="home">‹</div><div class="chip">Join a game</div><div style="width:36px"></div></div>
      <div class="setup"><h1>Got a room code?</h1><p class="lead">Ask whoever started the game for the six-letter code, or open the link they shared.</p>
        <input class="code-input" id="codein" maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABC123" inputmode="text">
        ${S.err ? `<div class="err-msg">${esc(S.err)}</div>` : ''}
        <button class="cta" data-act="join">Join the table</button>
        <p class="note">No account needed. You\u2019ll pick your name next.</p></div></div>`;
  };

  function setupTop(step) {
    const s = S.setup;
    const steps = ['1 Players', '2 Options', '3 Teams', '4 Order'].map((t, i) => `<span class="${i === step ? 'on' : ''}">${t}</span>`).join('');
    return `${sbar}<div class="topbar"><div class="back" data-act="setup-back">‹</div><div class="chip">${E.modeName(s.mode)}</div><div style="width:36px"></div></div>
      <div class="setup"><div class="steps">${steps}</div>`;
  }
  const roomBox = () => `<div class="room"><div><div class="kicker">Room code</div><div class="code ${S.setup.code ? '' : 'pending'}">${S.setup.code ? fmtCode(S.setup.code) : 'Opening a room…'}</div></div>${S.setup.code ? '<div class="share" data-act="share-setup">Share</div>' : ''}</div>`;

  V['setup-players'] = () => {
    document.body.className = 'cream';
    const s = S.setup;
    const rows = Array.from({ length: s.n }, (_, i) => `<div class="name-row">${av({ name: s.names[i] || String(i + 1), color: PALETTE[i % PALETTE.length] })}
      <div style="flex:1"><span class="field-label">Player ${i + 1}</span><input class="field" data-name="${i}" value="${esc(s.names[i] || '')}" placeholder="Name" maxlength="18" autocomplete="off" enterkeyhint="next"></div></div>`).join('');
    return `<div class="phone cream-bg">${setupTop(0)}
      <h1>Who\u2019s playing?</h1><p class="lead">Add everyone at the table, then share the room code on FaceTime.</p>
      <div class="stepper-row"><div><span class="label">Players</span><span class="hint">2 to 12</span></div>
        <div class="stepper"><div class="circle ${s.n <= 2 ? 'off' : ''}" data-act="n" data-d="-1">−</div><div class="count">${s.n}</div><div class="circle ${s.n >= 12 ? 'off' : ''}" data-act="n" data-d="1">+</div></div></div>
      <div class="names">${rows}</div>
      ${roomBox()}
      <button class="cta" data-act="setup-next" data-to="setup-options">Continue</button></div></div>`;
  };

  V['setup-options'] = () => {
    document.body.className = 'cream';
    const s = S.setup; const canTeams = s.n >= 4;
    const ch = (on, act, val, title, body, short) => `<div class="choice ${short ? 'short' : ''} ${on ? 'pick' : ''}" data-act="${act}" data-v="${val}" role="button"><div class="mark"></div>${short ? '<div>' : ''}<h3>${title}</h3><p>${body}</p>${short ? '</div>' : ''}</div>`;
    return `<div class="phone cream-bg">${setupTop(1)}
      <h1>How should we play?</h1><p class="lead">You can change these before the first roll.</p>
      <div class="choice-block"><h2>Who enters the scores?</h2><div class="choice-grid">
        ${ch(s.entry === 'everyone', 'entry', 'everyone', 'Everyone enters their own', 'Each phone logs its own roll when it\u2019s that player\u2019s turn.')}
        ${ch(s.entry === 'keeper', 'entry', 'keeper', 'One scorekeeper', 'This phone logs every roll for the whole table.')}</div></div>
      <div class="choice-block"><h2>Individual or teams?</h2><div class="choice-grid">
        ${ch(!s.teamsOn, 'teams', '0', 'Individual', 'Each player stands alone.', true)}
        ${ch(s.teamsOn, 'teams', '1', 'Teams', canTeams ? 'Pair up · totals stay together.' : 'Needs 4+ players.', true)}</div></div>
      <button class="cta" data-act="setup-next" data-to="${s.teamsOn ? 'setup-teams' : 'setup-order'}">${s.teamsOn ? 'Next: assign teams' : 'Next: turn order'}</button></div></div>`;
  };

  V['setup-teams'] = () => {
    document.body.className = 'cream';
    const s = S.setup; const ps = setupPlayers(); const P = (id) => ps.find((p) => p.id === id);
    const boards = s.teams.map((t) => `<div class="team-board" style="--team:${t.color}">
      <div class="team-top">${S.renaming === t.id ? `<input class="team-name-input" data-teamname="${t.id}" value="${esc(t.name)}" maxlength="20">` : `<div class="team-name">${esc(t.name)}</div>`}
        <div class="team-edit" data-act="rename" data-t="${t.id}">${S.renaming === t.id ? 'Done' : 'Rename'}</div></div>
      ${t.members.map((m) => `<div class="slot ${S.swapPick === m ? 'picked' : ''}">${av(P(m), 'sm')}<div style="font-weight:800">${esc(P(m).name)}</div><div class="swap" data-act="swap" data-p="${m}">${S.swapPick === m ? 'Cancel' : S.swapPick ? 'Swap here' : 'Swap'}</div></div>`).join('')}
    </div>`).join('');
    return `<div class="phone cream-bg">${setupTop(2)}
      <h1>Pick your teams</h1><p class="lead">${S.swapPick ? 'Now tap the player to trade places with.' : 'Teams of two. Tap swap to move someone, or rename a side.'}</p>
      ${boards}
      <a class="auto-split" data-act="autosplit">Auto-split the table</a>
      <button class="cta" data-act="setup-next" data-to="setup-order">Next: turn order</button></div></div>`;
  };

  V['setup-order'] = () => {
    document.body.className = 'cream';
    const s = S.setup; const ps = setupPlayers(); const P = (id) => ps.find((p) => p.id === id);
    const teamName = (id) => { const t = s.teams.find((x) => x.members.includes(id)); return t ? t.name : ''; };
    const rows = s.order.map((id, i) => `<div class="order-row" data-row="${i}">
      <div class="handle" data-drag="${i}" aria-hidden="true"><i></i><i></i><i></i></div><div class="ord">${i + 1}</div>
      <div class="who">${av(P(id), 'sm')}<div>${esc(P(id).name)}${s.teamsOn ? `<span class="team-tag">${esc(teamName(id))}</span>` : ''}</div></div>
      <div class="arrows"><b class="${i === 0 ? 'off' : ''}" data-act="mv" data-i="${i}" data-d="-1" aria-label="Move up">▴</b><b class="${i === s.order.length - 1 ? 'off' : ''}" data-act="mv" data-i="${i}" data-d="1" aria-label="Move down">▾</b></div></div>`).join('');
    return `<div class="phone cream-bg">${setupTop(3)}
      <div class="order-toolbar"><h1 style="margin:0">Who goes when?</h1><div class="shuffle" data-act="shuffle">Shuffle</div></div>
      <p class="lead">Drag the handles or use the arrows. This is the order for every round.</p>
      <div id="orderlist">${rows}</div>
      ${S.err ? `<div class="err-msg">${esc(S.err)}</div>` : ''}
      <button class="cta" data-act="start" ${S.busy ? 'disabled' : ''}>${S.busy ? 'Starting…' : 'Start the game'}</button>
      <p class="note">${s.entry === 'keeper' ? 'This phone keeps score. Everyone else can watch live with the room code.' : 'Everyone joins with the room code and taps their own roll.'}</p></div></div>`;
  };

  V.waiting = () => {
    document.body.className = 'felt';
    const g = S.game;
    return `<div class="phone felt-bg wait-screen is-playing">${sbar}<div class="rays"></div>
      <div class="wait-body"><div class="hero-dice"><div class="floater d1">${die(5)}</div><div class="floater d2">${die(6, 'die-red center')}</div><div class="floater d3">${die(3)}</div></div>
      <div class="lockup on-felt"><span class="bunco" style="font-size:48px">BUNCO</span><span class="together" style="font-size:38px">Together</span></div>
      <h2>${g.hostName ? esc(g.hostName) + ' is' : 'The host is'} setting up the table…</h2>
      <p>Hang tight. This screen moves on by itself when the game starts.</p>
      <div class="room"><div><div class="kicker">Room code</div><div class="code">${fmtCode(g.code)}</div></div><div class="share" data-act="share">Share</div></div>
      <button class="link-btn" style="color:rgba(246,239,226,.75)" data-act="home">Leave</button></div></div>`;
  };

  V.pick = () => {
    document.body.className = 'cream';
    const g = S.game; const sel = S.pickSel || (S.pickSel = new Set(myClaims()));
    const rows = g.players.map((p) => { const t = g.settings.teams ? (g.teams || []).find((x) => x.members.includes(p.id)) : null;
      return `<div class="pick-row ${sel.has(p.id) ? 'on' : ''}" data-act="pickp" data-p="${p.id}">${av(p, 'sm')}<div class="nm">${esc(p.name)}${t ? `<div class="tagline2">${esc(t.name)}</div>` : ''}</div><div class="tick">${sel.has(p.id) ? '✓' : ''}</div></div>`; }).join('');
    return `<div class="phone cream-bg">${sbar}
      <div class="topbar"><div class="back" data-act="pick-skip">‹</div><div class="chip">${E.modeName(g.settings.mode)} · ${fmtCode(g.code)}</div><div style="width:36px"></div></div>
      <div class="setup"><h1>Who\u2019s on this phone?</h1><p class="lead">${g.settings.entry === 'keeper' ? 'One scorekeeper is entering scores. Pick yourself so your row stands out.' : 'Tap your name. If two of you share a phone, tap both.'}</p>
      ${rows}
      <button class="cta" data-act="pick-done">${sel.size ? 'Let\u2019s roll' : 'Just watching'}</button></div></div>`;
  };

  function prowHTML(p, opts) {
    const c = S.comp, st = c.players[p.id], g = S.game;
    const flash = c.last && c.last.pid === p.id ? 'flash' : '';
    const up = !c.finished && c.currentPid === p.id ? '<span class="up">Up</span>' : '';
    const prog = opts.team ? `${st.round} this round` : `${st.round} / ${c.target} this round`;
    const bar = opts.team ? '' : `<span class="rb"><i style="width:${Math.min(100, (st.round / c.target) * 100)}%"></i></span>`;
    return `<div class="prow ${flash}" data-act="card" data-p="${p.id}" style="${flash ? `--sarah:${p.color}` : ''}">
      <div class="who">${av(p, 'sm')}<div><div class="nm">${esc(p.name)}${up}${myClaims().includes(p.id) ? ' <span style="font-size:10px;color:var(--ink-faint)">(you)</span>' : ''}</div><div class="round-pts">${prog}${bar}</div></div></div>
      <div class="stat">${st.points}</div><div><div class="stat">${st.won.length}</div>${wonBadges(st.won)}</div><div class="stat">${st.mini}</div><div class="stat">${st.bunco}</div></div>`;
  }

  function lastPlayHTML() {
    const c = S.comp, g = S.game, e = c.last;
    if (!e) { const p = pById(c.currentPid); return `<div class="last-play"><span class="dot" style="background:var(--gold-bright);box-shadow:0 0 0 4px rgba(240,193,75,.25)"></span><span>Fresh table · <em>${esc(p ? p.name : '')}</em> rolls first</span></div>`; }
    const p = pById(e.pid); const team = e.tid ? tById(e.tid) : null;
    const what = e.kind === 'none' ? 'rolled <em>nothing</em>' : e.kind === 'mini' ? 'rolled a <em>Mini Bunco</em>' : e.kind === 'bunco' ? 'rolled a <em>BUNCO!</em>' : `just rolled <em>${e.value}</em>`;
    let tail;
    if (e.cleared) tail = `${team ? esc(team.name) + ' take' : 'takes'} the ${e.number}s!`;
    else tail = team ? `${esc(team.name)} now ${e.prog} of ${c.target}` : `now ${e.prog} of ${c.target} this round`;
    return `<div class="last-play"><span class="dot" style="background:${p.color};box-shadow:0 0 0 4px ${p.color}40"></span><span>${esc(p.name)} ${what} · ${tail}</span></div>`;
  }

  V.table = () => {
    document.body.className = 'felt';
    const g = S.game, c = S.comp;
    if (g.status === 'setup') return V.hostWait();
    const teamsOn = g.settings.teams;
    const kicker = `The table${teamsOn ? ' · Teams' : ''} · ${c.finished ? 'Final' : `Round ${c.roundIdx + 1} of 12`}`;
    const units = teamsOn ? g.teams : g.players;
    const unitStats = (id) => (teamsOn ? c.teams[id] : c.players[id]);
    const nameOf = (id) => (teamsOn ? tById(id).name : pById(id).name);
    const list = units.map((u) => unitStats(u.id));
    let rows;
    if (!teamsOn) rows = `<div class="cols"><span>Player</span><span>Points</span><span>Won</span><span>Mini</span><span>Bunco</span></div>${c.order.map((id) => prowHTML(pById(id), {})).join('')}`;
    else rows = `<div class="tcols"><span>Player</span><span>Points</span><span>Won</span><span>Mini</span><span>Bunco</span></div>` + g.teams.map((t) => { const ts = c.teams[t.id];
      return `<div class="tcard" style="--team:${t.color}"><div class="thead"><div class="tn">${esc(t.name)}</div><div class="tstats"><div><b>${ts.round}/${c.target}</b><em>Round</em></div><div><b>${ts.points}</b><em>Points</em></div><div><b>${ts.won.length}</b><em>Won</em></div></div></div>
        ${t.members.map((m) => prowHTML(pById(m), { team: true })).join('')}</div>`; }).join('');
    const cur = pById(c.currentPid);
    let cta;
    if (c.finished) cta = `<button class="next-cta" data-act="go" data-view="results">See the final results</button>`;
    else if (canEnterFor(c.currentPid)) cta = `<button class="next-cta ${myClaims().includes(c.currentPid) ? 'mine' : ''}" data-act="go" data-view="turn">${myClaims().includes(c.currentPid) && !isHost() ? 'Your roll! Enter it' : `Enter ${esc(poss(cur.name))} roll`}</button>`;
    else cta = `<button class="next-cta waiting" disabled>${g.settings.entry === 'keeper' ? `Scorekeeper is logging ${esc(poss(cur.name))} roll…` : `Waiting for ${esc(poss(cur.name))} roll…`}</button>`;
    const last = g.log[g.log.length - 1];
    const undo = last && (isHost() || last.cid === cid) ? `<button class="undo-link" data-act="undo">Undo last entry</button>` : '';
    const me = myClaims().map((id) => pById(id)).filter(Boolean).map((p) => p.name).join(' & ');
    return `<div class="phone felt-bg">${sbar}<div class="table-wrap">
      <div class="table-head"><div class="kicker">${kicker}</div><h1>${c.finished ? 'That\u2019s the game!' : `Rolling for ${E.word(c.number)}`}</h1></div>
      ${track('round')}
      <div class="roomline"><button class="roompill" data-act="sharesheet">Room <b>${fmtCode(g.code)}</b> · Invite</button>
        ${S.conn ? '' : '<span class="roompill off" id="connpill">Reconnecting…</span>'}
        ${isHost() ? '<span class="roompill me">Host</span>' : `<button class="roompill me" data-act="go" data-view="pick">${me ? 'You: ' + esc(me) : 'Watching'} ›</button>`}</div>
      <div class="leads"><div class="lead-chip"><span class="lk">Rounds${teamsOn ? '' : ' lead'}</span><span class="lv">${leadText(list, (x) => x.won.length, nameOf)}</span></div>
        <div class="lead-chip"><span class="lk">Points lead</span><span class="lv">${leadText(list, (x) => x.points, nameOf)}</span></div></div>
      ${lastPlayHTML()}
      ${rows}
      <div class="table-actions"><div class="jump"><div class="lbl">Player cards</div><div class="avs">${c.order.map((id) => av(pById(id), 'sm', `data-act="card" data-p="${id}"`)).join('')}</div></div>${cta}</div>
      ${undo}</div></div>`;
  };
  V.hostWait = () => `<div class="phone felt-bg">${sbar}<div class="wait-body"><h2>Finishing setup…</h2></div></div>`;

  V.turn = () => {
    document.body.className = 'cream';
    const g = S.game, c = S.comp;
    if (c.finished || !canEnterFor(c.currentPid)) { S.view = 'table'; return V.table(); }
    const p = pById(c.currentPid); const T = c.target;
    const prog = roundProgOf(p.id);
    const team = g.settings.teams ? tById(c.teamOf[p.id]) : null;
    const nums = Array.from({ length: T === 21 ? 20 : 10 }, (_, i) => `<button data-act="pts" data-v="${i + 1}">${i + 1}</button>`).join('');
    return `<div class="phone cream-bg" id="turn">${sbar}
      <div class="round-head"><div class="round-kicker">Round ${c.roundIdx + 1} of 12 · ${E.modeName(g.settings.mode)}</div><h1>Rolling for ${E.word(c.number)}</h1>${track('round')}</div>
      <div class="whose">${av(p)}<div class="meta"><div class="who">${esc(poss(p.name))} roll</div><div class="sub">${team ? `For ${esc(team.name)} · one tap` : 'One tap to log it'}</div></div>
        <div class="prog"><b>${prog} / ${T}</b><div class="bar"><span style="width:${Math.min(100, (prog / T) * 100)}%"></span></div></div></div>
      <div class="entry"><button class="nothing" data-act="none">Nothing</button>
        <div class="nums ${T === 10 ? 'flash10' : ''}">${nums}</div>
        ${T === 21 ? '<div class="n21-wrap"><button data-act="pts" data-v="21">21</button></div>' : ''}
        <div class="specials"><button class="btn-mini" data-act="mini"><span class="lbl">Mini Bunco</span><span class="pts">worth 5</span></button>
          <button class="btn-bunco" data-act="bunco"><span class="lbl">Bunco</span><span class="pts">worth 21</span></button></div>
        <a class="view-table" data-act="go" data-view="table">View the table</a></div></div>`;
  };

  function rankChip(list, key, id, label) {
    const v = key(list.find((x) => x.id === id));
    const better = list.filter((x) => key(x) > v).length;
    const tied = list.filter((x) => key(x) === v).length > 1;
    if (v === 0 && better === 0) return '';
    if (better === 0) return tied ? `Tied for ${label} lead` : `Leading ${label}`;
    const ord = ['1st', '2nd', '3rd'][better] || better + 1 + 'th';
    return `${tied ? 'T-' : ''}${ord} in ${label}`;
  }
  V.card = () => {
    document.body.className = 'cream';
    const g = S.game, c = S.comp;
    const p = pById(S.cardPid) || g.players[0]; const st = c.players[p.id];
    const team = g.settings.teams ? tById(c.teamOf[p.id]) : null;
    const prog = roundProgOf(p.id);
    const ps = g.players.map((x) => c.players[x.id]);
    const ch1 = rankChip(ps, (x) => x.won.length, p.id, 'rounds'), ch2 = rankChip(ps, (x) => x.points, p.id, 'points');
    const wonList = st.won.map((i) => E.ROUNDS[i] + 's');
    const caption = wonList.length ? `Won the ${wonList.length > 1 ? wonList.slice(0, -1).join(', ') + ' and ' + wonList[wonList.length - 1] : wonList[0]}` : 'No rounds won yet';
    return `<div class="phone cream-bg" id="card">${sbar}<div class="card-screen">
      <div class="topbar"><div class="back" data-act="go" data-view="table">‹</div><div class="chip" data-act="go" data-view="table">The table</div><div style="width:36px"></div></div>
      <div class="portrait">${av(p, 'lg')}<h1>${esc(p.name)}</h1><div class="role">${team ? esc(team.name) : 'Player ' + (g.players.indexOf(p) + 1)} · ${E.modeName(g.settings.mode)}${!c.finished && c.currentPid === p.id ? ' · rolling now' : ''}</div>
        <div class="stand-chips">${ch1 ? `<span>${ch1}</span>` : ''}${ch2 ? `<span class="alt">${ch2}</span>` : ''}${!ch1 && !ch2 ? '<span>Just getting started</span>' : ''}</div></div>
      <div class="big-score"><div class="k pts">Points</div><div class="v">${st.points}</div>
        ${c.finished ? '<div class="this-round"><span>Game over</span><span>12 rounds</span></div>' : `<div class="this-round"><span>This round · ${E.word(c.number)}${team ? ' (team)' : ''}</span><span>${prog} / ${c.target}</span></div><div class="bar" style="margin-top:8px"><span style="width:${Math.min(100, (prog / c.target) * 100)}%"></span></div>`}</div>
      <div class="stat-grid"><div class="stat-tile"><div class="k">Rounds won</div><div class="v">${st.won.length}</div><div class="extra won-badges">${st.won.map((i) => `<b>${E.ROUNDS[i]}s</b>`).join('')}</div></div>
        <div class="stat-tile"><div class="k">Mini Bunco</div><div class="v">${st.mini}</div></div><div class="stat-tile"><div class="k">Bunco</div><div class="v">${st.bunco}</div></div></div>
      <div class="levels"><div class="k">Rounds this game${team ? ' · team' : ''}</div>${track('card', p.id)}<div class="caption">${team ? `${esc(team.name)}: ${c.teams[team.id].won.length} won · ` : ''}${caption}</div></div>
      <div class="card-more">${g.players.map((x) => av(x, 'sm' + (x.id === p.id ? ' cur' : ''), `data-act="card" data-p="${x.id}" aria-label="${esc(x.name)}"`)).join('')}</div>
    </div></div>`;
  };

  function awardHTML(cls, cat, a, unit, isTeam) {
    const units = a.ids.map((id) => (isTeam ? tById(id) : pById(id))).filter(Boolean);
    let face, who;
    if (!units.length) { face = `<div class="avatar sm" style="background:var(--cream-deep);color:var(--ink-faint);margin:0 auto 6px">–</div>`; who = `<div class="who small">Nobody this time</div><div class="num none">0</div>`; }
    else {
      face = units.length === 1 ? av(units[0], 'sm') : `<div class="avs-tie">${units.slice(0, 4).map((u) => av(u, 'sm')).join('')}</div>`;
      const names = units.map((u) => u.name);
      who = `<div class="who ${units.length > 1 ? 'small' : ''}">${units.length > 1 ? 'Tie · ' : ''}${esc(names.length > 3 ? names.slice(0, 3).join(', ') + ' +' + (names.length - 3) : names.join(' & '))}</div><div class="num">${a.value}</div>`;
    }
    const u = a.value === 1 ? { rounds: 'round', points: 'point', buncos: 'bunco', minis: 'mini' }[unit] : unit;
    return `<div class="award ${cls}"><div class="cat">${cat}</div>${face}${who}<div class="unit">${u}</div></div>`;
  }
  V.results = () => {
    document.body.className = 'cream';
    const g = S.game, c = S.comp;
    if (!c.finished) { S.view = 'table'; return V.table(); }
    const A = c.awards; const T = g.settings.teams;
    const winCls = (id, isTeamRow) => {
      const out = [];
      if (A.rounds.ids.includes(id) && (A.rounds.team === !!isTeamRow)) out.push('win-rounds');
      if (A.points.ids.includes(id) && (A.points.team === !!isTeamRow)) out.push('win-points');
      if (!isTeamRow && A.buncos.ids.includes(id)) out.push('win-bunco');
      if (!isTeamRow && A.minis.ids.includes(id)) out.push('win-mini');
      return out.join(' ');
    };
    const sortFn = (a, b) => b.won.length - a.won.length || b.points - a.points;
    const pRows = g.players.map((p) => c.players[p.id]).sort(sortFn).map((s) => { const p = pById(s.id);
      return `<div class="frow ${winCls(p.id, false)}"><div class="who">${av(p, 'sm')}${esc(p.name)}</div><div class="n n-rounds">${s.won.length}</div><div class="n n-points">${s.points}</div><div class="n n-bunco">${s.bunco}</div><div class="n n-mini">${s.mini}</div></div>`; }).join('');
    const tRows = T ? g.teams.map((t) => c.teams[t.id]).sort(sortFn).map((s) => { const t = tById(s.id);
      return `<div class="frow ${winCls(t.id, true)}"><div class="who"><span class="swatch" style="background:${t.color}"></span>${esc(t.name)}</div><div class="n n-rounds">${s.won.length}</div><div class="n n-points">${s.points}</div><div class="n n-bunco">${s.bunco}</div><div class="n n-mini">${s.mini}</div></div>`; }).join('') : '';
    const head = '<div class="fh"><span>Standings</span><span>Won</span><span>Points</span><span>Bunco</span><span>Mini</span></div>';
    return `<div class="phone is-playing" id="results">${sbar}
      <div class="confetti">${confetti(26, g.gameNo * 7 + 1)}</div><div class="sparkles">${sparks([1, 2, 5, 7])}</div>
      <div class="results"><div class="results-head"><div class="kicker">${E.modeName(g.settings.mode)} · 12 rounds${T ? ' · Teams' : ''}</div><h1>That\u2019s a wrap!</h1><p>Four ways to win — and four winners.</p></div>
        <div class="awards">${awardHTML('rounds', 'Most rounds won', A.rounds, 'rounds', T)}${awardHTML('points', 'Most points', A.points, 'points', T)}${awardHTML('buncos', 'Most buncos', A.buncos, 'buncos', false)}${awardHTML('minis', 'Most mini buncos', A.minis, 'minis', false)}</div>
        ${T ? `<div class="final-table"><div class="sec">Teams</div>${head}${tRows}</div>` : ''}
        <div class="final-table">${T ? '<div class="sec">Players</div>' : ''}${head}${pRows}</div>
        ${isHost() ? '<button class="cta rematch" data-act="rematch">Rematch</button>' : '<p class="note">The host can start a rematch, and it\u2019ll show up here.</p>'}
        <button class="link-btn" data-act="go" data-view="table">See the table</button>
        <button class="link-btn" data-act="newgame">New game</button></div></div>`;
  };

  // ---------- render + events ----------
  function render() {
    const app = $('#app');
    const fn = V[S.view] || V.home;
    if (!S.game && !['home', 'join'].includes(S.view) && !S.view.startsWith('setup')) {
      app.innerHTML = `<div class="phone felt-bg">${sbar}<div class="wait-body"><div class="lockup on-felt"><span class="bunco" style="font-size:44px">BUNCO</span><span class="together" style="font-size:34px">Together</span></div><h2>Finding your table…</h2><p>If the app was asleep this can take up to 30 seconds.</p></div></div>`;
      document.body.className = 'felt';
      return;
    }
    app.innerHTML = fn();
    if (S.view === 'setup-order') bindDrag();
    if (S.view === 'join') { const i = $('#codein'); if (i) { const pre = S.prefillCode; if (pre) i.value = pre; i.focus(); } }
    if (S.view === 'setup-teams' && S.renaming) { const i = $('.team-name-input'); if (i) { i.focus(); i.select(); } }
  }

  const ACT = {
    go: (t) => go(t.dataset.view),
    home: () => { leaveGame(); go('home'); },
    mode: (t) => { S.setup = newSetup(t.dataset.mode); saveSetup(); go('setup-players'); ensureRoom(); },
    'resume-setup': () => { S.setup = store.get('bt.setup'); go('setup-players'); ensureRoom(); },
    resume: (t) => { openGame(t.dataset.code); render(); },
    n: (t) => { const s = S.setup; s.n = Math.max(2, Math.min(12, s.n + Number(t.dataset.d))); while (s.names.length < s.n) s.names.push(''); if (s.n < 4) s.teamsOn = false; saveSetup(); render(); },
    'setup-back': () => {
      const order = ['setup-players', 'setup-options', 'setup-teams', 'setup-order'];
      let i = order.indexOf(S.view) - 1; if (order[i] === 'setup-teams' && !S.setup.teamsOn) i--;
      S.swapPick = null; S.renaming = null;
      if (i < 0) go('home'); else go(order[i]);
    },
    'setup-next': (t) => {
      const to = t.dataset.to;
      if (S.view === 'setup-players') {
        const names = S.setup.names.slice(0, S.setup.n).map((x) => (x || '').trim().toLowerCase()).filter(Boolean);
        if (new Set(names).size !== names.length) { toast('Two players have the same name, add an initial'); return; }
      }
      if (to === 'setup-teams' && (!S.setup.teams.length || S.setup.teams.reduce((a, t2) => a + t2.members.length, 0) !== S.setup.n)) autoSplit(false);
      if (to === 'setup-order') syncOrder();
      S.swapPick = null; S.renaming = null; saveSetup(); go(to);
    },
    entry: (t) => { S.setup.entry = t.dataset.v; saveSetup(); render(); },
    teams: (t) => { if (t.dataset.v === '1' && S.setup.n < 4) { toast('Teams need at least 4 players'); return; } S.setup.teamsOn = t.dataset.v === '1'; S.setup.order = []; saveSetup(); render(); },
    rename: (t) => {
      if (S.renaming === t.dataset.t) { const i = $('.team-name-input'); const tm = S.setup.teams.find((x) => x.id === S.renaming); if (i && tm) tm.name = i.value.trim() || tm.name; S.renaming = null; }
      else S.renaming = t.dataset.t;
      saveSetup(); render();
    },
    swap: (t) => {
      const id = t.dataset.p;
      if (!S.swapPick || S.swapPick === id) { S.swapPick = S.swapPick === id ? null : id; render(); return; }
      const teams = S.setup.teams; const ta = teams.find((x) => x.members.includes(S.swapPick)), tb = teams.find((x) => x.members.includes(id));
      if (ta === tb) { S.swapPick = id; render(); return; }
      ta.members[ta.members.indexOf(S.swapPick)] = id; tb.members[tb.members.indexOf(id)] = S.swapPick;
      S.swapPick = null; S.setup.order = []; saveSetup(); render();
    },
    autosplit: () => { autoSplit(true); S.setup.order = []; S.swapPick = null; saveSetup(); render(); },
    mv: (t) => { const i = Number(t.dataset.i), j = i + Number(t.dataset.d), o = S.setup.order; if (j < 0 || j >= o.length) return; [o[i], o[j]] = [o[j], o[i]]; saveSetup(); render(); },
    shuffle: () => { shuffleArr(S.setup.order); saveSetup(); render(); },
    start: () => startGame(),
    'share-setup': () => share(S.setup.code),
    share: () => share(S.code || (S.setup && S.setup.code)),
    sharesheet: () => shareSheet(false),
    'sheet-close': () => closeSheet(),
    join: () => {
      const v = ($('#codein').value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (v.length !== 6) { S.err = 'Room codes are 6 letters and numbers.'; render(); $('#codein').value = v; return; }
      S.prefillCode = null; openGame(v); render();
    },
    pickp: (t) => { const s = S.pickSel; const id = t.dataset.p; if (s.has(id)) s.delete(id); else s.add(id); render(); },
    'pick-skip': () => { setSess(S.code, { picked: true }); S.pickSel = null; go(S.game.status === 'finished' ? 'results' : 'table'); },
    'pick-done': () => { const claims = [...(S.pickSel || [])]; setSess(S.code, { claims, picked: true }); S.pickSel = null; go(S.game.status === 'finished' ? 'results' : 'table'); },
    card: (t) => go('card', { pid: t.dataset.p }),
    none: () => enter('none', 0),
    pts: (t) => enter('pts', Number(t.dataset.v)),
    mini: () => enter('mini', 0),
    bunco: () => enter('bunco', 0),
    undo: () => confirmUndo(),
    'undo-yes': () => undo(),
    rematch: () => rematch(),
    newgame: () => { leaveGame(); go('home'); },
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    e.preventDefault();
    const fn = ACT[t.dataset.act]; if (fn) fn(t, e);
  });
  document.addEventListener('input', (e) => {
    const i = e.target;
    if (i.dataset && i.dataset.name != null && S.setup) {
      S.setup.names[Number(i.dataset.name)] = i.value; saveSetup();
      const a = i.closest('.name-row').querySelector('.avatar'); if (a) a.textContent = initial(i.value || String(Number(i.dataset.name) + 1));
    }
    if (i.id === 'codein') { const pos = i.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); if (i.value !== pos) i.value = pos; }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const i = e.target;
    if (i.id === 'codein') ACT.join();
    if (i.dataset && i.dataset.name != null) { const nx = document.querySelector(`[data-name="${Number(i.dataset.name) + 1}"]`); if (nx) nx.focus(); else i.blur(); }
    if (i.classList && i.classList.contains('team-name-input')) ACT.rename({ dataset: { t: i.dataset.teamname } });
  });

  // Drag to reorder (turn order screen)
  function bindDrag() {
    const list = $('#orderlist'); if (!list) return;
    list.querySelectorAll('[data-drag]').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const row = h.closest('.order-row'); const from = Number(h.dataset.drag);
        const rowH = row.getBoundingClientRect().height + 8; const y0 = e.clientY;
        row.classList.add('dragging'); h.setPointerCapture(e.pointerId);
        const move = (ev) => { row.style.transform = `translateY(${ev.clientY - y0}px)`; };
        const up = (ev) => {
          h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
          const o = S.setup.order; const to = Math.max(0, Math.min(o.length - 1, from + Math.round((ev.clientY - y0) / rowH)));
          const [x] = o.splice(from, 1); o.splice(to, 0, x); saveSetup(); render();
        };
        h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
      });
    });
  }

  // ---------- boot ----------
  function boot() {
    const m = location.pathname.match(/^\/(?:g|j)\/([A-Za-z0-9]{6})/);
    const q = new URLSearchParams(location.search);
    if (m) { openGame(m[1].toUpperCase()); render(); }
    else if (location.pathname === '/join') { S.view = 'join'; S.prefillCode = (q.get('code') || '').toUpperCase(); render(); }
    else { S.view = 'home'; render(); }
    const splash = $('#splash');
    const seen = sessionStorage.getItem('bt.splash');
    const fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    fonts.then(() => setTimeout(() => { splash.classList.add('gone'); setTimeout(() => splash.remove(), 600); }, seen ? 250 : 1700));
    sessionStorage.setItem('bt.splash', '1');
  }
  window.BT = { S, ACT, render }; // handy for testing
  boot();
})();
