// หอเกียรติยศ (hall.html): all-time records from every league season (archived ones too) plus the club's friendly
// matches (challenges, tournament games), and the list of every champion. Two parts:
//  - HallRecords: pure functions over the league + club objects (no DOM, no storage), tested in Node by
//    tests/hall.test.cjs. Loaded on every page (after elo.js, before pwa.js) so pwa.js can tell the signed-in player
//    when a record falls (HallRecords.events, memoized on the data it reads).
//  - The page view at the bottom, which runs only where #hall exists.
// Nothing here writes league or club data.
const HallRecords = (() => {
  const req = name => typeof require === "function" ? require(name) : null;
  const Elo = () => typeof LeagueElo !== "undefined" ? LeagueElo : req("./elo.js");
  const ids = e => (Array.isArray(e) ? e : [e]).filter(x => typeof x === "string" && x);
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const roundOf = id => { const m = /^r(\d+)m/.exec(String(id || "")); return m ? Number(m[1]) : null; };

  // What each record is called and how its number reads. notify: a new holder is worth a notification
  // (running totals like matches played or the current #1 change too often to announce).
  const DEFS = [
    { id: "streak", icon: "🔥", title: "ชนะรวดในลีก", unit: "นัด", min: 3, notify: true, phrase: v => `ชนะรวด ${v} นัด` },
    { id: "streakAll", icon: "⚡", title: "ชนะรวดทุกรายการ", unit: "นัด", min: 3, notify: true, phrase: v => `ชนะรวด ${v} นัด (รวมคลับ)` },
    { id: "unbeaten", icon: "🛡️", title: "ไม่แพ้ติดต่อกัน", unit: "นัด", min: 3, notify: true, phrase: v => `ไม่แพ้ติดกัน ${v} นัด` },
    { id: "margin", icon: "💥", title: "ชนะขาดที่สุด", unit: "แต้ม", min: 1, notify: true, phrase: v => `ชนะขาด ${v} แต้ม` },
    { id: "points", icon: "🎯", title: "ทำแต้มสูงสุดในนัดเดียว", unit: "แต้ม", min: 1, notify: true, phrase: v => `ทำ ${v} แต้มในนัดเดียว` },
    { id: "upset", icon: "🌪️", title: "พลิกล็อกครั้งใหญ่", unit: "Elo", min: 1, notify: true, phrase: v => `ล้มคู่แข่งที่ Elo สูงกว่า ${v}` },
    { id: "seasonRate", icon: "📈", title: "อัตราชนะซีซั่นดีสุด", unit: "%", min: 1, notify: false, phrase: v => `ชนะ ${v}% ในซีซั่นเดียว` },
    { id: "peakElo", icon: "🚀", title: "Elo สูงสุดตลอดกาล", unit: "Elo", min: 1, notify: false, phrase: v => `Elo แตะ ${v}` },
    { id: "topElo", icon: "👑", title: "Elo อันดับ 1 ตอนนี้", unit: "Elo", min: 1, notify: false, phrase: v => `Elo ${v} อันดับ 1` },
    { id: "titles", icon: "🏆", title: "แชมป์ลีกมากที่สุด", unit: "สมัย", min: 1, notify: true, phrase: v => `แชมป์ลีก ${v} สมัย` },
    { id: "tourney", icon: "🥇", title: "แชมป์ทัวร์นาเมนต์มากที่สุด", unit: "รายการ", min: 1, notify: true, phrase: v => `แชมป์ทัวร์ ${v} รายการ` },
    { id: "rp", icon: "💎", title: "RP สะสมสูงสุด", unit: "RP", min: 1, notify: false, phrase: v => `RP สะสม ${v}` },
    { id: "played", icon: "🏓", title: "ลงแข่งมากที่สุด", unit: "นัด", min: 1, notify: false, phrase: v => `ลงแข่ง ${v} นัด` }
  ];
  const DEF = Object.fromEntries(DEFS.map(d => [d.id, d]));

  // Record-over-time keeper. offer() a value as the data is walked in time order; whenever the all-time best is beaten
  // (strictly) a history entry is added. Entries with the same `run` and holder are one effort that kept growing
  // (a win streak still going, a running total) and update in place, so the entry before it is the record it broke.
  function keeper() {
    let best = -Infinity; const hist = [];
    return {
      offer(holder, value, ctx, run) {
        if (!(value > best)) return; best = value;
        const last = hist[hist.length - 1];
        if (last && run !== undefined && last.run === run && same(last.ids, holder)) { last.value = value; last.ctx = ctx; }
        else hist.push({ ids: holder.slice(), value, ctx, ...(run !== undefined ? { run } : {}) });
      },
      hist: () => hist.map(({ run, ...h }) => h)
    };
  }
  // A finished record: the best value, every holder at that value (ties; first to reach it first), and its history.
  function finish(id, entries, k) {
    const d = DEF[id], hist = k ? k.hist() : [];
    const top = entries.filter(e => e.value >= d.min);
    const value = top.length ? Math.max(...top.map(e => e.value)) : 0;
    const seen = new Set(), holders = [];
    if (value) top.filter(e => e.value === value).map((e, n) => ({ e, n })).sort((x, y) => (x.e.t ?? 0) - (y.e.t ?? 0) || x.n - y.n).map(x => x.e).forEach(e => { const key = e.ids.join("+"); if (!seen.has(key)) { seen.add(key); holders.push(e); } });
    const setter = hist.length && hist[hist.length - 1].value === value ? hist[hist.length - 1] : null;
    const prev = setter && hist.length > 1 ? hist[hist.length - 2] : null;
    return { id, icon: d.icon, title: d.title, unit: d.unit, value, holders, ids: [...new Set(holders.flatMap(h => h.ids))], history: hist, setter, prev };
  }

  // Every match, league and club, in Elo order (elo.js timeline), each with each side's points and where it was played.
  function games(l, club) {
    const E = Elo(); if (!E) return [];
    return E.timeline(l, club).map((m, i) => {
      const ref = m.src === "league" ? { src: "league", season: m.season, round: roundOf(m.id) } : { src: "club", kind: m.kind || "", at: m.at || "" };
      return { i, ...m, ref, win: m.s.a > m.s.b ? "a" : m.s.a < m.s.b ? "b" : "" };
    });
  }
  const sideOf = (g, id) => g.a.includes(id) ? "a" : g.b.includes(id) ? "b" : "";
  const other = s => s === "a" ? "b" : "a";

  // Win streak / unbeaten run per player over a list of games; good(g, side) says whether the run goes on.
  function runs(id, list, good) {
    const k = keeper(), best = {}, cur = {};
    list.forEach(g => [...g.a, ...g.b].forEach(p => {
      const s = sideOf(g, p), c = cur[p] ||= { n: 0, from: null, start: -1 };
      if (good(g, s)) { if (!c.n) { c.from = g.ref; c.start = g.i; } c.n++; } else { c.n = 0; return; }
      const opp = g[other(s)], ctx = { from: c.from, to: g.ref, last: { opp: opp.slice(), score: [g.s[s], g.s[other(s)]] } };
      if (!best[p] || c.n > best[p].value) best[p] = { ids: [p], value: c.n, ctx, t: g.i };
      k.offer([p], c.n, ctx, `${p}@${c.start}`);
    }));
    return finish(id, Object.values(best), k);
  }

  // One entry per match for match records (margin, points, upset): the side's ids, the value, the match.
  function perMatch(id, list, valueOf) {
    const k = keeper(), all = [];
    list.forEach(g => ["a", "b"].forEach(s => {
      const v = valueOf(g, s); if (v === null || v === undefined) return;
      const e = { ids: g[s].slice(), value: v, t: g.i, ctx: { at: g.ref, opp: g[other(s)].slice(), score: [g.s[s], g.s[other(s)]] } };
      all.push(e); k.offer(e.ids, v, e.ctx);
    }));
    return finish(id, all, k);
  }

  // Running totals (titles, RP, tournament titles, matches played): walk events in time order.
  function totals(id, steps) {
    const k = keeper(), sum = {};
    steps.forEach((st, n) => st.ids.forEach(p => {
      const t = sum[p] ||= { ids: [p], value: 0, ctx: { items: [] } };
      t.value += st.add; t.t = n; if (st.item !== undefined) t.ctx.items.push(st.item);
      k.offer([p], t.value, { items: t.ctx.items.slice() }, "total");
    }));
    return finish(id, Object.values(sum), k);
  }

  function compute(l, club) {
    const E = Elo(), list = games(l, club), league = list.filter(g => g.src === "league");
    const recs = {};
    const won = (g, s) => g.win === s, notLost = (g, s) => g.win === s || g.win === "";
    recs.streak = runs("streak", league, won);
    recs.streakAll = runs("streakAll", list, won);
    recs.unbeaten = runs("unbeaten", list, notLost);
    recs.margin = perMatch("margin", list, (g, s) => g.win === s ? g.s[s] - g.s[other(s)] : null);
    recs.points = perMatch("points", list, (g, s) => g.s[s] > 0 ? g.s[s] : null);

    // Elo: the ratings each side had going into every match (rounded, as shown everywhere else).
    const table = E ? E.ratings(l, club) : {}, pre = {};
    Object.entries(table).forEach(([p, r]) => r.history.forEach((h, n) => { (pre[h.i] ||= {})[p] = n ? r.history[n - 1].rating : E.START; }));
    const avg = (g, s) => g[s].reduce((t, p) => t + (pre[g.i]?.[p] ?? E.START), 0) / g[s].length;
    recs.upset = perMatch("upset", list, (g, s) => {
      if (g.win !== s) return null; const gap = Math.round(avg(g, other(s)) - avg(g, s));
      return gap > 0 ? gap : null;
    });
    recs.upset.holders.forEach(h => { const g = list.find(x => x.ref === h.ctx.at); if (g) { h.ctx.elo = [Math.round(avg(g, sideOf(g, h.ids[0]))), Math.round(avg(g, other(sideOf(g, h.ids[0]))))]; } });
    // Peak: walk every rating step in time order; one player's climb is one entry.
    const steps = [];
    Object.entries(table).forEach(([p, r]) => r.history.forEach(h => steps.push({ p, i: h.i, rating: h.rating })));
    steps.sort((x, y) => x.i - y.i);
    const kp = keeper(), peaks = {};
    steps.forEach(st => {
      const ctx = { at: list[st.i]?.ref || null };
      if (!peaks[st.p] || st.rating > peaks[st.p].value) peaks[st.p] = { ids: [st.p], value: st.rating, ctx, t: st.i };
      kp.offer([st.p], st.rating, ctx, "peak");
    });
    recs.peakElo = finish("peakElo", Object.values(peaks), kp);
    const active = Object.values(l?.profiles || {}).filter(p => p && p.active !== false).map(p => p.id);
    const now = Object.entries(table).filter(([p, r]) => r.games > 0 && (!l?.profiles || active.includes(p)))
      .map(([p, r]) => ({ ids: [p], value: r.rating, ctx: { games: r.games, peak: r.peak } }));
    recs.topElo = finish("topElo", now, null);

    // Best single-season league win rate (at least 5 matches). Compared as exact fractions; shown as a whole percent.
    const seasonsSeen = [...new Set(league.map(g => g.season))].sort((a, b) => a - b), rates = [];
    const kr = keeper();
    seasonsSeen.forEach(season => {
      const per = {};
      league.filter(g => g.season === season).forEach(g => ["a", "b"].forEach(s => { const p = g[s][0], t = per[p] ||= { n: 0, w: 0, d: 0, l: 0 }; t.n++; if (g.win === s) t.w++; else if (g.win === "") t.d++; else t.l++; }));
      Object.entries(per).filter(([, t]) => t.n >= 5).forEach(([p, t]) => {
        const e = { ids: [p], value: Math.round(t.w / t.n * 100), exact: t.w / t.n, t: season, ctx: { season, w: t.w, d: t.d, l: t.l, n: t.n } };
        rates.push(e); kr.offer([p], e.exact, e.ctx);
      });
    });
    const bestExact = rates.length ? Math.max(...rates.map(r => r.exact)) : 0;
    recs.seasonRate = finish("seasonRate", rates.filter(r => r.exact === bestExact && r.exact > 0), null);
    recs.seasonRate.history = kr.hist().map(h => ({ ...h, value: Math.round(h.value * 100) }));
    const hr = recs.seasonRate.history; recs.seasonRate.setter = hr[hr.length - 1] || null; recs.seasonRate.prev = hr.length > 1 ? hr[hr.length - 2] : null;

    // League titles and RP from the finished seasons (rankHistory), in season order.
    const hist = (l?.rankHistory || []).slice().sort((a, b) => Number(a.season) - Number(b.season));
    recs.titles = totals("titles", hist.flatMap(h => (h.standings || []).filter(r => r?.rank === 1 && r.userId).map(r => ({ ids: [r.userId], add: 1, item: Number(h.season) }))));
    recs.rp = totals("rp", hist.flatMap(h => (h.standings || []).filter(r => r?.userId && Number(r.rpAward) > 0).map(r => ({ ids: [r.userId], add: Number(r.rpAward), item: Number(h.season) }))));
    // Tournament titles: a doubles team's title counts for both players.
    recs.tourney = totals("tourney", tourneyChamps(club).map(t => ({ ids: t.ids, add: 1, item: t.name })));
    recs.played = totals("played", list.map(g => ({ ids: [...g.a, ...g.b], add: 1 })));
    recs.played.holders.forEach(h => { const p = h.ids[0]; h.ctx = { league: league.filter(g => sideOf(g, p)).length, club: list.filter(g => g.src === "club" && sideOf(g, p)).length }; });
    return DEFS.map(d => recs[d.id]);
  }

  const tTime = t => String(t?.doneAt || t?.lastAt || t?.at || "");
  function tourneyChamps(club) {
    return (Array.isArray(club?.tournaments) ? club.tournaments : []).filter(t => t?.status === "done" && ids(t.champion).length)
      .map((t, n) => ({ t, n })).sort((x, y) => tTime(x.t).localeCompare(tTime(y.t)) || x.n - y.n)
      .map(({ t }) => ({ id: t.id, name: String(t.name || "ทัวร์นาเมนต์"), title: t.title || (t.kind === "playoff" ? "แชมป์เพลย์ออฟ" : "แชมป์"), format: t.format || "singles", season: t.season ?? null, at: tTime(t), ids: ids(t.champion) }));
  }

  // Every champion, oldest first: league seasons (rank 1 in rankHistory; a shared first place lists everyone)
  // and finished tournaments.
  function champions(l, club) {
    const league = (l?.rankHistory || []).map(h => ({ kind: "league", season: Number(h.season), at: String(h.finishedAt || ""),
      ids: (h.standings || []).filter(r => r?.rank === 1 && r.userId).map(r => r.userId), name: `ลีก ซีซั่น ${Number(h.season)}`, title: "แชมป์ลีก",
      pts: (h.standings || []).find(r => r?.rank === 1)?.pts ?? null })).filter(x => x.ids.length);
    const t = tourneyChamps(club).map(x => ({ kind: "tournament", ...x }));
    const key = x => x.at || (x.kind === "league" ? "" : "~");
    return [...league, ...t].map((x, n) => ({ x, n })).sort((p, q) => {
      if (p.x.at && q.x.at) return p.x.at.localeCompare(q.x.at) || p.n - q.n;
      if (p.x.kind === "league" && q.x.kind === "league") return p.x.season - q.x.season;
      return key(p.x).localeCompare(key(q.x)) || p.n - q.n;
    }).map(p => p.x);
  }

  // Memoized on the data it reads, so pwa.js can call events() every few seconds for free.
  let memo = { sig: null, out: null };
  function signature(l, club) {
    try {
      return JSON.stringify([l?.currentSeason, l?.updatedAt || l?.updated_at || "", l?.results, (l?.rounds || []).length,
        (l?.seasonArchives || []).map(a => [a?.season, Object.keys(a?.results || {}).length]), (l?.rankHistory || []).length,
        Object.keys(l?.profiles || {}).length,
        // every club match's score: a tournament result edited later keeps the list length and the last entry's time
        (Array.isArray(club?.matches) ? club.matches : []).map(m => [m?.id, m?.s?.a, m?.s?.b, m?.at]),
        (club?.tournaments || []).map(t => [t?.id, t?.status, ids(t?.champion).join("+")])]);
    } catch { return null; }
  }
  function all(l, club) {
    const sig = signature(l, club);
    if (sig !== null && memo.sig === sig) return memo.out;
    const out = { records: compute(l, club), champions: champions(l, club) };
    memo = { sig, out };
    return out;
  }
  const records = (l, club) => all(l, club).records;

  // pwa.js notifications: one per record that was just broken (a previous holder existed), keyed by record, value
  // and holder so each fires once. Ties with the record are not announced.
  function events(l, club, me) {
    if (!l?.profiles) return [];
    const nm = id => l.profiles?.[id]?.displayName || id, out = [];
    records(l, club).forEach(r => {
      const d = DEF[r.id]; if (!d.notify || !r.setter || !r.prev || r.setter.value !== r.value || r.value < d.min) return;
      const who = r.setter.ids.map(nm).join(" / "), mine = me && r.setter.ids.includes(me);
      out.push({ key: `hall:${r.id}:${r.value}:${r.setter.ids.join("+")}`, title: mine ? "คุณทำสถิติใหม่!" : "สถิติใหม่!",
        body: `${who} ${d.phrase(r.value)} ทำลายสถิติเดิม ${r.prev.value}`, tag: `pp-hall-${r.id}` });
    });
    return out;
  }

  return Object.freeze({ DEFS, compute, records, champions, tourneyChamps, events, all });
})();
if (typeof module !== "undefined") module.exports = HallRecords;
if (typeof window !== "undefined") window.HallRecords = HallRecords;

// ---------- The page (hall.html) ----------
(() => {
  if (typeof document === "undefined") return;
  const H = HallRecords, LS = () => typeof LeagueShared !== "undefined" ? LeagueShared : null;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let league = null, club = null;
  const nm = id => league?.profiles?.[id]?.displayName || id;
  const avatar = (id, size) => window.LeagueUI?.avatar ? window.LeagueUI.avatar(id, nm(id), size) : "";
  const KIND = { challenge: "ท้าดวล", tournament: "ทัวร์" };
  const date = at => { const d = new Date(at); return at && !isNaN(d) ? d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" }) : ""; };
  const where = ref => !ref ? "" : ref.src === "league" ? `ซีซั่น ${ref.season}${ref.round !== null && ref.round !== undefined ? ` รอบ ${ref.round + 1}` : ""}` : [KIND[ref.kind] || "คลับ", date(ref.at)].filter(Boolean).join(" • ");
  const vs = (opp, score) => `${score ? `${score[0]}–${score[1]} ` : ""}vs ${opp.map(nm).join(" / ")}`;

  function context(r, h) {
    const c = h.ctx || {};
    switch (r.id) {
      case "streak": case "streakAll": case "unbeaten": {
        const a = where(c.from), b = where(c.to);
        return a === b ? a : `${a} → ${b}`;
      }
      case "margin": case "points": return `${vs(c.opp, c.score)} • ${where(c.at)}`;
      case "upset": return `${c.elo ? `Elo ${c.elo[0]} ล้ม ${c.elo[1]} • ` : ""}${vs(c.opp, c.score)} • ${where(c.at)}`;
      case "seasonRate": return `ซีซั่น ${c.season} • ชนะ ${c.w} เสมอ ${c.d} แพ้ ${c.l}`;
      case "peakElo": return c.at ? `ทำได้ที่ ${where(c.at)}` : "";
      case "topElo": return `${c.games} เกม • สูงสุด ${c.peak}`;
      case "titles": return `ซีซั่น ${c.items.join(", ")}`;
      case "rp": return `จาก ${c.items.length} ซีซั่น`;
      case "tourney": return c.items.join(" • ");
      case "played": return `ลีก ${c.league} • คลับ ${c.club}`;
    }
    return "";
  }

  function plaque(r, n) {
    if (!r.value) return `<li class="hall-plaque is-empty"><p class="hall-kicker"><i aria-hidden="true">${r.icon}</i>${esc(r.title)}</p><p class="hall-none">ยังไม่มีเจ้าของสถิติ</p></li>`;
    const tier = n < 3 ? "gold" : "silver", shown = r.holders.slice(0, 3), more = r.holders.length - shown.length;
    const prev = r.prev && r.setter && r.setter.value === r.value ? `<p class="hall-prev">ทำลายสถิติเดิม ${esc(r.prev.value)} ของ ${esc(r.prev.ids.map(nm).join(" / "))}</p>` : "";
    return `<li class="hall-plaque ${tier}" style="--i:${n}">
<div class="hall-top"><p class="hall-kicker"><i aria-hidden="true">${r.icon}</i>${esc(r.title)}</p>${r.holders.length > 1 ? `<em class="hall-tie">เสมอ ${r.holders.length}</em>` : ""}</div>
<div class="hall-main"><p class="hall-num"><b>${esc(r.value)}</b><small>${esc(r.unit)}</small></p>
<ul class="hall-holders">${shown.map(h => `<li><button type="button" class="hall-who" data-pid="${esc(h.ids[0])}" aria-label="ดูโปรไฟล์ ${esc(h.ids.map(nm).join(" / "))}"><span class="hall-avs">${h.ids.map(id => avatar(id, "")).join("")}</span><span class="hall-name">${esc(h.ids.map(nm).join(" / "))}</span></button><small class="hall-ctx">${esc(context(r, h))}</small></li>`).join("")}${more > 0 ? `<li class="hall-more">และอีก ${more} คน</li>` : ""}</ul></div>
${prev}</li>`;
  }

  function champRow(c) {
    const who = c.ids.map(id => `<button type="button" class="hall-who sm" data-pid="${esc(id)}" aria-label="ดูโปรไฟล์ ${esc(nm(id))}">${avatar(id, "sm")}<span class="hall-name">${esc(nm(id))}</span></button>`).join("");
    const meta = c.kind === "league" ? [date(c.at), c.pts !== null && c.pts !== undefined ? `${c.pts} แต้ม` : ""] : [c.format === "doubles" ? "คู่" : "เดี่ยว", c.season ? `ซีซั่น ${c.season}` : "", date(c.at)];
    return `<li class="hall-champ ${c.kind}"><span class="hall-champ-ico" aria-hidden="true">${c.kind === "league" ? "🏆" : "🥇"}</span><div class="hall-champ-body"><p class="hall-champ-name">${esc(c.name)}<small>${esc(c.title)}</small></p><div class="hall-champ-who">${who}</div><p class="hall-champ-meta">${esc(meta.filter(Boolean).join(" • "))}</p></div></li>`;
  }

  function render() {
    const box = document.getElementById("hall"); if (!box || !league?.profiles) return;
    const { records, champions } = H.all(league, club);
    const held = records.filter(r => r.value);
    const sub = document.getElementById("hallSub");
    if (sub) sub.textContent = held.length ? `${held.length} สถิติตลอดกาล • ${champions.length} แชมป์` : "ยังไม่มีสถิติ";
    const champs = champions.slice().reverse();
    const html = `<section class="hall-sec" aria-labelledby="hallRecTitle"><h2 id="hallRecTitle" class="hall-h">สถิติตลอดกาล</h2>
${held.length ? `<ol class="hall-grid">${records.map((r, n) => plaque(r, n)).join("")}</ol>` : (window.LeagueUI?.empty?.("ยังไม่มีสถิติ", "สถิติจะขึ้นเมื่อมีผลการแข่งขัน", null, "trophy") || "<p class=\"muted\">ยังไม่มีสถิติ</p>")}</section>
<section class="hall-sec" aria-labelledby="hallChampTitle"><h2 id="hallChampTitle" class="hall-h">แชมป์ทุกรายการ</h2>
${champs.length ? `<ol class="hall-champs">${champs.map(champRow).join("")}</ol>` : (window.LeagueUI?.empty?.("ยังไม่มีแชมป์", "จบซีซั่นหรือทัวร์นาเมนต์แรกแล้วชื่อแชมป์จะอยู่ที่นี่", null, "trophy") || "")}</section>`;
    if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; box.setAttribute("aria-busy", "false"); }
  }

  async function boot() {
    const box = document.getElementById("hall"); if (!box) return;
    const S = LS();
    league = S?.readLocalLeague?.() || null; club = S?.readLocalClub?.() || null;
    render();
    box.addEventListener("click", e => { const b = e.target.closest(".hall-who[data-pid]"); if (b) window.PlayerCard?.open?.(b.dataset.pid); });
    if (!S) return;
    // Fresh copies from the cloud (in memory only; the pages that own the rows keep the local copies).
    const [row, c] = await Promise.all([S.cloudRequest?.("league,updated_at").then(r => r?.[0], () => null), S.clubRead?.().catch(() => null)]);
    if (row?.league?.uidLeague?.profiles) league = row.league.uidLeague;
    if (c?.club) club = c.club;
    if (!league?.profiles) { box.innerHTML = window.LeagueUI?.empty?.("ยังไม่มีข้อมูลลีก", "เปิดหน้าแรกก่อนเพื่อโหลดข้อมูล", { href: "index.html", label: "ไปหน้าแรก" }) || ""; return; }
    render();
    addEventListener("storage", e => { if (e.key === S.LEAGUE_KEY || e.key === S.CLUB_KEY) { league = S.readLocalLeague() || league; club = S.readLocalClub() || club; render(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
