// Season awards ceremony ("รางวัลท้ายซีซั่น"): after a season is finished (it is in rankHistory) every award is worked
// out from what the league, the predictions and the club row already hold, then revealed one by one full-screen.
// Pure maths first (SeasonAwards, tested in Node by tests/awards.test.cjs); the DOM part below draws the ceremony,
// the "ทำเนียบรางวัล" summary and its 1080x1350 share poster, the archive button, the one-time home pill and the
// player-card chips (player-card.js asks window.SeasonAwards.forPlayer). Reads only; never writes league data.
//
// Season dates: a season ends at its rankHistory finishedAt and starts when the previous finished season ended
// (start date is not stored). Check-ins and MVP weeks only count inside that range; without an end date they are left
// out. Ties share an award. An award with no data behind it is skipped, and so is one where everybody in the pool ties.
const SeasonAwards = (() => {
  const valid = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const EPS = 1e-9;
  const CLOSE = 2;        // a "close" win: by 2 points (or games) or fewer
  const MIN_BETS = 5;     // settled bets in the season before someone can be นักทายแห่งซีซั่น
  const Elo = () => typeof LeagueElo !== "undefined" ? LeagueElo : (typeof require === "function" ? (() => { try { return require("./elo.js"); } catch { return null; } })() : null);

  // Order of the ceremony: smaller awards first, the champion last.
  const DEFS = Object.freeze({
    upset: { icon: "🐎", title: "ม้ามืดแห่งซีซั่น", sub: "ล้มยักษ์ที่ Elo สูงกว่ามากที่สุด" },
    regular: { icon: "🏓", title: "ขาประจำสนาม", sub: "มาสนามบ่อยที่สุด" },
    mvp: { icon: "👑", title: "MVP โหวตมากสุด", sub: "ชนะโหวต MVP ประจำสัปดาห์บ่อยที่สุด" },
    oracle: { icon: "🔮", title: "นักทายแห่งซีซั่น", sub: "ทายผลเก่งที่สุด" },
    clutch: { icon: "🧊", title: "ราชาเกมสูสี", sub: `ชนะแบบห่างไม่เกิน ${CLOSE} แต้มมากที่สุด` },
    cannon: { icon: "💥", title: "ปืนใหญ่", sub: "ตีได้แต้มเฉลี่ยต่อนัดสูงสุด" },
    wall: { icon: "🧱", title: "กำแพงเหล็ก", sub: "เสียแต้มเฉลี่ยต่อนัดน้อยที่สุด" },
    improved: { icon: "📈", title: "พัฒนาการยอดเยี่ยม", sub: "ก้าวกระโดดไกลที่สุด" },
    third: { icon: "🥉", title: "อันดับ 3", sub: "ขึ้นโพเดียมอันดับสาม" },
    runnerUp: { icon: "🥈", title: "รองแชมป์", sub: "ห่างแชมป์แค่ก้าวเดียว" },
    champion: { icon: "🏆", title: "แชมป์", sub: "ราชาแห่งซีซั่น" }
  });
  const ORDER = Object.freeze(Object.keys(DEFS));
  const PODIUM = Object.freeze(["champion", "runnerUp", "third"]);

  // ---------- Bangkok calendar (same rules as social.js) ----------
  const BKK_MS = 7 * 3600e3, pad = n => String(n).padStart(2, "0"), bkk = d => new Date(new Date(d).getTime() + BKK_MS);
  function dateKey(date) { const d = bkk(date); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  function weekKey(date) {
    const b = bkk(date), d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
    const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
    const year = d.getUTCFullYear(), week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7);
    return `${year}-W${pad(week)}`;
  }
  function weekWinners(votes) {
    const counts = new Map();
    Object.entries(votes && typeof votes === "object" ? votes : {}).forEach(([voter, id]) => { if (typeof id === "string" && id && id !== voter) counts.set(id, (counts.get(id) || 0) + 1); });
    const top = Math.max(0, ...counts.values());
    return top ? [...counts].filter(([, n]) => n === top).map(([id]) => id) : [];
  }
  const okTime = v => typeof v === "string" && v && Number.isFinite(Date.parse(v));

  // ---------- Season lookups ----------
  const finishedSeasons = l => [...new Set((l?.rankHistory || []).filter(h => (h?.standings || []).length).map(h => Number(h.season)).filter(Number.isFinite))].sort((a, b) => a - b);
  const historyOf = (l, s) => (l?.rankHistory || []).find(h => Number(h?.season) === Number(s)) || null;
  const archiveOf = (l, s) => (l?.seasonArchives || []).find(a => Number(a?.season) === Number(s)) || null;
  const rowId = (l, row) => row?.userId || Object.keys(l?.profiles || {}).find(k => l.profiles[k]?.displayName === row?.name) || row?.name || "";

  // { start, end } as ISO strings (null when unknown): previous finished season's finishedAt -> this one's.
  function seasonRange(l, s) {
    const h = historyOf(l, s), end = okTime(h?.finishedAt) ? h.finishedAt : null;
    const prev = (l?.rankHistory || []).filter(x => Number(x?.season) < Number(s)).sort((a, b) => Number(b.season) - Number(a.season))[0];
    const start = okTime(prev?.finishedAt) ? prev.finishedAt : null;
    return { start, end };
  }
  // Finished league matches of one archived season: { pair, s }.
  function seasonMatches(l, s) {
    const a = archiveOf(l, s), out = [];
    (a?.rounds || []).forEach((r, ri) => (r?.m || []).forEach((pair, mi) => { const x = a.results?.[`r${ri}m${mi}`]; if (pair?.[0] && pair?.[1] && valid(x)) out.push({ id: `r${ri}m${mi}`, pair, s: x }); }));
    return out;
  }
  const inRange = (iso, r) => okTime(iso) && (!r.start || iso > r.start) && (!r.end || iso <= r.end);

  // Everyone tied on the best value (by `better`), as [{ id, v }].
  function best(entries, better) {
    const list = entries.filter(e => Number.isFinite(e.v));
    if (!list.length) return [];
    const top = list.reduce((m, e) => better(e.v, m) ? e.v : m, list[0].v);
    return list.filter(e => Math.abs(e.v - top) < EPS);
  }
  const more = (a, b) => a > b + EPS, less = (a, b) => a < b - EPS;
  const fmt = n => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const signed = n => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;

  // ---------- The awards of one finished season ----------
  // extras: { pred: predictions object ({ bets }), club: club row ({ checkin, mvp, matches }), elo: precomputed LeagueElo.ratings }
  function compute(l, season, extras = {}) {
    const s = Number(season), h = historyOf(l, s);
    if (!h || !(h.standings || []).length) return null;
    const pred = extras.pred || null, club = extras.club || null, arch = archiveOf(l, s), range = seasonRange(l, s);
    const names = {};
    (h.standings || []).forEach(r => { const id = rowId(l, r); if (id && r.name) names[id] = r.name; });
    const nm = id => arch?.profileNames?.[id] || l?.profiles?.[id]?.displayName || names[id] || id;
    const roster = [...new Set((h.standings || []).map(r => rowId(l, r)).filter(Boolean))];
    const matches = seasonMatches(l, s);
    const awards = [];
    const add = (key, winners, value, extra = {}) => { if (!winners.length) return; awards.push({ key, ...DEFS[key], season: s, value, winners: winners.map(w => ({ id: w.id, name: nm(w.id), reason: w.reason })), ...extra }); };

    // Podium (ranks as recorded; rows sharing a rank share the award)
    [["champion", 1], ["runnerUp", 2], ["third", 3]].forEach(([key, rank]) => {
      const rows = (h.standings || []).filter(r => Number(r.rank) === rank);
      add(key, rows.map(r => ({ id: rowId(l, r), reason: [r.pts != null ? `${r.pts} แต้ม` : "", r.gd != null ? `ผลต่าง ${signed(r.gd)}` : "", r.rpAward != null ? `+${r.rpAward} RP` : ""].filter(Boolean).join(" • ") || `อันดับ ${rank}` })), rows[0]?.pts != null ? `${rows[0].pts} แต้ม` : `#${rank}`);
    });

    // Elo per player for the whole league (computed once per call to all()/forPlayer())
    const E = Elo();
    let elo = extras.elo, tl = extras.timeline;
    if (E && (!elo || !tl)) { try { elo = E.ratings(l, club); tl = E.timeline(l, club); } catch { elo = null; tl = null; } }
    const step = {}; // id -> Map(timeline index -> { rating, d })
    if (elo) Object.entries(elo).forEach(([id, p]) => { step[id] = new Map((p.history || []).map(x => [x.i, x])); });

    // พัฒนาการยอดเยี่ยม: biggest rank climb against the previous finished season; else biggest Elo gain over the season
    const prevSeason = finishedSeasons(l).filter(x => x < s).pop();
    const prevH = prevSeason != null ? historyOf(l, prevSeason) : null;
    let improved = [];
    if (prevH) {
      const before = {}; (prevH.standings || []).forEach(r => { before[rowId(l, r)] = Number(r.rank); });
      improved = best((h.standings || []).map(r => { const id = rowId(l, r), b = before[id]; return b ? { id, v: b - Number(r.rank), from: b, to: Number(r.rank) } : null; }).filter(e => e && e.v > 0), more)
        .map(e => ({ id: e.id, v: e.v, reason: `จากอันดับ ${e.from} ขึ้นมาอันดับ ${e.to}` }));
      if (improved.length) add("improved", improved, `ขึ้น ${improved[0].v} อันดับ`, { basis: "rank" });
    }
    if (!improved.length && elo) {
      const gains = roster.map(id => {
        const hs = (elo[id]?.history || []).filter(x => x.src === "league" && Number(x.season) === s);
        if (!hs.length) return null;
        const startR = hs[0].rating - hs[0].d, endR = hs[hs.length - 1].rating;
        return { id, v: endR - startR, from: startR, to: endR };
      }).filter(e => e && e.v > 0);
      improved = best(gains, more).map(e => ({ id: e.id, v: e.v, reason: `Elo ${e.from} → ${e.to}` }));
      if (improved.length) add("improved", improved, `Elo ${signed(improved[0].v)}`, { basis: "elo" });
    }

    // Per-player season numbers from the league matches
    const st = {}; const get = id => st[id] ||= { id, n: 0, pf: 0, pa: 0, close: 0 };
    matches.forEach(m => {
      const [a, b] = m.pair, A = get(a), B = get(b);
      A.n++; B.n++; A.pf += m.s.a; A.pa += m.s.b; B.pf += m.s.b; B.pa += m.s.a;
      const d = m.s.a - m.s.b;
      if (d > 0 && d <= CLOSE) A.close++; else if (d < 0 && -d <= CLOSE) B.close++;
    });
    const players = Object.values(st), maxN = Math.max(0, ...players.map(p => p.n));

    // ราชาเกมสูสี
    const clutch = best(players.filter(p => p.close > 0).map(p => ({ id: p.id, v: p.close })), more);
    add("clutch", clutch.map(e => ({ ...e, reason: `ชนะแบบห่างไม่เกิน ${CLOSE} แต้ม ${e.v} นัด` })), `${clutch[0]?.v} นัด`);

    // กำแพงเหล็ก / ปืนใหญ่: per-match averages among players with enough games (half the most anyone played, at least 2)
    const minGames = Math.min(maxN, Math.max(2, Math.ceil(maxN / 2)));
    const pool = players.filter(p => p.n >= minGames && p.n > 0);
    const allTie = (winners, poolSize) => poolSize > 1 && winners.length === poolSize;
    if (pool.length) {
      const wall = best(pool.map(p => ({ id: p.id, v: p.pa / p.n, n: p.n })), less);
      if (!allTie(wall, pool.length)) add("wall", wall.map(e => ({ ...e, reason: `เสียเฉลี่ย ${fmt(e.v)} แต้มต่อนัด (${e.n} นัด)` })), `${fmt(wall[0].v)} ต่อนัด`, { minGames });
      const cannon = best(pool.map(p => ({ id: p.id, v: p.pf / p.n, n: p.n })), more);
      if (!allTie(cannon, pool.length)) add("cannon", cannon.map(e => ({ ...e, reason: `ตีได้เฉลี่ย ${fmt(e.v)} แต้มต่อนัด (${e.n} นัด)` })), `${fmt(cannon[0].v)} ต่อนัด`, { minGames });
    }

    // นักทายแห่งซีซั่น: at least MIN_BETS settled bets this season; most net credits, or best hit rate when nobody profited
    const byUser = {};
    (Array.isArray(pred?.bets) ? pred.bets : []).forEach(b => {
      if (Number(b?.season) !== s || (b.status !== "won" && b.status !== "lost") || typeof b.userId !== "string") return;
      const x = byUser[b.userId] ||= { id: b.userId, n: 0, hit: 0, net: 0 }; x.n++; if (b.status === "won") x.hit++; x.net += Number(b.net) || 0;
    });
    const bettors = Object.values(byUser).filter(x => x.n >= MIN_BETS);
    if (bettors.length) {
      let win = best(bettors.map(x => ({ ...x, v: x.net })), more), basis = "net";
      if (!(win[0].v > 0)) { win = best(bettors.map(x => ({ ...x, v: x.hit / x.n })), more); basis = "rate"; }
      if (basis === "net" && win.length > 1) win = best(win.map(x => ({ ...x, v: x.hit / x.n, net: x.v })), more).map(x => ({ ...x, v: x.net }));
      add("oracle", win.map(x => ({ id: x.id, reason: `${x.net >= 0 ? "กำไร" : "ขาดทุน"} ${Math.abs(x.net)} เครดิต • ทายถูก ${x.hit}/${x.n}` })),
        basis === "net" ? `+${win[0].v} เครดิต` : `ทายถูก ${Math.round(win[0].v * 100)}%`, { basis });
    }

    // ขาประจำสนาม: check-in days inside the season's dates; without dates (or check-ins there), matches played
    const checkin = club?.checkin && typeof club.checkin === "object" ? club.checkin : null;
    let regularDone = false;
    if (checkin && range.end) {
      const lo = range.start ? dateKey(range.start) : "", hi = dateKey(range.end), days = {};
      Object.entries(checkin).forEach(([day, who]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < lo || day > hi || !who || typeof who !== "object") return;
        Object.keys(who).forEach(id => { days[id] = (days[id] || 0) + 1; });
      });
      const list = Object.entries(days).map(([id, v]) => ({ id, v }));
      if (list.length) {
        const reg = best(list, more), poolN = new Set([...roster, ...list.map(e => e.id)]).size;
        if (!allTie(reg, poolN)) add("regular", reg.map(e => ({ ...e, reason: `เช็กชื่อมาสนาม ${e.v} วัน` })), `${reg[0].v} วัน`, { basis: "checkin" });
        regularDone = true;
      }
    }
    if (!regularDone) {
      const played = {}; players.forEach(p => { played[p.id] = p.n; });
      // Friendlies (challenges, tournaments) inside the season's dates count too, when the dates are known.
      if (range.end) (Array.isArray(club?.matches) ? club.matches : []).forEach(m => {
        if (!valid(m?.s) || !inRange(m.at, range)) return;
        [].concat(m.a, m.b).filter(id => typeof id === "string" && id).forEach(id => { played[id] = (played[id] || 0) + 1; });
      });
      const list = Object.entries(played).map(([id, v]) => ({ id, v })).filter(e => e.v > 0);
      const reg = best(list, more);
      if (reg.length && !allTie(reg, list.length)) add("regular", reg.map(e => ({ ...e, reason: `ลงแข่ง ${e.v} นัดในซีซั่นนี้` })), `${reg[0].v} นัด`, { basis: "matches" });
    }

    // MVP โหวตมากสุด: weekly MVP wins in the weeks the season ran
    if (club?.mvp && typeof club.mvp === "object" && range.end) {
      const lo = range.start ? weekKey(range.start) : "", hi = weekKey(range.end), wins = {};
      Object.entries(club.mvp).forEach(([week, votes]) => {
        if (!/^\d{4}-W\d{2}$/.test(week) || week < lo || week > hi) return;
        weekWinners(votes).forEach(id => { wins[id] = (wins[id] || 0) + 1; });
      });
      const mvp = best(Object.entries(wins).map(([id, v]) => ({ id, v })), more);
      add("mvp", mvp.map(e => ({ ...e, reason: `ชนะโหวต MVP ประจำสัปดาห์ ${e.v} ครั้ง` })), `${mvp[0]?.v} สัปดาห์`);
    }

    // ม้ามืด: the season's win over the highest-rated opponent (rating gap before the match)
    if (tl && elo) {
      const ups = [];
      tl.forEach((m, i) => {
        if (m.src !== "league" || Number(m.season) !== s || m.a.length !== 1 || m.s.a === m.s.b) return;
        const [a] = m.a, [b] = m.b, sa = step[a]?.get(i), sb = step[b]?.get(i); if (!sa || !sb) return;
        const ra = sa.rating - sa.d, rb = sb.rating - sb.d, aWon = m.s.a > m.s.b;
        const gap = aWon ? rb - ra : ra - rb;
        if (gap > 0) ups.push({ id: aWon ? a : b, v: gap, foe: aWon ? b : a, score: aWon ? `${m.s.a}-${m.s.b}` : `${m.s.b}-${m.s.a}` });
      });
      const top = best(ups, more), seen = new Set();
      const win = top.filter(e => !seen.has(e.id) && seen.add(e.id));
      add("upset", win.map(e => ({ id: e.id, reason: `ชนะ ${nm(e.foe)} ${e.score} ทั้งที่ Elo ต่ำกว่า ${e.v}` })), `Elo ห่าง ${win[0]?.v}`);
    }

    awards.sort((x, y) => ORDER.indexOf(x.key) - ORDER.indexOf(y.key));
    return { season: s, start: range.start, end: range.end, players: roster, matchCount: matches.length, awards };
  }

  // Every finished season, latest first; Elo is worked out once for all of them.
  function all(l, extras = {}) {
    const E = Elo(), x = { ...extras };
    if (E && !x.elo) { try { x.elo = E.ratings(l, extras.club || null); x.timeline = E.timeline(l, extras.club || null); } catch {} }
    return finishedSeasons(l).reverse().map(s => compute(l, s, x)).filter(Boolean);
  }
  // The awards one player won, latest season first: [{ season, key, icon, title, label }].
  function forPlayer(l, id, extras = {}) {
    if (!id) return [];
    const out = [];
    all(l, extras).forEach(r => r.awards.forEach(a => { if (a.winners.some(w => w.id === id)) out.push({ season: r.season, key: a.key, icon: a.icon, title: a.title, label: `${a.icon} ${a.title} S${r.season}` }); }));
    return out;
  }
  const latestSeason = l => finishedSeasons(l).pop() ?? null;

  return Object.freeze({ DEFS, ORDER, PODIUM, CLOSE, MIN_BETS, dateKey, weekKey, weekWinners, seasonRange, seasonMatches, finishedSeasons, compute, all, forPlayer, latestSeason });
})();
if (typeof module !== "undefined") module.exports = SeasonAwards;

// ---------- Ceremony, summary, share poster, entry points ----------
(() => {
  if (typeof document === "undefined") return;
  const A = SeasonAwards;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS = () => typeof LeagueShared !== "undefined" ? LeagueShared : null;
  const league = () => { try { return LS()?.readLocalLeague() || null; } catch { return null; } };
  const extras = () => {
    let pred = null, club = null;
    try { pred = JSON.parse(localStorage.getItem(LS()?.PRED_KEY) || "null"); } catch {}
    try { club = LS()?.readLocalClub?.() || null; } catch {}
    return { pred, club };
  };
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const say = (msg, type) => window.LeagueToast ? window.LeagueToast(msg, type) : null;
  const avatar = (id, name, size = "xl") => window.LeagueUI?.avatar ? window.LeagueUI.avatar(id, name, size) : `<span class="pa ${size}">${esc(String(name || "?").slice(0, 1))}</span>`;
  const REVEAL_MS = 1900; // the drumroll before a card turns by itself

  // The browser copy fills in the predictions and club row when the caller does not pass them.
  const api = { ...A, forPlayer: (l, id, x) => A.forPlayer(l, id, x || extras()), compute: (l, s, x) => A.compute(l, s, x || extras()) };

  let root = null, data = null, at = 0, revealed = false, timer = 0, lastFocus = null;
  function ensure() {
    if (root) return root;
    root = document.createElement("div"); root.className = "aw"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "พิธีมอบรางวัลท้ายซีซั่น");
    document.body.appendChild(root);
    root.addEventListener("click", e => {
      if (e.target.closest("[data-aw-close]")) return close();
      if (e.target.closest("[data-aw-skip]")) return summary();
      if (e.target.closest("[data-aw-share]")) return share(e.target.closest("[data-aw-share]"));
      if (e.target.closest("[data-aw-replay]")) return show(0);
      if (e.target.closest("a,button:not([data-aw-next])") || at >= data.list.length) return;
      advance();
    });
    document.addEventListener("keydown", e => {
      if (!root || root.hidden) return;
      if (e.key === "Escape") close();
      // Enter/Space on a focused button already clicks it; the arrow key works from anywhere.
      else if (at < data.list.length && (e.key === "ArrowRight" || ((e.key === " " || e.key === "Enter") && !e.target.closest?.("button,a")))) { e.preventDefault(); advance(); }
    });
    return root;
  }
  const winnersHtml = (a, size) => `<div class="aw-winners${a.winners.length > 1 ? " tie" : ""}">${a.winners.map(w => `<div class="aw-winner">${avatar(w.id, w.name, size)}<b>${esc(w.name)}</b><small>${esc(w.reason)}</small></div>`).join("")}</div>`;
  function slide(a, i) {
    const n = data.list.length, champ = a.key === "champion";
    return `<p class="aw-kicker">รางวัลที่ ${i + 1} จาก ${n} • ซีซั่น ${esc(data.season)}</p>
<h2 class="aw-title"><span aria-hidden="true">${a.icon}</span> ${esc(a.title)}</h2><p class="aw-sub">${esc(a.sub)}</p>
<div class="aw-card${champ ? " is-champ" : ""}" aria-live="polite"><div class="aw-flip">
 <div class="aw-face aw-back" aria-hidden="${revealed}"><span class="aw-q">?</span><span class="aw-drum">กลองรัว…</span></div>
 <div class="aw-face aw-front" aria-hidden="${!revealed}">${a.winners.length > 1 ? `<span class="aw-tie">ครองร่วม ${a.winners.length} คน</span>` : ""}${winnersHtml(a, a.winners.length > 2 ? "lg" : "xl")}<span class="aw-value">${esc(a.value)}</span></div>
</div></div>
<button type="button" class="aw-next primary" data-aw-next>${revealed ? (i + 1 < n ? "รางวัลถัดไป" : "ดูทำเนียบรางวัล") : "เปิดซองรางวัล"}</button>`;
  }
  function bar() { return `<div class="aw-bar" aria-hidden="true">${data.list.map((_, j) => `<i class="${j < at || (j === at && revealed) ? "done" : j === at ? "run" : ""}"></i>`).join("")}<i class="${at >= data.list.length ? "done" : ""}"></i></div>`; }
  function chrome(body, cls) {
    root.innerHTML = `${bar()}<div class="aw-top"><button type="button" class="aw-skip" data-aw-skip ${at >= data.list.length ? "hidden" : ""}>ข้าม</button><button type="button" class="aw-x" data-aw-close aria-label="ปิด"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div><div class="aw-stage ${cls}">${body}</div>`;
  }
  function show(i) {
    clearTimeout(timer); at = i; revealed = false;
    if (at >= data.list.length) return summary();
    const a = data.list[at];
    chrome(slide(a, at), `tone-${A.PODIUM.includes(a.key) ? a.key : "dark"}`);
    root.querySelector("[data-aw-next]")?.focus({ preventScroll: true });
    timer = setTimeout(reveal, still() ? 600 : REVEAL_MS);
  }
  function reveal() {
    clearTimeout(timer); if (revealed || at >= data.list.length) return;
    revealed = true;
    const card = root.querySelector(".aw-card"), btn = root.querySelector("[data-aw-next]");
    if (!card) return;
    card.classList.add("on");
    card.querySelector(".aw-back")?.setAttribute("aria-hidden", "true"); card.querySelector(".aw-front")?.setAttribute("aria-hidden", "false");
    if (btn) btn.textContent = at + 1 < data.list.length ? "รางวัลถัดไป" : "ดูทำเนียบรางวัล";
    root.querySelectorAll(".aw-bar i")[at]?.classList.replace("run", "done");
    if (!still()) setTimeout(() => { const r = card.getBoundingClientRect(); window.ArenaFX?.burst?.(r.left + r.width / 2, r.top + r.height * .35, data.list[at]?.key === "champion" ? 140 : 70, data.list[at]?.key === "champion" ? 1.4 : 1); }, 380);
  }
  function advance() { if (!revealed) reveal(); else show(at + 1); }
  function summary() {
    clearTimeout(timer); at = data.list.length; revealed = true;
    const tiles = data.list.slice().reverse().map(a => `<li class="aw-tile k-${esc(a.key)}"><div class="aw-tile-head"><span aria-hidden="true">${a.icon}</span><b>${esc(a.title)}</b><em>${esc(a.value)}</em></div><div class="aw-tile-who">${a.winners.map(w => `<span class="pchip">${avatar(w.id, w.name, "sm")}<span class="pchip-name">${esc(w.name)}</span></span>`).join("")}</div><small>${esc(a.winners[0].reason)}</small></li>`).join("");
    chrome(`<p class="aw-kicker">ซีซั่น ${esc(data.season)}${data.range ? ` • ${esc(data.range)}` : ""}</p><h2 class="aw-title">ทำเนียบรางวัล</h2><ul class="aw-grid">${tiles}</ul><div class="aw-actions"><button type="button" class="primary" data-aw-share>แชร์เข้า LINE</button><button type="button" class="secondary" data-aw-replay>ดูพิธีอีกครั้ง</button><button type="button" class="secondary" data-aw-close>ปิด</button></div>`, "tone-summary aw-summary");
    root.querySelector("[data-aw-share]")?.focus({ preventScroll: true });
  }
  const shortDate = v => { try { return v ? new Date(v).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : ""; } catch { return ""; } };
  function open(season) {
    const l = league(); if (!l?.rankHistory) return say("ยังไม่มีข้อมูลลีก", "bad");
    const s = Number(season) || A.latestSeason(l);
    const r = s != null ? A.compute(l, s, extras()) : null;
    if (!r?.awards.length) return say("ซีซั่นนี้ยังไม่มีรางวัลให้มอบ", "bad");
    data = { season: r.season, result: r, list: r.awards, range: [shortDate(r.start), shortDate(r.end)].filter(Boolean).join(" – ") };
    ensure(); lastFocus = document.activeElement;
    root.hidden = false; document.body.classList.add("aw-open");
    markSeen(r.season);
    show(0);
  }
  function close() {
    if (!root || root.hidden) return;
    clearTimeout(timer); root.hidden = true; root.innerHTML = ""; document.body.classList.remove("aw-open");
    lastFocus?.focus?.({ preventScroll: true });
  }

  // ---------- Share poster (1080x1350, names via fillText) ----------
  const W = 1080, H = 1350, DISPLAY = "Kanit, Anuphan, sans-serif", BODY = "Anuphan, system-ui, sans-serif";
  const C = { bg: "#0a0b0e", paper: "#15171d", paper2: "#1c1f26", ink: "#f4f5f7", soft: "#9ba1ad", line: "rgba(255,255,255,.14)", red: "#d81e29", redHi: "#ff4752", gold: "#f5b80b", goldHi: "#ffe28a" };
  const SP = () => window.SharePoster || {};
  const clean = (v, max = 28) => SP().cleanName ? SP().cleanName(v, max) : String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function txt(c, s, x, y, { size = 40, min = 20, display = true, weight = 700, color = C.ink, align = "center", max = 900 } = {}) {
    const f = px => display ? `italic 800 ${px}px ${DISPLAY}` : `${weight} ${px}px ${BODY}`;
    const measure = (t, px) => { c.font = f(px); return c.measureText(t).width; };
    const px = SP().fitSize ? SP().fitSize(measure, s, max, size, min) : (() => { let z = size; while (z > min && measure(s, z) > max) z -= 2; return z; })();
    c.font = f(px); c.fillStyle = color; c.textAlign = align; c.textBaseline = "alphabetic"; c.fillText(s, x, y, max);
  }
  function drawPoster(c, d) {
    const list = d.list, champ = list.find(a => a.key === "champion"), rest = list.filter(a => a.key !== "champion").reverse();
    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W * .5, 0, 0, W * .5, 0, 1000); g.addColorStop(0, "rgba(229,36,47,.45)"); g.addColorStop(1, "rgba(229,36,47,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
    const g2 = c.createRadialGradient(W * .5, 520, 0, W * .5, 520, 520); g2.addColorStop(0, "rgba(245,184,11,.18)"); g2.addColorStop(1, "rgba(245,184,11,0)"); c.fillStyle = g2; c.fillRect(0, 0, W, H);
    c.lineWidth = 4; c.strokeStyle = "rgba(255,71,82,.55)"; c.strokeRect(22, 22, W - 44, H - 44);
    txt(c, "ตีให้สุด หยุดที่เบ้าตา", W / 2, 120, { size: 44, color: C.redHi });
    txt(c, "ทำเนียบรางวัล", W / 2, 220, { size: 104, min: 60 });
    txt(c, `SEASON ${d.season}  •  รางวัลท้ายซีซั่น${d.range ? `  •  ${d.range}` : ""}`, W / 2, 278, { size: 32, display: false, color: C.soft, max: 940 });
    let y = 312;
    if (champ) {
      rrect(c, 60, y, W - 120, 220, 22); c.fillStyle = "rgba(245,184,11,.1)"; c.fill(); c.lineWidth = 4; c.strokeStyle = "rgba(245,184,11,.75)"; c.stroke();
      txt(c, "🏆  แชมป์ซีซั่น", W / 2, y + 62, { size: 36, display: false, weight: 800, color: C.gold });
      txt(c, champ.winners.map(w => clean(w.name, 18)).join(" / "), W / 2, y + 150, { size: 96, min: 44, color: C.goldHi, max: 900 });
      txt(c, champ.winners[0].reason, W / 2, y + 196, { size: 30, display: false, weight: 600, color: C.ink, max: 900 });
      y += 250;
    }
    const cols = 2, rows = Math.ceil(rest.length / cols), gap = 18, top = y, bottom = H - 110;
    const rowH = rows ? Math.min(170, (bottom - top - gap * (rows - 1)) / rows) : 0, colW = (W - 120 - gap) / cols;
    rest.forEach((a, i) => {
      const x = 60 + (i % cols) * (colW + gap), yy = top + Math.floor(i / cols) * (rowH + gap);
      rrect(c, x, yy, colW, rowH, 18); c.fillStyle = C.paper; c.fill(); c.lineWidth = 2; c.strokeStyle = C.line; c.stroke();
      c.fillStyle = C.red; rrect(c, x, yy, 10, rowH, 5); c.fill();
      const s = rowH / 150;
      txt(c, `${a.icon}  ${a.title}`, x + 34, yy + 44 * s, { size: Math.round(30 * s), min: 18, display: false, weight: 800, color: C.redHi, align: "left", max: colW - 60 });
      txt(c, a.winners.map(w => clean(w.name, 16)).join(" / "), x + 34, yy + 100 * s, { size: Math.round(50 * s), min: 22, align: "left", max: colW - 60 });
      txt(c, a.value, x + 34, yy + 136 * s, { size: Math.round(26 * s), min: 16, display: false, weight: 600, color: C.soft, align: "left", max: colW - 60 });
    });
    const dt = new Date();
    txt(c, `ตีให้สุด หยุดที่เบ้าตา  •  ซีซั่น ${d.season}  •  ${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear() + 543}`, W / 2, H - 60, { size: 28, display: false, weight: 600, color: C.soft });
  }
  async function share(btn) {
    if (!data || btn.getAttribute("aria-busy") === "true") return; btn.setAttribute("aria-busy", "true");
    try {
      await (SP().loadFonts?.() || document.fonts?.ready);
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H; drawPoster(cv.getContext("2d"), data);
      const blob = await new Promise(ok => cv.toBlob(ok, "image/png")); if (!blob) throw new Error("no image");
      const name = SP().posterFileName ? SP().posterFileName("awards", data.season) : `pingpong-season-${data.season}-awards.png`;
      const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
      if (file && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "ทำเนียบรางวัล", text: `ตีให้สุด หยุดที่เบ้าตา • รางวัลท้ายซีซั่น ${data.season}` }); return; } catch (e) { if (e?.name === "AbortError") return; } }
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      say("บันทึกรูปแล้ว ส่งเข้า LINE ได้เลย", "good");
    } catch { say("ทำรูปไม่สำเร็จ", "bad"); }
    finally { btn.removeAttribute("aria-busy"); }
  }

  // ---------- Entry: archive page (button in the selected season's head and on its poster) ----------
  function archiveButtons() {
    const title = document.getElementById("detailTitle"); if (!title) return;
    const s = Number(/ซีซั่น\s+(\d+)/.exec(title.textContent || "")?.[1]), l = league();
    const done = Number.isFinite(s) && (l?.rankHistory || []).some(h => Number(h.season) === s && (h.standings || []).length);
    const head = title.closest(".section-head");
    let btn = document.getElementById("awOpenArchive");
    if (!done) { btn?.remove(); return; }
    if (!btn) { btn = document.createElement("button"); btn.type = "button"; btn.id = "awOpenArchive"; btn.className = "aw-open-btn"; head?.appendChild(btn); }
    if (btn.dataset.season !== String(s)) { btn.dataset.season = String(s); btn.innerHTML = `<span aria-hidden="true">🏆</span> ดูพิธีมอบรางวัล`; btn.setAttribute("aria-label", `ดูพิธีมอบรางวัลซีซั่น ${s}`); }
    btn.onclick = () => open(s);
    const actions = document.querySelector("#seasonPoster .poster-actions");
    if (actions && !actions.querySelector("[data-aw-poster]")) { const b = document.createElement("button"); b.type = "button"; b.className = "primary"; b.dataset.awPoster = "1"; b.textContent = "ดูพิธีมอบรางวัล"; b.onclick = () => open(Number(/ซีซั่น\s+(\d+)/.exec(document.getElementById("detailTitle")?.textContent || "")?.[1])); actions.prepend(b); }
  }
  function watchArchive() {
    const box = document.getElementById("detailCard"); if (!box) return;
    let q = false; const later = () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; archiveButtons(); }); };
    new MutationObserver(later).observe(box, { childList: true, subtree: true, characterData: true });
    const poster = document.getElementById("seasonPoster"); if (poster) new MutationObserver(later).observe(poster, { childList: true });
    archiveButtons();
  }

  // ---------- Entry: home pill, once per finished season, queued behind the Wrapped pill ----------
  const SEEN = "pp_awards_seen";
  const seen = () => { try { return Number(localStorage.getItem(SEEN)) || 0; } catch { return 0; } };
  function markSeen(s) { try { if (Number(s) > seen()) localStorage.setItem(SEEN, String(s)); } catch {} document.querySelector(".aw-offer")?.remove(); }
  function offer() {
    if (!document.body.classList.contains("sport-page-index-html") || document.querySelector(".aw-offer")) return;
    const l = league(); let me = ""; try { me = LS()?.sessionUserId(l) || ""; } catch {}
    if (!l?.profiles?.[me]) return;
    const s = A.latestSeason(l); if (s == null || s <= seen()) return;
    if (document.querySelector(".wr-offer")) { // Wrapped first: wait until its pill is gone
      const mo = new MutationObserver(() => { if (!document.querySelector(".wr-offer")) { mo.disconnect(); setTimeout(offer, 700); } });
      mo.observe(document.body, { childList: true }); return;
    }
    if (document.querySelector(".wr:not([hidden])")) { setTimeout(offer, 1500); return; }
    if (!A.compute(l, s, extras())?.awards.length) return;
    const pill = document.createElement("div"); pill.className = "aw-offer";
    pill.innerHTML = `<button type="button" class="aw-offer-go"><span aria-hidden="true">🏆</span> พิธีมอบรางวัลซีซั่น ${esc(s)} พร้อมแล้ว <b>ดูเลย</b></button><button type="button" class="aw-offer-x" aria-label="ไม่ดูตอนนี้">×</button>`;
    pill.querySelector(".aw-offer-go").addEventListener("click", () => open(s));
    pill.querySelector(".aw-offer-x").addEventListener("click", () => markSeen(s));
    document.body.appendChild(pill);
  }

  function boot() { watchArchive(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  // Wrapped offers its pill 1.2 s after load; check after it so its pill (if any) is already there to queue behind.
  if (document.readyState === "complete") setTimeout(offer, 1800); else addEventListener("load", () => setTimeout(offer, 1800), { once: true });

  window.SeasonAwards = Object.freeze({ ...api, open, close, drawPoster });
})();
