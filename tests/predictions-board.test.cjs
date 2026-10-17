const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadBoard() {
  const context = {};
  vm.runInNewContext(fs.readFileSync('predictions-board.js', 'utf8') + '\nglobalThis.board = PredBoard;', context);
  return context.board;
}
const B = loadBoard();
const plain = value => JSON.parse(JSON.stringify(value));

test('handicapWords reads the handicap the way the hall says it', () => {
  assert.equal(B.handicapWords(0.5), 'ครึ่งลูก');
  assert.equal(B.handicapWords(1), '1 ลูก');
  assert.equal(B.handicapWords(1.5), 'ลูกครึ่ง');
  assert.equal(B.handicapWords(2.5), '2 ลูกครึ่ง');
  assert.equal(B.handicapWords(3), '3 ลูก');
  assert.equal(B.handicapWords(0), '');
  assert.equal(B.handicapWords('x'), '');
});

test('odds bill the favourite as ต่อ and the other corner as รอง, red corner first', () => {
  assert.deepEqual(plain(B.odds(['a', 'b'], { favoriteId: 'b', handicap: 1.5 })), [
    { id: 'a', role: 'dog', label: 'รอง ลูกครึ่ง', num: '+1.5' },
    { id: 'b', role: 'fav', label: 'ต่อ ลูกครึ่ง', num: '−1.5' }
  ]);
  const even = plain(B.odds(['a', 'b'], { favoriteId: 'a', handicap: 0 }));
  assert.deepEqual(even.map(o => o.role), ['even', 'even']);
  assert.deepEqual(plain(B.odds(['a', 'b'], { favoriteId: 'zz', handicap: 1 })).map(o => o.label), ['เสมอราคา', 'เสมอราคา'], 'a favourite outside the pair is not billed');
});

test('tally counts picks and stake per corner for one match only, without void bets', () => {
  const bets = [
    { season: 2, matchId: 'r0m0', sideId: 'a', stake: 100, status: 'pending' },
    { season: 2, matchId: 'r0m0', sideId: 'a', stake: 50, status: 'won' },
    { season: 2, matchId: 'r0m0', sideId: 'b', stake: 50, status: 'pending' },
    { season: 2, matchId: 'r0m0', sideId: 'b', stake: 999, status: 'void' },
    { season: 1, matchId: 'r0m0', sideId: 'a', stake: 999, status: 'pending' },
    { season: 2, matchId: 'r0m1', sideId: 'a', stake: 999, status: 'pending' },
    { season: 2, matchId: 'r0m0', sideId: 'zz', stake: 999, status: 'pending' }
  ];
  const t = plain(B.tally(bets, 2, 'r0m0', ['a', 'b']));
  assert.deepEqual(t.corners, [{ id: 'a', count: 2, stake: 150 }, { id: 'b', count: 1, stake: 50 }]);
  assert.equal(t.count, 3);
  assert.equal(t.stake, 200);
  assert.equal(t.redShare, 75);
  assert.equal(B.tally([], 2, 'r0m0', ['a', 'b']).redShare, 50, 'an empty board splits evenly');
  assert.equal(B.tally([{ season: '2', matchId: 'r0m0', sideId: 'b', stake: 0 }], 2, 'r0m0', ['a', 'b']).redShare, 0, 'no money: split by picks');
});

test('settledMatches groups won / lost / push per match, newest first, using the given status', () => {
  const bets = [
    { id: 1, season: 3, matchId: 'r0m0', pair: ['a', 'b'], status: 'won', settledAt: '2026-10-17T10:00:00Z' },
    { id: 2, season: 3, matchId: 'r0m0', pair: ['a', 'b'], status: 'lost', settledAt: '2026-10-17T10:00:00Z' },
    { id: 3, season: 3, matchId: 'r0m1', pair: ['c', 'd'], status: 'push', settledAt: '2026-10-17T11:00:00Z' },
    { id: 4, season: 3, matchId: 'r1m0', pair: ['a', 'c'], status: 'pending' },
    { id: 5, season: 3, matchId: 'r1m1', pair: ['b', 'd'], status: 'void' },
    { id: 6, season: 2, matchId: 'r0m0', pair: ['a', 'b'], status: 'won' }
  ];
  const groups = B.settledMatches(bets, 3);
  assert.deepEqual(plain(groups.map(g => g.matchId)), ['r0m1', 'r0m0']);
  assert.deepEqual(plain(groups[1].won.map(b => b.id)), [1]);
  assert.deepEqual(plain(groups[1].lost.map(b => b.id)), [2]);
  assert.deepEqual(plain(groups[0].push.map(b => b.id)), [3]);
  const corrected = B.settledMatches(bets, 3, b => (b.id === 1 ? 'lost' : b.status));
  assert.deepEqual(plain(corrected.find(g => g.matchId === 'r0m0').lost.map(b => b.id)), [1, 2], 'a corrected status moves the bet');
});

test('lines are stable for a bet and come from friendly lists', () => {
  assert.equal(B.teaseLine(7), B.teaseLine(7));
  assert.ok(B.TEASE_LINES.includes(B.teaseLine(42)));
  assert.ok(B.WIN_LINES.includes(B.winLine(42)));
  assert.ok(B.PUSH_LINES.includes(B.pushLine(42)));
  const seen = new Set(Array.from({ length: 40 }, (_, i) => B.teaseLine(i)));
  assert.ok(seen.size > 3, 'different bets get different lines');
  assert.equal(B.WIN_STAMP, 'ได้เงิน');
});

test('addStake adds whole chips to what is typed', () => {
  assert.equal(B.addStake('', 50), 50);
  assert.equal(B.addStake('120', '100'), 220);
  assert.equal(B.addStake('-5', 10), 10);
});

// The bill, board and settled banter print player names from the shared row: they must stay text.
test('predictions page escapes player names in the bill, board and settled banter', () => {
  const BAD = '"><img src=x onerror=alert(1)>';
  const P = (id, displayName, role = 'player') => ({ id, displayName, role, active: true });
  const league = {
    currentSeason: 1, profiles: { a: P('a', 'Alice', 'admin'), [BAD]: P(BAD, BAD), c: P('c', BAD), d: P('d', 'Dealer') },
    seasonPlayerIds: ['a', BAD, 'c'], rounds: [{ rest: null, m: [[BAD, 'c'], ['a', 'c']] }],
    results: { r0m1: { a: 11, b: 5 } }, rankHistory: [], seasonArchives: [], auditLog: []
  };
  const pred = { dealerId: 'd', nextBetId: 3, markets: { 's1:r0m0': { favoriteId: BAD, handicap: 1.5, open: true }, 's1:r0m1': { favoriteId: 'a', handicap: 0.5, open: false } },
    bets: [
      { id: 1, season: 1, matchId: 'r0m0', pair: [BAD, 'c'], favoriteId: BAD, handicap: 1.5, userId: BAD, sideId: BAD, stake: 10, status: 'pending', net: 0 },
      { id: 2, season: 1, matchId: 'r0m1', pair: ['a', 'c'], favoriteId: 'a', handicap: 0.5, userId: BAD, sideId: 'c', stake: 10, status: 'lost', net: -10, settledAt: '2026-10-17T10:00:00Z' }
    ] };
  const values = new Map([['pp_league_v7_uid', JSON.stringify(league)], ['pp_predictions_v3_uid', JSON.stringify(pred)], ['pp_user_id', 'a']]);
  const elements = new Map();
  const el = id => {
    const e = { id, style: {}, dataset: {}, value: '', textContent: '', innerHTML: '', className: '', children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null,
      addEventListener() {}, insertAdjacentHTML() {}, appendChild(c) { e.children.push(c); return c; }, querySelectorAll: () => [], querySelector: () => null };
    return e;
  };
  const document = { readyState: 'complete', body: el('body'), getElementById: id => { if (!elements.has(id)) elements.set(id, el(id)); return elements.get(id); },
    createElement: () => el(''), querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
  const context = { document, console, alert() {}, confirm: () => false,
    localStorage: { getItem: k => (values.has(k) ? values.get(k) : null), setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k), key: () => null, length: 0 },
    fetch: async () => { throw new Error('offline'); }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, requestAnimationFrame: () => 0,
    history: { replaceState() {} }, addEventListener() {}, MutationObserver: class { observe() {} } };
  context.window = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'bet-settle.js', 'predictions-board.js', 'predictions.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const html = id => [elements.get(id)?.innerHTML || '', ...(elements.get(id)?.children || []).map(c => c.innerHTML)].join('');
  for (const id of ['bettingMarkets', 'settledBoard']) {
    assert.ok(html(id).length > 0, `${id} rendered`);
    assert.doesNotMatch(html(id), /<img/, id);
  }
  assert.match(html('bettingMarkets'), /data-side="&quot;&gt;&lt;img/);
  assert.match(html('bettingMarkets'), /กระดานทาย/);
  assert.match(html('settledBoard'), /payout lost/);
});
