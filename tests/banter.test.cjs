const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadBanter() {
  const context = {};
  vm.runInNewContext(fs.readFileSync('banter.js', 'utf8') + '\nglobalThis.banter = LeagueBanter;', context);
  return context.banter;
}
const B = loadBanter();

// Build one Season from a list of [left, right, leftScore, rightScore], one match per round.
function season(list) {
  const rounds = list.map(([x, y]) => ({ rest: null, m: [[x, y]] }));
  const results = Object.fromEntries(list.map(([, , a, b], i) => [`r${i}m0`, { a, b }]));
  return { rounds, results };
}
const matchesOf = list => { const s = season(list); return B.seasonMatches(s.rounds, s.results, 1); };

test('seasonMatches keeps schedule order and skips unfinished or invalid scores', () => {
  const rounds = [{ m: [['a', 'b'], ['c', 'd']] }, { m: [['a', 'c']] }];
  const results = { r0m0: { a: 11, b: 5 }, r0m1: { a: 3, b: null }, r1m0: { a: -1, b: 4 } };
  const out = B.seasonMatches(rounds, results, 2);
  assert.equal(out.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(out[0])), { season: 2, round: 1, matchId: 'r0m0', pair: ['a', 'b'], score: { a: 11, b: 5 } });
});

test('three straight wins is ไฟลุก, two is nothing', () => {
  const m = matchesOf([['a', 'b', 11, 3], ['c', 'a', 2, 11], ['a', 'd', 11, 9]]);
  const badge = B.streakBadge(m, 'a');
  assert.equal(badge.kind, 'hot');
  assert.equal(badge.label, 'ไฟลุก');
  assert.equal(badge.length, 3);
  assert.equal(badge.fact, 'ชนะ 3 นัดติด');
  assert.equal(B.streakBadge(m.slice(0, 2), 'a'), null);
});

test('three straight losses is ฟอร์มตก', () => {
  const m = matchesOf([['a', 'b', 11, 3], ['a', 'c', 2, 11], ['d', 'a', 11, 9], ['a', 'b', 0, 11]]);
  const badge = B.streakBadge(m, 'a');
  assert.equal(badge.kind, 'cold');
  assert.equal(badge.label, 'ฟอร์มตก');
  assert.equal(badge.length, 3);
});

test('first win after three or more losses is คืนชีพ, and only that first win', () => {
  const losses = [['a', 'b', 1, 11], ['c', 'a', 11, 4], ['a', 'd', 7, 11], ['a', 'e', 9, 11]];
  const back = matchesOf([...losses, ['a', 'b', 11, 8]]);
  const badge = B.streakBadge(back, 'a');
  assert.equal(badge.kind, 'comeback');
  assert.equal(badge.label, 'คืนชีพ');
  assert.equal(badge.length, 4);
  assert.equal(badge.fact, 'ชนะครั้งแรกหลังแพ้ 4 นัดติด');
  assert.equal(B.streakBadge(matchesOf([...losses, ['a', 'b', 11, 8], ['a', 'c', 11, 8]]), 'a'), null, 'second win is no longer a comeback');
  assert.equal(B.streakBadge(matchesOf([...losses.slice(0, 2), ['a', 'b', 11, 8]]), 'a'), null, 'two losses then a win is not a comeback');
});

test('a draw breaks a streak and a player without matches has no badge', () => {
  const m = matchesOf([['a', 'b', 11, 3], ['a', 'c', 11, 3], ['a', 'd', 11, 3], ['a', 'e', 5, 5]]);
  assert.equal(B.streakBadge(m, 'a'), null);
  assert.equal(B.streakBadge(m, 'zz'), null);
  assert.equal(B.streakBadge([], 'a'), null);
});

test('streakBadges returns only players who earned a badge', () => {
  const m = matchesOf([['a', 'b', 11, 3], ['a', 'b', 11, 3], ['a', 'b', 11, 3]]);
  const out = B.streakBadges(m, ['a', 'b', 'c']);
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b']);
  assert.equal(out.a.kind, 'hot');
  assert.equal(out.b.kind, 'cold');
});

test('leagueMatches orders archives by Season before the current Season and skips an archive of the current Season', () => {
  const s1 = season([['a', 'b', 11, 2]]), s2 = season([['b', 'a', 11, 9]]), cur = season([['a', 'b', 4, 11]]);
  const league = {
    currentSeason: 3, rounds: cur.rounds, results: cur.results,
    seasonArchives: [{ season: 2, ...s2 }, { season: 1, ...s1 }, { season: 3, ...season([['a', 'b', 11, 0]]) }]
  };
  assert.deepEqual([...B.leagueMatches(league).map(m => m.season)], [1, 2, 3]);
  assert.deepEqual([...B.leagueMatches(league).map(m => B.resultFor(m, 'a'))], ['W', 'L', 'L']);
});

test('headToHead counts both sides of the pairing and remembers the latest loser', () => {
  const m = matchesOf([['a', 'b', 11, 5], ['b', 'a', 11, 9], ['a', 'b', 11, 3], ['b', 'a', 4, 11], ['a', 'c', 0, 11]]);
  const h = B.headToHead(m, 'a', 'b');
  assert.equal(h.played, 4);
  assert.equal(h.aw, 3);
  assert.equal(h.bw, 1);
  assert.equal(h.d, 0);
  assert.equal(h.last.winner, 'a');
  assert.equal(h.last.loser, 'b');
  assert.equal(B.recordLine(h), 'เจอกัน 4 ครั้ง ชนะ 3');
  assert.equal(B.recordLine(h, 'เอ'), 'เจอกัน 4 ครั้ง เอ ชนะ 3');
  assert.equal(B.headToHead(m, 'a', 'a').played, 0);
  assert.equal(B.recordLine(B.headToHead(m, 'b', 'c')), null);
});

test('recordLine mentions draws and a drawn last meeting has no loser', () => {
  const h = B.headToHead(matchesOf([['a', 'b', 11, 5], ['a', 'b', 6, 6]]), 'a', 'b');
  assert.equal(B.recordLine(h), 'เจอกัน 2 ครั้ง ชนะ 1 เสมอ 1');
  assert.equal(h.last.loser, null);
});

test('rivalryLine tells the record from the leading side', () => {
  const h = B.headToHead(matchesOf([['a', 'b', 1, 11], ['b', 'a', 11, 9], ['a', 'b', 11, 3]]), 'a', 'b');
  const names = { a: 'เอ', b: 'บี' };
  assert.equal(B.rivalryLine(h, 'a', 'b', id => names[id]), 'เจอกัน 3 ครั้ง บี ชนะ 2');
  assert.equal(B.rivalryLine(B.headToHead(matchesOf([['a', 'b', 11, 1], ['a', 'b', 1, 11]]), 'a', 'b'), 'a', 'b', id => names[id]), 'เจอกัน 2 ครั้ง เอ ชนะ 1');
  assert.equal(B.rivalryLine(B.headToHead([], 'a', 'b'), 'a', 'b'), null);
});

test('matchRivalry flags the previous loser for ศึกล้างตา until this Season\'s meeting is played', () => {
  const s1 = season([['a', 'b', 11, 2]]), s2 = season([['b', 'a', 11, 9]]);
  const archives = [{ season: 1, ...s1 }, { season: 2, ...s2 }];
  const rounds = [{ m: [['a', 'b'], ['c', 'd']] }];
  const upcoming = B.matchRivalry({ currentSeason: 3, rounds, results: {}, seasonArchives: archives }, ['a', 'b']);
  assert.equal(upcoming.played, 2);
  assert.equal(upcoming.aw, 1);
  assert.equal(upcoming.bw, 1);
  assert.equal(upcoming.revengeBy, 'a', 'a lost the Season 2 meeting');
  const played = B.matchRivalry({ currentSeason: 3, rounds, results: { r0m0: { a: 11, b: 1 } }, seasonArchives: archives }, ['a', 'b']);
  assert.equal(played.played, 3, 'the record includes this Season once it is played');
  assert.equal(played.aw, 2);
  assert.equal(played.revengeBy, null);
  assert.equal(B.matchRivalry({ currentSeason: 3, rounds, results: {}, seasonArchives: archives }, ['c', 'd']), null, 'never met before');
  const drawn = B.matchRivalry({ currentSeason: 2, rounds, results: {}, seasonArchives: [{ season: 1, ...season([['a', 'b', 7, 7]]) }] }, ['a', 'b']);
  assert.equal(drawn.revengeBy, null, 'no loser after a draw');
});

test('seasonPoster bills the podium from standings and finds the biggest win and longest win streak', () => {
  const s = season([['a', 'b', 11, 9], ['c', 'a', 11, 1], ['a', 'd', 11, 3], ['b', 'c', 2, 11], ['c', 'd', 11, 8], ['d', 'c', 3, 11]]);
  const archive = {
    season: 4, playerIds: ['a', 'b', 'c', 'd'], ...s,
    standings: [{ userId: 'b', rank: 3, name: 'บี' }, { userId: 'c', rank: 1, name: 'ซี' }, { userId: 'a', rank: 2, name: 'เอ' }, { userId: 'd', rank: 4, name: 'ดี' }]
  };
  const p = B.seasonPoster(archive);
  assert.equal(p.champion.userId, 'c');
  assert.equal(p.runnerUp.userId, 'a');
  assert.equal(p.third.userId, 'b');
  assert.equal(p.biggestWin.winner, 'c');
  assert.equal(p.biggestWin.loser, 'a');
  assert.equal(p.biggestWin.margin, 10);
  assert.equal(`${p.biggestWin.winnerScore}-${p.biggestWin.loserScore}`, '11-1');
  assert.equal(p.longestStreak.length, 4);
  assert.deepEqual([...p.longestStreak.ids], ['c']);
  assert.equal(p.matchCount, 6);
});

test('seasonPoster drops facts it cannot back up', () => {
  const p = B.seasonPoster({ season: 1, standings: [{ userId: 'a', rank: 1 }], rounds: [], results: {} });
  assert.equal(p.champion.userId, 'a');
  assert.equal(p.runnerUp, null);
  assert.equal(p.biggestWin, null);
  assert.equal(p.longestStreak, null, 'no scores means no streak claim');
  const draws = B.seasonPoster({ season: 1, ...season([['a', 'b', 5, 5]]) });
  assert.equal(draws.biggestWin, null);
  const ties = B.seasonPoster({ season: 1, ...season([['a', 'c', 11, 1], ['a', 'd', 11, 1], ['b', 'c', 11, 1], ['b', 'd', 11, 1]]) });
  assert.deepEqual([...ties.longestStreak.ids].sort(), ['a', 'b']);
});

test('stampHtml escapes and renders nothing without a badge', () => {
  assert.equal(B.stampHtml(null), '');
  assert.equal(B.stampHtml({ kind: 'hot', label: 'ไฟลุก', fact: 'ชนะ 3 นัดติด' }), '<span class="banter-stamp hot" title="ชนะ 3 นัดติด">ไฟลุก</span>');
  assert.match(B.stampHtml({ kind: '"x', label: '<b>' }), /&quot;x.*&lt;b&gt;/);
});
