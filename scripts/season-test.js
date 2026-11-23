const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-season-'));
process.env.SEASON_FILE = path.join(dir, 'season.json');
delete require.cache[require.resolve('../server/season')];
const season = require('../server/season');

assert.equal(season.inSeason(Date.parse('2026-11-26T18:00:00-07:00')), true);
assert.equal(season.inSeason(Date.parse('2026-11-22T12:00:00-07:00')), false);
assert.equal(season.seasonOver(Date.parse('2026-12-26T00:00:00-07:00')), true);
assert.equal(season.seasonOver(Date.parse('2026-12-25T23:00:00-07:00')), false);

const game = (id, names, winner, at) => ({
  id, code: 'ABC123', gameNo: 1, mode: 'flash', endedAt: at,
  players: names.map((name, i) => ({
    name, color: '#1F7A63', points: 40 - i, rounds: 3 - (i ? 1 : 0), bunco: i === 0 ? 2 : 0, mini: 1,
    gameWin: name.trim().toLowerCase() === winner.trim().toLowerCase(),
  })),
});
const tg = Date.parse('2026-11-26T18:00:00-07:00');
const dec = Date.parse('2026-12-05T19:00:00-07:00');
season.mergeSnapshot({ games: [
  game('ABC123:1', ['Justin', 'Sarah'], 'Justin', tg),
  game('DEF456:1', [' justin ', 'Julie'], 'Justin', dec), // same person, messy casing
]});
const st = season.standings(Date.parse('2026-12-10T12:00:00-07:00'));
assert.equal(st.rows.length, 3);
assert.equal(st.rows[0].name, 'Justin', 'keeps the capitalized spelling');
assert.equal(st.rows[0].games, 2, 'names match case-insensitively');
assert.equal(st.rows[0].rounds, 6);
assert.equal(st.champion, null, 'no champion until after Christmas');
const after = season.standings(Date.parse('2026-12-26T00:00:01-07:00'));
assert.equal(after.champion.name.toLowerCase(), 'justin');
// duplicate id should not double-count
season.mergeSnapshot({ games: [game('ABC123:1', ['Justin', 'Sarah'], 'Justin', tg)] });
assert.equal(season.standings(dec).rows[0].games, 2);
console.log('season tests passed');
