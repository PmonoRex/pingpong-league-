const test = require('node:test');
const assert = require('node:assert');
const S = require('../league-stats.js');

const ids = ['a', 'b', 'c'];
const profiles = Object.fromEntries(ids.map(id => [id, { id, displayName: id }]));
// Season 1 archived: a beats b 3-0 and c 3-1, b beats c. a champion. Season 2 current: b beats a, b beats a, b beats a.
const league = {
  profiles, currentSeason: 2,
  seasonArchives: [{ season: 1, rounds: [{ m: [['a', 'b'], ['a', 'c'], ['b', 'c']] }], results: { r0m0: { a: 3, b: 0 }, r0m1: { a: 3, b: 1 }, r0m2: { a: 3, b: 2 } } }],
  rankHistory: [{ season: 1, standings: [{ userId: 'a', rank: 1, rpAward: 30 }, { userId: 'b', rank: 2, rpAward: 20 }, { userId: 'c', rank: 3, rpAward: 10 }] }],
  rounds: [{ m: [['a', 'b']] }, { m: [['b', 'a']] }, { m: [['a', 'b']] }],
  results: { r0m0: { a: 1, b: 3 }, r1m0: { a: 3, b: 2 }, r2m0: { a: 0, b: 3 } }
};

test('matches spans archived and current seasons in order', () => {
  const m = S.matches(league);
  assert.strictEqual(m.length, 6);
  assert.deepStrictEqual(m.map(x => x.season), [1, 1, 1, 2, 2, 2]);
});

test('badges: champion and shutout for a (2 games is too few for unbeaten)', () => {
  const have = S.badges(league, 'a').filter(b => b.have).map(b => b.key);
  assert.deepStrictEqual(have.sort(), ['champ', 'shutout'].sort());
});

test('badges: b gets streak and giant killer (beat last season champion)', () => {
  const list = S.badges(league, 'b'), have = list.filter(b => b.have).map(b => b.key);
  assert.ok(have.includes('streak') && have.includes('giant'));
  assert.strictEqual(list.find(b => b.key === 'streak').value, '4 นัด');
  assert.ok(list.findIndex(b => !b.have) > list.findIndex(b => b.have), 'earned badges come first');
});

test('badges: prediction accuracy needs 5 settled bets', () => {
  const bets = st => st.map(status => ({ userId: 'c', status }));
  assert.ok(!S.badges(league, 'c', { bets: bets(['won', 'won', 'won', 'won']) }).find(b => b.key === 'sharp').have);
  assert.ok(S.badges(league, 'c', { bets: bets(['won', 'won', 'won', 'lost', 'lost']) }).find(b => b.key === 'sharp').have);
});

test('h2h from the first player side', () => {
  const h = S.h2h(league, 'a', 'b');
  assert.deepStrictEqual([h.n, h.w, h.d, h.l, h.pf, h.pa], [4, 1, 0, 3, 6, 9]);
  assert.deepStrictEqual(h.streak, { r: 'L', n: 3 });
  assert.deepStrictEqual(h.games[0].score, [0, 3]);
});

test('wrapped season summary', () => {
  const w = S.wrapped(league, 'a', 1);
  assert.strictEqual(w.w, 2); assert.strictEqual(w.rank, 1); assert.strictEqual(w.rp, 30);
  assert.strictEqual(w.best.o, 'b'); assert.strictEqual(w.victim.o, 'b');
  assert.strictEqual(S.wrapped(league, 'a', 2).nemesis.o, 'b');
  assert.deepStrictEqual(S.seasons(league), [1, 2]);
});
