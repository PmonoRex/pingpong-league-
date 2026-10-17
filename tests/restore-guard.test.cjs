const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fakeElement(id = '') {
  const listeners = {};
  const el = {
    id, style: {}, dataset: {}, value: '', disabled: false, textContent: '', innerHTML: '', className: '', onclick: null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type, event) { (listeners[type] || []).forEach(fn => fn(event)); },
    querySelectorAll: () => [], querySelector: () => null
  };
  return el;
}

// Backup page with an in-memory cloud row: GET returns it, PATCH replaces it. No network.
async function loadBackup({ league, backups, confirmAnswer = true }) {
  const row = { league: { uidLeague: league }, updated_at: '2026-10-15T00:00:00.000Z' };
  const values = new Map([['pp_league_v7_uid', JSON.stringify(league)], ['pp_user_id', 'a'], ['pp_backup_center_v1', JSON.stringify(backups)]]);
  const localStorage = { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const elements = new Map(), alerts = [], patches = [];
  const document = { getElementById: id => { if (!elements.has(id)) elements.set(id, fakeElement(id)); return elements.get(id); }, querySelectorAll: () => [] };
  const fetch = async (url, options = {}) => {
    if (options.method === 'PATCH') { const body = JSON.parse(options.body); patches.push(body); Object.assign(row, body); }
    return { ok: true, json: async () => [JSON.parse(JSON.stringify(row))] };
  };
  const context = { localStorage, document, console, fetch, alert: m => alerts.push(String(m)), confirm: () => confirmAnswer };
  context.window = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'backup.js', 'restore-guard.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  await new Promise(r => setImmediate(r));
  const exec = code => vm.runInContext(code, context);
  const select = i => { exec(`selected=list()[${i}]`); elements.get('backupList').fire('click', { target: { closest: () => ({}) } }); };
  return { elements, alerts, patches, row, exec, select };
}

const profiles = Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { id, displayName: id.toUpperCase() + 'name', role: id === 'a' ? 'admin' : 'player', active: true }]));
// The schedule was re-drawn after the backup (e.g. "เปลี่ยนรายชื่อ"): positions now hold different pairs.
const current = () => ({ profiles, seasonPlayerIds: ['a', 'b', 'c', 'd'], currentSeason: 1, rankHistory: [], seasonArchives: [], auditLog: [],
  rounds: [{ m: [['c', 'd'], ['a', 'b']] }, { m: [['a', 'c'], ['b', 'd']] }], results: { r1m1: { a: 2, b: 11 }, r0m0: { a: 4, b: 11 } } });
const backupState = () => ({ profiles, seasonPlayerIds: ['a', 'b', 'c', 'd'], currentSeason: 1,
  rounds: [{ m: [['a', 'b'], ['c', 'd']] }, { m: [['c', 'a'], ['b', 'd']] }], results: { r0m0: { a: 11, b: 5 }, r0m1: { a: 7, b: 11 }, r1m0: { a: 3, b: 11 } } });
const snap = state => ({ id: 'b_1', savedAt: '2026-10-10T00:00:00.000Z', reason: 'Manual', state });

test('planScores restores only matches whose id still maps to the same pair (QA B1)', () => {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync('restore-guard.js', 'utf8') + ';this.RG=RestoreGuard', ctx);
  const plan = JSON.parse(JSON.stringify(ctx.RG.planScores(current(), backupState())));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.skipped.map(x => x.id).sort(), ['r0m0', 'r0m1']);
  assert.deepEqual(plan.results.r1m0, { a: 11, b: 3 }, 'c-a in the backup is a-c now: score is flipped to match');
  assert.equal(plan.results.r1m1, undefined, 'same pair, no score in the backup: cleared as before');
  assert.deepEqual(plan.results.r0m0, { a: 4, b: 11 }, 'skipped position keeps its current score');
  assert.match(ctx.RG.describe(plan, current(), backupState()), /✗ r0m0 Backup: Aname vs Bname 11-5 → ตอนนี้: Cname vs Dname \(คู่ไม่ตรงกับตารางปัจจุบัน\)/);

  const other = ctx.RG.planScores({ ...current(), currentSeason: 2 }, backupState());
  assert.equal(other.ok, false);
  assert.match(other.message, /ซีซั่น 1 แต่ตอนนี้เป็นซีซั่น 2/);
  const none = ctx.RG.planScores(current(), { ...backupState(), rounds: [{ m: [['d', 'a'], ['b', 'c']] }], results: { r0m0: { a: 1, b: 11 } } });
  assert.equal(none.ok, false);
  assert.match(none.message, /ไม่มีคะแนนที่ตรงคู่/);
});

test('"กู้เฉพาะคะแนน" on the Backup page writes only matched pairs and shows what is skipped (QA B1)', async () => {
  const { elements, patches, row, select, alerts } = await loadBackup({ league: current(), backups: [snap(backupState())] });
  select(0);
  assert.match(elements.get('backupPreview').textContent, /^จะกู้ 2 คู่ • ข้าม 2 คู่/);
  await elements.get('restoreScores').onclick();
  assert.equal(patches.length, 1);
  const results = row.league.uidLeague.results;
  assert.deepEqual(results, { r0m0: { a: 4, b: 11 }, r1m0: { a: 11, b: 3 } });
  assert.deepEqual(row.league.uidLeague.auditLog[0].meta.skipped.sort(), ['r0m0', 'r0m1']);
  assert.equal(alerts.at(-1), 'กู้คืนสำเร็จ');
});

test('A Backup from another Season is refused without writing (QA B1)', async () => {
  const { elements, patches, alerts, select } = await loadBackup({ league: { ...current(), currentSeason: 2 }, backups: [snap(backupState())] });
  select(0);
  await elements.get('restoreScores').onclick();
  assert.equal(patches.length, 0);
  assert.match(alerts.at(-1), /กู้เฉพาะคะแนนไม่ได้/);
});

test('Full restore still goes through the original code path', async () => {
  const { elements, row, select } = await loadBackup({ league: current(), backups: [snap(backupState())] });
  select(0);
  await elements.get('restoreFull').onclick();
  assert.deepEqual(row.league.uidLeague.rounds, backupState().rounds);
});
