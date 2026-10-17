const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// QA X1: values that come from the shared cloud row (ids, scores, ranks, Season numbers) must not become markup.
const BAD = '"><img src=x onerror=alert(1)>';

function fakeElement(id = '') {
  const el = {
    id, style: {}, dataset: {}, value: '', disabled: false, textContent: '', innerHTML: '', className: '', onclick: null, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, addEventListener() {}, insertAdjacentHTML() {},
    appendChild(child) { el.children.push(child); return child; }, querySelectorAll: () => [], querySelector: () => null
  };
  return el;
}
function load(files, league) {
  const values = new Map([['pp_league_v7_uid', JSON.stringify(league)], ['pp_user_id', 'a']]);
  const elements = new Map();
  const document = {
    readyState: 'complete', body: fakeElement('body'),
    getElementById: id => { if (!elements.has(id)) elements.set(id, fakeElement(id)); return elements.get(id); },
    createElement: () => fakeElement(), querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
  };
  const context = {
    document, console, alert() {}, confirm: () => false,
    localStorage: { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k), key: () => null, length: 0 },
    fetch: async () => { throw new Error('offline'); },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, requestAnimationFrame: () => 0,
    history: { replaceState() {} }, addEventListener() {}, MutationObserver: class { observe() {} }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  const html = id => [elements.get(id)?.innerHTML || '', ...(elements.get(id)?.children || []).map(c => c.innerHTML)].join('');
  return { html };
}

test('index.js escapes roster ids, stored scores and ranking values', () => {
  const league = {
    profiles: { a: { id: 'a', displayName: 'Alice', role: 'admin', active: true }, [BAD]: { id: BAD, displayName: 'Mallory', role: 'player', active: true } },
    seasonPlayerIds: ['a', BAD], currentSeason: 2, rounds: [{ rest: null, m: [['a', BAD]] }],
    results: { r0m0: { a: BAD, b: 3 } },
    rankHistory: [{ season: 1, standings: [{ userId: 'a', rank: BAD, rpAward: BAD }] }], seasonArchives: [], auditLog: []
  };
  const { html } = load(['shared.js', 'index.js'], league);
  for (const id of ['rosterList', 'schedule', 'rankingList']) assert.doesNotMatch(html(id), /<img/, id);
  assert.match(html('rosterList'), /data-roster="&quot;&gt;&lt;img/);
});

test('archive.js escapes Season numbers and standings values from archives', () => {
  const league = {
    profiles: { a: { id: 'a', displayName: 'Alice', role: 'admin', active: true } }, rankHistory: [], auditLog: [],
    seasonArchives: [{ season: BAD, rounds: [], results: {}, standings: [{ userId: 'a', rank: BAD, pts: BAD, gd: BAD, rpAward: BAD }], profileNames: {} }]
  };
  const { html } = load(['shared.js', 'player-ui.js', 'archive.js'], league);
  for (const id of ['seasonList', 'archiveStandings']) assert.doesNotMatch(html(id), /<img/, id);
  assert.match(html('seasonList'), /data-season="&quot;&gt;&lt;img/);
});

test('profile sheets and avatars escape names, catchphrases and pictures from the shared row', () => {
  const context = { console, requestAnimationFrame: () => 0, MutationObserver: class { observe() {} },
    document: { readyState: 'complete', body: { querySelectorAll: () => [] }, querySelectorAll: () => [], querySelector: () => null, getElementById: () => null, addEventListener() {} } };
  context.window = context;
  vm.createContext(context);
  for (const f of ['player-ui.js', 'promptpay.js', 'vendor/qrcode-generator/qrcode.js', 'profile-me.js']) vm.runInContext(fs.readFileSync(f, 'utf8'), context, { filename: f });
  const P = context.LeagueProfile, UI = context.LeagueUI;
  const evil = { id: BAD, displayName: BAD, tagline: BAD, promptpay: '0812345678', avatar: `data:image/png;base64,AA${BAD}` };
  for (const html of [P.payHtml({ payee: evil, fromName: BAD, amount: 10 }), P.payHtml({ payee: { ...evil, promptpay: '', payQr: `data:image/png;base64,${BAD}` } }),
    P.sheetHtml(evil, { displayName: BAD, tagline: BAD, avatar: '', payMethod: 'promptpay', promptpay: BAD, payQr: '' }), UI.avatar(BAD, BAD)])
    assert.doesNotMatch(html, /<img src=x/, html.slice(0, 80));
  assert.doesNotMatch(UI.avatar(BAD, BAD), /<img/, 'an invalid picture falls back to initials');
});
