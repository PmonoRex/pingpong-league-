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
  assert.equal(s.target, 500);
  assert.equal(s.knockBonus, 0);
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
  assert.equal(D.winner(s).name, 'C');
  assert.equal(D.winner({ ...s, target: 0 }), null);
});

test('cardPoints uses Dummy card values', () => {
  const D = load();
  assert.equal(D.cardPoints({ low: 3, high: 2, ace: 1, special: 1 }), 15 + 20 + 15 + 50);
  assert.equal(D.cardPoints({}), 0);
});
