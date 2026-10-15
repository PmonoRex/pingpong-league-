const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal DOM stand-in: enough for index.js to load offline and render into throwaway elements.
function fakeElement(id = '') {
  const el = {
    id, style: {}, dataset: {}, value: '', disabled: false, textContent: '', innerHTML: '', className: '', onclick: null, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, addEventListener() {}, remove() { el.removed = true; },
    appendChild(child) { el.children.push(child); return child; }, querySelectorAll: () => [], querySelector: () => null
  };
  return el;
}

function loadIndex({ storage = {}, confirmAnswer = true } = {}) {
  // A logged-in user also has a server session token (shared.js drops an id without one).
  const values = new Map(Object.entries(storage.pp_user_id ? { pp_session_token_v1: 'test-token', ...storage } : storage));
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: i => [...values.keys()][i] ?? null,
    get length() { return values.size; }
  };
  const elements = new Map();
  const actions = fakeElement('standingsActions');
  const document = {
    readyState: 'complete',
    getElementById: id => { if (!elements.has(id)) elements.set(id, fakeElement(id)); return elements.get(id); },
    createElement: () => fakeElement(),
    querySelectorAll: () => [],
    querySelector: sel => sel === '#standingsCard .actions' ? actions : null,
    addEventListener() {}
  };
  const context = {
    localStorage, document, console,
    confirm: () => confirmAnswer, alert() {},
    fetch: async () => { throw new Error('offline'); },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    history: { replaceState() {} }, addEventListener() {}
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'index.js', 'archive-hook.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { context, elements, actions, values, run: code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)) };
}

const profiles = {
  a: { id: 'a', displayName: 'Alice', pin: '1234', role: 'admin', active: true },
  b: { id: 'b', displayName: 'Bob', pin: '1234', role: 'player', active: true },
  c: { id: 'c', displayName: 'Cat', pin: '1234', role: 'player', active: true }
};
const rounds = [{ rest: 'c', m: [['a', 'b']] }, { rest: 'a', m: [['b', 'c']] }, { rest: 'b', m: [['c', 'a']] }];
const results = { r0m0: { a: 11, b: 5 }, r1m0: { a: 11, b: 9 }, r2m0: { a: 7, b: 7 } };
const league = (extra = {}) => ({ profiles, seasonPlayerIds: ['a', 'b', 'c'], rounds, results, rankHistory: [], seasonArchives: [], currentSeason: 1, ...extra });

test('Finish Season button writes a full archive snapshot (QA A1)', () => {
  const { elements, run } = loadIndex({ storage: { pp_league_v7_uid: JSON.stringify(league()), pp_user_id: 'a' } });
  elements.get('finishSeason').onclick({});
  const out = run('({season: state.currentSeason, archives: state.seasonArchives, history: state.rankHistory})');
  assert.equal(out.season, 2);
  assert.equal(out.history.length, 1);
  assert.equal(out.archives.length, 1);
  assert.equal(out.archives[0].season, 1);
  assert.deepEqual(out.archives[0].results, results);
  assert.equal(out.archives[0].standings[0].userId, 'a');
  assert.equal(out.archives[0].profileNames.b, 'Bob');
});

test('Cancelled Finish Season writes nothing', () => {
  const { elements, run } = loadIndex({ storage: { pp_league_v7_uid: JSON.stringify(league()), pp_user_id: 'a' }, confirmAnswer: false });
  elements.get('finishSeason').onclick({});
  assert.equal(run('state.seasonArchives.length'), 0);
  assert.equal(run('state.currentSeason'), 1);
});

test('Back-fill rebuilds a lost archive only from a complete snapshot that matches rankHistory', () => {
  // Season 1 finished while the bug was live: rankHistory exists, archive missing, scores reset.
  const standings = [
    { userId: 'a', name: 'Alice', rank: 1, rpAward: 100, pts: 4, gd: 6 },
    { userId: 'b', name: 'Bob', rank: 2, rpAward: 80, pts: 3, gd: -4 },
    { userId: 'c', name: 'Cat', rank: 3, rpAward: 65, pts: 1, gd: -2 }
  ];
  const now = league({ currentSeason: 2, results: {}, rankHistory: [{ season: 1, finishedAt: '2026-10-01T10:00:00Z', standings }] });
  const good = { savedAt: '2026-10-01T09:59:00Z', league: league() };
  const wrong = { savedAt: '2026-10-01T09:59:30Z', league: league({ results: { ...results, r2m0: { a: 9, b: 7 } } }) };
  const partial = { savedAt: '2026-10-01T09:59:40Z', league: league({ results: { r0m0: results.r0m0 } }) };
  const { run, elements } = loadIndex({ storage: {
    pp_league_v7_uid: JSON.stringify(now), pp_user_id: 'a',
    pp_league_recovery_v1: JSON.stringify([partial, wrong, good])
  } });
  const found = run('LeagueArchiveBackfill.find()');
  assert.equal(found.length, 1);
  assert.equal(found[0].backfilled.snapshotAt, good.savedAt);
  assert.match(elements.get('archiveBackfill').textContent, /1 Season/);
  assert.equal(run('LeagueArchiveBackfill.apply()'), 1);
  assert.deepEqual(run('state.seasonArchives.map(a => [a.season, Object.keys(a.results).length])'), [[1, 3]]);
  assert.equal(run('LeagueArchiveBackfill.find().length'), 0);
});

test('Back-fill is admin-only', () => {
  const now = league({ currentSeason: 2, results: {}, rankHistory: [{ season: 1, standings: [{ userId: 'a', rank: 1, pts: 4, gd: 6 }] }] });
  const { run } = loadIndex({ storage: { pp_league_v7_uid: JSON.stringify(now), pp_user_id: 'b', pp_league_recovery_v1: JSON.stringify([{ league: league() }]) } });
  assert.equal(run('LeagueArchiveBackfill.apply()'), 0);
  assert.equal(run('state.seasonArchives.length'), 0);
});
