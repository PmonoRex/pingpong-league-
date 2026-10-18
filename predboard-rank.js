// ตารางนักทาย: who reads the games best. PredRank is pure maths over the predictions object (bets by players only;
// the dealer's book is not a bet and is never ranked). A bet counts the way BetSettle.effective sees it when that is
// loaded (so an edited score moves the table at once), else by its stored status/net. tests/predrank.test.cjs runs it.
// Below it, PredRankUI draws the card on predictions.html (predictions.js calls render after each of its renders),
// and the player card asks PredRank for the "เซียนทายผล" titles and the all-time prediction line.
const PredRank = (() => {
  const MIN_SETTLED = 5;
  const SETTLED = ["won", "lost", "push"];
  const ALL = "all";

  // {status, net} for one bet: opts.effective(bet) first, then BetSettle.effective on the page, then the stored fields.
  function effectiveOf(league, pred, bet, opts) {
    try {
      if (typeof opts?.effective === "function") { const e = opts.effective(bet); if (e) return { status: e.status, net: Number(e.net) || 0 }; }
      if (opts?.effective !== false && typeof BetSettle !== "undefined" && typeof LeagueShared !== "undefined" && league) {
        const e = BetSettle.effective(league, pred, bet); return { status: e.status, net: Number(e.net) || 0 };
      }
    } catch {}
    return { status: bet?.status, net: Number(bet?.net) || 0 };
  }

  // Bets in the order they were played: season, round, match, then bet id.
  const order = b => { const m = /^r(\d+)m(\d+)$/.exec(b?.matchId || ""); return [Number(b?.season) || 0, m ? Number(m[1]) : 0, m ? Number(m[2]) : 0, Number(b?.id) || 0]; };
  function byPlay(a, b) { const x = order(a), y = order(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }

  const blank = id => ({ id, settled: 0, decided: 0, hits: 0, misses: 0, pushes: 0, pending: 0, stake: 0, net: 0, hitRate: 0, roi: 0, streak: 0, bestStreak: 0, biggestWin: null, eligible: false, rank: null });

  // One row per player who has a bet in scope (season number, or "all").
  function playerStats(league, pred, season = ALL, opts = {}) {
    const rows = new Map();
    const bets = (Array.isArray(pred?.bets) ? pred.bets : []).filter(b => b && b.userId && (season === ALL || Number(b.season) === Number(season))).slice().sort(byPlay);
    bets.forEach(b => {
      const e = effectiveOf(league, pred, b, opts);
      if (e.status === "void") return;
      const r = rows.get(b.userId) || rows.set(b.userId, blank(b.userId)).get(b.userId);
      if (!SETTLED.includes(e.status)) { if (e.status === "pending") r.pending++; return; }
      const stake = Number(b.stake) || 0;
      r.settled++; r.stake += stake; r.net += e.net;
      if (e.status === "push") { r.pushes++; return; } // a refund neither keeps nor breaks a streak
      r.decided++;
      if (e.status === "won") {
        r.hits++; r.streak++; r.bestStreak = Math.max(r.bestStreak, r.streak);
        if (!r.biggestWin || e.net > r.biggestWin.net) r.biggestWin = { net: e.net, betId: b.id, season: Number(b.season), matchId: b.matchId, sideId: b.sideId };
      } else { r.misses++; r.streak = 0; }
    });
    const min = Number.isFinite(opts.minSettled) ? opts.minSettled : MIN_SETTLED;
    rows.forEach(r => {
      r.hitRate = r.decided ? r.hits / r.decided : 0;
      r.roi = r.stake ? r.net / r.stake : 0;
      r.eligible = r.settled >= min;
    });
    return [...rows.values()];
  }

  // Net credits first, then hit rate, then more settled bets; the id keeps equal rows in a stable order.
  const compare = (a, b) => b.net - a.net || b.hitRate - a.hitRate || b.settled - a.settled || String(a.id).localeCompare(String(b.id));

  // The table: ranked (eligible, with rank numbers; equal net/rate/count share a rank) and the rest, still short of the minimum.
  function board(league, pred, season = ALL, opts = {}) {
    const all = playerStats(league, pred, season, opts).filter(r => r.settled || r.pending);
    const ranked = all.filter(r => r.eligible).sort(compare), rest = all.filter(r => !r.eligible).sort((a, b) => b.settled - a.settled || compare(a, b));
    ranked.forEach((r, i) => { const p = ranked[i - 1]; r.rank = p && p.net === r.net && p.hitRate === r.hitRate && p.settled === r.settled ? p.rank : i + 1; });
    return { season, minSettled: Number.isFinite(opts.minSettled) ? opts.minSettled : MIN_SETTLED, ranked, rest, finished: season !== ALL && isFinished(league, season) };
  }

  // A season is over once the league wrote its final standings to rankHistory.
  const isFinished = (league, season) => (league?.rankHistory || []).some(h => Number(h?.season) === Number(season));

  // Seasons that have bets, newest first, with the current one always offered.
  function seasons(league, pred) {
    const set = new Set([Number(league?.currentSeason) || 1]);
    (pred?.bets || []).forEach(b => { const s = Number(b?.season); if (Number.isFinite(s) && s > 0) set.add(s); });
    return [...set].sort((a, b) => b - a);
  }

  // เซียนทายผล S{n}: rank 1 of each finished season (first of a shared rank 1). [{season, userId, row}] oldest first.
  function titles(league, pred, opts = {}) {
    return seasons(league, pred).filter(s => isFinished(league, s)).sort((a, b) => a - b).map(season => {
      const top = board(league, pred, season, opts).ranked[0];
      return top ? { season, userId: top.id, row: top } : null;
    }).filter(Boolean);
  }
  const titlesFor = (league, pred, id, opts) => titles(league, pred, opts).filter(t => t.userId === id).map(t => t.season);

  // All-time line for one player (null when they never had a bet settle).
  function lineFor(league, pred, id, opts) {
    const r = playerStats(league, pred, ALL, opts).find(x => x.id === id);
    return r && r.settled ? r : null;
  }

  return Object.freeze({ MIN_SETTLED, ALL, effectiveOf, playerStats, compare, board, isFinished, seasons, titles, titlesFor, lineFor });
})();
if (typeof module !== "undefined") module.exports = PredRank;

// ---- UI: the card on predictions.html, and the player-card hook on every page ----
(() => {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = v => Number(v || 0).toLocaleString("th-TH");
  const signed = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v))}`;
  const tone = v => v > 0 ? "pos" : v < 0 ? "neg" : "";
  const pct = v => `${Math.round(v * 100)}%`;
  const nameOf = (l, id) => l?.profiles?.[id]?.displayName || id;
  const avatar = (l, id, size) => window.LeagueUI?.avatar ? window.LeagueUI.avatar(id, nameOf(l, id), size) : "";
  const PICK_KEY = "pp_predrank_pick";
  const readPick = () => { try { return localStorage.getItem(PICK_KEY) || ""; } catch { return ""; } };
  const savePick = v => { try { localStorage.setItem(PICK_KEY, v); } catch {} };

  // Player card: the 🎯 title chips and the all-time line. pred is the stored predictions object (may be null).
  const titleChips = (l, pred, id) => PredRank.titlesFor(l, pred, id).map(s => `<span class="pc-chip pc-gold">🎯 เซียนทายผล S${esc(s)}</span>`).join("");
  const cardLine = (l, pred, id) => {
    const r = PredRank.lineFor(l, pred, id); if (!r) return "";
    return `<div class="pc-line"><span>ทายผลตลอดกาล</span><b>ถูก ${r.hits}/${r.decided} • <span class="${r.net > 0 ? "positive" : r.net < 0 ? "negative" : ""}">${signed(r.net)}</span></b></div>`;
  };

  window.PredRank = Object.freeze({ ...PredRank, titleChips, cardLine });

  let pick = readPick(), state = null;
  const LIST_MAX = 10;

  function card() {
    let el = document.getElementById("predRankPanel");
    if (el) return el;
    const anchor = document.getElementById("settlement")?.closest("section") || document.getElementById("historySection");
    if (!anchor) return null;
    el = document.createElement("section");
    el.className = "card pr-card"; el.id = "predRankPanel";
    el.setAttribute("aria-labelledby", "predRankTitle");
    anchor.insertAdjacentElement(anchor.id === "historySection" ? "beforebegin" : "afterend", el);
    el.addEventListener("click", e => {
      const tab = e.target.closest("[data-pr-season]");
      if (tab) { pick = tab.dataset.prSeason; savePick(pick); draw(); return; }
      const who = e.target.closest("[data-pr-open]");
      if (who && window.PlayerCard?.open) { e.preventDefault(); window.PlayerCard.open(who.dataset.prOpen); }
    });
    return el;
  }

  function streakTag(r) { return r.streak >= 2 ? `<span class="pr-fire" title="ทายถูกติดกัน ${r.streak} ครั้ง">🔥${r.streak}</span>` : ""; }
  function who(l, id, me) { return `<button type="button" class="pr-who" data-pr-open="${esc(id)}">${esc(nameOf(l, id))}${id === me ? '<small class="pr-you">คุณ</small>' : ""}</button>`; }

  function podium(l, top, me, b) {
    const slot = (r, place) => {
      if (!r) return `<div class="pr-pod p${place} empty" aria-hidden="true"><div class="pr-pod-av"><span class="pa lg">?</span></div><div class="pr-step"><b>${place}</b></div></div>`;
      const crown = place === 1 ? '<span class="pr-crown" aria-hidden="true">👑</span>' : "";
      const title = place === 1 && b.finished ? `<span class="pr-title">🎯 เซียนทายผล S${esc(b.season)}</span>` : "";
      return `<div class="pr-pod p${place}${r.id === me ? " me" : ""}"><button type="button" class="pr-pod-av" data-pr-open="${esc(r.id)}" aria-label="ดูโปรไฟล์ ${esc(nameOf(l, r.id))}">${crown}${avatar(l, r.id, place === 1 ? "xl" : "lg")}</button>
<div class="pr-pod-name">${who(l, r.id, me)}</div>${title}<b class="pr-net ${tone(r.net)}">${signed(r.net)}</b><small class="pr-pod-sub">ถูก ${r.hits}/${r.decided} • ${pct(r.hitRate)} ${streakTag(r)}</small><div class="pr-step"><b>${place}</b></div></div>`;
    };
    return `<div class="pr-podium">${slot(top[1], 2)}${slot(top[0], 1)}${slot(top[2], 3)}</div>`;
  }

  function row(l, r, me, extra = "") {
    const rank = r.rank ? `<span class="pr-rank">${r.rank}</span>` : '<span class="pr-rank dim">–</span>';
    const left = !r.eligible ? `<small class="pr-need">อีก ${Math.max(0, state.board.minSettled - r.settled)} ครั้งติดอันดับ</small>` : "";
    return `<li class="pr-row${r.id === me ? " me" : ""}${r.eligible ? "" : " short"}${extra}">${rank}<span class="pr-av">${avatar(l, r.id, "sm")}</span>
<div class="pr-main"><div class="pr-line1">${who(l, r.id, me)}${streakTag(r)}</div><div class="pr-bar" role="img" aria-label="ทายถูก ${pct(r.hitRate)}"><i style="width:${Math.round(r.hitRate * 100)}%"></i></div><small class="pr-sub">ถูก ${r.hits}/${r.decided} • ${pct(r.hitRate)} • ${r.settled} ครั้ง${r.pushes ? ` (คืน ${r.pushes})` : ""}${left ? ` • ${left}` : ""}</small></div>
<div class="pr-money"><b class="pr-net ${tone(r.net)}">${signed(r.net)}</b><small>ROI ${r.roi > 0 ? "+" : r.roi < 0 ? "−" : ""}${Math.abs(Math.round(r.roi * 100))}%</small></div></li>`;
  }

  function draw() {
    const el = card(); if (!el || !state) return;
    const { l, p, me } = state;
    const list = PredRank.seasons(l, p), cur = Number(l?.currentSeason) || 1;
    const scope = pick === PredRank.ALL ? PredRank.ALL : list.includes(Number(pick)) ? Number(pick) : cur;
    const b = state.board = PredRank.board(l, p, scope);
    const tabs = list.map(s => `<button type="button" class="pr-tab${scope === s ? " on" : ""}" data-pr-season="${s}" aria-pressed="${scope === s}">S${s}${s === cur ? " <small>ปัจจุบัน</small>" : ""}</button>`).join("")
      + `<button type="button" class="pr-tab${scope === PredRank.ALL ? " on" : ""}" data-pr-season="${PredRank.ALL}" aria-pressed="${scope === PredRank.ALL}">ตลอดกาล</button>`;
    const label = scope === PredRank.ALL ? "ตลอดกาล" : `ซีซั่น ${scope}`;
    const note = scope === PredRank.ALL ? "รวมทุกซีซั่น" : b.finished ? `จบซีซั่นแล้ว • อันดับ 1 ได้ฉายา “เซียนทายผล S${scope}”` : `ซีซั่นยังไม่จบ • อันดับ 1 ตอนจบได้ฉายา “เซียนทายผล S${scope}”`;
    let body;
    if (!b.ranked.length && !b.rest.length) {
      body = `<div class="pr-empty"><span aria-hidden="true">🎯</span><b>ยังไม่มีผลทายใน${esc(label)}</b><small>${scope === PredRank.ALL ? "ทายคู่ที่เปิดอยู่ แล้วรอเจ้ามือคำนวณผล" : "ลองดูแบบตลอดกาล หรือทายคู่ที่เปิดอยู่"}</small></div>`;
    } else {
      const shown = b.ranked.slice(3, LIST_MAX);
      const mine = [...b.ranked, ...b.rest].find(r => r.id === me);
      const mineVisible = mine && mine.eligible && b.ranked.indexOf(mine) < LIST_MAX;
      const restMe = b.rest.filter(r => r.id !== me);
      body = (b.ranked.length ? podium(l, b.ranked.slice(0, 3), me, b) : `<div class="pr-empty slim"><b>ยังไม่มีใครทายครบ ${b.minSettled} ครั้ง</b><small>ทายครบ ${b.minSettled} ครั้งที่มีผลแล้วถึงติดอันดับ</small></div>`)
        + (shown.length ? `<ol class="pr-list">${shown.map(r => row(l, r, me)).join("")}</ol>` : "")
        + (mine && !mineVisible ? `<div class="pr-pin-label">อันดับของคุณ</div><ol class="pr-list pinned">${row(l, mine, me)}</ol>` : "")
        + (b.ranked.length > LIST_MAX ? `<p class="pr-more">อีก ${b.ranked.length - LIST_MAX} คนในอันดับถัดไป</p>` : "")
        + (restMe.length ? `<details class="pr-rest"><summary>ยังทายไม่ครบ ${b.minSettled} ครั้ง • ${restMe.length} คน</summary><ol class="pr-list">${restMe.map(r => row(l, r, me)).join("")}</ol></details>` : "");
    }
    const openRest = el.querySelector(".pr-rest")?.open;
    el.innerHTML = `<div class="pr-head"><h2 id="predRankTitle">ตารางนักทาย</h2><span class="pr-scope">${esc(label)}</span></div>
<div class="pr-tabs" role="group" aria-label="เลือกซีซั่น">${tabs}</div><p class="pr-note">${esc(note)} • จัดอันดับตามยอดสุทธิ แล้วดูอัตราทายถูก</p>${body}`;
    if (openRest) { const d = el.querySelector(".pr-rest"); if (d) d.open = true; }
  }

  // predictions.js: after each render, PredRankUI.render(league, pred, currentUserId).
  function render(l, p, me) {
    try { state = { l, p, me: me || "", board: null }; draw(); }
    catch (e) { try { console.warn("PredRank render failed", e); } catch {} }
  }
  window.PredRankUI = Object.freeze({ render });
})();
