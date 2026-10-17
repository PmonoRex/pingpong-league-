const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// player-ui.js (avatars + image check), promptpay.js and profile-me.js without a page: profile-me exposes only its pure rules.
function load(league = null) {
  const node = () => ({ querySelectorAll: () => [], querySelector: () => null, classList: { add() {} }, insertAdjacentHTML() {}, dataset: {}, style: {} });
  const context = {
    console, requestAnimationFrame: () => 0, MutationObserver: class { observe() {} },
    document: { readyState: 'complete', body: null, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, addEventListener() {} },
    LeagueShared: { readLocalLeague: () => league }
  };
  context.window = context;
  context.document.body = node();
  vm.createContext(context);
  for (const f of ['player-ui.js', 'promptpay.js', 'vendor/qrcode-generator/qrcode.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: f });
  // Without LeagueShared.cloudRequest wiring the page part still binds; we only use the pure API here.
  vm.runInContext(fs.readFileSync('profile-me.js', 'utf8') + ';this.LP = LeagueProfile;', context, { filename: 'profile-me.js' });
  return { UI: context.LeagueUI, P: context.LP };
}
const dataUrl = (bytes, type = 'webp') => `data:image/${type};base64,${'A'.repeat(bytes)}`;
const league = () => ({ profiles: {
  a: { id: 'a', displayName: 'กิฟท์', role: 'player', active: true, pin: '1234' },
  b: { id: 'b', displayName: 'Golf', role: 'player', active: true },
  c: { id: 'c', displayName: 'ปิด', role: 'player', active: false }
} });

test('imageOk enforces type, base64 shape and size limits', () => {
  const { UI } = load();
  assert.equal(UI.LIMITS.avatar, 12 * 1024);
  assert.ok(UI.imageOk(dataUrl(1000), UI.LIMITS.avatar));
  assert.ok(UI.imageOk(dataUrl(1000, 'jpeg'), UI.LIMITS.avatar));
  assert.ok(!UI.imageOk(dataUrl(UI.LIMITS.avatar), UI.LIMITS.avatar), 'over the avatar limit');
  assert.ok(UI.imageOk(dataUrl(UI.LIMITS.avatar), UI.LIMITS.payQr), 'bank QR may be bigger');
  assert.ok(!UI.imageOk(dataUrl(UI.LIMITS.payQr), UI.LIMITS.payQr));
  for (const bad of ['data:image/svg+xml;base64,AAAA', 'javascript:alert(1)', 'https://x.example/a.png', 'data:image/png;base64,AA"><img', '', null, 42])
    assert.ok(!UI.imageOk(bad, UI.LIMITS.payQr), String(bad));
});

test('compress keeps the first step under the limit, or gives up', () => {
  const { P } = load();
  const tried = [];
  const encode = (size, q) => { tried.push([size, q]); return dataUrl(Math.round(size * size * q * 2.2)); };
  const url = P.compress(encode, P.AVATAR_PLAN, P.LIMITS.avatar);
  assert.ok(url.length <= P.LIMITS.avatar);
  assert.ok(tried.every(([s]) => s === 96), 'avatar is always 96x96');
  assert.ok(tried.length > 1, 'stepped quality down');
  assert.equal(P.compress(() => dataUrl(50000), P.AVATAR_PLAN, P.LIMITS.avatar), '');
  assert.equal(P.compress(() => 'data:text/html;base64,AAAA', P.QR_PLAN, P.LIMITS.payQr), '');
  const qr = P.compress((size, q) => dataUrl(Math.round(size * size * q * 0.25)), P.QR_PLAN, P.LIMITS.payQr);
  assert.ok(qr && qr.length <= P.LIMITS.payQr);
});

test('square crop and fit keep proportions', () => {
  const { P } = load();
  assert.deepEqual({ ...P.coverRect(400, 300) }, { sx: 50, sy: 0, sw: 300, sh: 300 });
  assert.deepEqual({ ...P.coverRect(300, 500) }, { sx: 0, sy: 100, sw: 300, sh: 300 });
  assert.deepEqual({ ...P.fitWithin(4000, 3000, 400) }, { w: 400, h: 300 });
  assert.deepEqual({ ...P.fitWithin(200, 100, 400) }, { w: 200, h: 100 });
});

test('checkEdit keeps the rename rules and validates every field', () => {
  const { P } = load();
  const L = league();
  const ok = P.checkEdit(L, 'a', { displayName: '  กิฟท์ใหม่ ', tagline: ' ตบ\n ไม่เลือก​ หน้า ', payMethod: 'promptpay', promptpay: '081-234-5678' });
  assert.equal(ok.error, undefined);
  assert.equal(ok.clean.displayName, 'กิฟท์ใหม่');
  assert.equal(ok.clean.tagline, 'ตบ ไม่เลือก หน้า');
  assert.equal(ok.clean.promptpay, '0812345678');
  assert.equal(P.checkEdit(L, 'a', { displayName: 'golf' }).error, 'มีชื่อนี้แล้ว');
  assert.equal(P.checkEdit(L, 'a', { displayName: '   ' }).error, 'กรอกชื่อเล่นก่อน');
  assert.match(P.checkEdit(L, 'a', { displayName: 'x'.repeat(31) }).error, /30/);
  assert.match(P.checkEdit(L, 'c', { displayName: 'ปิด' }).error, /เข้าสู่ระบบ/);
  assert.equal(P.checkEdit(L, 'a', { displayName: 'A', tagline: 'ก'.repeat(80) }).clean.tagline.length, 40);
  assert.match(P.checkEdit(L, 'a', { displayName: 'A', payMethod: 'promptpay', promptpay: '1101700230709' }).error, /ไม่ถูกต้อง/);
  assert.match(P.checkEdit(L, 'a', { displayName: 'A', avatar: dataUrl(20000) }).error, /ใหญ่/);
  assert.match(P.checkEdit(L, 'a', { displayName: 'A', payMethod: 'qr', payQr: '' }).error, /QR/);
  assert.equal(P.checkEdit(L, 'a', { displayName: 'A', payMethod: 'qr', payQr: dataUrl(15000) }).clean.payQr.length, 15000 + 23);
});

test('applyEdit stores only what is needed and reports changed fields', () => {
  const { P } = load();
  const person = { id: 'a', displayName: 'กิฟท์', pin: '1234', promptpay: '0812345678' };
  const changed = P.applyEdit(person, { displayName: 'กิฟท์', tagline: 'มาสิ', avatar: '', promptpay: '', payQr: dataUrl(10) });
  assert.deepEqual([...changed], ['tagline', 'promptpay', 'payQr']);
  assert.equal(person.promptpay, undefined, 'switching to a bank QR drops the PromptPay number');
  assert.equal(person.pin, '1234', 'other fields untouched');
  assert.ok(!('avatar' in person), 'empty fields are not stored');
  assert.equal(P.applyEdit(person, { displayName: 'กิฟท์', tagline: 'มาสิ', payQr: person.payQr }).length, 0);
});

test('payee lookup and payment method', () => {
  const { P } = load();
  const L = league();
  assert.equal(P.payeeByName(L, ' golf ').id, 'b');
  assert.equal(P.payeeByName(L, 'ปิด'), null, 'closed accounts are not paid');
  assert.equal(P.payeeByName(L, ''), null);
  assert.equal(P.payMethod({ promptpay: '0812345678' }).type, 'promptpay');
  assert.equal(P.payMethod({ promptpay: '123' }), null);
  assert.equal(P.payMethod({ payQr: dataUrl(100) }).type, 'qr');
  assert.equal(P.payMethod({ payQr: 'javascript:x' }), null);
});

test('pay sheet draws a PromptPay QR with the amount and a bank QR as an image', () => {
  const { P } = load();
  const pp = P.payHtml({ payee: { id: 'b', displayName: 'Golf', promptpay: '0812345678' }, fromName: 'กิฟท์', amount: 150 });
  assert.match(pp, /<svg class="pay-qr-code"/);
  assert.match(pp, /฿150/);
  assert.match(pp, /081-234-5678/);
  assert.match(pp, /data-pay-copy="150.00"/);
  const img = P.payHtml({ payee: { id: 'b', displayName: 'Golf', payQr: dataUrl(100) }, amount: 12.5 });
  assert.match(img, /<img src="data:image\/webp;base64,/);
  assert.match(img, /พิมพ์ ฿12\.50 เอง/);
  assert.match(P.payHtml({ payee: { id: 'b', displayName: 'Golf' }, amount: 5 }), /ยังไม่ได้ใส่ช่องทางรับเงิน/);
});
