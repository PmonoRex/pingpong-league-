// QA P1/P2: one place that decides what a bet should be worth given the scores as they are now.
// Current-Season bets read league.rounds/results; bets of a finished Season read that Season's seasonArchives entry.
const BetSettle = (() => {
  const validScore = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const SETTLED = ["won", "lost", "push"];

  function matchFor(league, bet) {
    const parts = /^r(\d+)m(\d+)$/.exec(bet?.matchId || "");
    if (!parts || !league) return null;
    let source = null;
    if (Number(bet.season) === Number(league.currentSeason)) source = { rounds: league.rounds, results: league.results, from: "current" };
    else {
      const archive = (league.seasonArchives || []).find(a => Number(a?.season) === Number(bet.season));
      if (archive) source = { rounds: archive.rounds, results: archive.results, from: "archive" };
    }
    const pair = source?.rounds?.[Number(parts[1])]?.m?.[Number(parts[2])];
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    return { id: bet.matchId, season: bet.season, pair, score: (source.results || {})[bet.matchId], from: source.from };
  }

  // Raw outcome ({type:"win",winnerId}|{type:"push"}) or null when the bet cannot be judged (no result, other pair, bad market).
  function outcome(league, pred, bet) {
    const match = matchFor(league, bet);
    if (!match || !validScore(match.score)) return null;
    if (!Array.isArray(bet.pair) || bet.pair.length !== 2 || !bet.pair.every((id, i) => id === match.pair[i])) return null;
    let favoriteId = bet.favoriteId, handicap = Number(bet.handicap);
    const market = pred?.markets?.[LeagueShared.marketKey(bet.season, bet.matchId)];
    // Legacy bets may not contain a complete market snapshot. Only then fall back to the stored market.
    if (!match.pair.includes(favoriteId) && match.pair.includes(market?.favoriteId)) favoriteId = market.favoriteId;
    if (!Number.isFinite(handicap) && Number.isFinite(Number(market?.handicap))) handicap = Number(market.handicap);
    if (!match.pair.includes(favoriteId) || !Number.isFinite(handicap) || handicap < 0) return null;
    return LeagueShared.predictionOutcome(match.pair, match.score, { favoriteId, handicap });
  }

  // What the bet should be now: {status,net}; status "pending" when the score was cleared. null = leave as is.
  function resolve(league, pred, bet) {
    if (!bet || bet.status === "void") return null;
    const r = outcome(league, pred, bet);
    if (r) return r.type === "push" ? { status: "push", net: 0 } : r.winnerId === bet.sideId ? { status: "won", net: Number(bet.stake) } : { status: "lost", net: -Number(bet.stake) };
    const match = matchFor(league, bet);
    const samePair = match && Array.isArray(bet.pair) && bet.pair.every((id, i) => id === match.pair[i]);
    return samePair && !validScore(match.score) ? { status: "pending", net: 0 } : null;
  }

  // For display/export: a settled bet follows the current score even before the dealer saves the correction.
  function effective(league, pred, bet) {
    const stored = { status: bet.status, net: Number(bet.net) || 0, stale: false };
    if (!SETTLED.includes(bet.status)) return stored;
    const target = resolve(league, pred, bet);
    if (!target || (target.status === stored.status && target.net === stored.net)) return stored;
    return { status: target.status, net: target.net, stale: true };
  }

  const isOldPending = (league, bet) => bet.status === "pending" && Number(bet.season) !== Number(league.currentSeason);
  function seasons(league, pred) {
    const set = new Set([Number(league.currentSeason) || 1]);
    (pred?.bets || []).forEach(b => { if (Number.isFinite(Number(b.season))) set.add(Number(b.season)); });
    return [...set].sort((a, b) => b - a);
  }

  // Settlement table/export for one Season: every active non-dealer player plus anyone who bet in it (even if closed since).
  function summary(league, pred, season) {
    const bets = (pred?.bets || []).filter(b => Number(b.season) === Number(season));
    const ids = new Set(LeagueShared.activeProfiles(league).filter(p => p.id !== pred?.dealerId).map(p => p.id));
    bets.forEach(b => ids.add(b.userId));
    let receive = 0, pay = 0, stale = 0;
    const pending = [];
    const rows = [...ids].map(id => {
      let cost = 0, won = 0, lost = 0, waiting = 0;
      bets.filter(b => b.userId === id).forEach(b => {
        const e = effective(league, pred, b);
        if (e.stale) stale++;
        if (e.status === "pending") { waiting++; pending.push(b); return; }
        if (e.status === "void") return;
        cost += Number(b.stake) || 0;
        if (e.status === "won") won += Number(b.stake) || 0;
        if (e.status === "lost") lost += Number(b.stake) || 0;
      });
      receive += lost; pay += won;
      const person = LeagueShared.profile(league, id);
      return { id, name: person?.displayName || id, inactive: !person || person.active === false, cost, won, lost, net: won - lost, pending: waiting };
    });
    return { season: Number(season), rows, receive, pay, net: receive - pay, pending, stale };
  }

  return Object.freeze({ matchFor, outcome, resolve, effective, isOldPending, seasons, summary });
})();
