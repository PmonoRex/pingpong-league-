const test = require('node:test');
const assert = require('node:assert');
const A = require('../awards.js');

const ids = ['a', 'b', 'c', 'd'];
const profiles = Object.fromEntries(ids.map(id => [id, { id, displayName: id.toUpperCase() }]));
const rr = pairs => [{ m: pairs }];
const res = scores => Object.fromEntries(scores.map((s, i) => [`r0m${i}`, { a: s[0], b: s[1] }]));
const row = (userId, rank, pts, gd) => ({ userId, name: userId.toUpperCase(), rank, pts, gd, rpAward: 100 - rank * 10 });

// Season 1 (finished 2026-09-01): a beats everyone, d last. Season 2 (finished 2026-10-01): d climbs to 1st.
const S1_PAIRS = [['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd'], ['c', 'd']];
const base = () => ({
  profiles, currentSeason: 3,
  seasonArchives: [
    { season: 1, rounds: rr(S1_PAIRS), results: res([[11, 2], [11, 3], [11, 1], [11, 9], [11, 5], [11, 4]]), profileNames: { a: 'A' } },
    // season 2: d beats a 11-9 (close, upset), d beats b 11-10 (close), d beats c 11-0; a beats b 11-2, a beats c 11-3, b beats c 12-10 (close)
    { season: 2, rounds: rr([['d', 'a'], ['d', 'b'], ['d', 'c'], ['a', 'b'], ['a', 'c'], ['b', 'c']]), results: res([[11, 9], [11, 10], [11, 0], [11, 2], [11, 3], [12, 10]]) }
  ],
  rankHistory: [
    { season: 1, finishedAt: '2026-09-01T12:00:00.000Z', standings: [row('a', 1, 9, 29), row('b', 2, 6, 6), row('c', 3, 3, -9), row('d', 4, 0, -26)] },
    { season: 2, finishedAt: '2026-10-01T12:00:00.000Z', standings: [row('d', 1, 9, 13), row('a', 2, 6, 17), row('b', 3, 3, -10), row('c', 4, 0, -20)] }
  ],
  rounds: [], results: {}
});
const get = (r, key) => r.awards.find(x => x.key === key);
const who = (r, key) => (get(r, key)?.winners || []).map(w => w.id).sort();

test('podium awards follow the recorded ranks, with reasons', () => {
  const r = A.compute(base(), 2);
  assert.deepStrictEqual(who(r, 'champion'), ['d']);
  assert.deepStrictEqual(who(r, 'runnerUp'), ['a']);
  assert.deepStrictEqual(who(r, 'third'), ['b']);
  assert.match(get(r, 'champion').winners[0].reason, /9 แต้ม/);
  assert.strictEqual(r.awards[r.awards.length - 1].key, 'champion', 'champion is revealed last');
});

test('podium ties share the award', () => {
  const l = base(); l.rankHistory[1].standings[1].rank = 1;
  assert.deepStrictEqual(who(A.compute(l, 2), 'champion'), ['a', 'd']);
});

test('improved: biggest rank climb against the previous season', () => {
  const r = A.compute(base(), 2), x = get(r, 'improved');
  assert.deepStrictEqual(who(r, 'improved'), ['d']);
  assert.strictEqual(x.basis, 'rank');
  assert.match(x.winners[0].reason, /อันดับ 4 ขึ้นมาอันดับ 1/);
});

test('improved: falls back to Elo gain in the first season', () => {
  const r = A.compute(base(), 1), x = get(r, 'improved');
  assert.strictEqual(x.basis, 'elo');
  assert.deepStrictEqual(who(r, 'improved'), ['a']);
});

test('clutch: most wins by 2 or fewer, ties share', () => {
  const r = A.compute(base(), 2);
  assert.deepStrictEqual(who(r, 'clutch'), ['d']); // d: 11-9 and 11-10; b: 12-10
  const l = base(); l.seasonArchives[1].results.r0m1 = { a: 11, b: 5 }; // d's second close win gone: d 1, b 1
  assert.deepStrictEqual(who(A.compute(l, 2), 'clutch'), ['b', 'd']);
});

test('wall and cannon: per-match averages', () => {
  const r = A.compute(base(), 2);
  // conceded: d 19/3, a 16/3, b 34/3, c 34/3 -> a; scored: d 33, a 31, b 22, c 10 -> d
  assert.deepStrictEqual(who(r, 'wall'), ['a']);
  assert.deepStrictEqual(who(r, 'cannon'), ['d']);
  assert.match(get(r, 'wall').winners[0].reason, /5\.33 แต้มต่อนัด \(3 นัด\)/);
});

test('wall: min matches keeps out a one-game player; everyone tied means no award', () => {
  const l = base();
  l.seasonArchives[1].rounds[0].m.push(['e', 'a']); l.seasonArchives[1].results.r0m6 = { a: 0, b: 11 };
  assert.ok(!who(A.compute(l, 2), 'wall').includes('e'));
  const flat = base(); flat.seasonArchives[1].results = res([[10, 10], [10, 10], [10, 10], [10, 10], [10, 10], [10, 10]]);
  const r = A.compute(flat, 2);
  assert.strictEqual(get(r, 'wall'), undefined);
  assert.strictEqual(get(r, 'cannon'), undefined);
});

test('oracle: needs 5 settled bets this season; most net, then hit rate', () => {
  const bets = (u, list, season = 2) => list.map(([status, net]) => ({ userId: u, season, status, net }));
  const pred = { bets: [
    ...bets('a', [['won', 50], ['won', 50], ['lost', -20], ['won', 30], ['lost', -10]]),           // +100, 3/5
    ...bets('b', [['won', 200], ['won', 10], ['won', 10], ['won', 10]]),                          // only 4 bets
    ...bets('c', [['won', 40], ['won', 40], ['won', 10], ['lost', 0], ['won', 10], ['open', 0]]), // +100, 4/5
    ...bets('d', [['won', 500], ['won', 500], ['won', 500], ['won', 500], ['won', 500]], 1)        // other season
  ] };
  const r = A.compute(base(), 2, { pred });
  assert.deepStrictEqual(who(r, 'oracle'), ['c']); // tie on +100, c hits more often
  assert.match(get(r, 'oracle').winners[0].reason, /กำไร 100 เครดิต • ทายถูก 4\/5/);
  const loss = { bets: [...bets('a', [['won', -1], ['lost', -5], ['lost', -5], ['won', 0], ['won', 0]]), ...bets('c', [['lost', -1], ['lost', -1], ['lost', -1], ['won', 0], ['lost', -1]])] };
  const x = get(A.compute(base(), 2, { pred: loss }), 'oracle');
  assert.strictEqual(x.basis, 'rate'); assert.deepStrictEqual(x.winners.map(w => w.id), ['a']);
  assert.strictEqual(get(A.compute(base(), 2, { pred: { bets: bets('a', [['won', 9]]) } }), 'oracle'), undefined);
});

test('regular: check-in days inside the season dates only', () => {
  const club = { checkin: {
    '2026-08-20': { a: 'x', b: 'x' },            // season 1
    '2026-09-05': { b: 'x', c: 'x' }, '2026-09-12': { b: 'x' }, '2026-09-30': { c: 'x', b: 'x' },
    '2026-10-02': { c: 'x' }, '2026-10-03': { c: 'x' } // season 3
  } };
  const r = A.compute(base(), 2, { club });
  assert.deepStrictEqual(who(r, 'regular'), ['b']);
  assert.strictEqual(get(r, 'regular').basis, 'checkin');
  assert.strictEqual(get(r, 'regular').value, '3 วัน');
});

test('regular: without season dates it uses matches played (round robin alone ties, friendlies decide)', () => {
  const l = base(); delete l.rankHistory[1].finishedAt;
  assert.strictEqual(get(A.compute(l, 2, { club: { checkin: { '2026-09-05': { a: 'x' } } } }), 'regular'), undefined);
  const club = { matches: [{ id: 'x', kind: 'challenge', a: 'c', b: 'd', s: { a: 3, b: 1 }, at: '2026-09-10T10:00:00.000Z' }] };
  const r = A.compute(base(), 2, { club });
  assert.deepStrictEqual(who(r, 'regular'), ['c', 'd']);
  assert.strictEqual(get(r, 'regular').basis, 'matches');
});

test('mvp: weekly winners in the season weeks, ties count for all', () => {
  const club = { mvp: {
    '2026-W34': { a: 'b', c: 'b' },              // before season 2 (season 1 ended 2026-09-01, W36)
    '2026-W37': { a: 'b', b: 'a', c: 'b' },      // b
    '2026-W38': { a: 'c', b: 'c' },              // c
    '2026-W39': { a: 'b', b: 'c' },              // tie b, c
    '2026-W41': { a: 'd', b: 'd' }               // after season 2 (ended 2026-10-01, W40)
  } };
  const r = A.compute(base(), 2, { club });
  assert.deepStrictEqual(who(r, 'mvp'), ['b', 'c']);
  assert.strictEqual(get(r, 'mvp').value, '2 สัปดาห์');
});

test('upset: biggest Elo gap beaten', () => {
  const r = A.compute(base(), 2), x = get(r, 'upset');
  assert.deepStrictEqual(who(r, 'upset'), ['d']); // last-placed d beat champion a
  assert.match(x.winners[0].reason, /ชนะ A 11-9 ทั้งที่ Elo ต่ำกว่า \d+/);
});

test('missing data: no archive scores, no club, no predictions -> only podium (+ improved by rank)', () => {
  const l = base(); l.seasonArchives = [];
  const keys = A.compute(l, 2).awards.map(a => a.key).sort();
  assert.deepStrictEqual(keys, ['champion', 'improved', 'runnerUp', 'third']);
  assert.strictEqual(A.compute(l, 3), null, 'unfinished season has no awards');
  assert.strictEqual(A.compute({ profiles: {} }, 1), null);
});

test('season range comes from this and the previous finishedAt', () => {
  const l = base();
  assert.deepStrictEqual(A.seasonRange(l, 2), { start: '2026-09-01T12:00:00.000Z', end: '2026-10-01T12:00:00.000Z' });
  assert.deepStrictEqual(A.seasonRange(l, 1), { start: null, end: '2026-09-01T12:00:00.000Z' });
  delete l.rankHistory[0].finishedAt;
  assert.strictEqual(A.seasonRange(l, 2).start, null);
  assert.strictEqual(A.weekKey('2026-10-01T12:00:00.000Z'), '2026-W40');
  assert.strictEqual(A.dateKey('2026-09-30T20:00:00.000Z'), '2026-10-01'); // Bangkok is UTC+7
});

test('forPlayer: every award a player won, latest season first; all() is latest first', () => {
  const list = A.forPlayer(base(), 'd');
  assert.ok(list.length >= 3);
  assert.strictEqual(list[0].season, 2);
  assert.ok(list.some(x => x.key === 'champion' && x.label === '🏆 แชมป์ S2'));
  assert.ok(list.every((x, i) => !i || list[i - 1].season >= x.season));
  assert.ok(A.forPlayer(base(), 'a').some(x => x.key === 'champion' && x.season === 1));
  assert.deepStrictEqual(A.forPlayer(base(), 'zzz'), []);
  assert.deepStrictEqual(A.all(base()).map(r => r.season), [2, 1]);
});

test('names come from the archive, then profiles', () => {
  const r = A.compute(base(), 1);
  assert.strictEqual(get(r, 'champion').winners[0].name, 'A');
});
