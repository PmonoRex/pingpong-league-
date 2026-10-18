const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../hall.js');
const E = require('../elo.js');

const profiles = Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { id, displayName: id.toUpperCase(), active: true }]));
// One match per round: [[a, b, scoreA, scoreB], ...]
const season = list => ({ rounds: list.map(([x, y]) => ({ m: [[x, y]] })), results: Object.fromEntries(list.map(([, , p, q], i) => [`r${i}m0`, { a: p, b: q }])) });
const league = (cur, archives = [], extra = {}) => ({ profiles, currentSeason: archives.length + 1, ...season(cur),
  seasonArchives: archives.map((list, i) => ({ season: i + 1, ...season(list) })), rankHistory: [], ...extra });
const rec = (l, club, id) => H.compute(l, club).find(r => r.id === id);

test('every record is computed, in the documented order', () => {
  assert.deepEqual(H.compute(league([]), null).map(r => r.id), ['streak', 'streakAll', 'unbeaten', 'margin', 'points', 'upset', 'seasonRate', 'peakElo', 'topElo', 'titles', 'tourney', 'rp', 'played']);
  assert.ok(H.compute(league([]), null).every(r => r.value === 0 && r.holders.length === 0));
});

test('league win streak runs across archived seasons and keeps the record it broke', () => {
  // Season 1: b wins 3 straight. Season 2: a wins 4 straight (crossing nothing), then loses.
  const l = league([['a', 'c', 11, 3], ['a', 'd', 11, 4], ['a', 'b', 11, 9], ['a', 'c', 11, 1], ['a', 'b', 2, 11]],
    [[['b', 'c', 11, 2], ['b', 'd', 11, 5], ['b', 'c', 11, 7], ['c', 'a', 11, 3]]]);
  const r = rec(l, null, 'streak');
  assert.equal(r.value, 4);
  assert.deepEqual(r.ids, ['a']);
  assert.deepEqual(r.holders[0].ctx.from, { src: 'league', season: 2, round: 0 });
  assert.deepEqual(r.holders[0].ctx.to, { src: 'league', season: 2, round: 3 });
  assert.equal(r.prev.value, 3); assert.deepEqual(r.prev.ids, ['b']);
  // The streak that runs from the end of season 1 into season 2 counts as one.
  const cross = league([['a', 'c', 11, 3], ['a', 'd', 11, 3]], [[['a', 'b', 11, 5], ['a', 'c', 11, 5]]]);
  assert.equal(rec(cross, null, 'streak').value, 4);
});

test('streak ties: both holders, first to reach it first; below 3 is no record', () => {
  const l = league([['c', 'a', 11, 1], ['c', 'b', 11, 1], ['c', 'd', 11, 1], ['a', 'b', 11, 2], ['a', 'd', 11, 2], ['a', 'b', 11, 3]]);
  const r = rec(l, null, 'streak');
  assert.equal(r.value, 3);
  assert.deepEqual(r.holders.map(h => h.ids[0]), ['c', 'a']);
  assert.equal(rec(league([['a', 'b', 11, 1], ['a', 'c', 11, 1]]), null, 'streak').value, 0);
});

test('overall streak and unbeaten run include club matches (doubles credit every player); draws keep the unbeaten run', () => {
  const l = league([['a', 'b', 11, 5], ['a', 'c', 11, 5]]);
  const club = { matches: [
    { id: 'm1', kind: 'challenge', format: 'singles', a: 'a', b: 'd', s: { a: 11, b: 4 }, at: '2026-10-01T10:00:00Z' },
    { id: 'm2', kind: 'tournament', format: 'doubles', a: ['a', 'b'], b: ['c', 'd'], s: { a: 11, b: 8 }, at: '2026-10-02T10:00:00Z' },
    { id: 'm3', kind: 'challenge', format: 'singles', a: 'a', b: 'b', s: { a: 9, b: 9 }, at: '2026-10-03T10:00:00Z' },
    { id: 'm4', kind: 'challenge', format: 'singles', a: 'c', b: 'a', s: { a: 3, b: 11 }, at: '2026-10-04T10:00:00Z' }] };
  assert.equal(rec(l, club, 'streak').value, 0); // league only: 2 wins
  const all = rec(l, club, 'streakAll');
  assert.equal(all.value, 4); assert.deepEqual(all.ids, ['a']);
  assert.deepEqual(all.holders[0].ctx.to, { src: 'club', kind: 'tournament', at: '2026-10-02T10:00:00Z' });
  const unb = rec(l, club, 'unbeaten');
  assert.equal(unb.value, 6); assert.deepEqual(unb.ids, ['a']);
});

test('biggest margin and most points: single match, league or club, ties keep each holder once', () => {
  const l = league([['a', 'b', 11, 2], ['c', 'd', 2, 11], ['a', 'c', 11, 2]], [[['b', 'c', 15, 13]]]);
  const m = rec(l, null, 'margin');
  assert.equal(m.value, 9);
  assert.deepEqual(m.holders.map(h => h.ids[0]), ['a', 'd']);
  assert.deepEqual(m.holders[0].ctx, { at: { src: 'league', season: 2, round: 0 }, opp: ['b'], score: [11, 2] });
  const p = rec(l, null, 'points');
  assert.equal(p.value, 15); assert.deepEqual(p.ids, ['b']);
  assert.deepEqual(p.holders[0].ctx.at, { src: 'league', season: 1, round: 0 });
  const club = { matches: [{ id: 'x', kind: 'challenge', a: ['c', 'd'], b: ['a', 'b'], s: { a: 21, b: 5 }, at: '2026-10-05T00:00:00Z' }] };
  const p2 = rec(l, club, 'points'), m2 = rec(l, club, 'margin');
  assert.equal(p2.value, 21); assert.deepEqual(p2.holders[0].ids, ['c', 'd']); assert.deepEqual(p2.ids, ['c', 'd']);
  assert.equal(m2.value, 16); assert.equal(m2.prev.value, 9);
});

test('upset: the biggest pre-match Elo gap a winner overcame', () => {
  // b wins 4 to climb, then c (still 1000) beats b.
  const l = league([['b', 'a', 11, 1], ['b', 'd', 11, 1], ['b', 'a', 11, 1], ['b', 'd', 11, 1], ['c', 'b', 11, 9]]);
  const t = E.ratings(l, null), bBefore = t.b.history[3].rating;
  const r = rec(l, null, 'upset');
  assert.deepEqual(r.ids, ['c']);
  assert.equal(r.value, bBefore - 1000);
  assert.deepEqual(r.holders[0].ctx.elo, [1000, bBefore]);
  assert.deepEqual(r.holders[0].ctx.opp, ['b']);
  // A favourite winning is no upset.
  assert.equal(rec(league([['b', 'a', 11, 1], ['b', 'a', 11, 1]]), null, 'upset').value, 0);
});

test('best season win rate needs 5 matches, uses exact fractions and handles ties', () => {
  const five = (x, ys, wins) => ys.map((y, i) => i < wins ? [x, y, 11, 5] : [x, y, 5, 11]);
  // Season 1: a 4/5 (80%). Season 2: c 4/5 (80%), b plays 4 and wins all (too few).
  const l = league([...five('c', ['a', 'd', 'a', 'd', 'a'], 4), ['b', 'd', 11, 1], ['b', 'd', 11, 1], ['b', 'd', 11, 1], ['b', 'd', 11, 1]], [five('a', ['b', 'c', 'd', 'b', 'c'], 4)]);
  const r = rec(l, null, 'seasonRate');
  assert.equal(r.value, 80);
  assert.deepEqual(r.holders.map(h => [h.ids[0], h.ctx.season]), [['a', 1], ['c', 2]]);
  assert.deepEqual(r.holders[0].ctx, { season: 1, w: 4, d: 0, l: 1, n: 5 });
});

test('Elo peak and current #1 (active players only), ties listed together', () => {
  const l = league([['a', 'b', 11, 5], ['c', 'd', 11, 5]]);
  const t = E.ratings(l, null);
  const peak = rec(l, null, 'peakElo'), top = rec(l, null, 'topElo');
  assert.equal(peak.value, t.a.peak); assert.deepEqual(peak.ids, ['a', 'c']);
  assert.deepEqual(peak.holders[0].ctx.at, { src: 'league', season: 1, round: 0 });
  assert.equal(top.value, t.a.rating); assert.deepEqual(top.ids, ['a', 'c']);
  const off = { ...l, profiles: { ...profiles, a: { ...profiles.a, active: false } } };
  assert.deepEqual(rec(off, null, 'topElo').ids, ['c']);
});

test('league titles and RP from rankHistory (archived seasons), with previous holder', () => {
  const rh = [
    { season: 2, finishedAt: '2026-06-01', standings: [{ userId: 'a', rank: 1, rpAward: 100, pts: 9 }, { userId: 'b', rank: 2, rpAward: 80 }] },
    { season: 1, finishedAt: '2026-03-01', standings: [{ userId: 'b', rank: 1, rpAward: 100, pts: 7 }, { userId: 'a', rank: 2, rpAward: 60 }] },
    { season: 3, finishedAt: '2026-09-01', standings: [{ userId: 'a', rank: 1, rpAward: 100, pts: 8 }, { userId: 'c', rank: 2, rpAward: 50 }] }];
  const l = league([], [], { currentSeason: 4, rankHistory: rh });
  const titles = rec(l, null, 'titles');
  assert.equal(titles.value, 2); assert.deepEqual(titles.ids, ['a']); assert.deepEqual(titles.holders[0].ctx.items, [2, 3]);
  assert.equal(titles.prev.value, 1); assert.deepEqual(titles.prev.ids, ['b']);
  const rp = rec(l, null, 'rp');
  assert.equal(rp.value, 260); assert.deepEqual(rp.ids, ['a']);
  // Shared title count is a tie.
  const two = league([], [], { rankHistory: rh.slice(0, 2) });
  assert.deepEqual(rec(two, null, 'titles').holders.map(h => h.ids[0]), ['b', 'a']);
});

test('tournament titles: done only, doubles teams credit both players', () => {
  const club = { tournaments: [
    { id: 't1', name: 'คู่มันส์', format: 'doubles', status: 'done', champion: ['a', 'b'], doneAt: '2026-05-01' },
    { id: 't2', name: 'เดี่ยวคัพ', format: 'singles', status: 'done', champion: 'a', doneAt: '2026-06-01' },
    { id: 't3', name: 'ยังแข่ง', format: 'singles', status: 'running', champion: null },
    { id: 't4', name: 'เดี่ยวคัพ 2', format: 'singles', status: 'done', champion: 'c', at: '2026-07-01' }] };
  const r = rec(league([]), club, 'tourney');
  assert.equal(r.value, 2); assert.deepEqual(r.ids, ['a']); assert.deepEqual(r.holders[0].ctx.items, ['คู่มันส์', 'เดี่ยวคัพ']);
  assert.deepEqual(H.tourneyChamps(club).map(t => [t.id, t.ids]), [['t1', ['a', 'b']], ['t2', ['a']], ['t4', ['c']]]);
  const one = rec(league([]), { tournaments: club.tournaments.slice(0, 1) }, 'tourney');
  assert.deepEqual(one.ids, ['a', 'b']);
});

test('most matches played counts league (all seasons) and club', () => {
  const l = league([['a', 'b', 11, 5]], [[['a', 'c', 11, 5], ['b', 'c', 11, 5]]]);
  const club = { matches: [{ id: 'x', kind: 'challenge', a: ['b', 'c'], b: ['a', 'd'], s: { a: 11, b: 3 }, at: '2026-10-01' }] };
  const r = rec(l, club, 'played');
  assert.equal(r.value, 3); assert.deepEqual(r.ids.slice().sort(), ['a', 'b', 'c']);
  assert.deepEqual(r.holders.find(h => h.ids[0] === 'a').ctx, { league: 2, club: 1 });
});

test('champions: league seasons and tournaments in time order', () => {
  const l = league([], [], { rankHistory: [
    { season: 2, finishedAt: '2026-06-01T00:00:00Z', standings: [{ userId: 'a', rank: 1, pts: 9 }] },
    { season: 1, finishedAt: '2026-03-01T00:00:00Z', standings: [{ userId: 'b', rank: 1 }, { userId: 'c', rank: 1 }] }] });
  const club = { tournaments: [{ id: 't', name: 'Cup', status: 'done', format: 'doubles', champion: ['c', 'd'], doneAt: '2026-04-01T00:00:00Z' }] };
  const c = H.champions(l, club);
  assert.deepEqual(c.map(x => [x.kind, x.ids]), [['league', ['b', 'c']], ['tournament', ['c', 'd']], ['league', ['a']]]);
  assert.equal(c[2].pts, 9);
});

test('events: one per broken record, keyed by record + value + holder; ties and first records stay quiet', () => {
  const base = [['a', 'b', 11, 1], ['a', 'c', 11, 1], ['a', 'd', 11, 1], ['a', 'b', 3, 11]];
  const l1 = league(base);
  const keys1 = H.events(l1, null, 'b').map(e => e.key);
  assert.ok(!keys1.some(k => k.startsWith('hall:streak:')), 'first-ever streak has nothing to break');
  // b wins 4 straight: breaks a's 3.
  const l2 = league([...base, ['b', 'c', 11, 5], ['b', 'd', 11, 5], ['b', 'c', 11, 5]]);
  const ev = H.events(l2, null, 'b').filter(e => e.key.startsWith('hall:streak:'));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].key, 'hall:streak:4:b');
  assert.equal(ev[0].title, 'คุณทำสถิติใหม่!');
  assert.equal(ev[0].body, 'B ชนะรวด 4 นัด ทำลายสถิติเดิม 3');
  assert.equal(H.events(l2, null, 'a').find(e => e.key === 'hall:streak:4:b').title, 'สถิติใหม่!');
  // Same data again: same keys (pwa.js shows each key once).
  assert.deepEqual(H.events(structuredClone(l2), null, 'b').map(e => e.key), H.events(l2, null, 'b').map(e => e.key));
  // c ties b's 4 later: no new streak event.
  const l3 = league([...base, ['b', 'c', 11, 5], ['b', 'd', 11, 5], ['b', 'c', 11, 5], ['b', 'a', 1, 11], ['c', 'a', 11, 5], ['c', 'd', 11, 5], ['c', 'a', 11, 5], ['c', 'd', 11, 5]]);
  assert.deepEqual(H.events(l3, null, '').filter(e => e.key.startsWith('hall:streak:')).map(e => e.key), ['hall:streak:4:b']);
  // Running totals that change every match are never announced.
  assert.ok(!H.events(l3, null, '').some(e => /^hall:(played|topElo|peakElo|rp|seasonRate):/.test(e.key)));
  assert.deepEqual(H.events(null, null, ''), []);
});

test('memoized: same data returns the same result object; a changed score recomputes', () => {
  const l = league([['a', 'b', 11, 5]]);
  const x = H.all(l, null), y = H.all(structuredClone(l), null);
  assert.equal(x, y);
  const z = H.all({ ...l, results: { r0m0: { a: 11, b: 0 } } }, null);
  assert.notEqual(z, x);
  assert.equal(z.records.find(r => r.id === 'margin').value, 11);
});

test('every page loads hall.js after elo.js and before pwa.js; pwa.js and the menu wire it in', () => {
  const root = path.join(__dirname, '..');
  const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  assert.ok(pages.includes('hall.html'));
  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const elo = html.indexOf('src="elo.js'), hall = html.indexOf('src="hall.js?v=20261020-hall"'), pwa = html.indexOf('src="pwa.js');
    assert.ok(elo > 0 && hall > elo && pwa > hall, page);
  }
  assert.match(fs.readFileSync(path.join(root, 'pwa.js'), 'utf8'), /window\.HallRecords\?\.events\?\./);
  assert.match(fs.readFileSync(path.join(root, 'sport-ui.js'), 'utf8'), /item\('hall','หอเกียรติยศ',\{href:'hall\.html'\}\)/);
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /'hall\.html'\]/);
});
