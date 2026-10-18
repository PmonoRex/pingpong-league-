// League history maths shared by the player card (badges), the head-to-head page and the season Wrapped story.
// Pure functions over the league object (and the predictions object for the prediction badge); no DOM, no storage.
// tests/league-stats.test.cjs runs them in Node.
const LeagueStats = (() => {
  const valid = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;

  // Every finished match the league still has (archived seasons, then the current one), in schedule order.
  function matches(l) {
    const out = [], take = (rounds, results, season) => (rounds || []).forEach((r, ri) => (r?.m || []).forEach((pair, mi) => {
      const s = results?.[`r${ri}m${mi}`]; if (pair?.[0] && pair?.[1] && valid(s)) out.push({ season, round: ri, id: `r${ri}m${mi}`, pair, s });
    }));
    const cur = Number(l?.currentSeason) || 1;
    (l?.seasonArchives || []).filter(a => Number(a?.season) !== cur).sort((a, b) => a.season - b.season).forEach(a => take(a.rounds, a.results, Number(a.season)));
    take(l?.rounds, l?.results, cur);
    return out;
  }
  // "W" / "D" / "L" for player id in match m ("" if they did not play), plus their points for and against.
  const side = (m, id) => m.pair[0] === id ? "a" : m.pair[1] === id ? "b" : "";
  const result = (m, id) => { const s = side(m, id); if (!s) return ""; const o = m.s[s], t = m.s[s === "a" ? "b" : "a"]; return o > t ? "W" : o < t ? "L" : "D"; };
  const scoreFor = (m, id) => { const s = side(m, id); return s ? [m.s[s], m.s[s === "a" ? "b" : "a"]] : [0, 0]; };
  const opponent = (m, id) => m.pair[0] === id ? m.pair[1] : m.pair[0];
  const tally = rs => ({ n: rs.length, w: rs.filter(r => r === "W").length, d: rs.filter(r => r === "D").length, l: rs.filter(r => r === "L").length });

  function bestStreak(rs) { let best = 0, run = 0; rs.forEach(r => { run = r === "W" ? run + 1 : 0; best = Math.max(best, run); }); return best; }
  // Season -> rank table from rankHistory (finished seasons only).
  function ranksBySeason(l) {
    const out = {};
    (l?.rankHistory || []).forEach(h => { const t = out[Number(h.season)] = {}; (h.standings || []).forEach(r => { t[r.userId] = r.rank; }); });
    return out;
  }
  const championOf = (ranks, season) => Object.entries(ranks[season] || {}).find(([, r]) => r === 1)?.[0] || "";

  // Achievement badges: every badge with whether this player has it, earned ones first.
  function badges(l, id, pred) {
    const all = matches(l), mine = all.filter(m => m.pair.includes(id)), rs = mine.map(m => result(m, id)), ranks = ranksBySeason(l);
    const streak = bestStreak(rs);
    const shutouts = mine.filter(m => { const [f, a] = scoreFor(m, id); return f > 0 && a === 0; }).length;
    const giantKills = mine.filter(m => { const c = championOf(ranks, m.season - 1); return c && c !== id && opponent(m, id) === c && result(m, id) === "W"; }).length;
    const seasons = [...new Set(mine.map(m => m.season))];
    const cur = Number(l?.currentSeason) || 1;
    const unbeaten = seasons.filter(s => s !== cur && ranks[s]).filter(s => { const g = mine.filter(m => m.season === s); return g.length >= 3 && g.every(m => result(m, id) !== "L"); }).length;
    const titles = Object.keys(ranks).filter(s => ranks[s][id] === 1).length;
    const ranked = Object.keys(ranks).map(Number).sort((a, b) => a - b).filter(s => ranks[s][id]);
    let climb = 0; for (let i = 1; i < ranked.length; i++) climb = Math.max(climb, ranks[ranked[i - 1]][id] - ranks[ranked[i]][id]);
    const settled = (pred?.bets || []).filter(b => b.userId === id && (b.status === "won" || b.status === "lost"));
    const hit = settled.filter(b => b.status === "won").length, rate = settled.length ? hit / settled.length : 0;
    const list = [
      { key: "champ", icon: "🏆", name: "แชมป์ลีก", have: titles > 0, value: titles > 1 ? `×${titles}` : "", how: "จบอันดับ 1 ของซีซั่น" },
      { key: "streak", icon: "🔥", name: "ชนะรวด", have: streak >= 3, value: streak >= 3 ? `${streak} นัด` : "", how: "ชนะติดกัน 3 นัดขึ้นไป" },
      { key: "giant", icon: "⚡", name: "พลิกล็อก", have: giantKills > 0, value: giantKills > 1 ? `×${giantKills}` : "", how: "ชนะแชมป์ซีซั่นก่อน" },
      { key: "unbeaten", icon: "🛡️", name: "ไร้พ่าย", have: unbeaten > 0, value: unbeaten > 1 ? `×${unbeaten}` : "", how: "จบซีซั่นโดยไม่แพ้เลย" },
      { key: "shutout", icon: "🧹", name: "ชนะขาว", have: shutouts > 0, value: shutouts > 1 ? `×${shutouts}` : "", how: "ชนะโดยคู่แข่งไม่ได้แต้ม" },
      { key: "climb", icon: "📈", name: "ขึ้นแรง", have: climb >= 3, value: climb >= 3 ? `+${climb}` : "", how: "อันดับขึ้น 3 ขั้นในซีซั่นเดียว" },
      { key: "sharp", icon: "🎯", name: "ตาแม่น", have: settled.length >= 5 && rate >= .6, value: settled.length >= 5 && rate >= .6 ? `${Math.round(rate * 100)}%` : "", how: "ทายถูก 60% จาก 5 ครั้งขึ้นไป" },
      { key: "regular", icon: "🏓", name: "ขาประจำ", have: mine.length >= 20, value: mine.length >= 20 ? `${mine.length} นัด` : "", how: "ลงแข่งครบ 20 นัด" }
    ];
    return list.filter(b => b.have).concat(list.filter(b => !b.have));
  }

  // Head to head between a and b: their record from a's side, points, and every meeting (latest first).
  // Optional club: also count singles friendlies from club.matches (challenges, tournaments), after the league games,
  // by time; those games carry club: true and the match kind instead of a season/round.
  function h2h(l, a, b, club) {
    const friendly = (Array.isArray(club?.matches) ? club.matches : []).filter(m => typeof m?.a === "string" && typeof m?.b === "string" && valid(m.s))
      .slice().sort((x, y) => String(x.at || "").localeCompare(String(y.at || ""))).map(m => ({ club: true, kind: m.kind || "", at: m.at || "", pair: [m.a, m.b], s: m.s }));
    const games = matches(l).concat(friendly).filter(m => m.pair.includes(a) && m.pair.includes(b));
    const rs = games.map(m => result(m, a)), t = tally(rs);
    let pf = 0, pa = 0; games.forEach(m => { const [f, x] = scoreFor(m, a); pf += f; pa += x; });
    return { ...t, pf, pa, streak: currentRun(rs), games: games.slice().reverse().map(m => ({ ...(m.club ? { club: true, kind: m.kind, at: m.at } : { season: m.season, round: m.round }), score: scoreFor(m, a), r: result(m, a) })) };
  }
  // The current run from the latest result back: { r: "W", n: 3 } means three wins in a row so far.
  function currentRun(rs) { if (!rs.length) return null; const r = rs[rs.length - 1]; let n = 0; for (let i = rs.length - 1; i >= 0 && rs[i] === r; i--) n++; return { r, n }; }

  // One player's season in numbers, for the Wrapped story.
  function wrapped(l, id, season, pred) {
    const games = matches(l).filter(m => m.season === season && m.pair.includes(id));
    const rs = games.map(m => result(m, id)), t = tally(rs);
    let pf = 0, pa = 0, best = null, worst = null;
    const foes = {};
    games.forEach(m => {
      const [f, a] = scoreFor(m, id), o = opponent(m, id), d = f - a; pf += f; pa += a;
      if (d > 0 && (!best || d > best.d)) best = { d, o, f, a };
      if (d < 0 && (!worst || d < worst.d)) worst = { d, o, f, a };
      const x = foes[o] ||= { o, n: 0, w: 0, l: 0 }; x.n++; if (d > 0) x.w++; if (d < 0) x.l++;
    });
    const list = Object.values(foes);
    const nemesis = list.filter(x => x.l > x.w).sort((x, y) => (y.l - y.w) - (x.l - x.w) || y.n - x.n)[0] || null;
    const victim = list.filter(x => x.w > x.l).sort((x, y) => (y.w - y.l) - (x.w - x.l) || y.n - x.n)[0] || null;
    const ranks = ranksBySeason(l), rank = ranks[season]?.[id] || null, prevRank = ranks[season - 1]?.[id] || null;
    const row = (l?.rankHistory || []).find(h => Number(h.season) === season)?.standings?.find(r => r.userId === id);
    const bets = (pred?.bets || []).filter(b => b.userId === id && b.season === season && (b.status === "won" || b.status === "lost"));
    return { season, ...t, pf, pa, rate: t.n ? Math.round(t.w / t.n * 100) : 0, streak: bestStreak(rs), best, worst, nemesis, victim, rank, prevRank, rp: row?.rpAward || 0,
      bets: bets.length, betHits: bets.filter(b => b.status === "won").length, net: bets.reduce((s, b) => s + (Number(b.net) || 0), 0) };
  }
  const seasons = l => [...new Set(matches(l).map(m => m.season))].sort((a, b) => a - b);

  return Object.freeze({ matches, result, scoreFor, opponent, tally, bestStreak, badges, h2h, wrapped, seasons });
})();
if (typeof module !== "undefined") module.exports = LeagueStats;
