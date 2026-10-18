const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const R = require('../predboard-rank.js');

// Bets: helper builds a settled bet (raw status/net) in round order.
let nextId = 1;
const bet = (userId, season, round, status, stake = 10, extra = {}) => ({
  id: nextId++, season, matchId: `r${round}m0`, userId, sideId: 'x', stake, status,
  net: status === 'won' ? stake : status === 'lost' ? -stake : 0, ...extra
});
const series = (userId, season, statuses, stake = 10) => statuses.map((s, i) => bet(userId, season, i, s, stake));
const RAW = { effective: false }; // ignore any BetSettle, read stored fields

const league = { currentSeason: 3, rankHistory: [{ season: 1, standings: [] }, { season: 2, standings: [] }], profiles: {} };

test('stats: hits, hit rate, net, ROI, pushes and void bets', () => {
  const pred = { bets: [...series('a', 3, ['won', 'won', 'lost', 'push', 'won']), bet('a', 3, 9, 'void'), bet('a', 3, 10, 'pending')] };
  const [a] = R.playerStats(league, pred, 3, RAW);
  assert.equal(a.settled, 5);
  assert.equal(a.decided, 4);
  assert.equal(a.hits, 3);
  assert.equal(a.pushes, 1);
  assert.equal(a.pending, 1);
  assert.equal(a.hitRate, 0.75);
  assert.equal(a.net, 20);
  assert.equal(a.stake, 50);
  assert.equal(a.roi, 0.4);
  assert.equal(a.eligible, true);
});

test('streaks: current and best, pushes do not break, order follows season/round not array order', () => {
  const bets = series('a', 3, ['won', 'won', 'won', 'lost', 'won', 'push', 'won']).reverse();
  const [a] = R.playerStats(league, { bets }, R.ALL, RAW);
  assert.equal(a.bestStreak, 3);
  assert.equal(a.streak, 2);
  const [b] = R.playerStats(league, { bets: series('b', 3, ['won', 'lost']) }, R.ALL, RAW);
  assert.equal(b.streak, 0);
  assert.equal(b.bestStreak, 1);
});

test('biggest win is the largest winning net', () => {
  const pred = { bets: [bet('a', 3, 0, 'won', 20), bet('a', 3, 1, 'won', 150), bet('a', 3, 2, 'lost', 500)] };
  const [a] = R.playerStats(league, pred, 3, RAW);
  assert.equal(a.biggestWin.net, 150);
  assert.equal(a.biggestWin.matchId, 'r1m0');
});

test('ranking: net first, then hit rate, then settled count; equal rows share a rank', () => {
  const bets = [
    ...series('lowNet', 3, ['won', 'won', 'won', 'won', 'won']),            // +50
    ...series('bigNet', 3, ['won', 'lost', 'lost', 'lost', 'lost'], 10), bet('bigNet', 3, 9, 'won', 200), // +170
    ...series('rateHi', 3, ['won', 'won', 'won', 'push', 'push', 'push', 'lost', 'lost', 'lost', 'won', 'won', 'lost']).slice(0, 5), // won won won push push = +30, 100%
    ...series('rateLo', 3, ['won', 'won', 'won', 'won', 'lost', 'lost', 'lost']), // +10, 57%
    ...series('rateLo2', 3, ['won', 'won', 'won', 'lost', 'push', 'push']), // +20 75%
    ...series('more', 3, ['won', 'won', 'won', 'push', 'push', 'push']),   // +30, 100%, 6 settled
  ];
  const b = R.board(league, { bets }, 3, RAW);
  assert.deepEqual(b.ranked.map(r => r.id), ['bigNet', 'lowNet', 'more', 'rateHi', 'rateLo2', 'rateLo']);
  assert.deepEqual(b.ranked.map(r => r.rank), [1, 2, 3, 4, 5, 6]);
  const tie = R.board(league, { bets: [...series('p', 3, ['won', 'won', 'won', 'won', 'lost']), ...series('q', 3, ['won', 'won', 'won', 'won', 'lost'])] }, 3, RAW);
  assert.deepEqual(tie.ranked.map(r => r.rank), [1, 1]);
  // Same net (+10): the better hit rate goes first even with fewer wins.
  const rate = R.board(league, { bets: [...series('x', 3, ['won', 'won', 'won', 'won', 'lost', 'lost', 'lost']), ...series('y', 3, ['won', 'push', 'push', 'push', 'push'])] }, 3, RAW);
  assert.deepEqual(rate.ranked.map(r => r.id), ['y', 'x']);
});

test('eligibility: fewer than 5 settled bets are listed apart, unranked', () => {
  const bets = [...series('pro', 3, ['won', 'lost', 'won', 'lost', 'lost']), ...series('new', 3, ['won', 'won', 'won', 'won']), bet('new', 3, 8, 'pending'), bet('wait', 3, 9, 'pending')];
  const b = R.board(league, { bets }, 3, RAW);
  assert.deepEqual(b.ranked.map(r => r.id), ['pro']);
  assert.deepEqual(b.rest.map(r => r.id), ['new', 'wait']);
  assert.equal(b.rest[0].rank, null);
  assert.equal(R.board(league, { bets }, 3, { ...RAW, minSettled: 4 }).ranked.length, 2);
});

test('season vs all-time', () => {
  const bets = [...series('a', 1, ['won', 'won', 'won', 'won', 'won']), ...series('b', 2, ['won', 'won', 'won', 'won', 'won'], 30), ...series('a', 2, ['lost', 'lost'])];
  assert.deepEqual(R.board(league, { bets }, 1, RAW).ranked.map(r => r.id), ['a']);
  assert.deepEqual(R.board(league, { bets }, 2, RAW).ranked.map(r => r.id), ['b']);
  const all = R.board(league, { bets }, R.ALL, RAW);
  assert.deepEqual(all.ranked.map(r => [r.id, r.net, r.settled]), [['b', 150, 5], ['a', 30, 7]]);
  assert.deepEqual(R.seasons(league, { bets }), [3, 2, 1]);
});

test('titles only for finished seasons (in rankHistory), and only to an eligible rank 1', () => {
  const bets = [
    ...series('a', 1, ['won', 'won', 'won', 'won', 'won']),
    ...series('b', 2, ['won', 'won', 'won', 'won']),           // S2: nobody eligible -> no title
    ...series('c', 3, ['won', 'won', 'won', 'won', 'won'], 50)  // S3 still running -> no title yet
  ];
  assert.deepEqual(R.titles(league, { bets }, RAW).map(t => [t.season, t.userId]), [[1, 'a']]);
  assert.deepEqual(R.titlesFor(league, { bets }, 'a', RAW), [1]);
  assert.deepEqual(R.titlesFor(league, { bets }, 'c', RAW), []);
  const done = { ...league, rankHistory: [...league.rankHistory, { season: 3, standings: [] }] };
  assert.deepEqual(R.titlesFor(done, { bets }, 'c', RAW), [3]);
  assert.equal(R.board(league, { bets }, 1, RAW).finished, true);
  assert.equal(R.board(league, { bets }, 3, RAW).finished, false);
});

test('lineFor: all-time line, null without settled bets', () => {
  const bets = [...series('a', 1, ['won', 'lost']), ...series('a', 2, ['won']), bet('z', 3, 0, 'pending')];
  const a = R.lineFor(league, { bets }, 'a', RAW);
  assert.equal(a.hits, 2); assert.equal(a.decided, 3); assert.equal(a.net, 10);
  assert.equal(R.lineFor(league, { bets }, 'z', RAW), null);
  assert.equal(R.lineFor(league, null, 'a', RAW), null);
});

test('custom effective function overrides stored status', () => {
  const bets = series('a', 3, ['won', 'won', 'won', 'won', 'won']);
  const flipped = R.board(league, { bets }, 3, { effective: b => b.id === bets[0].id ? { status: 'lost', net: -10 } : null });
  assert.equal(flipped.ranked[0].hits, 4);
  assert.equal(flipped.ranked[0].net, 30);
});

// With the real page scripts: BetSettle.effective follows an edited score even before the dealer re-settles.
test('BetSettle.effective is respected when loaded (edited score flips a stored win)', () => {
  const store = new Map();
  const context = { localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('shared.js', 'utf8') + '\n' + fs.readFileSync('bet-settle.js', 'utf8') + '\n' + fs.readFileSync('predboard-rank.js', 'utf8').replace('if (typeof module !== "undefined") module.exports = PredRank;', '') + '\nglobalThis.PR = PredRank;', context);
  const L = { currentSeason: 1, profiles: { a: { id: 'a', displayName: 'A' }, b: { id: 'b', displayName: 'B' }, u: { id: 'u', displayName: 'U' } },
    rounds: [{ m: [['a', 'b']] }], results: { r0m0: { a: 1, b: 3 } }, rankHistory: [] };
  // Stored as a win for "a" (score was 3-1 when settled); the score has since been corrected to 1-3.
  const stored = { id: 1, season: 1, matchId: 'r0m0', pair: ['a', 'b'], favoriteId: 'a', handicap: 0, userId: 'u', sideId: 'a', stake: 40, status: 'won', net: 40 };
  const P = { bets: [stored], markets: {} };
  const eff = context.PR.lineFor(L, P, 'u');
  assert.equal(eff.hits, 0);
  assert.equal(eff.net, -40);
  const raw = context.PR.lineFor(L, P, 'u', { effective: false });
  assert.equal(raw.hits, 1);
  assert.equal(raw.net, 40);
});
