/* BUNCO Together game engine: pure functions shared by server and browser. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BuncoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ROUNDS = [1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1];
  const WORDS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  const MINI = 5, BUNCO = 21;
  const target = (mode) => (mode === 'flash' ? 10 : 21);
  const modeName = (mode) => (mode === 'flash' ? 'Flash 10' : 'Classic 21');
  const word = (n) => WORDS[n - 1];
  const entryPoints = (e) => (e.kind === 'none' ? 0 : e.kind === 'mini' ? MINI : e.kind === 'bunco' ? BUNCO : e.value | 0);

  function validEntry(mode, kind, value) {
    if (kind === 'none' || kind === 'mini' || kind === 'bunco') return true;
    if (kind !== 'pts') return false;
    return Number.isInteger(value) && value >= 1 && value <= target(mode);
  }

  // Replay the log and derive everything the screens need.
  function compute(game) {
    const { players, settings, log } = game;
    const order = game.order && game.order.length ? game.order : players.map((p) => p.id);
    const teams = settings.teams ? game.teams || [] : [];
    const T = target(settings.mode);
    const teamOf = {};
    teams.forEach((t) => t.members.forEach((m) => (teamOf[m] = t.id)));
    const blank = (id) => ({ id, points: 0, mini: 0, bunco: 0, won: [], round: 0, rolls: 0 });
    const P = {}, TM = {};
    players.forEach((p) => (P[p.id] = blank(p.id)));
    teams.forEach((t) => (TM[t.id] = blank(t.id)));
    let roundIdx = 0, turn = 0, finished = false;
    const events = [];
    for (const e of log) {
      if (finished || !P[e.pid]) continue;
      const pts = entryPoints(e);
      const p = P[e.pid];
      p.points += pts; p.round += pts; p.rolls++;
      if (e.kind === 'mini') p.mini++;
      if (e.kind === 'bunco') p.bunco++;
      const tm = settings.teams ? TM[teamOf[e.pid]] : null;
      if (tm) { tm.points += pts; tm.round += pts; if (e.kind === 'mini') tm.mini++; if (e.kind === 'bunco') tm.bunco++; }
      const prog = tm ? tm.round : p.round;
      const ev = { seq: e.seq, pid: e.pid, tid: tm ? tm.id : null, kind: e.kind, value: e.value, pts, roundIdx, number: ROUNDS[roundIdx], prog, cleared: false, at: e.at, cid: e.cid };
      if (prog >= T) {
        ev.cleared = true;
        p.won.push(roundIdx);
        if (tm) tm.won.push(roundIdx);
        Object.values(P).forEach((x) => (x.round = 0));
        Object.values(TM).forEach((x) => (x.round = 0));
        roundIdx++;
        if (roundIdx >= ROUNDS.length) finished = true;
        // House rule: whoever wins the round starts the next one (in teams, the player who rolled it).
        const wi = order.indexOf(e.pid);
        turn = wi >= 0 ? wi : (turn + 1) % order.length;
      } else if (e.kind !== 'mini') turn = (turn + 1) % order.length;
      // A Mini Bunco keeps the same player rolling.
      if (e.kind === 'mini' && !ev.cleared) ev.keepRolling = true;
      events.push(ev);
    }
    const units = settings.teams ? teams.map((t) => TM[t.id]) : players.map((p) => P[p.id]);
    return {
      target: T, roundIdx: Math.min(roundIdx, 11), number: ROUNDS[Math.min(roundIdx, 11)], finished,
      currentPid: finished ? null : order[turn], turn, order, players: P, teams: TM, teamOf, units, events,
      last: events[events.length - 1] || null,
      awards: finished ? awards(game, P, TM) : null,
    };
  }

  function best(list, key) {
    let max = 0; list.forEach((x) => (max = Math.max(max, key(x))));
    if (max <= 0) return { value: 0, ids: [] };
    return { value: max, ids: list.filter((x) => key(x) === max).map((x) => x.id) };
  }

  // Four winners. Team mode: rounds and points go to teams, buncos and minis to the player who rolled them.
  function awards(game, P, TM) {
    const ps = game.players.map((p) => P[p.id]);
    const roundsList = game.settings.teams ? Object.values(TM) : ps;
    return {
      rounds: { ...best(roundsList, (x) => x.won.length), team: !!game.settings.teams },
      points: { ...best(roundsList, (x) => x.points), team: !!game.settings.teams },
      buncos: { ...best(ps, (x) => x.bunco), team: false },
      minis: { ...best(ps, (x) => x.mini), team: false },
    };
  }

  // Leaders for the table chips (current standing, ties allowed).
  function leaders(list, key) {
    const b = best(list, key);
    return b;
  }

  return { ROUNDS, WORDS, MINI, BUNCO, target, modeName, word, entryPoints, validEntry, compute, leaders };
});
