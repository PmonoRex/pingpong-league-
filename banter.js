// Banter from the real results only: streak badges, rivalry records and the Season-end poster facts.
// Pure functions over league data (no DOM, no storage), so pages render the output and tests cover the logic.
// Match order is the schedule order (Season, then round, then match), the only order the league stores.
const LeagueBanter = (() => {
  const validScore = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);

  const STREAK_MIN = 3;
  const BADGES = Object.freeze({
    hot: { kind: "hot", label: "ไฟลุก" },
    cold: { kind: "cold", label: "ฟอร์มตก" },
    comeback: { kind: "comeback", label: "คืนชีพ" }
  });

  // Finished matches of one Season in schedule order.
  function seasonMatches(rounds, results, season = null) {
    const out = [];
    (Array.isArray(rounds) ? rounds : []).forEach((round, ri) => (round?.m || []).forEach((pair, mi) => {
      const score = results?.[`r${ri}m${mi}`];
      if (Array.isArray(pair) && pair[0] && pair[1] && validScore(score)) out.push({ season, round: ri + 1, matchId: `r${ri}m${mi}`, pair, score });
    }));
    return out;
  }
  // Every finished match the league still has: archived Seasons (oldest first), then the current Season.
  function leagueMatches(league) {
    const current = Number(league?.currentSeason) || 1;
    const archives = (Array.isArray(league?.seasonArchives) ? league.seasonArchives : [])
      .filter(a => Number(a?.season) !== current)
      .sort((a, b) => Number(a.season) - Number(b.season));
    return [
      ...archives.flatMap(a => seasonMatches(a.rounds, a.results, Number(a.season))),
      ...seasonMatches(league?.rounds, league?.results, current)
    ];
  }

  function resultFor(match, id) {
    const side = match.pair[0] === id ? "a" : match.pair[1] === id ? "b" : null;
    if (!side) return null;
    const own = match.score[side], other = match.score[side === "a" ? "b" : "a"];
    return own > other ? "W" : own < other ? "L" : "D";
  }
  const resultsFor = (matches, id) => matches.map(m => resultFor(m, id)).filter(Boolean);

  // Runs of identical results counted back from the latest match.
  function tailRun(list, end) {
    if (end < 0) return { result: null, length: 0 };
    let n = 0;
    for (let i = end; i >= 0 && list[i] === list[end]; i--) n++;
    return { result: list[end], length: n };
  }

  // Current streak badge: 3+ wins in a row, 3+ losses in a row, or the first win right after 3+ losses.
  function streakBadge(matches, id) {
    const list = resultsFor(matches, id);
    const last = tailRun(list, list.length - 1);
    if (last.result === "W" && last.length >= STREAK_MIN) return { ...BADGES.hot, length: last.length, fact: `ชนะ ${last.length} นัดติด` };
    if (last.result === "L" && last.length >= STREAK_MIN) return { ...BADGES.cold, length: last.length, fact: `แพ้ ${last.length} นัดติด` };
    if (last.result === "W" && last.length === 1) {
      const before = tailRun(list, list.length - 2);
      if (before.result === "L" && before.length >= STREAK_MIN) return { ...BADGES.comeback, length: before.length, fact: `ชนะครั้งแรกหลังแพ้ ${before.length} นัดติด` };
    }
    return null;
  }
  function streakBadges(matches, ids) {
    const out = {};
    (ids || []).forEach(id => { const badge = streakBadge(matches, id); if (badge) out[id] = badge; });
    return out;
  }

  // Head-to-head record between a and b, plus who lost their latest meeting (null after a draw or no meeting).
  function headToHead(matches, a, b) {
    const list = a && b && a !== b ? matches.filter(m => m.pair.includes(a) && m.pair.includes(b)) : [];
    let aw = 0, bw = 0, d = 0;
    list.forEach(m => { const r = resultFor(m, a); if (r === "W") aw++; else if (r === "L") bw++; else d++; });
    const lastMatch = list[list.length - 1] || null;
    const lastResult = lastMatch ? resultFor(lastMatch, a) : null;
    const last = lastMatch ? {
      season: lastMatch.season, round: lastMatch.round, score: lastMatch.score, pair: lastMatch.pair,
      winner: lastResult === "W" ? a : lastResult === "L" ? b : null,
      loser: lastResult === "W" ? b : lastResult === "L" ? a : null
    } : null;
    return { played: list.length, aw, bw, d, list, last };
  }
  // "เจอกัน 4 ครั้ง ชนะ 3" from a's side; null when they have never met.
  function recordLine(record, nameOfA = "") {
    if (!record?.played) return null;
    const who = nameOfA ? `${nameOfA} ` : "";
    const tail = record.d ? ` เสมอ ${record.d}` : "";
    return `เจอกัน ${record.played} ครั้ง ${who}ชนะ ${record.aw}${tail}`;
  }

  // Told from the side that leads the record ("เจอกัน 4 ครั้ง กิฟท์ ชนะ 3"); a level record is told from a's side.
  function rivalryLine(record, a, b, nameOf = id => id) {
    if (!record?.played) return null;
    const flip = record.bw > record.aw;
    return recordLine(flip ? { ...record, aw: record.bw, bw: record.aw } : record, nameOf(flip ? b : a));
  }

  // Rivalry facts for a pairing in the current Season: the record of every meeting so far, and while this Season's
  // meeting is still to play, the loser of their previous meeting gets a revenge match (ศึกล้างตา).
  // The home page asks for the rivalry of every card in one go: the list of every league match (all archived Seasons)
  // is built once and reused while the league, its rounds, its scores and its archives are unchanged.
  let matchesMemo = null;
  function cachedLeagueMatches(league) {
    const archives = Array.isArray(league?.seasonArchives) ? league.seasonArchives : [];
    const key = [league, league?.currentSeason, league?.rounds, league?.results, JSON.stringify(league?.results ?? null), league?.seasonArchives, ...archives];
    if (matchesMemo && matchesMemo.key.length === key.length && matchesMemo.key.every((v, i) => v === key[i])) return matchesMemo.out;
    const out = leagueMatches(league);
    matchesMemo = { key, out };
    return out;
  }
  function matchRivalry(league, pair) {
    const current = Number(league?.currentSeason) || 1;
    const [a, b] = pair || [];
    const record = headToHead(cachedLeagueMatches(league), a, b);
    if (!record.played) return null;
    const playedThisSeason = record.list.some(m => m.season === current);
    return { ...record, revengeBy: playedThisSeason ? null : record.last?.loser || null };
  }

  // Facts for the Season-end poster: podium from the saved standings, biggest win and longest win streak from the scores.
  function seasonPoster(archive) {
    const standings = (archive?.standings || []).slice().sort((x, y) => Number(x.rank) - Number(y.rank));
    const matches = seasonMatches(archive?.rounds, archive?.results, Number(archive?.season) || null);
    let biggestWin = null;
    matches.forEach(m => {
      const margin = Math.abs(m.score.a - m.score.b);
      if (!margin) return;
      const top = Math.max(m.score.a, m.score.b);
      if (!biggestWin || margin > biggestWin.margin || (margin === biggestWin.margin && top > biggestWin.top)) {
        const aWon = m.score.a > m.score.b;
        biggestWin = { margin, top, round: m.round, winner: aWon ? m.pair[0] : m.pair[1], loser: aWon ? m.pair[1] : m.pair[0], winnerScore: top, loserScore: Math.min(m.score.a, m.score.b) };
      }
    });
    const ids = [...new Set([...(archive?.playerIds || []), ...matches.flatMap(m => m.pair)])];
    let longestStreak = null;
    ids.forEach(id => {
      let run = 0, best = 0;
      resultsFor(matches, id).forEach(r => { run = r === "W" ? run + 1 : 0; best = Math.max(best, run); });
      if (best < 2) return;
      if (!longestStreak || best > longestStreak.length) longestStreak = { length: best, ids: [id] };
      else if (best === longestStreak.length) longestStreak.ids.push(id);
    });
    return {
      season: archive?.season ?? null,
      champion: standings[0] || null,
      runnerUp: standings[1] || null,
      third: standings[2] || null,
      biggestWin,
      longestStreak,
      matchCount: matches.length
    };
  }

  // A Chonburi stamp like the existing ชนะ / แชมป์ stamps; the fact goes in the title for screen readers and hover.
  function stampHtml(badge) {
    if (!badge) return "";
    return `<span class="banter-stamp ${esc(badge.kind)}" title="${esc(badge.fact || badge.label)}">${esc(badge.label)}</span>`;
  }
  const REVENGE = Object.freeze({ kind: "revenge", label: "ศึกล้างตา" });

  return Object.freeze({ STREAK_MIN, BADGES, REVENGE, validScore, seasonMatches, leagueMatches, resultFor, streakBadge, streakBadges,
    headToHead, recordLine, rivalryLine, matchRivalry, seasonPoster, stampHtml });
})();
if (typeof module !== "undefined" && module.exports) module.exports = LeagueBanter;
