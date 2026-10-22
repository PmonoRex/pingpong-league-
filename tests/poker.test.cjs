const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const context = { document: { getElementById: () => null } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('poker.js', 'utf8'), context, { filename: 'poker.js' });
  return context.PokerNight;
}
const plain = x => JSON.parse(JSON.stringify(x));
const night = (events, extra = {}) => ({ id: 'n1', startedAt: 1000, buyIn: 100, chips: 1000, events, ...extra });
const ev = (id, at, t, name, amount, ref) => ({ id, at, t, name, amount, ref });

test('view adds up buy-ins, rebuys and cash-outs; undo removes an event', () => {
  const P = load();
  const v = P.view(night([
    ev('a', 1, 'join', 'กิฟท์'), ev('b', 2, 'buy', 'กิฟท์', 100), ev('c', 3, 'join', 'Golf'), ev('d', 4, 'buy', 'Golf', 100),
    ev('e', 5, 'buy', 'Golf', 100), ev('f', 6, 'buy', 'Golf', 100), ev('g', 7, 'undo', null, null, 'f'),
    ev('h', 8, 'out', 'กิฟท์', 2500), ev('i', 9, 'out', 'Golf', 300), ev('j', 10, 'out', 'Golf', 500)
  ]));
  const [gift, golf] = v.players;
  assert.equal(gift.paid, 100); assert.equal(golf.paid, 200);
  assert.equal(golf.out, 500, 'latest chip count wins');
  assert.equal(gift.net, 150); assert.equal(golf.net, -150);
  assert.equal(v.chipsIn, 3000); assert.equal(v.chipsOut, 3000);
  assert.ok(v.balanced);
});

test('a chip count that does not add up is not balanced', () => {
  const P = load();
  const v = P.view(night([ev('a', 1, 'buy', 'A', 100), ev('b', 2, 'buy', 'B', 100), ev('c', 3, 'out', 'A', 1500), ev('d', 4, 'out', 'B', 400)]));
  assert.equal(v.allOut, true); assert.equal(v.balanced, false); assert.equal(v.diffChips, -100);
  const w = P.view(night([ev('a', 1, 'buy', 'A', 100), ev('b', 2, 'buy', 'B', 100), ev('c', 3, 'out', 'A', 2000)]));
  assert.equal(w.allOut, false);
});

test('transfers settle everyone in the fewest payments and add up exactly', () => {
  const P = load();
  const players = [{ name: 'A', net: 300 }, { name: 'B', net: -250 }, { name: 'C', net: 50 }, { name: 'D', net: -100 }];
  const t = P.transfers(players);
  assert.deepEqual(plain(t.map(x => [x.from, x.to, x.amount])), [['B', 'A', 250], ['D', 'A', 50], ['D', 'C', 50]]);
  assert.equal(P.transfers([{ name: 'A', net: 0 }, { name: 'B', net: 0 }]).length, 0);
  // chips that do not divide evenly into baht: totals still match to the satang
  const v = P.view({ id: 'n', startedAt: 1, buyIn: 100, chips: 300, events: [ev('a', 1, 'buy', 'A', 100), ev('b', 2, 'buy', 'B', 100), ev('c', 3, 'buy', 'C', 100), ev('d', 4, 'out', 'A', 401), ev('e', 5, 'out', 'B', 299), ev('f', 6, 'out', 'C', 200)] });
  const tr = P.transfers(v.players), sum = tr.reduce((s, x) => s + Math.round(x.amount * 100), 0);
  const losers = v.players.filter(p => p.net < 0).reduce((s, p) => s - Math.round(p.net * 100), 0);
  assert.ok(v.balanced); assert.equal(sum, losers);
});

test('merge keeps events from both phones and closes a night closed on either', () => {
  const P = load();
  const base = { nights: { n1: night([ev('a', 1, 'buy', 'A', 100)]) } };
  const phone1 = { nights: { n1: night([ev('a', 1, 'buy', 'A', 100), ev('b', 2, 'buy', 'B', 100)]) } };
  const phone2 = { nights: { n1: night([ev('a', 1, 'buy', 'A', 100), ev('c', 3, 'buy', 'A', 100)], { closedAt: 50 }) } };
  const m = P.merge(phone1, phone2);
  assert.deepEqual(plain(m.nights.n1.events.map(e => e.id)), ['a', 'b', 'c']);
  assert.equal(m.nights.n1.closedAt, 50);
  assert.ok(P.same(P.merge(m, base), m), 'merging an older copy changes nothing');
  assert.ok(P.same(P.merge(phone2, phone1), m), 'order does not matter');
});

test('normalize drops bad events and caps stored nights', () => {
  const P = load();
  const p = P.normalize({ nights: { x: night([{ id: 'a', at: 1, t: 'buy', name: 'A', amount: -5 }, { id: 'b', at: 2, t: 'hack', name: 'A' }, { id: 'c', at: 3, t: 'join', name: '  ' }, { id: 'd', at: 4, t: 'join', name: 'x'.repeat(50) }]) } });
  assert.deepEqual(plain(Object.values(p.nights)[0].events.map(e => e.id)), ['d']);
  assert.equal(Object.values(p.nights)[0].events[0].name.length, 30);
  const many = { nights: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`n${i}`, { ...night([]), id: `n${i}`, startedAt: i }])) };
  assert.equal(Object.keys(P.normalize(many).nights).length, P.MAX_NIGHTS);
  assert.equal(P.normalize('nonsense').nights && Object.keys(P.normalize('nonsense').nights).length, 0);
});

test('startNight buys everyone in once; current and history follow closedAt', () => {
  const P = load();
  const { poker, id } = P.startNight({}, { buyIn: 200, chips: 2000, names: ['A', 'B', 'A', ' '] });
  const v = P.view(P.current(poker));
  assert.equal(P.current(poker).id, id);
  assert.deepEqual(plain(v.players.map(p => [p.name, p.paid, p.chipsIn])), [['A', 200, 2000], ['B', 200, 2000]]);
  const closed = P.closeNight(poker, id);
  assert.equal(P.current(closed), null);
  assert.equal(P.history(closed).length, 1);
});

test('Dummy keeps the poker nights stored in the same column', () => {
  const context = { document: { getElementById: () => null } };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync('dummy.js', 'utf8'), context, { filename: 'dummy.js' });
  const D = context.DummyScore, poker = { nights: { n1: night([]) } };
  assert.deepEqual(plain(D.normalize({ players: ['A', 'B'], poker }).poker), poker);
  const base = { players: ['A', 'B'], rev: 1 }, local = { players: ['A', 'C'], rev: 1 }, remote = { players: ['A', 'B'], rev: 2, poker };
  assert.deepEqual(plain(D.mergeDummy(base, local, remote).state.poker), poker, 'a line-up change here does not drop poker saved elsewhere');
  assert.deepEqual(plain(D.mergeDummy(base, base, remote).state.poker), poker);
});

test('a player joins from their own phone once, with one buy-in, even if both phones tap', () => {
  const P = load();
  const { poker, id } = P.startNight({}, { buyIn: 100, chips: 1000, names: ['A'] });
  const phone1 = P.join(poker, id, 'B'), phone2 = P.join(poker, id, 'B');
  const v = P.view(P.merge(phone1, phone2).nights[id]);
  assert.deepEqual(plain(v.players.map(p => [p.name, p.paid])), [['A', 100], ['B', 100]]);
  assert.ok(P.same(P.join(phone1, id, 'B'), phone1), 'already seated: no change');
  const join = P.normalize(phone1).nights[id].events.find(e => e.t === 'join' && e.name === 'B');
  const undone = P.addEvent(phone1, id, { t: 'undo', ref: join.id });
  assert.deepEqual(plain(P.view(undone.nights[id]).players.map(p => p.name)), ['A'], 'undoing the join takes the buy-in back too');
  assert.equal(P.view(P.join(poker, id, 'C').nights[id]).paid, 200);
});

test('the shared hand: board, reveal, fold and a new deal that clears it', () => {
  const P = load();
  let { poker, id } = P.startNight({}, { buyIn: 100, chips: 1000, names: ['A', 'B', 'C'] });
  poker = P.setBoard(poker, id, 0, 48); poker = P.setBoard(poker, id, 1, 44); poker = P.setBoard(poker, id, 1, null);
  poker = P.show(poker, id, 'A', [0, 1]); poker = P.fold(poker, id, 'C');
  let h = P.view(poker.nights[id]).hand;
  assert.deepEqual(plain(h.board), [48, null, null, null, null]);
  assert.deepEqual(plain(h.shown), { A: [0, 1] });
  assert.deepEqual(plain(h.folded), ['C']);
  assert.equal(h.no, 1);
  assert.equal(P.view(poker.nights[id]).lastAction.t, 'buy', 'undo only ever targets money, not cards');
  poker = P.deal(poker, id);
  h = P.view(poker.nights[id]).hand;
  assert.deepEqual(plain(h.board), [null, null, null, null, null]);
  assert.deepEqual(plain(h.shown), {}); assert.equal(h.folded.length, 0); assert.equal(h.no, 1, 'the first deal starts hand 1');
  assert.equal(P.view(poker.nights[id]).paid, 300, 'money is untouched by a new deal');
});

test('reveals must be two real, different cards; cards of old hands are dropped but money never is', () => {
  const P = load();
  let { poker, id } = P.startNight({}, { buyIn: 100, chips: 1000, names: ['A', 'B'] });
  for (const bad of [[1], [5, 5], [3, 52], ['x', 2]]) assert.ok(P.same(P.show(poker, id, 'A', bad), poker), JSON.stringify(bad));
  for (let i = 0; i < 400; i++) { poker = P.setBoard(poker, id, i % 5, i % 52); if (i % 5 === 4) poker = P.deal(poker, id); }
  const events = P.normalize(poker).nights[id].events;
  assert.ok(events.filter(e => e.t === 'board').length <= 5, 'only the current hand keeps board events');
  assert.equal(P.view(poker.nights[id]).paid, 200);
  assert.equal(P.view(poker.nights[id]).hand.no, 80);
});
