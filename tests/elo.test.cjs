const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../elo.js');
const S = require('../league-stats.js');

const profiles = Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { id, displayName: id }]));
const one = (pair, s, extra = {}) => ({ profiles, currentSeason: 1, rounds: [{ m: [pair] }], results: { r0m0: s }, ...extra });

test('expected score is symmetric and 0.5 for equal ratings', () => {
  assert.equal(E.expected(1000, 1000), 0.5);
  assert.ok(Math.abs(E.expected(1200, 1000) + E.expected(1000, 1200) - 1) < 1e-12);
  assert.ok(Math.abs(E.expected(1400, 1000) - 10 / 11) < 1e-12);
});

test('handicapHint: 1 point per 50 rating, capped 0..6', () => {
  assert.equal(E.handicapHint(1000, 1000), 0);
  assert.equal(E.handicapHint(1100, 1000), 2);
  assert.equal(E.handicapHint(1124, 1000), 2);
  assert.equal(E.handicapHint(1126, 1000), 3);
  assert.equal(E.handicapHint(1000, 1200), 0);
  assert.equal(E.handicapHint(1800, 1000), 6);
});

test('one win between new players: K=48 with margin factor', () => {
  const r = E.ratings(one(['a', 'b'], { a: 11, b: 0 }));
  // 48 * 1.25 * 0.5 = 30
  assert.equal(r.a.rating, 1030); assert.equal(r.b.rating, 970);
  assert.equal(r.a.games, 1); assert.equal(r.a.peak, 1030); assert.equal(r.b.peak, 1000);
  assert.equal(r.a.w, 1); assert.equal(r.b.l, 1); assert.equal(r.a.last, 30);
  assert.deepEqual(r.a.history.map(h => h.rating), [1030]);
  const close = E.ratings(one(['a', 'b'], { a: 11, b: 9 }));
  assert.equal(close.a.rating, 1000 + Math.round(48 * (1 + 0.25 * 2 / 11) * 0.5));
});

test('draw between equals changes nothing; ratings are zero-sum', () => {
  const r = E.ratings(one(['a', 'b'], { a: 2, b: 2 }));
  assert.equal(r.a.rating, 1000); assert.equal(r.b.rating, 1000); assert.equal(r.a.d, 1);
  const l = { profiles, currentSeason: 1, rounds: [{ m: [['a', 'b'], ['c', 'd']] }, { m: [['a', 'c'], ['b', 'd']] }, { m: [['a', 'd'], ['b', 'c']] }],
    results: { r0m0: { a: 3, b: 1 }, r0m1: { a: 0, b: 3 }, r1m0: { a: 2, b: 3 }, r1m1: { a: 3, b: 2 }, r2m0: { a: 3, b: 0 }, r2m1: { a: 1, b: 1 } } };
  const t = E.ratings(l), sum = Object.values(t).reduce((s, p) => s + p.rating, 0);
  assert.ok(Math.abs(sum - 4000) <= 2, `sum ${sum}`);
});

test('K drops from 48 to 32 after 10 games', () => {
  const rounds = [], results = {};
  for (let i = 0; i < 11; i++) { rounds.push({ m: [['a', 'b']] }); results[`r${i}m0`] = { a: 1, b: 1 }; }
  const r = E.ratings({ profiles, currentSeason: 1, rounds, results: { ...results, r10m0: { a: 1, b: 0 } } });
  // after 10 draws both are 1000; the 11th game is a win at K=32 with margin x1.25 -> +20
  assert.equal(r.a.rating, 1020); assert.equal(r.a.games, 11);
});

test('unfinished and invalid matches are ignored', () => {
  const r = E.ratings({ profiles, currentSeason: 1, rounds: [{ m: [['a', 'b'], ['c', 'd']] }], results: { r0m0: { a: null, b: 3 }, r0m1: { a: -1, b: 2 } } });
  assert.deepEqual(r, {});
  assert.equal(E.rating(r, 'a'), 1000);
  assert.deepEqual(E.ratings(null, null), {});
});

test('order: archived seasons, club matches up to each season end, current season, then later club matches', () => {
  const league = {
    profiles, currentSeason: 2,
    seasonArchives: [{ season: 1, rounds: [{ m: [['a', 'b']] }], results: { r0m0: { a: 3, b: 0 } } }],
    rankHistory: [{ season: 1, finishedAt: '2026-10-01T00:00:00.000Z', standings: [] }],
    rounds: [{ m: [['c', 'd']] }], results: { r0m0: { a: 3, b: 1 } }
  };
  const club = { matches: [
    { id: 'late', kind: 'challenge', format: 'singles', a: 'b', b: 'c', s: { a: 11, b: 4 }, at: '2026-10-10T00:00:00.000Z' },
    { id: 'early', kind: 'challenge', format: 'singles', a: 'a', b: 'c', s: { a: 11, b: 8 }, at: '2026-09-20T00:00:00.000Z' },
    { id: 'none', kind: 'challenge', format: 'singles', a: 'a', b: 'd', s: null, at: '2026-09-21T00:00:00.000Z' }
  ] };
  const t = E.timeline(league, club);
  assert.deepEqual(t.map(m => `${m.src}:${m.id}`), ['league:r0m0', 'club:early', 'league:r0m0', 'club:late']);
  assert.deepEqual(t.map(m => m.season || 0), [1, 0, 2, 0]);
  const r = E.ratings(league, club);
  assert.equal(r.b.games, 2); assert.equal(r.c.games, 3);
  assert.equal(r.c.history[0].at, '2026-09-20T00:00:00.000Z');
  // without finishedAt every club match goes after the league
  const t2 = E.timeline({ ...league, rankHistory: [] }, club);
  assert.deepEqual(t2.map(m => m.id), ['r0m0', 'r0m0', 'early', 'late']);
});

test('club matches change Elo but never league standings data', () => {
  const league = one(['a', 'b'], { a: 3, b: 0 });
  const before = JSON.stringify(league);
  const r = E.ratings(league, { matches: [{ id: 'x', kind: 'challenge', format: 'singles', a: 'b', b: 'a', s: { a: 3, b: 0 }, at: '2026-10-19T00:00:00Z' }] });
  assert.equal(r.a.games, 2); assert.ok(r.b.rating > 970);
  assert.equal(JSON.stringify(league), before);
  assert.equal(S.matches(league).length, 1);
});

test('doubles update each player from the team average and do not crash on junk', () => {
  const club = { matches: [
    { id: 'd1', kind: 'challenge', format: 'doubles', a: ['a', 'b'], b: ['c', 'd'], s: { a: 11, b: 0 }, at: '2026-10-19T01:00:00Z' },
    { id: 'bad1', format: 'doubles', a: ['a'], b: ['c', 'd'], s: { a: 11, b: 5 } },
    { id: 'bad2', format: 'doubles', a: ['a', 'c'], b: ['c', 'd'], s: { a: 11, b: 5 } },
    { id: 'bad3', format: 'singles', a: 'a', b: 'a', s: { a: 11, b: 5 } },
    { id: 'bad4', a: null, b: 'c', s: { a: 1, b: 0 } }, null, 7
  ] };
  const r = E.ratings({ profiles }, club);
  assert.deepEqual(Object.keys(r).sort(), ['a', 'b', 'c', 'd']);
  assert.equal(r.a.rating, 1030); assert.equal(r.b.rating, 1030); assert.equal(r.c.rating, 970); assert.equal(r.d.rating, 970);
});

test('top and rankOf sort by rating among active players', () => {
  const r = E.ratings(one(['a', 'b'], { a: 3, b: 1 }));
  assert.deepEqual(E.top(r, 5).map(x => x.id), ['a', 'b']);
  assert.equal(E.rankOf(r, 'b'), 2); assert.equal(E.rankOf(r, 'c'), 0);
  assert.deepEqual(E.top(r, 5, ['b']).map(x => x.id), ['b']);
});

test('LeagueStats.h2h with club matches (default unchanged)', () => {
  const league = one(['a', 'b'], { a: 3, b: 1 });
  const club = { matches: [{ id: 'x', kind: 'challenge', format: 'singles', a: 'b', b: 'a', s: { a: 11, b: 7 }, at: '2026-10-19T00:00:00Z' },
    { id: 'y', kind: 'challenge', format: 'doubles', a: ['a', 'c'], b: ['b', 'd'], s: { a: 11, b: 7 } }] };
  const plain = S.h2h(league, 'a', 'b');
  assert.deepEqual([plain.n, plain.w, plain.l], [1, 1, 0]);
  const h = S.h2h(league, 'a', 'b', club);
  assert.deepEqual([h.n, h.w, h.l, h.pf, h.pa], [2, 1, 1, 10, 12]);
  assert.equal(h.games[0].club, true); assert.deepEqual(h.games[0].score, [7, 11]); assert.equal(h.games[1].season, 1);
});
