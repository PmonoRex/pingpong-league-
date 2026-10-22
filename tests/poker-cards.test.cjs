const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const context = { document: { getElementById: () => null } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('poker-cards.js', 'utf8'), context, { filename: 'poker-cards.js' });
  return context.PokerCards;
}
const C = load();
// "As Kd 10h" → card numbers (rank * 4 + suit; suits s h d c = ♠ ♥ ♦ ♣)
const cards = text => text.trim().split(/\s+/).map(t => C.RANKS.indexOf(t.slice(0, -1)) * 4 + 'shdc'.indexOf(t.slice(-1)));
const hand = text => C.evaluate(cards(text));
const nameOf = text => C.name(hand(text));

test('card helpers', () => {
  assert.equal(C.label(cards('As')[0]), 'A♠');
  assert.equal(C.speak(cards('10h')[0]), '10 โพแดง');
  assert.ok(C.red(cards('Qd')[0]) && !C.red(cards('Qc')[0]));
});

test('names every hand category from 7 cards', () => {
  assert.equal(nameOf('As Ks Qs Js 10s 2d 3c'), 'รอยัลสเตรทฟลัช');
  assert.equal(nameOf('9h 8h 7h 6h 5h Ad Kc'), 'สเตรทฟลัช ถึง 9');
  assert.equal(nameOf('7s 7h 7d 7c Ks 2d 3c'), 'โฟร์การ์ด 7');
  assert.equal(nameOf('Qs Qh Qd 3c 3s 3d 2h'), 'ฟูลเฮาส์ Q เต็ม 3', 'two trips make a full house');
  assert.equal(nameOf('Ah 9h 7h 4h 2h Kd Kc'), 'ฟลัช A สูง', 'flush beats a pair');
  assert.equal(nameOf('As 2d 3c 4h 5s Kd Kc'), 'สเตรท ถึง 5', 'A-2-3-4-5 wheel');
  assert.equal(nameOf('10s Jd Qc Kh As 2d 2c'), 'สเตรท ถึง A');
  assert.equal(nameOf('8s 8h 8d Kc 2s 5d 9h'), 'ตอง 8');
  assert.equal(nameOf('As Ad 8c 8h 3s 3d 9h'), 'สองคู่ A กับ 8', 'best two of three pairs');
  assert.equal(nameOf('Ks Kd 9c 7h 3s'), 'หนึ่งคู่ K');
  assert.equal(nameOf('As Jd 9c 7h 3s 2d 4c'), 'ไพ่สูง A');
});

test('fewer than five cards read the way the table reads them', () => {
  assert.equal(nameOf('7s 7d'), 'หนึ่งคู่ 7');
  assert.equal(nameOf('As Kd'), 'ไพ่สูง A');
  assert.equal(nameOf('As Ks Qs Js'), 'ไพ่สูง A', 'four to a flush is not a flush');
});

test('scores order hands and kickers correctly', () => {
  const s = t => C.score(hand(t));
  assert.ok(s('As Ad Kc 9h 3s 2d 4c') > s('As Ad Qc 9h 3s 2d 4c'), 'kicker');
  assert.ok(s('6s 7d 8c 9h 10s 2d 2c') > s('As 2d 3c 4h 5s Kd Kc'), 'six-high straight beats the wheel');
  assert.ok(s('2h 3h 4h 7h 9h') > s('As Kd Qc Jh 10s'), 'flush beats straight');
  assert.ok(s('Qs Qh Qd 3c 3s') > s('Js Jh Jd As Ad'), 'full house by trips rank');
  assert.equal(s('As Kd 9c 7h 3s 2d 2c'), s('Ah Kc 9d 7s 3h 2s 2h'), 'same hand in other suits ties');
});

test('odds: exact on a full board, close to known numbers before it', () => {
  const done = C.odds(cards('Ks 9d 4c 2h 7s'), [cards('As Ah'), cards('Kh Kd')]);
  assert.equal(done[0].win, 0); assert.equal(done[1].win, 1);
  const split = C.odds(cards('As Ks Qs Js 10s'), [cards('2d 3d'), cards('4c 5c')]);
  assert.equal(split[0].tie, 1); assert.equal(split[0].share, 0.5);
  // AA vs KK preflop is about 82% / 18%.
  const pre = C.odds([], [cards('As Ah'), cards('Ks Kh')], { iterations: 6000 });
  assert.ok(Math.abs(pre[0].win - 0.82) < 0.03, String(pre[0].win));
  // a set on the flop against a random hand wins most of the time
  const set = C.odds(cards('7d Kc 2s'), [cards('7s 7h'), []], { iterations: 3000 });
  assert.ok(set[0].win > 0.85, String(set[0].win));
  const total = C.odds(cards('Jd 4c'), [cards('Qs Jh'), [], []], { iterations: 2000 });
  assert.ok(Math.abs(total.reduce((s, x) => s + x.share, 0) - 1) < 1e-9, 'shares add up to one pot');
});
