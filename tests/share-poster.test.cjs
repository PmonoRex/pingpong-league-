const test = require('node:test');
const assert = require('node:assert/strict');
const poster = require('../share-poster.js');

const BAD = '"><img src=x onerror=alert(1)>';

test('cleanName strips control characters, trims and caps length without touching markup characters', () => {
  assert.equal(poster.cleanName('  มอส\n\t '), 'มอส');
  assert.equal(poster.cleanName(null), '');
  assert.equal(poster.cleanName(BAD), BAD); // drawn with fillText, never parsed as HTML
  const long = poster.cleanName('ก'.repeat(50), 10);
  assert.equal(Array.from(long).length, 10);
  assert.ok(long.endsWith('…'));
});

test('taunt inserts the loser name literally, including $ patterns', () => {
  assert.ok(poster.TAUNTS.length >= 15);
  for (const line of poster.TAUNTS) assert.match(line, /\{n\}/);
  assert.equal(poster.taunt('กอล์ฟ', () => 0), 'กอล์ฟ กลับไปซ้อมเสิร์ฟก่อนนะ');
  assert.match(poster.taunt('$& $1', () => 0), /^\$& \$1 /);
  assert.ok(poster.TAUNTS.includes(poster.taunt('x', () => 0.999999).replace('x', '{n}')));
  assert.ok(poster.DRAW_LINES.includes(poster.drawLine(() => 0.5)));
});

test('matchOutcome only accepts whole non-negative scores', () => {
  assert.equal(poster.matchOutcome(11, 7), 'a');
  assert.equal(poster.matchOutcome(3, 11), 'b');
  assert.equal(poster.matchOutcome(5, 5), 'd');
  assert.equal(poster.matchOutcome(null, 3), null);
  assert.equal(poster.matchOutcome(-1, 3), null);
  assert.equal(poster.matchOutcome('11', 3), null);
});

test('fitSize shrinks until the text fits, never below the minimum', () => {
  const measure = (text, size) => text.length * size;
  assert.equal(poster.fitSize(measure, 'abcd', 400, 80, 30), 80);
  assert.equal(poster.fitSize(measure, 'abcdefghij', 400, 80, 30), 40);
  assert.equal(poster.fitSize(measure, 'a'.repeat(100), 400, 80, 30), 30);
});

test('posterFileName keeps the file name plain ASCII', () => {
  assert.equal(poster.posterFileName('match-r0m1', 3), 'pingpong-season-3-match-r0m1.png');
  assert.equal(poster.posterFileName(BAD, BAD), 'pingpong-season-x-imgsrcxonerroralert1.png');
});

test('standingsBill bills the top 3 like a fight card and numbers the rest', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map(name => ({ name }));
  const live = poster.standingsBill(rows, false);
  assert.deepEqual(live.top.map(r => [r.rank, r.label]), [[1, 'จ่าฝูง'], [2, 'รองจ่าฝูง'], [3, 'อันดับ 3']]);
  assert.deepEqual(live.rest.map(r => r.rank), [4, 5]);
  assert.equal(poster.standingsBill(rows, true).top[0].label, 'แชมป์');
  assert.deepEqual(poster.standingsBill(rows.slice(0, 2), true).rest, []);
});
