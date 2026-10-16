const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const context = { document: { getElementById: () => null } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('dummy.js', 'utf8'), context, { filename: 'dummy.js' });
  return context.DummyScore;
}

test('normalize trims players, caps at 4 and aligns round scores to players', () => {
  const D = load();
  const s = D.normalize({ players: [' A ', '', 'B', 'C', 'D', 'E'], target: '500', knockBonus: -3, rounds: [{ scores: ['10', 'x'], knock: 9 }, null] });
  assert.deepEqual([...s.players], ['A', 'B', 'C', 'D']);
  assert.equal(s.target, 0);
  assert.equal(s.knockBonus, 0);
  assert.equal(s.moneyMode, 'points');
  assert.equal(s.rounds.length, 1);
  assert.deepEqual([...s.rounds[0].scores], [10, 0, 0, 0]);
  assert.equal(s.rounds[0].knock, null);
});

test('totals, standings and winner', () => {
  const D = load();
  const s = D.normalize({ players: ['A', 'B', 'C'], target: 100, rounds: [{ scores: [50, -20, 30], knock: 0 }, { scores: [10, 40, 80] }] });
  assert.deepEqual([...D.totals(s)], [60, 20, 110]);
  const st = D.standings(s);
  assert.deepEqual(st.map(r => r.name), ['C', 'A', 'B']);
  assert.equal(st[1].knocks, 1);
  assert.equal(D.winner({ ...s, target: 100 }).name, 'C');
  assert.equal(D.winner({ ...s, target: 0 }), null);
});

test('cardPoints uses Dummy card values', () => {
  const D = load();
  assert.equal(D.cardPoints({ low: 3, high: 2, ace: 1, special: 1 }), 15 + 20 + 15 + 50);
  assert.equal(D.cardPoints({}), 0);
});

test('settleWinner: knocker takes all, lower hand score pays more', () => {
  const D = load();
  const m = D.settleWinner({ scores: [80, 10, 40, -30], knock: 0, rates: [10, 20, 30] });
  assert.deepEqual([...m], [60, -20, -10, -30]);
});

test('settleWinner: equal scores pay the better rank rate; knock flags and โง่ double', () => {
  const D = load();
  assert.deepEqual([...D.settleWinner({ scores: [0, 20, 20, 5], knock: 0, rates: [10, 20, 30] })], [50, -10, -10, -30]);
  const m = D.settleWinner({ scores: [0, 20, 10, 5], knock: 0, flags: { dark: true, color: true }, dumb: [false, false, false, true], rates: [10, 20, 30] });
  assert.deepEqual([...m], [40 + 80 + 240, -40, -80, -240]);
});

test('settleWinner: no knock → top hand score wins, split on a tie; flags ignored', () => {
  const D = load();
  assert.deepEqual([...D.settleWinner({ scores: [10, 50, 30], knock: null, flags: { dark: true }, rates: [10, 20, 30] })], [-20, 30, -10]);
  assert.deepEqual([...D.settleWinner({ scores: [50, 50, 30], knock: null, rates: [10, 20, 30] })], [5, 5, -10]);
});

test('normalize keeps money mode, rates and per-round money', () => {
  const D = load();
  const s = D.normalize({ players: ['A', 'B'], moneyMode: 'winner', rates: [15, 'x'], rounds: [{ scores: [1, 2], knock: 0, money: [15, -15], dumb: [0, 1], flags: { dark: 1 } }] });
  assert.equal(s.moneyMode, 'winner');
  assert.deepEqual([...s.rates], [15, 0, 0]);
  assert.deepEqual([...D.moneyTotals(s)], [15, -15]);
  assert.equal(s.rounds[0].dumb[1], true);
  assert.equal(s.rounds[0].flags.dark, true);
  assert.equal(D.normalize({ moneyMode: 'bogus' }).moneyMode, 'points');
});

test('pairDebts keeps each pair separate and only nets two players who owe each other', () => {
  const D = load();
  const plain = t => JSON.parse(JSON.stringify(t.map(x => [x.from, x.to, x.amount, x.owed, x.back])));
  // game 1: A knocks (B 5, C 10, D 15); game 2: B knocks (A 5, C 15, D 10)
  const rounds = [{ money: [30, -5, -10, -15] }, { money: [-5, 30, -15, -10] }];
  assert.deepEqual(plain(D.pairDebts(rounds, 4)), [[2, 0, 10, 10, 0], [2, 1, 15, 15, 0], [3, 0, 15, 15, 0], [3, 1, 10, 10, 0]]);
  // B owed A 5 and A owed B 5 → they cancel, so no A–B line
  assert.equal(D.pairDebts(rounds, 4).some(x => (x.from === 0 && x.to === 1) || (x.from === 1 && x.to === 0)), false);
  // A owes B 20, B owes A 5 → A pays B 15
  assert.deepEqual(plain(D.pairDebts([{ money: [-20, 20] }, { money: [5, -5] }], 2)), [[0, 1, 15, 20, 5]]);
  // split pot: C's 0.15 shared between A and B without losing a satang
  assert.deepEqual(plain(D.pairDebts([{ money: [0.08, 0.07, -0.15] }], 3)), [[2, 0, 0.08, 0.08, 0], [2, 1, 0.07, 0.07, 0]]);
  assert.deepEqual(plain(D.pairDebts([{ money: null }], 2)), []);
});

test('settlePoints: score ÷ divisor, every pair pays the difference', () => {
  const D = load();
  const r = D.settlePoints([100, 40, -20], 10);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { vals: [10, 4, -2], money: [18, 0, -18] });
  const plain = t => JSON.parse(JSON.stringify(t.map(x => [x.from, x.to, x.amount])));
  assert.deepEqual(plain(D.pairDebts([r], 3)), [[1, 0, 6], [2, 0, 12], [2, 1, 6]]);
  // two games between the same pair net out pair by pair
  assert.deepEqual(plain(D.pairDebts([D.settlePoints([100, 40], 10), D.settlePoints([20, 60], 10)], 2)), [[1, 0, 2]]);
  assert.deepEqual(JSON.parse(JSON.stringify(D.settlePoints([105, 0], 10).vals)), [10.5, 0]);
});
