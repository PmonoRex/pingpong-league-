const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { document: { getElementById: () => null } };
context.window = context; context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync('dummy-game.js', 'utf8'), context, { filename: 'dummy-game.js' });
const { DummyGame: G, DummyRooms: R } = context;
const plain = x => JSON.parse(JSON.stringify(x));
// '7H' → card number (rank * 4 + suit, suits S H D C).
const c = s => ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].indexOf(s.slice(0, -1)) * 4 + 'SHDC'.indexOf(s.slice(-1));
const cs = s => s.split(' ').map(c);
// A table with chosen hands, pile and stock (seat 0 to play first).
function table(hands, { pile = ['9D'], stock = ['2D', '3D', '4D'], turn = 0 } = {}) {
  const seats = Object.keys(hands), s = G.deal({ seed: 'x', seats, dealer: seats.length - 1 });
  seats.forEach(n => { s.hands[n] = cs(hands[n]); });
  s.pile = pile.map((x, i) => ({ c: c(x), by: null, head: i === 0 }));
  s.stock = cs(stock.join(' ')); s.turn = turn;
  return s;
}

test('card points and specials', () => {
  assert.equal(G.points(c('2S')), 5); assert.equal(G.points(c('9H')), 5);
  assert.equal(G.points(c('10D')), 10); assert.equal(G.points(c('KC')), 10);
  assert.equal(G.points(c('AS')), 15);
  assert.equal(G.points(c('2C')), 50); assert.equal(G.points(c('QS')), 50);
  assert.equal(G.label(c('10H')), '10♥');
});

test('melds: sets of 3-4, runs of 3+ in a suit, ace low or high but never wrapping', () => {
  assert.equal(G.meldKind(cs('7S 7H 7D')), 'set');
  assert.equal(G.meldKind(cs('7S 7H 7D 7C')), 'set');
  assert.equal(G.meldKind(cs('5H 6H 7H')), 'run');
  assert.equal(G.meldKind(cs('7H 5H 6H 8H')), 'run');
  assert.equal(G.meldKind(cs('AH 2H 3H')), 'run');
  assert.equal(G.meldKind(cs('QH KH AH')), 'run');
  assert.equal(G.meldKind(cs('KH AH 2H')), null);
  assert.equal(G.meldKind(cs('5H 6H 7D')), null);
  assert.equal(G.meldKind(cs('5H 6H')), null);
  assert.equal(G.meldKind(cs('5H 6H 8H')), null);
  assert.deepEqual(plain(G.sortMeld(cs('3H AH 2H'))), cs('AH 2H 3H'));
  assert.deepEqual(plain(G.sortMeld(cs('AH KH QH'))), cs('QH KH AH'));
});

test('the deal: hand sizes by player count, head card on the pile, the rest is the stock', () => {
  for (const [n, size] of [[2, 11], [3, 9], [4, 7]]) {
    const seats = ['a', 'b', 'c', 'd'].slice(0, n), s = G.deal({ seed: 'seed1', seats, dealer: 0 });
    seats.forEach(x => assert.equal(s.hands[x].length, size));
    assert.equal(s.pile.length, 1); assert.equal(s.pile[0].head, true);
    assert.equal(s.stock.length, 52 - n * size - 1);
    const all = [...seats.flatMap(x => s.hands[x]), s.pile[0].c, ...s.stock];
    assert.equal(new Set(all).size, 52);
    assert.equal(s.seats[s.turn], seats[1 % n], 'the player left of the dealer starts');
  }
  assert.deepEqual(plain(G.shuffle('same')), plain(G.shuffle('same')));
  assert.notDeepEqual(plain(G.shuffle('one')), plain(G.shuffle('two')));
});

test('a turn: draw, meld, lay off only after melding, discard; out of turn and out of order is refused', () => {
  const s = table({ a: '5H 6H 7H 8H KS 3C', b: '9S 9C 2S 4D' }, { stock: ['JD', 'JC'] });
  assert.match(G.check(s, { by: 'b', a: 'draw' }), /ยังไม่ถึงตา/);
  assert.match(G.check(s, { by: 'a', a: 'discard', c: c('KS') }), /จั่วหรือเก็บ/);
  assert.equal(G.apply(s, { by: 'a', a: 'draw' }), null);
  assert.match(G.check(s, { by: 'a', a: 'draw' }), /ไปแล้ว/);
  assert.match(G.check(s, { by: 'a', a: 'lay', c: c('8H'), m: 0 }), /แตะชุด|ลงชุดของตัวเองก่อน/);
  assert.match(G.check(s, { by: 'a', a: 'meld', cards: cs('5H 6H KS') }), /ตอง|เรียง/);
  assert.equal(G.apply(s, { by: 'a', a: 'meld', cards: cs('5H 6H 7H') }), null);
  assert.equal(G.apply(s, { by: 'a', a: 'lay', c: c('8H'), m: 0 }), null);
  assert.deepEqual(plain(s.melds[0].cards.map(x => x.c)), cs('5H 6H 7H 8H'));
  assert.equal(G.apply(s, { by: 'a', a: 'discard', c: c('KS') }), null);
  assert.equal(s.seats[s.turn], 'b'); assert.equal(s.phase, 'draw');
  assert.deepEqual(plain(s.hands.a.slice().sort()), cs('3C JD').sort());
});

test('picking from the pile takes every card after it and must meld the picked card at once', () => {
  const s = table({ a: '7S 7H 2D KC', b: '3S 4S' }, { pile: ['9D', '7D', 'JH', '4C'] });
  assert.match(G.check(s, { by: 'a', a: 'pick', i: 1, with: [] }), /ลงเป็นชุดทันที/);
  assert.match(G.check(s, { by: 'a', a: 'pick', i: 1, with: cs('7S KC') }), /ลงเป็นชุดทันที/);
  assert.equal(G.apply(s, { by: 'a', a: 'pick', i: 1, with: cs('7S 7H') }), null);
  assert.deepEqual(plain(s.pile.map(x => x.c)), cs('9D'));
  assert.deepEqual(plain(s.hands.a.slice().sort((x, y) => x - y)), cs('2D 4C JH KC').sort((x, y) => x - y));
  assert.equal(s.melds[0].owner, 'a'); assert.equal(s.phase, 'play');
});

test('a picked card may meld with cards that came up with it', () => {
  const s = table({ a: '7S 2D', b: '3S 4S' }, { pile: ['9D', '7D', '7C'] });
  assert.equal(G.apply(s, { by: 'a', a: 'pick', i: 1, with: cs('7S 7C') }), null);
  assert.deepEqual(plain(s.hands.a), cs('2D'));
});

test('a player must keep a card to discard', () => {
  const s = table({ a: '5H 6H 7H', b: '3S 4S' }, { stock: ['KD', 'KC'] });
  G.apply(s, { by: 'a', a: 'draw' });
  assert.equal(G.apply(s, { by: 'a', a: 'meld', cards: cs('5H 6H 7H') }), null);
  assert.match(G.check(s, { by: 'a', a: 'lay', c: c('KD'), m: 0 }), /ต่อชุดนี้ไม่ได้/);
  const t = table({ a: '5H 6H 7H', b: '3S 4S' }, { pile: ['9D', '8H'] });
  assert.match(G.check(t, { by: 'a', a: 'pick', i: 1, with: cs('5H 6H 7H') }), /ต้องเหลือไพ่/);
});

test('knock: discarding the last card ends the game; dark and same-suit knocks double the bonus', () => {
  // Dark and one suit: everything melded in the knocking turn, all hearts → 50 × 2 × 2.
  const s = table({ a: '5H 6H 7H KS', b: '3S 4S 9C' }, { stock: ['8H', 'JC'] });
  G.apply(s, { by: 'a', a: 'draw' });
  G.apply(s, { by: 'a', a: 'meld', cards: cs('5H 6H 7H 8H') });
  assert.equal(G.apply(s, { by: 'a', a: 'discard', c: c('KS') }), null);
  assert.deepEqual(plain(s.over), { reason: 'knock', knocker: 'a', dark: true, color: true });
  const sc = G.score(s);
  assert.equal(sc.a.played, 20); assert.equal(sc.a.hand, 0); assert.equal(sc.a.extras, 200); assert.equal(sc.a.total, 220);
  assert.equal(sc.b.total, -(5 + 5 + 5));
  assert.match(G.check(s, { by: 'b', a: 'draw' }), /เกมจบแล้ว/);
});

test('a knock after melding in an earlier turn is not dark', () => {
  const t = table({ a: '5H 6H 7H KS', b: '3S 4S' }, { stock: ['8H', 'JC', 'QC'] });
  G.apply(t, { by: 'a', a: 'draw' }); G.apply(t, { by: 'a', a: 'meld', cards: cs('5H 6H 7H') }); G.apply(t, { by: 'a', a: 'discard', c: c('KS') });
  G.apply(t, { by: 'b', a: 'draw' }); G.apply(t, { by: 'b', a: 'discard', c: c('JC') });
  G.apply(t, { by: 'a', a: 'draw' }); // QC
  assert.equal(G.apply(t, { by: 'a', a: 'lay', c: c('8H'), m: 0 }), null);
  assert.equal(G.apply(t, { by: 'a', a: 'discard', c: c('QC') }), null);
  assert.equal(t.over.knocker, 'a'); assert.equal(t.over.dark, false); assert.equal(t.over.color, true);
  assert.equal(G.score(t).a.extras, 100);
});

test('head card bonus and the penalty for feeding a special or a card that could be laid off', () => {
  const s = table({ a: '9S 9H KD 4H', b: '5H 6H 7H QS 4C', c: 'QH QD 2C 3D' }, { pile: ['9D'], stock: ['JC', 'JS', 'JH', '10C'] });
  assert.equal(G.apply(s, { by: 'a', a: 'pick', i: 0, with: cs('9S 9H') }), null);
  assert.deepEqual(plain(s.extras.a), [{ why: 'เก็บหัว', pts: 50 }]);
  G.apply(s, { by: 'a', a: 'discard', c: c('KD') });
  G.apply(s, { by: 'b', a: 'draw' }); G.apply(s, { by: 'b', a: 'meld', cards: cs('5H 6H 7H') });
  assert.equal(G.apply(s, { by: 'b', a: 'discard', c: c('QS') }), null);
  assert.equal(s.pile[s.pile.length - 1].dumb, 'ทิ้งสเปโต');
  assert.equal(G.apply(s, { by: 'c', a: 'pick', i: s.pile.length - 1, with: cs('QH QD') }), null);
  assert.deepEqual(plain(s.extras.b), [{ why: 'ทิ้งสเปโต', pts: -50 }]);
  G.apply(s, { by: 'c', a: 'discard', c: c('3D') });
  G.apply(s, { by: 'a', a: 'draw' }); // JS fits nothing on the table
  assert.equal(G.apply(s, { by: 'a', a: 'discard', c: c('JS') }), null);
  assert.equal(s.pile[s.pile.length - 1].dumb, '');
  // 8H could be laid off on a's hearts: discarding it is ทิ้งโง่, and it costs b 50 once c picks it up and melds it
  const t = table({ a: '5H 6H 7H KD 2D', b: '8H 3S 4S', c: '9H 10H 2S' }, { pile: ['AD'], stock: ['JC', 'JS', 'JH'] });
  G.apply(t, { by: 'a', a: 'draw' }); G.apply(t, { by: 'a', a: 'meld', cards: cs('5H 6H 7H') }); G.apply(t, { by: 'a', a: 'discard', c: c('KD') });
  G.apply(t, { by: 'b', a: 'draw' });
  assert.equal(G.apply(t, { by: 'b', a: 'discard', c: c('8H') }), null);
  assert.equal(t.pile[t.pile.length - 1].dumb, 'ทิ้งโง่');
  assert.equal(G.apply(t, { by: 'c', a: 'pick', i: t.pile.length - 1, with: cs('9H 10H') }), null);
  assert.deepEqual(plain(t.extras.b), [{ why: 'ทิ้งโง่', pts: -50 }]);
  assert.deepEqual(plain(t.extras.c), []);
});

test('the game ends after the discard that follows the last stock card', () => {
  const s = table({ a: '5H 9S', b: '3S 4S' }, { stock: ['KD'] });
  G.apply(s, { by: 'a', a: 'draw' }); G.apply(s, { by: 'a', a: 'discard', c: c('KD') });
  assert.deepEqual(plain(s.over), { reason: 'stock' });
  assert.equal(G.score(s).a.total, -10); assert.equal(G.score(s).b.total, -10);
});

test('replaying moves skips the ones that were not allowed', () => {
  const game = { seed: 'replay', seats: ['a', 'b'], dealer: 1 };
  const start = G.deal(game), first = start.hands.a[0];
  const s = G.play(game, [{ by: 'b', a: 'draw' }, { by: 'a', a: 'draw' }, { by: 'a', a: 'draw' }, { by: 'a', a: 'discard', c: first }]);
  assert.equal(s.seats[s.turn], 'b'); assert.equal(s.hands.a.length, 11); assert.equal(s.pile.length, 2);
});

// ---- rooms ----
const ids = p => Object.keys(p.rooms);
function room2() {
  let { state: p, id } = R.create(null, { name: 'โต๊ะ 1', divisor: 10, by: 'กิฟท์' });
  p = R.join(p, id, 'Golf');
  return { p, id };
}

test('rooms: create, join, start deals the seated players, leaving mid-game is refused', () => {
  let { p, id } = room2();
  let v = R.view(p.rooms[id]);
  assert.deepEqual(plain(v.seated), ['กิฟท์', 'Golf']); assert.equal(v.running, false);
  p = R.start(p, id, 'seedA'); v = R.view(p.rooms[id]);
  assert.equal(v.running, true); assert.deepEqual(plain(v.game.seats), ['กิฟท์', 'Golf']); assert.equal(v.game.table.hands['Golf'].length, 11);
  assert.equal(R.start(p, id, 'seedB'), p, 'no second game while one is running');
  p = R.leave(p, id, 'Golf'); v = R.view(p.rooms[id]);
  assert.ok(v.seated.includes('Golf'));
  assert.equal(R.view(R.join(R.join(R.join(p, id, 'c'), id, 'd'), id, 'e').rooms[id]).seated.length, 4);
});

test('rooms: moves replay, a finished game scores in baht and the next deal moves left', () => {
  let { p, id } = room2();
  p = R.start(p, id, 'seedA');
  let v = R.view(p.rooms[id]);
  // play until the stock runs out: whoever is to act draws and discards their first card
  for (let k = 0; k < 200 && v.running; k++) {
    const t = v.game.table, who = t.seats[t.turn];
    p = R.move(p, id, v.game.id, { by: who, a: 'draw' });
    v = R.view(p.rooms[id]);
    p = R.move(p, id, v.game.id, { by: who, a: 'discard', c: v.game.table.hands[who][0] });
    v = R.view(p.rooms[id]);
  }
  assert.equal(v.running, false); assert.equal(v.games.length, 1);
  assert.ok(v.needsResult);
  const scores = v.games[0].scores;
  p = R.result(p, id, v.game.id, scores); v = R.view(p.rooms[id]);
  assert.equal(v.needsResult, null);
  const [a, b] = ['กิฟท์', 'Golf'], m = R.settle([scores[a], scores[b]], 10);
  assert.equal(v.players.find(x => x.name === a).net, m[0]);
  assert.equal(m[0] + m[1], 0);
  p = R.start(p, id, 'seedB'); v = R.view(p.rooms[id]);
  assert.equal(v.game.no, 2); assert.equal(v.game.dealer, 1);
  // the old game's moves are dropped once its result is written and a new game started
  assert.ok(p.rooms[id].events.filter(e => e.t === 'act').length === 0);
  assert.equal(v.games.length, 1); assert.deepEqual(plain(v.games[0].scores), plain(scores));
});

test('rooms: settle in baht like the score sheet, transfers are fewest', () => {
  assert.deepEqual(plain(R.settle([100, 40], 10)), [6, -6]);
  assert.deepEqual(plain(R.settle([25, -25, 0], 10)), [9, -9, 0]);
  assert.deepEqual(plain(R.transfers({ a: 10, b: -4, c: -6 })), [{ from: 'c', to: 'a', amount: 6 }, { from: 'b', to: 'a', amount: 4 }]);
});

test('rooms: merging two phones keeps both sides; abort calls a game off', () => {
  let { p, id } = room2();
  p = R.start(p, id, 'seedA');
  const g = R.view(p.rooms[id]).game, first = g.table.seats[g.table.turn];
  const left = R.move(p, id, g.id, { by: first, a: 'draw' }), right = R.join(p, id, 'มอส');
  const both = R.merge(left, right), v = R.view(both.rooms[id]);
  assert.equal(v.game.table.phase, 'play'); assert.ok(v.seated.includes('มอส'));
  assert.ok(R.same(R.merge(right, left), both));
  const off = R.abort(both, id, g.id), w = R.view(off.rooms[id]);
  assert.equal(w.running, false); assert.equal(w.game, null); assert.equal(w.games.length, 0);
  const again = R.start(off, id, 'seedC');
  assert.equal(R.view(again.rooms[id]).game.seats.length, 3);
  assert.equal(ids(R.close(again, id)).length, 1); assert.equal(R.openRooms(R.close(again, id)).length, 0);
});

test('the score sheet (dummy.js) keeps the online rooms stored in the same column', () => {
  const ctx = { document: { getElementById: () => null } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('dummy.js', 'utf8'), ctx, { filename: 'dummy.js' });
  const D = ctx.DummyScore, online = plain(R.create(null, { name: 'x', by: 'a' }).state);
  assert.deepEqual(plain(D.normalize({ players: ['A', 'B'], online }).online), online);
  const base = { players: ['A', 'B'], rev: 1 }, local = { players: ['A', 'C'], rev: 1 }, remote = { players: ['A', 'B'], rev: 2, online };
  assert.deepEqual(plain(D.mergeDummy(base, local, remote).state.online), online);
  assert.deepEqual(plain(D.mergeDummy(base, base, remote).state.online), online);
});
