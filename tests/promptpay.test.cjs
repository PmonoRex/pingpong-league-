const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('promptpay.js', 'utf8') + ';this.PromptPay = PromptPay;', context, { filename: 'promptpay.js' });
  return context.PromptPay;
}

test('crc16 is CRC-16/CCITT-FALSE (check value of "123456789" is 29B1)', () => {
  const P = load();
  assert.equal(P.crc16('123456789'), '29B1');
  assert.equal(P.crc16(''), 'FFFF');
});

// Expected strings were produced by the reference promptpay-qr library (dtinth/promptpay-qr 0.5.0).
const VECTORS = [
  ['0801234567', undefined, '00020101021129370016A000000677010111011300668012345675802TH530376463046197'],
  ['0812345678', undefined, '00020101021129370016A000000677010111011300668123456785802TH530376463045D82'],
  ['081-234-5678', 150, '00020101021229370016A000000677010111011300668123456785802TH53037645406150.006304CC46'],
  ['0899999999', 4.22, '00020101021229370016A000000677010111011300668999999995802TH530376454044.2263049DF5'],
  ['0812345678', 0.01, '00020101021229370016A000000677010111011300668123456785802TH530376454040.01630437B6'],
  ['0812345678', 99999.99, '00020101021229370016A000000677010111011300668123456785802TH5303764540899999.996304DE2C'],
  ['1101700230708', undefined, '00020101021129370016A000000677010111021311017002307085802TH5303764630437EC'],
  ['1-1017-00230-70-8', 1234.5, '00020101021229370016A000000677010111021311017002307085802TH530376454071234.5063048AC3']
];
test('payload matches known-good PromptPay QR strings', () => {
  const P = load();
  for (const [target, amount, expected] of VECTORS) assert.equal(P.payload(target, amount), expected, `${target} ${amount}`);
});

test('every payload ends with the CRC of everything before it', () => {
  const P = load();
  for (const [target, amount] of VECTORS) {
    const p = P.payload(target, amount);
    assert.equal(p.slice(-4), P.crc16(p.slice(0, -4)));
    assert.match(p, /6304[0-9A-F]{4}$/);
  }
});

test('amount field only appears for a positive amount, rounded to satang', () => {
  const P = load();
  for (const bad of [0, -5, NaN, 'abc', null, Infinity]) assert.doesNotMatch(P.payload('0812345678', bad), /5404|010212/, String(bad));
  assert.match(P.payload('0812345678', 10.005), /540510\.01/);
  assert.equal(P.amountText(12), '12.00');
});

test('kind and problem accept phones and checksum-valid citizen IDs only', () => {
  const P = load();
  assert.equal(P.kind('081 234 5678'), 'phone');
  assert.equal(P.kind('1101700230708'), 'id');
  assert.equal(P.kind('1101700230709'), '', 'bad check digit');
  assert.equal(P.kind('812345678'), '');
  assert.equal(P.payload('12345', 10), '');
  assert.equal(P.problem('0812345678'), '');
  assert.match(P.problem('1101700230709'), /ไม่ถูกต้อง/);
  assert.match(P.problem('1812345678'), /ขึ้นต้นด้วย 0/);
  assert.match(P.problem(''), /กรอก/);
  assert.equal(P.format('0812345678'), '081-234-5678');
  assert.equal(P.format('1101700230708'), '1-1017-00230-70-8');
});
