const test = require('node:test');
const assert = require('node:assert');
const L = require('../live.js');

const play = (m, seq) => [...seq].reduce((x, s) => L.point(x, s), m);
const base = o => L.fresh({ key: 's1:r0m0', season: 1, id: 'r0m0', pair: ['p', 'q'], ...o });

test('a game ends at 11 with a 2-point lead, not before', () => {
  let m = play(base(), 'a'.repeat(10) + 'b'.repeat(10));
  assert.deepStrictEqual(m.cur, [10, 10]);
  m = play(m, 'a'); assert.strictEqual(m.done, false);
  m = play(m, 'a'); assert.strictEqual(m.done, true);
  assert.deepStrictEqual(L.result(m), { a: 12, b: 10 });
});

test('best of 3 records games won and stops at 2', () => {
  let m = play(base({ bestOf: 3 }), 'a'.repeat(11));
  assert.strictEqual(m.done, false); assert.deepStrictEqual(m.games, [[11, 0]]);
  m = play(m, 'b'.repeat(11) + 'a'.repeat(11));
  assert.strictEqual(m.done, true); assert.deepStrictEqual(L.result(m), { a: 2, b: 1 });
  assert.strictEqual(L.point(m, 'a'), m, 'no points after the match');
});

test('single game can be recorded as games won', () => {
  const m = play(base({ record: 'games' }), 'b'.repeat(11));
  assert.deepStrictEqual(L.result(m), { a: 0, b: 1 });
});

test('serve: two each, then every point from 10-10; next game the other side starts', () => {
  let m = base({ first: 'a', bestOf: 3 });
  const seen = [];
  for (let i = 0; i < 6; i++) { seen.push(L.server(m)); m = L.point(m, i % 2 ? 'a' : 'b'); }
  assert.deepStrictEqual(seen, ['a', 'a', 'b', 'b', 'a', 'a']);
  m = play(base({ first: 'a', bestOf: 3 }), 'ab'.repeat(10));
  assert.strictEqual(L.server(m), 'a'); m = L.point(m, 'a'); assert.strictEqual(L.server(m), 'b');
  m = play(base({ first: 'a', bestOf: 3 }), 'a'.repeat(11));
  assert.strictEqual(L.server(m), 'b');
});

test('undo steps back across a finished game', () => {
  let m = play(base({ bestOf: 3 }), 'a'.repeat(11));
  m = L.undo(m); assert.deepStrictEqual(m.cur, [10, 0]); assert.deepStrictEqual(m.games, []);
  const done = play(base(), 'a'.repeat(11)); assert.strictEqual(L.undo(done).done, false);
});

test('format guess from league scores', () => {
  assert.deepStrictEqual(L.guessFormat({ r0m0: { a: 11, b: 7 } }), { bestOf: 1, record: 'points' });
  assert.deepStrictEqual(L.guessFormat({ r0m0: { a: 3, b: 1 } }), { bestOf: 5, record: 'games' });
  assert.deepStrictEqual(L.guessFormat({ r0m0: { a: 2, b: 0 } }), { bestOf: 3, record: 'games' });
  assert.deepStrictEqual(L.guessFormat({}), { bestOf: 1, record: 'points' });
});
