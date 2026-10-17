const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Minimal DOM stand-in: enough for the predictions page scripts to load offline.
function fakeElement(id = '') {
  const listeners = {};
  const el = {
    id, style: {}, dataset: {}, value: '', disabled: false, textContent: '', innerHTML: '', className: '', onclick: null, onchange: null, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, remove() {},
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type) { return Promise.all((listeners[type] || []).map(fn => fn({}))); },
    appendChild(child) { el.children.push(child); return child; }, querySelectorAll: () => [], querySelector: () => null
  };
  return el;
}

// The cloud row lives in memory; GET returns it and PATCH replaces it, so nothing leaves the process.
function loadPredictions({ league, predictions, userId, confirmAnswer = true }) {
  const row = { league: { uidLeague: league }, predictions: { uidPredictions: predictions }, updated_at: '2026-10-15T00:00:00.000Z' };
  const values = new Map([['pp_league_v7_uid', JSON.stringify(league)], ['pp_predictions_v3_uid', JSON.stringify(predictions)], ['pp_user_id', userId]]);
  const localStorage = { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const elements = new Map();
  const alerts = [], shared = [];
  const document = {
    readyState: 'complete', body: fakeElement('body'), documentElement: { scrollHeight: 0 },
    getElementById: id => { if (!elements.has(id)) elements.set(id, fakeElement(id)); return elements.get(id); },
    createElement: () => fakeElement(), querySelectorAll: () => [], querySelector: () => null, addEventListener() {}
  };
  let tick = 0;
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'PATCH') {
      const body = JSON.parse(options.body);
      Object.assign(row, JSON.parse(JSON.stringify(body)), { updated_at: `2026-10-15T00:00:${String(++tick).padStart(2, '0')}.000Z` });
    }
    return { ok: true, json: async () => [JSON.parse(JSON.stringify(row))] };
  };
  const context = {
    localStorage, document, console, fetch,
    alert: msg => alerts.push(String(msg)), confirm: () => confirmAnswer,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    history: { replaceState() {} }, addEventListener() {},
    navigator: { share: async data => { shared.push(data); } },
    MutationObserver: class { observe() {} }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['shared.js', 'bet-settle.js', 'predictions-board.js', 'predictions.js', 'predictions-realtime.js', 'predictions-export.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  }
  const run = code => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context) ?? 'null');
  const settle = () => elements.get('settleAll').onclick();
  // Another device edits the league (e.g. admin corrects a score) without touching predictions.
  const editCloud = change => { change(row.league.uidLeague); row.updated_at = `2026-10-15T01:00:${String(++tick).padStart(2, '0')}.000Z`; };
  return { context, elements, row, alerts, shared, run, settle, editCloud, exec: code => vm.runInContext(code, context) };
}

const profiles = {
  a: { id: 'a', displayName: 'Alice', role: 'admin', active: true },
  b: { id: 'b', displayName: 'Bob', role: 'player', active: true },
  c: { id: 'c', displayName: '<img src=x onerror=alert(1)>', role: 'player', active: true },
  d: { id: 'd', displayName: 'Dealer', role: 'player', active: true }
};
// Season 3 is current. Season 2 finished with a full archive; Season 1 finished while the archive hook was broken (none).
const baseLeague = () => ({
  profiles: JSON.parse(JSON.stringify(profiles)), seasonPlayerIds: ['a', 'b', 'c', 'd'], currentSeason: 3,
  rounds: [{ rest: null, m: [['b', 'c'], ['a', 'd']] }],
  results: { r0m0: { a: 11, b: 9 } },
  rankHistory: [{ season: 2, standings: [{ userId: 'c', rank: 1, rpAward: 100 }] }],
  seasonArchives: [{ season: 2, rounds: [{ m: [['a', 'b']] }], results: { r0m0: { a: 11, b: 5 } }, standings: [] }],
  auditLog: []
});
const bet = (id, extra) => ({ id, status: 'pending', net: 0, createdAt: '2026-10-01T00:00:00.000Z', ...extra });
const basePredictions = () => ({
  dealerId: 'd', markets: {}, nextBetId: 4,
  bets: [
    bet(1, { season: 3, matchId: 'r0m0', pair: ['b', 'c'], favoriteId: 'b', handicap: 0.5, userId: 'a', sideId: 'b', stake: 500 }),
    bet(2, { season: 2, matchId: 'r0m0', pair: ['a', 'b'], favoriteId: 'a', handicap: 1.5, userId: 'c', sideId: 'b', stake: 100 }),
    bet(3, { season: 1, matchId: 'r0m0', pair: ['b', 'c'], favoriteId: 'b', handicap: 0.5, userId: 'b', sideId: 'c', stake: 50 })
  ]
});

test('latestOutcomeForBet judges the current Season from live scores (QA P1)', () => {
  const { run } = loadPredictions({ league: baseLeague(), predictions: basePredictions(), userId: 'd' });
  assert.deepEqual(run('latestOutcomeForBet(pred.bets[0])'), { type: 'win', winnerId: 'b' });
  run('(league.results.r0m0={a:9,b:11},0)');
  assert.deepEqual(run('latestOutcomeForBet(pred.bets[0])'), { type: 'win', winnerId: 'c' });
  run('(league.results.r0m0={a:10,b:10},0)');
  assert.deepEqual(run('latestOutcomeForBet(pred.bets[0])'), { type: 'win', winnerId: 'c' }, 'b gives 0.5 so 10-10 goes to c');
  run('(league.results.r0m0={a:5},0)');
  assert.equal(run('latestOutcomeForBet(pred.bets[0])'), null, 'half-entered score has no outcome');
  run('(league.results={},0)');
  assert.equal(run('latestOutcomeForBet(pred.bets[0])'), null);
});

test('latestOutcomeForBet reads a finished Season from seasonArchives and refuses other pairs (QA P2)', () => {
  const { run } = loadPredictions({ league: baseLeague(), predictions: basePredictions(), userId: 'd' });
  assert.deepEqual(run('latestOutcomeForBet(pred.bets[1])'), { type: 'win', winnerId: 'a' }, 'a gives 1.5: 9.5 vs 5');
  assert.equal(run('latestOutcomeForBet(pred.bets[2])'), null, 'Season 1 has no archive');
  run('(pred.bets[0].pair=["c","b"],0)');
  assert.equal(run('latestOutcomeForBet(pred.bets[0])'), null, 'schedule changed under the bet');
  run('(pred.bets[0].pair=["b","c"],delete pred.bets[0].handicap,pred.markets["s3:r0m0"]={favoriteId:"b",handicap:0.5,open:false},0)');
  assert.deepEqual(run('latestOutcomeForBet(pred.bets[0])'), { type: 'win', winnerId: 'b' }, 'legacy bet falls back to the stored market');
});

test('Settle button follows score edits: re-settles, reverts cleared scores to pending and logs both (QA P1)', async () => {
  const { run, settle, editCloud, row, alerts } = loadPredictions({ league: baseLeague(), predictions: basePredictions(), userId: 'd' });
  await settle();
  let bets = row.predictions.uidPredictions.bets;
  assert.deepEqual(bets.map(b => [b.status, b.net]), [['won', 500], ['lost', -100], ['pending', 0]]);
  assert.equal((row.predictions.uidPredictions.settleLog || []).length, 0, 'first settlement is not a correction');

  editCloud(l => { l.results.r0m0 = { a: 9, b: 11 }; });
  await settle();
  bets = row.predictions.uidPredictions.bets;
  assert.deepEqual([bets[0].status, bets[0].net], ['lost', -500]);
  const log = row.predictions.uidPredictions.settleLog;
  assert.equal(log[0].action, 'bet_resettle');
  assert.deepEqual([log[0].betId, log[0].from, log[0].to, log[0].oldNet, log[0].newNet, log[0].actorId], [1, 'won', 'lost', 500, -500, 'd']);
  assert.match(alerts.at(-1), /แก้ผลตามคะแนนที่ถูกแก้ 1 รายการ/);

  editCloud(l => { delete l.results.r0m0; });
  await settle();
  bets = row.predictions.uidPredictions.bets;
  assert.deepEqual([bets[0].status, bets[0].net, 'settledAt' in bets[0]], ['pending', 0, false]);
  assert.equal(row.predictions.uidPredictions.settleLog[0].action, 'bet_revert');
  assert.match(alerts.at(-1), /กลับเป็นรอผล 1 รายการ/);
  assert.equal(bets[1].status, 'lost', 'archived Season result is untouched by current score edits');
  assert.equal(run('pred.bets[2].status'), 'pending', 'no archive: left for the dealer to void');
});

test('Settlement table and history follow the current score before the dealer re-settles (QA P1)', async () => {
  const { run, settle, editCloud, elements, context } = loadPredictions({ league: baseLeague(), predictions: basePredictions(), userId: 'd' });
  await settle();
  assert.equal(elements.get('dealerPays').textContent, '500');
  editCloud(l => { l.results.r0m0 = { a: 9, b: 11 }; });
  await context.pull();
  assert.equal(run('pred.bets[0].status'), 'won', 'stored value is still the old one');
  assert.equal(elements.get('dealerPays').textContent, '0');
  assert.equal(elements.get('dealerReceives').textContent, '500');
  assert.match(elements.get('settleAlert').textContent, /คะแนนถูกแก้\/ลบหลังคำนวณ 1 รายการ/);
  assert.match(elements.get('history').innerHTML, /แพ้ <span title="คะแนนถูกแก้หลังคำนวณ/);
});

test('Finished-Season bets stay visible, settle from the archive and can be voided (QA P2)', async () => {
  const { exec, settle, elements, row, shared } = loadPredictions({ league: baseLeague(), predictions: basePredictions(), userId: 'd' });
  assert.match(elements.get('settleAlert').textContent, /รายการทายค้างจาก Season ก่อน 2 รายการ \(Season 2, 1\)/);
  assert.match(elements.get('settlementSeasonSelect').innerHTML, /Season 1 • มีรายการค้าง/);
  await settle();
  assert.equal(row.predictions.uidPredictions.bets[1].status, 'lost', 'Season 2 bet settled against its archive');

  const select = elements.get('settlementSeasonSelect');
  select.value = '1'; select.onchange();
  assert.equal(elements.get('settlementSeason').textContent, 1);
  assert.match(elements.get('settlementPending').innerHTML, /#3 .*Bob.*ไม่มี Archive.*data-void="3"/);
  await elements.get('exportSettlement').fire('click');
  assert.match(shared[0].title, /Season 1/);
  assert.match(shared[0].text, /ยังมีรายการรอผล 1 รายการ\n {2}• #3 Bob: 50 \(r0m0\)/);

  await exec('voidOldBet(1)');
  assert.equal(row.predictions.uidPredictions.bets[0].status, 'won', 'current-Season bets cannot be voided here');
  await exec('voidOldBet(3)');
  const b3 = row.predictions.uidPredictions.bets[2];
  assert.deepEqual([b3.status, b3.net], ['void', 0]);
  assert.equal(row.predictions.uidPredictions.settleLog[0].action, 'bet_void');
  assert.equal(elements.get('settleAlert').textContent, '');
});

test('Closed accounts with bets stay in the Season table (needed for P2 totals)', () => {
  const league = baseLeague(); league.profiles.c.active = false;
  const { elements } = loadPredictions({ league, predictions: basePredictions(), userId: 'd' });
  elements.get('settlementSeasonSelect').value = '2'; elements.get('settlementSeasonSelect').onchange();
  assert.match(elements.get('settlement').innerHTML, /data-profile="c">&lt;img src=x onerror=alert\(1\)&gt;<\/button> <small class="muted">ปิดบัญชีแล้ว/);
});

test('Names and ids from the cloud are escaped on the predictions page (QA X1)', () => {
  const league = baseLeague();
  const { elements, run } = loadPredictions({ league, predictions: basePredictions(), userId: 'a' });
  for (const id of ['history', 'settlement', 'dealerSelect']) assert.doesNotMatch(elements.get(id).innerHTML, /<img/, id);
  run('openProfile("c")');
  assert.doesNotMatch(elements.get('profileHistory').innerHTML, /<img/);
  assert.match(elements.get('profileHistory').innerHTML, /&lt;img src=x/);
  run('(league.rankHistory[0].standings[0].rank=\'1"><img src=x>\',openProfile("c"),0)');
  assert.doesNotMatch(elements.get('profileHistory').innerHTML, /<img/);
});
