const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  const context = { document: { getElementById: () => null } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('dummy.js', 'utf8'), context, { filename: 'dummy.js' });
  return context.DummyScore;
}

test('normalize trims players, caps at 4 and aligns round scores to players', () => {
  const D = load();
  const s = D.normalize({ players: [' A ', '', 'B', 'C', 'D', 'E'], target: '500', knockBonus: -3, rounds: [{ scores: ['10', 'x'], knock: 9 }, null] });
  assert.deepEqual([...s.players], ['A', 'B', 'C', 'D']);
  assert.equal(s.target, 0);
  assert.equal(s.knockBonus, 0);
  assert.equal(s.moneyMode, 'points');
  assert.equal(s.rounds.length, 1);
  assert.deepEqual([...s.rounds[0].scores], [10, 0, 0, 0]);
  assert.equal(s.rounds[0].knock, null);
});

test('totals, standings and winner', () => {
  const D = load();
  const s = D.normalize({ players: ['A', 'B', 'C'], target: 100, rounds: [{ scores: [50, -20, 30], knock: 0 }, { scores: [10, 40, 80] }] });
  assert.deepEqual([...D.totals(s)], [60, 20, 110]);
  const st = D.standings(s);
  assert.deepEqual(st.map(r => r.name), ['C', 'A', 'B']);
  assert.equal(st[1].knocks, 1);
  assert.equal(D.winner({ ...s, target: 100 }).name, 'C');
  assert.equal(D.winner({ ...s, target: 0 }), null);
});

test('cardPoints uses Dummy card values', () => {
  const D = load();
  assert.equal(D.cardPoints({ low: 3, high: 2, ace: 1, special: 1 }), 15 + 20 + 15 + 50);
  assert.equal(D.cardPoints({}), 0);
});

test('settleWinner: knocker takes all, lower hand score pays more', () => {
  const D = load();
  const m = D.settleWinner({ scores: [80, 10, 40, -30], knock: 0, rates: [10, 20, 30] });
  assert.deepEqual([...m], [60, -20, -10, -30]);
});

test('settleWinner: equal scores pay the better rank rate; knock flags and โง่ double', () => {
  const D = load();
  assert.deepEqual([...D.settleWinner({ scores: [0, 20, 20, 5], knock: 0, rates: [10, 20, 30] })], [50, -10, -10, -30]);
  const m = D.settleWinner({ scores: [0, 20, 10, 5], knock: 0, flags: { dark: true, color: true }, dumb: [false, false, false, true], rates: [10, 20, 30] });
  assert.deepEqual([...m], [40 + 80 + 240, -40, -80, -240]);
});

test('settleWinner: no knock → top hand score wins, split on a tie; flags ignored', () => {
  const D = load();
  assert.deepEqual([...D.settleWinner({ scores: [10, 50, 30], knock: null, flags: { dark: true }, rates: [10, 20, 30] })], [-20, 30, -10]);
  assert.deepEqual([...D.settleWinner({ scores: [50, 50, 30], knock: null, rates: [10, 20, 30] })], [5, 5, -10]);
});

test('normalize keeps money mode, rates and per-round money', () => {
  const D = load();
  const s = D.normalize({ players: ['A', 'B'], moneyMode: 'winner', rates: [15, 'x'], rounds: [{ scores: [1, 2], knock: 0, money: [15, -15], dumb: [0, 1], flags: { dark: 1 } }] });
  assert.equal(s.moneyMode, 'winner');
  assert.deepEqual([...s.rates], [15, 0, 0]);
  assert.deepEqual([...D.moneyTotals(s)], [15, -15]);
  assert.equal(s.rounds[0].dumb[1], true);
  assert.equal(s.rounds[0].flags.dark, true);
  assert.equal(D.normalize({ moneyMode: 'bogus' }).moneyMode, 'points');
});

test('pairDebts keeps each pair separate and only nets two players who owe each other', () => {
  const D = load();
  const plain = t => JSON.parse(JSON.stringify(t.map(x => [x.from, x.to, x.amount, x.owed, x.back])));
  // game 1: A knocks (B 5, C 10, D 15); game 2: B knocks (A 5, C 15, D 10)
  const rounds = [{ money: [30, -5, -10, -15] }, { money: [-5, 30, -15, -10] }];
  assert.deepEqual(plain(D.pairDebts(rounds, 4)), [[2, 0, 10, 10, 0], [2, 1, 15, 15, 0], [3, 0, 15, 15, 0], [3, 1, 10, 10, 0]]);
  // B owed A 5 and A owed B 5 → they cancel, so no A–B line
  assert.equal(D.pairDebts(rounds, 4).some(x => (x.from === 0 && x.to === 1) || (x.from === 1 && x.to === 0)), false);
  // A owes B 20, B owes A 5 → A pays B 15
  assert.deepEqual(plain(D.pairDebts([{ money: [-20, 20] }, { money: [5, -5] }], 2)), [[0, 1, 15, 20, 5]]);
  // split pot: C's 0.15 shared between A and B without losing a satang
  assert.deepEqual(plain(D.pairDebts([{ money: [0.08, 0.07, -0.15] }], 3)), [[2, 0, 0.08, 0.08, 0], [2, 1, 0.07, 0.07, 0]]);
  assert.deepEqual(plain(D.pairDebts([{ money: null }], 2)), []);
});

test('settlePoints: score ÷ divisor, every pair pays the difference', () => {
  const D = load();
  const r = D.settlePoints([100, 40, -20], 10);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { vals: [10, 4, -2], money: [18, 0, -18] });
  const plain = t => JSON.parse(JSON.stringify(t.map(x => [x.from, x.to, x.amount])));
  assert.deepEqual(plain(D.pairDebts([r], 3)), [[1, 0, 6], [2, 0, 12], [2, 1, 6]]);
  // two games between the same pair net out pair by pair
  assert.deepEqual(plain(D.pairDebts([D.settlePoints([100, 40], 10), D.settlePoints([20, 60], 10)], 2)), [[1, 0, 2]]);
  assert.deepEqual(JSON.parse(JSON.stringify(D.settlePoints([105, 0, -25, 14, 4], 10).vals)), [11, 0, -3, 1, 0]);
  assert.deepEqual(JSON.parse(JSON.stringify(D.settlePoints([100, 40], 20).vals)), [5, 2]);
});

const plainJson = v => JSON.parse(JSON.stringify(v));
// Noon UTC keeps every test timestamp on the same local calendar day in any time zone from UTC−11 to UTC+11.
const noon = day => Date.parse(`${day}T12:00:00Z`);

test('normalize keeps dayStart and rev; currentRounds only shows games since the new day', () => {
  const D = load();
  const s = D.normalize({ players: ['A', 'B'], dayStart: noon('2026-10-17'), rev: '4', rounds: [{ scores: [1, 0], at: noon('2026-10-16') }, { scores: [2, 0], at: noon('2026-10-17') + 1 }] });
  assert.equal(s.rev, 4);
  assert.deepEqual(plainJson(D.currentRounds(s).map(r => r.scores[0])), [2]);
  assert.equal(D.currentRounds({ ...s, dayStart: 0 }).length, 2);
  assert.equal(D.normalize({ dayStart: -5, rev: 'x' }).dayStart, 0);
});

test('dayKey gives the local calendar day, empty for games without a timestamp', () => {
  const D = load();
  assert.equal(D.dayKey(noon('2026-10-17')), '2026-10-17');
  assert.equal(D.dayKey(0), '');
  assert.equal(D.dayKey(undefined), '');
});

test('daySummaries groups games per day, newest first, with that day\'s money and pair debts only', () => {
  const D = load();
  const s = D.normalize({ players: ['A', 'B', 'C'], rounds: [
    { scores: [100, 40, 0], at: noon('2026-10-16'), ...D.settlePoints([100, 40, 0], 10) },
    { scores: [0, 0, 0], at: 0 },
    { scores: [20, 60, 0], at: noon('2026-10-17'), ...D.settlePoints([20, 60, 0], 10) },
    { scores: [50, 0, 10], at: noon('2026-10-16') + 60000, ...D.settlePoints([50, 0, 10], 10) }
  ] });
  const days = plainJson(D.daySummaries(s));
  assert.deepEqual(days.map(d => [d.day, d.games, d.indices]), [['2026-10-17', 1, [2]], ['2026-10-16', 2, [0, 3]], ['', 1, [1]]]);
  assert.deepEqual(days[1].totals, [150, 40, 10]);
  // 16 Oct: game 1 is worth [10, 4, 0] baht, game 4 [5, 0, 1]
  assert.deepEqual(days[1].money, [16 + 9, -2 - 6, -14 - 3]);
  // pair rule per day: B owes A 6 + 5, C owes A 10 + 4, C owes B 4 and B owes C 1 → only that pair nets (C pays B 3)
  assert.deepEqual(days[1].debts.map(x => [x.from, x.to, x.amount]), [[1, 0, 11], [2, 0, 14], [2, 1, 3]]);
  assert.deepEqual(days[0].debts.map(x => [x.from, x.to, x.amount]), [[0, 1, 4], [2, 0, 2], [2, 1, 6]]);
  assert.equal(days[2].hasMoney, false);
  assert.deepEqual(days[2].debts, []);
});

test('mergeDummy keeps games added and deleted on both devices and the setting each side changed', () => {
  const D = load();
  const g = (at, a) => ({ scores: [a, 0], at });
  const base = { players: ['A', 'B'], rev: 3, divisor: 10, rounds: [g(1, 10), g(2, 20)] };
  const local = { ...base, divisor: 5, rounds: [g(1, 10), g(3, 30)] };          // deleted game 2, added game 3, changed divisor
  const remote = { ...base, rev: 4, moneyMode: 'winner', rounds: [g(1, 10), g(2, 20), g(4, 40)] }; // added game 4, changed mode
  const { state, conflict } = plainJson(D.mergeDummy(base, local, remote));
  assert.equal(conflict, false);
  assert.deepEqual(state.rounds.map(r => r.at), [1, 3, 4]);
  assert.equal(state.divisor, 5);
  assert.equal(state.moneyMode, 'winner');
  assert.equal(state.rev, 4);
  // the same game saved on both sides is not doubled; dayStart takes the later start
  const both = plainJson(D.mergeDummy(base, { ...base, dayStart: 9, rounds: [...base.rounds, g(5, 50)] }, { ...base, rev: 4, dayStart: 7, rounds: [...base.rounds, g(5, 50)] }).state);
  assert.deepEqual(both.rounds.map(r => r.at), [1, 2, 5]);
  assert.equal(both.dayStart, 9);
});

test('mergeDummy with different line-ups: the side that changed players wins, the cloud on a tie', () => {
  const D = load();
  const base = { players: ['A', 'B'], rev: 1, rounds: [{ scores: [1, 0], at: 1 }] };
  const mine = { players: ['A', 'C'], rounds: [{ scores: [5, 0], at: 2 }] };
  const r1 = plainJson(D.mergeDummy(base, mine, { ...base, rev: 2 }));
  assert.deepEqual([r1.state.players, r1.state.rev, r1.conflict], [['A', 'C'], 2, false]);
  const r2 = plainJson(D.mergeDummy(base, mine, { players: ['B', 'D'], rev: 2, rounds: [] }));
  assert.deepEqual([r2.state.players, r2.conflict], [['B', 'D'], true]);
  // a device with an old local sheet (no base yet) and an empty one: nothing to lose
  const r3 = plainJson(D.mergeDummy({}, { players: ['A', 'B'], rounds: [] }, { players: ['X', 'Y'], rev: 5, rounds: [] }));
  assert.equal(r3.conflict, false);
});

test('shared.js Dummy cloud helpers read the dummy column and lock on dummy.rev, never updated_at', async () => {
  const requests = [];
  let reply = [{ dummy: { players: ['A', 'B'], rev: 2 } }];
  const context = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, fetch: async (url, options) => { if (String(url).includes('/rpc/')) return { ok: false, status: 404, json: async () => ({ code: 'PGRST202' }) }; requests.push({ url, options }); return { ok: true, json: async () => reply }; } };
  vm.runInNewContext(fs.readFileSync('shared.js', 'utf8') + '\nglobalThis.shared = LeagueShared;', context);
  const S = context.shared;
  assert.deepEqual(plainJson(await S.loadDummyCloud()), { players: ['A', 'B'], rev: 2 });
  assert.match(requests[0].url, /id=eq\.main&select=dummy$/);
  reply = [{ dummy: { rev: 3 } }];
  assert.deepEqual(plainJson(await S.saveDummyCloud({ rev: 3 }, 2)), { rev: 3 });
  assert.match(requests[1].url, /dummy->>rev=eq\.2&select=dummy$/);
  assert.equal(requests[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[1].options.body), { dummy: { rev: 3 } });
  await S.saveDummyCloud({ rev: 1 }, 0);
  assert.match(requests[2].url, /dummy->>rev=is\.null/);
  reply = [];
  assert.equal(await S.saveDummyCloud({ rev: 3 }, 2), null);
  await assert.rejects(S.loadDummyCloud(), /row missing/);
});

test('entryCheck flags an all-zero game and scores far above what the sheet usually sees', () => {
  const D = load();
  assert.deepEqual(plainJson(D.entryCheck([0, 0, 0])), { allZero: true, big: [], limit: 1000 });
  assert.deepEqual(plainJson(D.entryCheck([120, -1500, 40])), { allZero: false, big: [1], limit: 1000 });
  assert.deepEqual(plainJson(D.entryCheck(['5', 0]).allZero), false);
  // a group that plays big hands: the limit follows 3× the median earlier score
  const rounds = [{ scores: [400, 500, 0] }, { scores: [600, -450, 700] }];
  assert.deepEqual(plainJson(D.entryCheck([1200, 1500, 0], rounds)), { allZero: false, big: [], limit: 1500 });
  assert.deepEqual(plainJson(D.entryCheck([1200, 1600, 0], rounds).big), [1]);
});

test('undoChange reverses a save, an edit and a delete by content, even after the list moved', () => {
  const D = load();
  const g = (at, a) => ({ scores: [a, 0], knock: null, money: null, vals: null, at });
  const list = [g(1, 10), g(2, 20), g(3, 30)];
  assert.deepEqual(plainJson(D.undoChange([...list, g(4, 40)], { type: 'add', round: g(4, 40) })), plainJson(list));
  // another device added a game after ours: ours still comes out, theirs stays
  assert.deepEqual(plainJson(D.undoChange([...list, g(4, 40), g(5, 50)], { type: 'add', round: g(4, 40) }).map(r => r.at)), [1, 2, 3, 5]);
  const edited = [g(1, 10), g(2, 99), g(3, 30)];
  assert.deepEqual(plainJson(D.undoChange(edited, { type: 'edit', before: g(2, 20), after: g(2, 99) })), plainJson(list));
  assert.deepEqual(plainJson(D.undoChange([g(1, 10), g(3, 30)], { type: 'delete', round: g(2, 20), index: 1 })), plainJson(list));
  // the index no longer fits the time order (a game was removed elsewhere): fall back to time order
  assert.deepEqual(plainJson(D.undoChange([g(3, 30)], { type: 'delete', round: g(2, 20), index: 5 }).map(r => r.at)), [2, 3]);
  assert.deepEqual(plainJson(D.undoChange([g(1, 10)], { type: 'delete', round: g(2, 20), index: 0 }).map(r => r.at)), [1, 2]);
  // the game is gone (deleted or changed on another device): nothing to undo
  assert.equal(D.undoChange(list, { type: 'add', round: g(9, 90) }), null);
  assert.equal(D.undoChange(list, { type: 'edit', before: g(2, 20), after: g(2, 77) }), null);
  assert.equal(D.undoChange(list, { type: 'bogus' }), null);
});
