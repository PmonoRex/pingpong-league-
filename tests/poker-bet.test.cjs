const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { document: { getElementById: () => null } };
context.window = context;
vm.createContext(context);
for (const f of ['poker-cards.js', 'poker-bet.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: f });
const { PokerBet: B, PokerCards: C } = context;
const plain = x => JSON.parse(JSON.stringify(x));
const cards = text => text.trim().split(/\s+/).map(t => C.RANKS.indexOf(t.slice(0, -1)) * 4 + 'shdc'.indexOf(t.slice(-1)));
const base = (extra = {}) => ({ seats: ['A', 'B', 'C'], stacks: { A: 100, B: 100, C: 100 }, button: 'A', sb: 1, bb: 2, acts: [], ...extra });
const act = (name, a, to) => ({ name, a, to });
const by = (h, name) => h.players.find(p => p.name === name);

test('blinds post and the seat after the big blind speaks first', () => {
  const h = B.play(base());
  assert.equal(h.sbName, 'B'); assert.equal(h.bbName, 'C');
  assert.equal(by(h, 'B').committed, 1); assert.equal(by(h, 'C').committed, 2);
  assert.equal(h.toAct, 'A'); assert.equal(h.toCall, 2); assert.equal(h.minTo, 4); assert.equal(h.pot, 3);
});

test('calls around and the big blind checks: on to the flop, first live seat after the button speaks', () => {
  const h = B.play(base({ acts: [act('A', 'call'), act('B', 'call'), act('C', 'check')] }));
  assert.equal(h.street, 1); assert.equal(h.streetName, 'ฟล็อป'); assert.equal(h.pot, 6); assert.equal(h.toAct, 'B');
});

test('the big blind gets the option, and out-of-turn or too-small actions are ignored', () => {
  let h = B.play(base({ acts: [act('C', 'check'), act('A', 'call'), act('B', 'call')] }));
  assert.equal(h.street, 0); assert.equal(h.toAct, 'C', 'C checked out of turn; still has the option');
  h = B.play(base({ acts: [act('A', 'raise', 3)] }));
  assert.equal(h.toAct, 'A', 'a raise to 3 is below the minimum of 4');
  h = B.play(base({ acts: [act('A', 'raise', 6), act('B', 'raise', 8)] }));
  assert.equal(h.toAct, 'B', 'a re-raise must be at least the last raise (4): 8 is too small');
  h = B.play(base({ acts: [act('A', 'raise', 6), act('B', 'raise', 10), act('C', 'fold'), act('A', 'call')] }));
  assert.equal(h.street, 1); assert.equal(h.pot, 22);
});

test('heads-up: the button posts the small blind, acts first preflop and last after', () => {
  let h = B.play({ seats: ['A', 'B'], stacks: { A: 50, B: 50 }, button: 'A', sb: 1, bb: 2, acts: [] });
  assert.equal(h.sbName, 'A'); assert.equal(h.toAct, 'A');
  h = B.play({ seats: ['A', 'B'], stacks: { A: 50, B: 50 }, button: 'A', sb: 1, bb: 2, acts: [act('A', 'call'), act('B', 'check')] });
  assert.equal(h.street, 1); assert.equal(h.toAct, 'B');
});

test('everyone else folds: the last player takes the pot without a showdown', () => {
  const h = B.play(base({ acts: [act('A', 'raise', 6), act('B', 'fold'), act('C', 'fold')] }));
  assert.ok(h.done); assert.deepEqual(plain(h.delta), { A: 3, B: -1, C: -2 });
  assert.equal(by(h, 'A').stack, 103);
});

test('all-ins make side pots, the board is run out, and face-up hands settle every pot', () => {
  const input = { seats: ['A', 'B', 'C'], stacks: { A: 20, B: 50, C: 100 }, button: 'A', sb: 1, bb: 2,
    acts: [act('A', 'raise', 20), act('B', 'raise', 50), act('C', 'call')] };
  let h = B.play(input);
  assert.equal(h.street, 4, 'nobody can bet any more');
  assert.deepEqual(plain(h.pots.map(p => [p.amount, p.eligible])), [[60, ['A', 'B', 'C']], [60, ['B', 'C']]]);
  assert.equal(h.done, false, 'waits for the winner');
  // A has aces, B kings, C queens on a dry board: A wins the main pot, B the side pot.
  h = B.play({ ...input, board: cards('2s 7d 9c Jh 3s'), shown: { A: cards('As Ah'), B: cards('Ks Kh'), C: cards('Qs Qh') } }, C);
  assert.ok(h.done);
  assert.deepEqual(plain(h.delta), { A: 40, B: 10, C: -50 });
  assert.equal(h.pots[0].how, 'cards'); assert.equal(h.pots[0].hand, 'หนึ่งคู่ A');
});

test('a pot can be awarded by hand when cards are not entered; only eligible winners count', () => {
  const input = { seats: ['A', 'B', 'C'], stacks: { A: 20, B: 50, C: 100 }, button: 'A', sb: 1, bb: 2,
    acts: [act('A', 'raise', 20), act('B', 'raise', 50), act('C', 'call')] };
  const h = B.play({ ...input, awards: [{ pot: 0, names: ['A'] }, { pot: 1, names: ['A'] }, { pot: 1, names: ['C'] }] });
  assert.ok(h.done); assert.deepEqual(plain(h.delta), { A: 40, B: -50, C: 10 });
});

test('a split pot gives the odd chip to the first winner left of the button', () => {
  const h = B.play({ seats: ['A', 'B', 'C'], stacks: { A: 100, B: 100, C: 100 }, button: 'A', sb: 1, bb: 2,
    acts: [act('A', 'fold'), act('B', 'raise', 4), act('C', 'raise', 6), act('B', 'call'), act('B', 'check'), act('C', 'check'), act('B', 'check'), act('C', 'check'), act('B', 'check'), act('C', 'check')],
    awards: [{ pot: 0, names: ['C', 'B'] }] });
  assert.ok(h.done); assert.equal(h.pots[0].amount, 12); assert.deepEqual(plain(h.delta), { A: 0, B: 0, C: 0 });
  const one = B.play({ seats: ['A', 'B', 'C'], stacks: { A: 100, B: 100, C: 100 }, button: 'A', sb: 1, bb: 2,
    acts: [act('A', 'call'), act('B', 'fold'), act('C', 'check'), act('C', 'check'), act('A', 'check'), act('C', 'check'), act('A', 'check'), act('C', 'check'), act('A', 'check')],
    awards: [{ pot: 0, names: ['A', 'C'] }] });
  assert.equal(one.pots[0].amount, 5);
  assert.deepEqual(plain(one.delta), { A: 0, B: -1, C: 1 }, 'C sits left of the button: gets the odd chip');
});

test('fewer than two players with chips: no betting', () => {
  assert.equal(B.play({ seats: ['A', 'B'], stacks: { A: 100, B: 0 }, button: 'A', sb: 1, bb: 2 }).active, false);
});

// The night model with betting (poker.js on top of poker-bet.js and poker-cards.js).
vm.runInContext(fs.readFileSync('poker.js', 'utf8'), context, { filename: 'poker.js' });
const N = context.PokerNight;
const stacks = (p, id) => Object.fromEntries(N.view(p.nights[id]).players.map(x => [x.name, x.stack]));

test('a night of hands: stacks carry over, the button moves, chips are never made or lost', () => {
  let { poker, id } = N.startNight({}, { buyIn: 100, chips: 100, names: ['A', 'B', 'C'], sb: 1, bb: 2 });
  assert.equal(N.view(poker.nights[id]).hand.bet, null, 'no betting before the first deal');
  poker = N.deal(poker, id);
  let h = N.view(poker.nights[id]).hand;
  assert.deepEqual(plain(h.bet.players.map(p => p.name)), ['A', 'B', 'C']); assert.equal(h.bet.button, 'A');
  poker = N.act(poker, id, 'A', 'raise', 6); poker = N.act(poker, id, 'B', 'fold'); poker = N.act(poker, id, 'C', 'fold');
  assert.deepEqual(stacks(poker, id), { A: 103, B: 99, C: 98 });
  poker = N.deal(poker, id);
  h = N.view(poker.nights[id]).hand;
  assert.equal(h.bet.button, 'B', 'button moves one seat');
  assert.deepEqual(stacks(poker, id), { A: 101, B: 99, C: 97 }, 'after +3/-1/-2, new blinds: C small, A big');
  assert.equal(N.view(poker.nights[id]).hand.bet.sbName, 'C');
  // a rebuy mid-hand waits for the next hand, then plays
  poker = N.addEvent(poker, id, { t: 'buy', name: 'B', amount: 100 });
  assert.equal(stacks(poker, id).B, 199);
  // calling a hand off refunds everyone (B is first to speak after the big blind)
  poker = N.act(poker, id, 'B', 'raise', 10);
  assert.equal(stacks(poker, id).B, 189);
  poker = N.deal(poker, id);
  const v = N.view(poker.nights[id]), total = v.players.reduce((s, p) => s + p.stack, 0);
  assert.equal(total + v.hand.bet.pot, v.chipsIn, 'every chip bought is on the table or in the pot');
  assert.deepEqual(plain(Object.fromEntries(v.players.map(p => [p.name, p.stack + (v.hand.bet.players.find(x => x.name === p.name)?.committed || 0)]))), { A: 103, B: 199, C: 98 });
});

test('a busted player is not dealt in; two phones acting at once agree', () => {
  let { poker, id } = N.startNight({}, { buyIn: 10, chips: 10, names: ['A', 'B'], sb: 1, bb: 2 });
  poker = N.deal(poker, id);
  poker = N.act(poker, id, 'A', 'raise', 10); poker = N.act(poker, id, 'B', 'call');
  poker = N.award(poker, id, 0, ['A']);
  assert.deepEqual(stacks(poker, id), { A: 20, B: 0 });
  poker = N.deal(poker, id);
  assert.equal(N.view(poker.nights[id]).hand.bet, null, 'B has no chips: no hand to play');
  // concurrent actions: both phones record, the replay keeps only the legal one
  let q = N.startNight({}, { buyIn: 100, chips: 100, names: ['A', 'B', 'C'], sb: 1, bb: 2 });
  q.poker = N.deal(q.poker, q.id);
  const p1 = N.act(q.poker, q.id, 'A', 'call'), p2 = N.act(q.poker, q.id, 'B', 'call');
  const merged = N.merge(p1, p2), m = N.view(merged.nights[q.id]).hand.bet;
  const other = N.view(N.merge(p2, p1).nights[q.id]).hand.bet;
  assert.ok(N.same(merged, N.merge(p2, p1)), 'both phones hold the same events');
  assert.deepEqual(plain([m.toAct, m.pot, m.street]), plain([other.toAct, other.pot, other.street]), 'and replay them to the same state');
});

test('who pays whom if the night ended now, from the chips at the table', () => {
  let { poker, id } = N.startNight({}, { buyIn: 100, chips: 1000, names: ['A', 'B', 'C'], sb: 10, bb: 20 });
  assert.equal(N.liveSettle(N.view(poker.nights[id])), null, 'nothing to settle before any hand is bet');
  poker = N.deal(poker, id);
  poker = N.act(poker, id, 'A', 'raise', 500); poker = N.act(poker, id, 'B', 'fold'); poker = N.act(poker, id, 'C', 'fold');
  // A won B's 10 and C's 20 chips: 1030 / 990 / 980 chips = +3 / -1 / -2 baht
  let live = N.liveSettle(N.view(poker.nights[id]));
  assert.deepEqual(plain(live.rows.map(r => [r.name, r.chips, r.net])), [['A', 1030, 3], ['B', 990, -1], ['C', 980, -2]]);
  assert.deepEqual(plain(live.transfers.map(t => [t.from, t.to, t.amount])), [['C', 'A', 2], ['B', 'A', 1]]);
  assert.equal(live.pending, false);
  // a hand being played does not move money yet; a rebuy counts what was paid
  poker = N.deal(poker, id); poker = N.act(poker, id, 'B', 'raise', 300);
  poker = N.addEvent(poker, id, { t: 'buy', name: 'C', amount: 100 });
  live = N.liveSettle(N.view(poker.nights[id]));
  assert.ok(live.pending);
  assert.deepEqual(plain(live.rows.map(r => [r.name, r.chips, r.paid, r.net])), [['A', 1030, 100, 3], ['B', 990, 100, -1], ['C', 1980, 200, -2]]);
  const sum = live.rows.reduce((s, r) => s + r.net, 0);
  assert.equal(Math.round(sum * 100), 0, 'money adds up to zero');
});

test('a room with no buy-ins: play for baht, stand up, sit back down, settle', () => {
  let { poker, id } = N.startNight({}, { name: 'โต๊ะ 1', credit: true, sb: 5, bb: 10, names: ['A'] });
  poker = N.join(poker, id, 'B'); poker = N.join(poker, id, 'C');
  let v = N.view(poker.nights[id]);
  assert.equal(v.night.name, 'โต๊ะ 1'); assert.ok(v.credit);
  assert.deepEqual(plain(v.players.map(p => [p.name, p.paid, p.net, p.seated])), [['A', 0, 0, true], ['B', 0, 0, true], ['C', 0, 0, true]]);
  poker = N.deal(poker, id); // button A, B small 5, C big 10
  poker = N.act(poker, id, 'A', 'raise', 300); poker = N.act(poker, id, 'B', 'call'); poker = N.act(poker, id, 'C', 'fold');
  const bet = N.view(poker.nights[id]).hand.bet;
  assert.equal(bet.maxTo > 1e8, true, 'nobody can run out of money');
  for (let i = 0; i < 6; i++) poker = N.act(poker, id, ['B', 'A'][i % 2], 'check');
  poker = N.award(poker, id, 0, ['B']);
  v = N.view(poker.nights[id]);
  assert.deepEqual(plain(v.players.map(p => [p.name, p.net])), [['A', -300], ['B', 310], ['C', -10]]);
  assert.ok(v.balanced, 'a credit room settles whenever no hand is being played');
  assert.deepEqual(plain(N.transfers(v.players).map(t => [t.from, t.to, t.amount])), [['A', 'B', 300], ['C', 'B', 10]]);
  // C stands up: not dealt in, result kept; sits back down later at the same result
  poker = N.leave(poker, id, 'C');
  poker = N.deal(poker, id);
  v = N.view(poker.nights[id]);
  assert.deepEqual(plain(v.hand.bet.players.map(p => p.name)), ['A', 'B']);
  assert.equal(v.players.find(p => p.name === 'C').seated, false);
  assert.equal(v.players.find(p => p.name === 'C').net, -10);
  poker = N.join(poker, id, 'C');
  assert.equal(N.view(poker.nights[id]).players.find(p => p.name === 'C').seated, true);
  assert.equal(N.view(poker.nights[id]).players.find(p => p.name === 'C').net, -10, 'sitting back down costs nothing');
  // two rooms at once
  const second = N.startNight(poker, { name: 'โต๊ะ 2', credit: true, sb: 1, bb: 2, names: ['D'] });
  assert.deepEqual(plain(N.openNights(second.poker).map(n => n.name)), ['โต๊ะ 2', 'โต๊ะ 1']);
  assert.deepEqual(plain(N.openNights(N.closeNight(second.poker, id)).map(n => n.name)), ['โต๊ะ 2']);
});

test('a buy-in night still works as before, and a leaver there is not dealt in either', () => {
  let { poker, id } = N.startNight({}, { buyIn: 100, chips: 100, names: ['A', 'B', 'C'], sb: 1, bb: 2 });
  assert.equal(N.view(poker.nights[id]).credit, false);
  poker = N.leave(poker, id, 'C'); poker = N.deal(poker, id);
  assert.deepEqual(plain(N.view(poker.nights[id]).hand.bet.players.map(p => p.name)), ['A', 'B']);
  poker = N.join(poker, id, 'C');
  assert.equal(N.view(poker.nights[id]).players.find(p => p.name === 'C').paid, 100, 'coming back does not buy in again');
});
