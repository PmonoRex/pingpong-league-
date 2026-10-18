const test = require('node:test');
const assert = require('node:assert');
const T = require('../tournament.js');

const players = n => Array.from({ length: n }, (_, i) => `p${i + 1}`);
const make = (n, o = {}) => T.createTournament({ id: 't1', name: 'ศึกทดสอบ', entrants: players(n), ...o });
const ko = t => T.knockoutOf(t);
const m = (t, id) => T.findMatch(t, id);
// Play every playable match without a result, the lower seed index winning 11-5 (or the reverse when flip says so).
function playAll(t, flip = () => false) {
  for (let guard = 0; guard < 100; guard++) {
    const next = T.allMatches(t).find(x => T.playable(x) && !x.s);
    if (!next) return t;
    const aWins = (next.a < next.b) !== flip(next);
    T.recordResult(t, next.id, aWins ? { a: 11, b: 5 } : { a: 5, b: 11 });
  }
  throw new Error('did not finish');
}

test('seed order puts 1 v N and keeps top seeds apart', () => {
  assert.deepStrictEqual(T.seedOrder(2), [1, 2]);
  assert.deepStrictEqual(T.seedOrder(4), [1, 4, 2, 3]);
  assert.deepStrictEqual(T.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('bracket sizes 2,3,4,5,6,8: byes go to the top seeds', () => {
  const expect = { 2: [1, 0], 3: [2, 1], 4: [2, 0], 5: [3, 3], 6: [3, 2], 8: [3, 0] };
  for (const [n, [rounds, byes]] of Object.entries(expect)) {
    const t = make(Number(n)), k = ko(t);
    assert.strictEqual(k.rounds, rounds, `rounds for ${n}`);
    const first = Object.values(k.matches).filter(x => x.r === 0);
    assert.strictEqual(first.filter(x => x.bye).length, byes, `byes for ${n}`);
    // Byes belong to seeds 1..byes (indexes 0..byes-1) and they are already through to round 2.
    first.filter(x => x.bye).forEach(x => assert.ok(T.winnerOf(x) < byes, `bye winner is a top seed (${n})`));
    // Every entrant appears exactly once in round 1.
    const seen = first.flatMap(x => [x.a, x.b]).filter(e => e >= 0).sort((a, b) => a - b);
    assert.deepStrictEqual(seen, [...Array(Number(n)).keys()]);
  }
  assert.strictEqual(m(make(2), 'r0m0').label, 'ชิงชนะเลิศ');
  assert.strictEqual(m(make(8), 'r0m0').label, 'ก่อนรองชนะเลิศ');
  assert.strictEqual(m(make(8), 'r1m0').label, 'รองชนะเลิศ');
  assert.strictEqual(T.roundName(0, 4), 'รอบแรก');
  assert.strictEqual(T.roundName(1, 5), 'รอบ 16 คนสุดท้าย');
});

test('a 3-player bracket: seed 1 waits in the final', () => {
  const t = make(3);
  assert.strictEqual(m(t, 'r1m0').a, 0);
  assert.strictEqual(m(t, 'r1m0').b, null);
  T.recordResult(t, 'r0m1', { a: 7, b: 11 });
  assert.strictEqual(m(t, 'r1m0').b, 2);
});

test('winners advance and the champion is found (6 players)', () => {
  const t = make(6, { thirdPlace: true });
  assert.strictEqual(t.status, 'running');
  T.recordResult(t, 'r0m1', { a: 11, b: 8 });           // seed 4 beats seed 5
  assert.strictEqual(m(t, 'r1m0').b, 3);
  assert.throws(() => T.recordResult(t, 'r0m0', { a: 11, b: 0 }), /ไม่พร้อม/);   // a bye cannot be scored
  assert.throws(() => T.recordResult(t, 'r0m3', { a: 9, b: 9 }), /ห้ามเสมอ/);
  playAll(t);
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.champion, 'p1');
  assert.deepStrictEqual(t.placings, { first: 0, second: 1, third: 2 });
  assert.deepStrictEqual(T.progress(t), { played: 6, total: 6 });
});

test('editing a result resets the later matches that depended on it', () => {
  const t = playAll(make(8, { thirdPlace: true }));
  assert.strictEqual(t.champion, 'p1');
  const cleared = T.recordResult(t, 'r0m0', { a: 3, b: 11 });   // seed 8 now beats seed 1
  assert.deepStrictEqual(cleared.sort(), ['p3', 'r1m0', 'r2m0'].sort());
  assert.strictEqual(m(t, 'r1m0').a, 7);
  assert.strictEqual(m(t, 'r1m0').s, null);
  assert.strictEqual(m(t, 'r1m1').s.a, 11, 'the other semi-final keeps its result');
  assert.strictEqual(t.champion, null);
  assert.strictEqual(t.status, 'running');
  // Same winner again: nothing downstream is touched.
  playAll(t);
  const again = T.recordResult(t, 'r0m1', { a: 11, b: 9 });
  assert.deepStrictEqual(again, []);
  assert.strictEqual(t.status, 'done');
  // Clearing a result also resets what follows.
  assert.ok(T.recordResult(t, 'r1m1', null).includes('r2m0'));
});

test('third-place match takes the semi-final losers', () => {
  const t = make(4, { thirdPlace: true });
  T.recordResult(t, 'r0m0', { a: 11, b: 4 });
  T.recordResult(t, 'r0m1', { a: 2, b: 11 });
  assert.deepStrictEqual([m(t, 'p3').a, m(t, 'p3').b], [3, 1]);
  T.recordResult(t, 'r1m0', { a: 11, b: 6 });
  assert.strictEqual(t.status, 'running', 'still waiting for the bronze match');
  assert.strictEqual(t.champion, 'p1');
  T.recordResult(t, 'p3', { a: 11, b: 9 });
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.placings.third, 3);
  assert.strictEqual(make(3, { thirdPlace: true }).bracket.third, null, 'no bronze match with 3 entrants');
});

test('group stage: sizes 3-5, round robin, top K into a knockout', () => {
  assert.deepStrictEqual(T.groupSizes(3), [3]);
  assert.deepStrictEqual(T.groupSizes(5), [5]);
  assert.deepStrictEqual(T.groupSizes(6), [3, 3]);
  assert.deepStrictEqual(T.groupSizes(7), [4, 3]);
  assert.deepStrictEqual(T.groupSizes(9), [5, 4]);
  assert.deepStrictEqual(T.groupSizes(10), [4, 3, 3]);
  assert.deepStrictEqual(T.groupSizes(13), [5, 4, 4]);
  for (let n = 3; n <= 24; n++) T.groupSizes(n).forEach(s => assert.ok(s >= 3 && s <= 5, `group size for ${n}`));
  const t = make(8, { kind: 'groups', advance: 2 });
  const b = t.bracket;
  assert.strictEqual(b.groups.length, 2);
  assert.deepStrictEqual(b.groups.map(g => g.members), [[0, 3, 4, 7], [1, 2, 5, 6]]);
  assert.strictEqual(Object.keys(b.groups[0].matches).length, 6);
  assert.strictEqual(b.ko, null);
  // Group A: p5 (index 4) wins everything; elsewhere the lower index wins.
  for (const g of b.groups) for (const x of Object.values(g.matches)) {
    const aWins = x.a === 4 ? true : x.b === 4 ? false : x.a < x.b;
    T.recordResult(t, x.id, aWins ? { a: 11, b: 6 } : { a: 6, b: 11 });
  }
  assert.strictEqual(T.groupTable(b.groups[0])[0].e, 4);
  assert.ok(b.ko, 'knockout built once every group game is in');
  assert.deepStrictEqual(b.ko.seeds, [4, 1, 0, 2]);              // A1, B1, A2, B2
  assert.deepStrictEqual([m(t, 'r0m0').a, m(t, 'r0m0').b], [4, 2]); // A1 v B2
  playAll(t, x => (x.a === 4 || x.b === 4) && (x.a < x.b) !== (x.a === 4));
  assert.strictEqual(t.status, 'done');
  assert.strictEqual(t.champion, 'p5');
  // Changing a group result that changes who qualifies rebuilds the knockout (results there are dropped).
  const gA = Object.values(b.groups[0].matches).find(x => (x.a === 4 && x.b === 0) || (x.a === 0 && x.b === 4));
  const before = T.groupTable(b.groups[0]).map(r => r.e).slice(0, 2);
  T.recordResult(t, gA.id, gA.a === 0 ? { a: 11, b: 0 } : { a: 0, b: 11 });
  const after = T.groupTable(b.groups[0]).map(r => r.e).slice(0, 2);
  assert.notDeepStrictEqual(after, before);
  assert.strictEqual(t.status, 'running');
  assert.ok(Object.values(b.ko.matches).every(x => !x.s), 'knockout results reset');
  // Clearing a group result removes the knockout until the group is complete again.
  T.recordResult(t, gA.id, null);
  assert.strictEqual(b.ko, null);
});

test('doubles: balanced pairing puts the strongest with the weakest', () => {
  const rating = { a: 1400, b: 1300, c: 1200, d: 1100, e: 1000, f: 900, g: 800, h: 700 };
  const of = id => rating[id];
  const { teams, left } = T.pairTeams(Object.keys(rating), of, 'balanced', () => 0.3);
  assert.deepStrictEqual(teams, [['a', 'h'], ['b', 'g'], ['c', 'f'], ['d', 'e']]);
  assert.deepStrictEqual(left, []);
  const sums = teams.map(t => of(t[0]) + of(t[1]));
  assert.ok(Math.max(...sums) - Math.min(...sums) === 0, 'team totals are equal');
  const odd = T.pairTeams(['a', 'b', 'c', 'd', 'e'], of, 'balanced');
  assert.strictEqual(odd.teams.length, 2);
  assert.deepStrictEqual(odd.left, ['c']);
  const random = T.pairTeams(Object.keys(rating), of, 'random');
  assert.strictEqual(random.teams.length, 4);
  assert.strictEqual(new Set(random.teams.flat()).size, 8);
});

test('doubles tournament: teams as entrants, club.matches gets array sides', () => {
  const entrants = [['a', 'h'], ['b', 'g'], ['c', 'f'], ['d', 'e']];
  const t = T.createTournament({ id: 'd1', name: 'คู่', format: 'doubles', entrants, thirdPlace: false });
  const club = { matches: [], tournaments: [t] };
  T.applyResult(club, 'd1', 'r0m0', { a: 11, b: 7 }, 'admin', '2026-10-19T10:00:00Z');
  T.applyResult(club, 'd1', 'r0m1', { a: 11, b: 7 }, 'admin', '2026-10-19T10:05:00Z');
  T.applyResult(club, 'd1', 'r1m0', { a: 9, b: 11 }, 'admin', '2026-10-19T10:10:00Z');
  assert.strictEqual(t.status, 'done');
  assert.deepStrictEqual(t.champion, ['b', 'g']);
  assert.strictEqual(club.matches.length, 3);
  assert.deepStrictEqual(club.matches[0], { id: 'd1_r0m0', kind: 'tournament', format: 'doubles', a: ['a', 'h'], b: ['d', 'e'], s: { a: 11, b: 7 }, tournamentId: 'd1', matchId: 'r0m0', at: '2026-10-19T10:00:00Z', by: 'admin' });
  assert.deepStrictEqual(T.titlesFor(club, 'g').map(x => x.title), ['แชมป์']);
  // Running the same write twice (a retried clubMutate) changes nothing.
  T.applyResult(club, 'd1', 'r1m0', { a: 9, b: 11 }, 'admin', 'later');
  assert.strictEqual(club.matches.length, 3);
  assert.strictEqual(club.matches[2].at, '2026-10-19T10:10:00Z');
  // Editing a semi-final removes the final's club match.
  T.applyResult(club, 'd1', 'r0m0', { a: 3, b: 11 }, 'admin', 'x');
  assert.deepStrictEqual(club.matches.map(x => x.id).sort(), ['d1_r0m0', 'd1_r0m1']);
  assert.deepStrictEqual(club.matches.find(x => x.id === 'd1_r0m0').s, { a: 3, b: 11 });
  T.removeTournament(club, 'd1');
  assert.deepStrictEqual(club, { matches: [], tournaments: [] });
});

test('validation: names, duplicates, team shape', () => {
  assert.throws(() => T.createTournament({ id: 'x', name: ' ', entrants: players(4) }), /ตั้งชื่อ/);
  assert.throws(() => T.createTournament({ id: 'x', name: 'a', entrants: ['p1'] }), /อย่างน้อย 2/);
  assert.throws(() => T.createTournament({ id: 'x', name: 'a', entrants: ['p1', 'p1'] }), /ซ้ำ/);
  assert.throws(() => T.createTournament({ id: 'x', name: 'a', format: 'doubles', entrants: [['a', 'b'], ['b', 'c']] }), /ซ้ำ/);
  assert.throws(() => T.createTournament({ id: 'x', name: 'a', format: 'doubles', entrants: [['a', 'a'], ['b', 'c']] }), /2 คน/);
  assert.throws(() => T.createTournament({ id: 'x', name: 'a', kind: 'groups', entrants: players(2) }), /อย่างน้อย 3/);
});

test('playoff seeds come from the league table; rating falls back to RP then random', () => {
  const league = {
    profiles: { a: { id: 'a', displayName: 'A' }, b: { id: 'b', displayName: 'B' }, c: { id: 'c', displayName: 'C' }, d: { id: 'd', displayName: 'D' }, e: { id: 'e', displayName: 'E', active: false } },
    seasonPlayerIds: ['a', 'b', 'c', 'd', 'e'], currentSeason: 3,
    rounds: [{ m: [['a', 'b'], ['c', 'd'], ['e', 'a']] }, { m: [['b', 'c'], ['d', 'a']] }],
    results: { r0m0: { a: 5, b: 11 }, r0m1: { a: 11, b: 2 }, r0m2: { a: 11, b: 0 }, r1m0: { a: 11, b: 9 }, r1m1: { a: 1, b: 11 } },
    rankHistory: [{ season: 2, standings: [{ userId: 'd', rank: 1, rpAward: 100 }] }]
  };
  assert.deepStrictEqual(T.standings(league).map(x => x.id), ['b', 'e', 'c', 'a', 'd']);
  assert.deepStrictEqual(T.playoffSeeds(league, 4), ['b', 'c', 'a', 'd'], 'inactive players are skipped');
  const t = T.createTournament({ id: 'po', name: 'เพลย์ออฟ', kind: 'playoff', season: 3, entrants: T.playoffSeeds(league, 4) });
  assert.strictEqual(t.title, 'แชมป์เพลย์ออฟ');
  assert.strictEqual(t.season, 3);
  assert.deepStrictEqual([m(t, 'r0m0').a, m(t, 'r0m0').b], [0, 3]);
  const rp = T.ratingSource(league, {}, {});
  assert.strictEqual(rp.source, 'rp');
  assert.ok(rp.of('d') > rp.of('b'));
  assert.deepStrictEqual(T.seedEntrants(['a', 'b', 'c', 'd'], rp.of, 'rating').slice(0, 2), ['d', 'b']);
  assert.strictEqual(T.ratingSource({ profiles: {} }, {}, {}).source, 'random');
  const elo = T.ratingSource(league, {}, { LeagueElo: { ratings: () => ({ a: 1500, b: { elo: 1100 } }) } });
  assert.strictEqual(elo.source, 'elo');
  assert.strictEqual(elo.of('a'), 1500); assert.strictEqual(elo.of('b'), 1100); assert.strictEqual(elo.of('zzz'), 1000);
  playAll(t);
  assert.deepStrictEqual(T.titlesFor({ tournaments: [t] }, 'b'), [{ id: 'po', name: 'เพลย์ออฟ', title: 'แชมป์เพลย์ออฟ', kind: 'playoff', season: 3, format: 'singles' }]);
});
