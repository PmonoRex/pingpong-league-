// Elo rating for every player, computed (never stored) from league matches plus the friendly matches in the club row
// (challenges, tournament games: club.matches, docs/club-data.md). Pure functions first (LeagueElo, tested in Node by
// tests/elo.test.cjs); the small DOM part at the bottom shows the rating on the stats page, the dashboard and the
// dealer's handicap field, and hands the player card its rating block (LeagueEloView).
//
// Rules: everyone starts at 1000. K = 48 for a player's first 10 games, then 32. The result comes from the score
// (more points or games = win, equal = draw) and a small margin factor (x1 to x1.25 by how lopsided the score was).
// Doubles: each side plays at its average rating and every player on it moves by the same expected/actual gap
// (with their own K).
//
// Order: league matches have no time, club matches do (`at`). Archived seasons are taken in season order, each in
// schedule order. A finished season has a finishedAt time in rankHistory, so the club matches played up to that
// moment go right after that season's league matches; everything later (the current season) comes next, and the club
// matches since the last finished season go last, sorted by `at`. So a challenge played mid-season counts after that
// season's league games; within the current season that means league games first, then challenges.
const LeagueElo = (() => {
  const START = 1000, K = 32, K_NEW = 48, NEW_GAMES = 10;
  const valid = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const Stats = () => typeof LeagueStats !== "undefined" ? LeagueStats : (typeof require === "function" ? require("./league-stats.js") : null);

  const expected = (ra, rb) => 1 / (1 + Math.pow(10, (rb - ra) / 400));
  // Suggested handicap the stronger player gives (points/balls): 1 per 50 rating, 0 to 6.
  const handicapHint = (ra, rb) => Math.max(0, Math.min(6, Math.round((ra - rb) / 50) || 0));
  const margin = s => { const hi = Math.max(s.a, s.b); return hi > 0 ? 1 + 0.25 * Math.abs(s.a - s.b) / hi : 1; };
  const side = v => (Array.isArray(v) ? v : [v]).filter(x => typeof x === "string" && x);

  // Every rated match in the order described above: { src, season?, id, a: [ids], b: [ids], s, at? }.
  function timeline(league, club) {
    const S = Stats(), out = [];
    const finished = {};
    (league?.rankHistory || []).forEach(h => { if (h?.finishedAt) finished[Number(h.season)] = String(h.finishedAt); });
    const friendly = (Array.isArray(club?.matches) ? club.matches : [])
      .filter(m => m && valid(m.s) && side(m.a).length && side(m.b).length && side(m.a).length === side(m.b).length &&
        !side(m.a).some(id => side(m.b).includes(id)))
      .map((m, i) => ({ m, i })).sort((x, y) => String(x.m.at || "").localeCompare(String(y.m.at || "")) || x.i - y.i).map(x => x.m);
    let next = 0;
    const flush = until => { while (next < friendly.length && (until === null || String(friendly[next].at || "") <= until)) {
      const m = friendly[next++]; out.push({ src: "club", id: m.id, kind: m.kind || "", a: side(m.a), b: side(m.b), s: { a: m.s.a, b: m.s.b }, at: m.at || "" }); } };
    const league_ = S ? S.matches(league) : [];
    league_.forEach((m, i) => {
      out.push({ src: "league", season: m.season, id: m.id, a: [m.pair[0]], b: [m.pair[1]], s: { a: m.s.a, b: m.s.b } });
      const last = !league_[i + 1] || league_[i + 1].season !== m.season;
      if (last && finished[m.season]) flush(finished[m.season]);
    });
    flush(null);
    return out;
  }

  // { id: { rating, games, peak, w, d, l, last, history: [{ i, at?, season?, rating, d }] } }; ratings are rounded.
  function ratings(league, club) {
    const raw = {}, get = id => raw[id] ||= { r: START, games: 0, peak: START, w: 0, d: 0, l: 0, history: [] };
    timeline(league, club).forEach((m, i) => {
      const A = m.a.map(get), B = m.b.map(get);
      const avg = list => list.reduce((t, p) => t + p.r, 0) / list.length;
      const ra = avg(A), rb = avg(B), ea = expected(ra, rb), sa = m.s.a > m.s.b ? 1 : m.s.a < m.s.b ? 0 : 0.5, mf = margin(m.s);
      const move = (p, score, exp) => {
        const k = p.games < NEW_GAMES ? K_NEW : K, d = k * mf * (score - exp);
        p.r += d; p.games++; p.peak = Math.max(p.peak, p.r);
        if (score === 1) p.w++; else if (score === 0) p.l++; else p.d++;
        p.history.push({ i, ...(m.at ? { at: m.at } : {}), ...(m.season ? { season: m.season } : {}), src: m.src, rating: Math.round(p.r), d: Math.round(d) });
      };
      A.forEach(p => move(p, sa, ea)); B.forEach(p => move(p, 1 - sa, 1 - ea));
    });
    const out = {};
    Object.entries(raw).forEach(([id, p]) => { out[id] = { rating: Math.round(p.r), games: p.games, peak: Math.round(p.peak), w: p.w, d: p.d, l: p.l,
      last: p.history.length ? p.history[p.history.length - 1].d : 0, history: p.history }; });
    return out;
  }
  const rating = (table, id) => table?.[id]?.rating ?? START;
  // Highest rated first (only players who have played), ties by games played.
  const top = (table, n = 5, only = null) => Object.entries(table || {}).filter(([id, p]) => p.games > 0 && (!only || only.includes(id)))
    .sort((x, y) => y[1].rating - x[1].rating || y[1].games - x[1].games).slice(0, n).map(([id, p]) => ({ id, ...p }));
  const rankOf = (table, id, only = null) => { const i = top(table, Infinity, only).findIndex(x => x.id === id); return i < 0 ? 0 : i + 1; };

  return Object.freeze({ START, K, K_NEW, NEW_GAMES, expected, handicapHint, margin, timeline, ratings, rating, top, rankOf });
})();
if (typeof module !== "undefined") module.exports = LeagueElo;

// ---------- Views: player card block, stats page line, dashboard top list, dealer hint ----------
(() => {
  if (typeof document === "undefined") return;
  const E = LeagueElo, LS = () => typeof LeagueShared !== "undefined" ? LeagueShared : null;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const league = () => { try { if (typeof state !== "undefined" && state?.profiles) return state; } catch {} try { return LS()?.readLocalLeague() || null; } catch { return null; } };
  const club = () => { try { return LS()?.readLocalClub?.() || null; } catch { return null; } };
  const nm = (l, id) => l?.profiles?.[id]?.displayName || id;
  const active = l => Object.values(l?.profiles || {}).filter(p => p && p.active !== false).map(p => p.id);
  const table = (l = league()) => { try { return E.ratings(l, club()); } catch { return {}; } };

  // A tiny line of the rating over the last 30 games (starts at 1000), last point marked.
  function sparkline(history, w = 120, h = 34) {
    const pts = [E.START, ...(history || []).map(x => x.rating)].slice(-31);
    if (pts.length < 2) return "";
    const lo = Math.min(...pts), hi = Math.max(...pts), span = Math.max(hi - lo, 20), pad = 3;
    const xy = pts.map((v, i) => [pad + i * (w - pad * 2) / (pts.length - 1), pad + (h - pad * 2) * (1 - (v - lo) / span)].map(n => Math.round(n * 10) / 10));
    const line = xy.map(p => p.join(",")).join(" "), end = xy[xy.length - 1], up = pts[pts.length - 1] >= pts[0];
    return `<svg class="elo-spark ${up ? "up" : "down"}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="กราฟ Elo ${pts.length - 1} เกมล่าสุด จาก ${pts[0]} เป็น ${pts[pts.length - 1]}">
<polygon points="${pad},${h} ${line} ${end[0]},${h}" class="elo-area"/><polyline points="${line}" fill="none" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${end[0]}" cy="${end[1]}" r="3"/></svg>`;
  }
  const delta = d => d ? `<em class="elo-d ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${Math.abs(d)}</em>` : "";

  // The block under the chips on the player card.
  function cardHtml(l, id) {
    const t = table(l), p = t[id];
    if (!p) return `<div class="elo-card"><div class="elo-num"><small>Elo</small><b>${E.START}</b></div><p class="elo-meta">ยังไม่มีเกมที่นับ Elo • เริ่มที่ ${E.START}</p></div>`;
    const rank = E.rankOf(t, id, active(l));
    return `<div class="elo-card"><div class="elo-num"><small>Elo</small><b>${p.rating}</b>${delta(p.last)}</div>${sparkline(p.history)}
<p class="elo-meta">${rank ? `อันดับ Elo #${rank} • ` : ""}สูงสุด ${p.peak} • ${p.games} เกม</p></div>`;
  }

  // stats.html: a line under the player's name, refreshed whenever stats.js renders the chosen player.
  function statsLine() {
    const sel = document.getElementById("playerA"), meta = document.getElementById("playerMeta"); if (!sel || !meta) return;
    const l = league(), p = table(l)[sel.value];
    let box = document.getElementById("eloLine");
    if (!box) { box = document.createElement("div"); box.id = "eloLine"; box.className = "elo-line"; meta.after(box); }
    const html = p ? `<span class="elo-pill"><small>Elo</small><b>${p.rating}</b>${delta(p.last)}</span><span class="elo-peak">สูงสุด <b>${p.peak}</b> • ${p.games} เกม</span>${sparkline(p.history, 96, 28)}`
      : `<span class="elo-pill"><small>Elo</small><b>${E.START}</b></span><span class="elo-peak">ยังไม่มีเกมที่นับ Elo</span>`;
    if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
  }

  // dashboard.html: a card with the five highest ratings, right after the podium.
  function dashboard() {
    const grid = document.querySelector(".dashboard-grid"); if (!grid) return;
    const l = league(); if (!l?.profiles) return;
    let card = document.getElementById("eloTop");
    if (!card) { card = document.createElement("section"); card.className = "card elo-top"; card.id = "eloTop"; const podium = document.getElementById("top3")?.closest(".card"); if (podium?.parentElement === grid) podium.after(card); else grid.prepend(card); }
    const t = table(l), list = E.top(t, 5, active(l)), UI = window.LeagueUI;
    const rows = list.map((x, i) => `<li><span class="elo-rank">${i + 1}</span><span class="form-who">${UI?.chip ? UI.chip(x.id, nm(l, x.id), "sm") : esc(nm(l, x.id))}</span>${sparkline(x.history, 64, 22)}<b class="elo-val">${x.rating}</b></li>`).join("");
    const html = `<h2>Elo สูงสุด</h2>${rows ? `<ol class="elo-list">${rows}</ol><p class="elo-foot">คำนวณจากผลลีกและท้าดวล • เริ่มที่ ${E.START}</p>` : (UI?.empty ? UI.empty("ยังไม่มีคะแนน Elo", "Elo จะขึ้นเมื่อมีผลการแข่งขันนัดแรก") : "<p class=\"muted\">ยังไม่มีคะแนน Elo</p>")}`;
    if (card.dataset.html !== html) { card.dataset.html = html; card.innerHTML = html; }
  }

  // predictions.html (dealer): "Elo แนะนำ…" under each market's handicap field. Text only; the dealer decides.
  function dealerHints() {
    const box = document.getElementById("dealerMarkets"); if (!box) return;
    const l = league(), t = table(l);
    box.querySelectorAll(".market").forEach(card => {
      const fav = card.querySelector("select[id^='fav-']"), ctl = card.querySelector(".market-controls"); if (!fav || !ctl) return;
      const [a, b] = [...fav.options].map(o => o.value); if (!a || !b) return;
      const ra = E.rating(t, a), rb = E.rating(t, b), strong = ra >= rb ? a : b, n = E.handicapHint(Math.max(ra, rb), Math.min(ra, rb));
      const chance = Math.round(E.expected(Math.max(ra, rb), Math.min(ra, rb)) * 100);
      const text = n ? `Elo แนะนำ: ${nm(l, strong)} ต่อ ${n} แต้ม` : "Elo สูสี • ไม่ต้องต่อ";
      let hint = card.querySelector(".elo-hint");
      if (!hint) { hint = document.createElement("p"); hint.className = "elo-hint"; ctl.after(hint); }
      const html = `<b>${esc(text)}</b><small>${esc(nm(l, a))} ${ra} • ${esc(nm(l, b))} ${rb} • โอกาสชนะ ${chance}%</small>`;
      if (hint.dataset.html !== html) { hint.dataset.html = html; hint.innerHTML = html; }
    });
  }

  function paint() { try { statsLine(); dashboard(); dealerHints(); } catch (e) { console.warn("elo view", e); } }
  function boot() {
    let queued = false;
    const later = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); };
    ["playerTitle", "dealerMarkets", "top3"].forEach(id => { const el = document.getElementById(id); if (el) new MutationObserver(later).observe(el, { childList: true, subtree: true, characterData: true }); });
    window.addEventListener("pp-club", later);
    addEventListener("storage", e => { if (e.key === LS()?.LEAGUE_KEY || e.key === LS()?.CLUB_KEY) later(); });
    paint();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.LeagueEloView = Object.freeze({ table, cardHtml, sparkline, paint });
})();
