const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const store = new Map();
const context = { crypto: globalThis.crypto, atob, btoa, TextEncoder, TextDecoder, Uint8Array, Uint32Array, document: { getElementById: () => null },
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } };
context.window = context; context.globalThis = context;
vm.createContext(context);
for (const f of ['poker-cards.js', 'poker-bet.js', 'poker-deal.js', 'poker.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: f });
const { PokerDeal: D, PokerNight: N } = context;
const plain = x => JSON.parse(JSON.stringify(x));

test('shuffle deals every card once and uses the random source', () => {
  const deck = D.shuffle();
  assert.equal(deck.length, 52); assert.equal(new Set(deck).size, 52);
  const fixed = D.shuffle(n => n - 1); // always swap with itself: no change
  assert.deepEqual(plain(fixed), Array.from({ length: 52 }, (_, c) => c));
  assert.notDeepEqual(plain(D.shuffle()), plain(D.shuffle()), 'two shuffles differ (1 in 52! chance of a false failure)');
});

test('hole cards open only with the right private key, and tampering is caught', async () => {
  const a = await D.newKeys(), b = await D.newKeys();
  const { epk, boxes } = await D.seal({ A: a.pub, B: b.pub }, { A: [0, 51], B: [7, 8] });
  assert.deepEqual(plain(await D.open(a.priv, epk, boxes.A)), [0, 51]);
  assert.deepEqual(plain(await D.open(b.priv, epk, boxes.B)), [7, 8]);
  assert.equal(await D.open(a.priv, epk, boxes.B), null, "A cannot open B's box");
  const bad = { ...boxes.A, ct: boxes.A.ct.slice(0, -4) + (boxes.A.ct.endsWith('AAA=') ? 'BBB=' : 'AAA=') };
  assert.equal(await D.open(a.priv, epk, bad), null, 'a changed box does not open');
  assert.ok(!JSON.stringify(boxes).includes('51'), 'the row never holds the cards in the clear');
});

test('this phone keeps one key pair and remembers the cards it opened', async () => {
  const k1 = await D.myKeys(), k2 = await D.myKeys();
  assert.equal(k1.pub, k2.pub); assert.equal(D.myPub(), k1.pub);
  const { epk, boxes } = await D.seal({ me: k1.pub }, { me: [12, 13] });
  assert.deepEqual(plain(await D.unlock('h1', epk, boxes.me)), [12, 13]);
  assert.deepEqual(plain(D.myCards('h1')), [12, 13]);
  D.saveBoard('h1', [1, 2, 3, 4, 5]); assert.deepEqual(plain(D.boardFor('h1')), [1, 2, 3, 4, 5]);
});

test('the night keeps sealed deals, keys and the mode; old boxes are dropped', async () => {
  let { poker, id } = N.startNight({}, { buyIn: 100, chips: 100, names: ['A', 'B'], sb: 1, bb: 2, mode: 'app' });
  const a = await D.newKeys(), b = await D.newKeys();
  poker = N.setKey(poker, id, 'A', a.pub); poker = N.setKey(poker, id, 'B', 'b-old'.replace(/-/g, '')); poker = N.setKey(poker, id, 'B', b.pub);
  let v = N.view(poker.nights[id]);
  assert.equal(v.mode, 'app'); assert.equal(v.keys.B, b.pub, 'latest key wins');
  const next = N.nextDeal(poker.nights[id]);
  const sealed = await D.seal({ A: a.pub, B: b.pub }, { A: [0, 1], B: [2, 3] });
  poker = N.deal(poker, id, { mode: 'app', by: 'A', epk: sealed.epk, holes: sealed.boxes });
  v = N.view(poker.nights[id]);
  assert.ok(v.hand.app); assert.equal(v.hand.by, 'A'); assert.deepEqual(plain(Object.keys(v.hand.holes)), plain(next.seats));
  assert.deepEqual(plain(await D.open(b.priv, v.hand.epk, v.hand.holes.B)), [2, 3]);
  // a sealed deal that misses a seat is not an app deal
  const partial = N.deal(poker, id, { mode: 'app', by: 'A', epk: sealed.epk, holes: { A: sealed.boxes.A } });
  assert.equal(N.view(partial.nights[id]).hand.app, false);
  poker = N.deal(poker, id);
  const events = N.normalize(poker).nights[id].events;
  assert.equal(events.filter(e => e.holes).length, 0, 'boxes of a finished hand are dropped');
  assert.equal(events.filter(e => e.t === 'key').length, 2, 'one key per player is kept');
  poker = N.setMode(poker, id, 'real');
  assert.equal(N.view(poker.nights[id]).mode, 'real');
});
