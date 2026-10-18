// Live scoring: count a match point by point on a phone at the table, and everyone else watches the score move.
// - Scorers (the admin, or either player of the match) tap นับสด on an unplayed match card, pick the format, then tap
//   the left/right half of the scoreboard for each point. Serve, game and match wins follow table tennis rules
//   (games to 11, win by 2, serve changes every 2 points and every point from 10-10).
// - Each change is sent (at most every ~0.7 s) to the small "live" row of app_state, never to the league row; watchers
//   poll that row every few seconds and show a LIVE chip on the match card and a strip above the schedule.
// - At the end the admin saves the result into the league with the normal score inputs (index.js updateFromInputs);
//   a player's finished match waits on the admin's card with a บันทึกผล button.
// Without the live row (the SQL not run yet) the scoreboard still works on the scorer's phone, it just is not shared.
const LiveScore = (() => {
  const other = s => s === "a" ? "b" : "a";
  const gameOver = (cur, to = 11) => Math.max(cur[0], cur[1]) >= to && Math.abs(cur[0] - cur[1]) >= 2;
  const need = bestOf => Math.ceil(bestOf / 2);
  const wins = games => games.reduce((w, g) => { w[g[0] > g[1] ? 0 : 1]++; return w; }, [0, 0]);
  const matchOver = m => { const w = wins(m.games); return w[0] >= need(m.bestOf) || w[1] >= need(m.bestOf); };
  // Who serves now: games alternate the first server; two serves each, then one each from 10-10.
  function server(m) {
    const start = m.games.length % 2 === 0 ? m.first : other(m.first), t = m.cur[0] + m.cur[1];
    const changes = t < 20 ? Math.floor(t / 2) : 10 + (t - 20);
    return changes % 2 === 0 ? start : other(start);
  }
  function fresh({ key, season, id, pair, bestOf = 1, to = 11, record = "points", first = "a", by = "" }) {
    return { key, season, id, pair, bestOf, to, record: bestOf > 1 ? "games" : record, first, by, games: [], cur: [0, 0], hist: [], done: false, at: new Date().toISOString() };
  }
  // A point for side "a" or "b"; finishes the game (and the match) when the rules say so. Returns a new object.
  function point(m, side) {
    if (m.done) return m;
    const n = { ...m, hist: [...m.hist, { games: m.games, cur: m.cur }].slice(-80), cur: [...m.cur], games: [...m.games], at: new Date().toISOString() };
    n.cur[side === "a" ? 0 : 1]++;
    if (gameOver(n.cur, n.to)) { n.games.push(n.cur); n.cur = [0, 0]; if (matchOver(n)) n.done = true; }
    return n;
  }
  function undo(m) {
    const last = m.hist[m.hist.length - 1]; if (!last) return m;
    return { ...m, games: last.games, cur: last.cur, hist: m.hist.slice(0, -1), done: false, at: new Date().toISOString() };
  }
  // The score to save into the league: points of the single game, or games won.
  function result(m) {
    if (!m.done) return null;
    if (m.record === "points" && m.bestOf === 1) { const g = m.games[0]; return { a: g[0], b: g[1] }; }
    const w = wins(m.games); return { a: w[0], b: w[1] };
  }
  // A sensible default format from scores already in the league: big numbers mean points of one game; small ones mean
  // games won, with the best-of that the highest count fits (3 → best of 5, 2 → best of 3).
  function guessFormat(results) {
    const vals = Object.values(results || {}).flatMap(x => [x?.a, x?.b]).filter(Number.isInteger);
    const top = vals.length ? Math.max(...vals) : 11;
    if (top > 5) return { bestOf: 1, record: "points" };
    return { bestOf: top >= 3 ? 5 : top === 2 ? 3 : 1, record: top >= 2 ? "games" : "points" };
  }
  return Object.freeze({ gameOver, wins, matchOver, server, fresh, point, undo, result, guessFormat, other });
})();
if (typeof module !== "undefined") module.exports = LiveScore;

(() => {
  if (typeof document === "undefined") return;
  const L = LiveScore, LS = () => typeof LeagueShared !== "undefined" ? LeagueShared : null;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const league = () => { try { return LS()?.readLocalLeague() || null; } catch { return null; } };
  const meId = l => { try { return LS()?.sessionUserId(l) || ""; } catch { return ""; } };
  const nm = (l, id) => l?.profiles?.[id]?.displayName || id;
  const isAdmin = (l, id) => { try { return !!LS()?.isAdmin(l, id); } catch { return false; } };
  const toast = (m, t) => window.LeagueToast ? window.LeagueToast(m, t) : null;
  const STALE_MS = 6 * 3600e3, FORMAT_KEY = "pp_live_format";

  // ---------- Cloud: the live row ----------
  let remote = {}, cloud = null, stamp = "", pushTimer = 0, pushing = false;
  const dirty = new Map(); // key -> match (or null to remove) waiting to be sent
  async function pull() {
    try {
      const row = (await LS().liveRequest())[0];
      if (!row) { cloud = false; return; }
      cloud = true;
      if (row.updated_at === stamp) return;
      stamp = row.updated_at; remote = row.league?.matches || {};
      paint();
      if (cur?.club && board && !board.hidden && board.dataset.mode === "watch") renderBoard();
    } catch { if (cloud === null) cloud = false; }
  }
  function queue(m, key = m.key) { dirty.set(key, m); remote = { ...remote, [key]: m }; if (!m) delete remote[key]; clearTimeout(pushTimer); pushTimer = setTimeout(push, 700); paint(); }
  async function push() {
    if (pushing) { pushTimer = setTimeout(push, 400); return; }
    if (!dirty.size || cloud === false) return;
    pushing = true;
    const sending = new Map(dirty); dirty.clear();
    try {
      for (let attempt = 0; attempt < LS().LOCK_TRIES; attempt++) {
        const row = (await LS().liveRequest())[0]; if (!row) { cloud = false; return; }
        const now = Date.now(), matches = { ...(row.league?.matches || {}) };
        Object.keys(matches).forEach(k => { if (!matches[k] || now - Date.parse(matches[k].at || 0) > STALE_MS) delete matches[k]; });
        sending.forEach((m, k) => { if (m) matches[k] = m; else delete matches[k]; });
        const filter = row.updated_at ? `updated_at=eq.${encodeURIComponent(row.updated_at)}` : "";
        const saved = await LS().liveRequest("PATCH", { league: { matches }, updated_at: new Date().toISOString() }, filter);
        if (saved?.length) { stamp = saved[0].updated_at; remote = matches; paint(); return; }
        await LS().lockBackoff(attempt);
      }
      sending.forEach((m, k) => { if (!dirty.has(k)) dirty.set(k, m); }); // try again with the next change
    } catch (error) {
      sending.forEach((m, k) => { if (!dirty.has(k)) dirty.set(k, m); });
      // Network drop: send the kept points again shortly, so watchers catch up without waiting for the next tap.
      if (error instanceof TypeError) { clearTimeout(pushTimer); pushTimer = setTimeout(push, 3000); }
    }
    finally { pushing = false; }
  }

  // ---------- Match cards: นับสด button, LIVE chip, live strip ----------
  const valid = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const keyOf = (season, id) => `s${season}:${id}`;
  function liveFor(l, id) { const m = remote[keyOf(Number(l?.currentSeason) || 1, id)]; return m && Date.now() - Date.parse(m.at || 0) < STALE_MS ? m : null; }
  const scoreLine = m => { const w = L.wins(m.games); return m.done ? `จบ ${L.result(m).a}–${L.result(m).b}` : `${m.cur[0]}–${m.cur[1]}${m.bestOf > 1 ? ` • เกม ${w[0]}–${w[1]}` : ""}`; };
  function paint() {
    const box = document.getElementById("schedule"), l = league(); if (!box || !l?.rounds) return;
    const me = meId(l), admin = isAdmin(l, me), season = Number(l.currentSeason) || 1, live = [];
    l.rounds.forEach((r, ri) => (r?.m || []).forEach((pair, mi) => {
      const id = `r${ri}m${mi}`, card = document.getElementById(`match-${id}`); if (!card) return;
      const m = liveFor(l, id), played = valid(l.results?.[id]), can = admin || pair.includes(me);
      let slot = card.querySelector(".lv-slot");
      if (!slot) { slot = document.createElement("div"); slot.className = "lv-slot"; const st = card.querySelector(".status"); if (st) st.before(slot); else card.appendChild(slot); }
      let html = "";
      if (m && !(played && m.done)) {
        live.push({ id, m, pair });
        html = `<button type="button" class="lv-chip${m.done ? " done" : ""}" data-lv-watch="${esc(id)}"><i aria-hidden="true"></i>${m.done ? "จบแล้ว" : "LIVE"} <b>${esc(scoreLine(m))}</b></button>`;
        if (m.done && admin && !played) html += `<button type="button" class="primary lv-save" data-lv-save="${esc(id)}">บันทึกผล ${L.result(m).a}–${L.result(m).b}</button>`;
        else if (!m.done && can) html += `<button type="button" class="secondary lv-go" data-lv-score="${esc(id)}">นับต่อ</button>`;
      } else if (!played && can) html = `<button type="button" class="secondary lv-go" data-lv-score="${esc(id)}"><i class="lv-dot" aria-hidden="true"></i>นับสด</button>`;
      if (slot.dataset.html !== html) { slot.dataset.html = html; slot.innerHTML = html; }
      card.classList.toggle("is-live", !!m && !m.done);
    }));
    // Challenges and tournament games being scored right now join the strip too (they carry their own names).
    Object.keys(remote).forEach(k => { const m = /^[ct]:/.test(k) && clubLive(k); if (m && !m.done) live.push({ id: k, m, pair: m.pair || [] }); });
    let strip = document.querySelector(".lv-strip");
    const going = live.filter(x => !x.m.done);
    // An open "ดูสด" board follows every change, the final point included (when nothing is left going).
    if (board && !board.hidden && board.dataset.mode === "watch") renderBoard();
    if (!going.length) { strip?.remove(); return; }
    if (!strip) { strip = document.createElement("div"); strip.className = "lv-strip"; (document.getElementById("nextUp") || box).before(strip); }
    const html = `<span class="lv-tag"><i aria-hidden="true"></i>กำลังแข่งสด</span>${going.map(x => `<button type="button" data-lv-watch="${esc(x.id)}"><b>${esc(label(l, x.m, 0))}</b> <em>${x.m.cur[0]}–${x.m.cur[1]}</em> <b>${esc(label(l, x.m, 1))}</b>${x.m.bestOf > 1 ? `<small>เกม ${L.wins(x.m.games).join("–")}</small>` : ""}</button>`).join("")}`;
    if (strip.dataset.html !== html) { strip.dataset.html = html; strip.innerHTML = html; }
  }

  // ---------- Scoreboard ----------
  let board = null, cur = null, wake = null;
  function ensureBoard() {
    if (board) return board;
    board = document.createElement("div"); board.className = "lv"; board.hidden = true;
    board.setAttribute("role", "dialog"); board.setAttribute("aria-modal", "true"); board.setAttribute("aria-label", "นับแต้มสด");
    document.body.appendChild(board);
    board.addEventListener("click", e => {
      const t = e.target.closest("[data-lv]"); if (!t) return;
      const act = t.dataset.lv;
      if (act === "close") return closeBoard();
      if (act === "start") return start(t);
      if (act === "a" || act === "b") return tap(act);
      if (act === "undo") { cur = L.undo(cur); queue(cur); return renderBoard(); }
      if (act === "save") return saveResult(cur.id, t);
      if (act === "send") { toast("ส่งผลแล้ว รอแอดมินบันทึกลงตาราง", "good"); return closeBoard(); }
      if (act === "cancel") { if (confirm("ยกเลิกการนับสดคู่นี้?")) { queue(null, cur.key); closeBoard(); } }
    });
    document.addEventListener("keydown", e => {
      if (!board || board.hidden) return;
      if (e.key === "Escape") closeBoard();
      if (board.dataset.mode === "score") { if (e.key === "ArrowLeft") tap("a"); if (e.key === "ArrowRight") tap("b"); if (e.key === "Backspace") { cur = L.undo(cur); queue(cur); renderBoard(); } }
    });
    return board;
  }
  function openBoard(mode) {
    ensureBoard(); board.dataset.mode = mode; board.hidden = false; document.body.classList.add("lv-open");
    if (mode === "score" && navigator.wakeLock?.request) navigator.wakeLock.request("screen").then(w => { wake = w; }).catch(() => {});
  }
  function closeBoard() { if (!board) return; board.hidden = true; document.body.classList.remove("lv-open"); wake?.release?.().catch?.(() => {}); wake = null; if (board.dataset.mode === "score") push(); }
  function pairOf(l, id) { const [, ri, mi] = /^r(\d+)m(\d+)$/.exec(id) || []; return l?.rounds?.[ri]?.m?.[mi] || null; }

  function setup(id, spec = null) {
    const l = league(), pair = spec ? spec.ids || [null, null] : pairOf(l, id); if (!pair) return;
    const existing = spec ? clubLive(spec.key) : liveFor(l, id);
    if (existing && !existing.done) { cur = existing; openBoard("score"); return renderBoard(); }
    let fmt = L.guessFormat(l?.results); try { fmt = { ...fmt, ...JSON.parse(localStorage.getItem(FORMAT_KEY) || "{}") }; } catch {}
    cur = { id, pair, setup: true, ...(spec ? { club: true, key: spec.key, names: spec.names } : {}) };
    openBoard("setup");
    const opt = (name, v, label, on) => `<label class="lv-opt"><input type="radio" name="${name}" value="${v}"${on ? " checked" : ""}><span>${label}</span></label>`;
    board.innerHTML = `<div class="lv-setup"><button type="button" class="lv-x" data-lv="close" aria-label="ปิด">×</button>
      <p class="lv-kicker">นับแต้มสด</p><h2>${esc(label(l, cur, 0))} <span>vs</span> ${esc(label(l, cur, 1))}</h2>
      <fieldset><legend>แข่งกี่เกม</legend><div class="lv-opts">${opt("bo", 1, "เกมเดียว", fmt.bestOf === 1)}${opt("bo", 3, "2 ใน 3", fmt.bestOf === 3)}${opt("bo", 5, "3 ใน 5", fmt.bestOf === 5)}</div></fieldset>
      <fieldset class="lv-rec"><legend>ลงตารางเป็น</legend><div class="lv-opts">${opt("rec", "points", "แต้มของเกม (เช่น 11–7)", fmt.record === "points")}${opt("rec", "games", "จำนวนเกมที่ชนะ (เช่น 1–0)", fmt.record === "games")}</div></fieldset>
      <fieldset><legend>ใครเสิร์ฟก่อน</legend><div class="lv-opts">${opt("first", "a", esc(label(l, cur, 0)), true)}${opt("first", "b", esc(label(l, cur, 1)), false)}</div></fieldset>
      <button type="button" class="primary lv-begin" data-lv="start">เริ่มนับ</button>
      <p class="lv-note">${cloud ? "คนอื่นจะเห็นคะแนนสดบนการ์ดคู่นี้" : "ยังไม่ได้เปิดระบบถ่ายทอดสด • นับได้ในเครื่องนี้ แล้วบันทึกผลตอนจบ"}</p></div>`;
    const sync = () => { const bo = Number(board.querySelector("[name=bo]:checked")?.value || 1); board.querySelector(".lv-rec").hidden = bo > 1; };
    board.querySelectorAll("[name=bo]").forEach(r => r.addEventListener("change", sync)); sync();
  }
  function start() {
    const l = league(), bestOf = Number(board.querySelector("[name=bo]:checked")?.value || 1), record = board.querySelector("[name=rec]:checked")?.value || "points";
    const first = board.querySelector("[name=first]:checked")?.value || "a";
    try { localStorage.setItem(FORMAT_KEY, JSON.stringify({ bestOf, record })); } catch {}
    const season = Number(l?.currentSeason) || 1, was = cur;
    cur = L.fresh({ key: was.club ? was.key : keyOf(season, was.id), season, id: was.id, pair: was.pair, bestOf, record, first, by: meId(l) });
    if (was.club) Object.assign(cur, { club: true, names: was.names });
    board.dataset.mode = "score";
    if (navigator.wakeLock?.request) navigator.wakeLock.request("screen").then(w => { wake = w; }).catch(() => {});
    queue(cur); renderBoard();
  }
  function tap(side) {
    if (!cur || cur.done || board.dataset.mode !== "score") return;
    const before = cur.games.length; cur = L.point(cur, side);
    navigator.vibrate?.(cur.games.length > before ? [30, 40, 30] : 12);
    queue(cur); renderBoard(cur.games.length > before ? side : "");
  }
  function watch(id) { if (/^[ct]:/.test(id)) return watchClub(id); const m = liveFor(league(), id); if (!m) return; cur = m; openBoard("watch"); renderBoard(); }

  function renderBoard(gameTo = "") {
    if (!board || !cur || cur.setup) return;
    const l = league(), mode = board.dataset.mode, watching = mode === "watch";
    if (watching) { const m = cur.club ? clubLive(cur.key) : liveFor(l, cur.id); if (m) cur = m; }
    const m = cur, w = L.wins(m.games), srv = m.done ? "" : L.server(m), me = meId(l), admin = m.club ? !!clubSpecs.get(m.key)?.onDone : isAdmin(l, me);
    const side = s => { const i = s === "a" ? 0 : 1, id = m.pair?.[i], who = label(l, m, i);
      return `<button type="button" class="lv-side ${s}${srv === s ? " serving" : ""}" ${watching || m.done ? "disabled" : ""} data-lv="${s}" aria-label="แต้มให้ ${esc(who)}">
        <span class="lv-who">${window.LeagueUI?.avatar && typeof id === "string" ? window.LeagueUI.avatar(id, who, "lg") : ""}<b>${esc(who)}</b></span>
        <span class="lv-pts">${m.done ? (m.bestOf === 1 ? m.games[0][i] : w[i]) : m.cur[i]}</span>
        <span class="lv-games">${m.bestOf > 1 ? `เกม ${w[i]}` : ""}${srv === s ? '<i class="lv-serve">เสิร์ฟ</i>' : ""}</span></button>`; };
    const res = L.result(m), done = m.done ? `<div class="lv-end"><p>${esc(label(l, m, res.a > res.b ? 0 : 1))} ชนะ</p><b>${res.a}–${res.b}</b>${m.games.length > 1 || m.record === "games" ? `<small>${m.games.map(g => g.join("–")).join(" • ")}</small>` : ""}
      ${watching ? "" : admin ? `<button type="button" class="primary" data-lv="save">${m.club ? "บันทึกผล" : "บันทึกผลลงตาราง"}</button>` : `<button type="button" class="primary" data-lv="send">เสร็จแล้ว ส่งให้แอดมิน</button>`}${watching ? "" : '<button type="button" class="secondary" data-lv="undo">แก้แต้มล่าสุด</button>'}</div>` : "";
    board.innerHTML = `<div class="lv-top"><button type="button" class="lv-x" data-lv="close" aria-label="ปิด">×</button><span class="lv-tag"><i aria-hidden="true"></i>${watching ? "ดูสด" : "LIVE"}</span><span class="lv-fmt">${m.bestOf === 1 ? "เกมเดียว" : `${Math.ceil(m.bestOf / 2)} ใน ${m.bestOf}`} • ${m.to} แต้ม</span>${!watching && !m.done ? '<button type="button" class="lv-cancel" data-lv="cancel">ยกเลิก</button>' : ""}</div>
      <div class="lv-court${gameTo ? ` won-${gameTo}` : ""}">${side("a")}<div class="lv-mid">${m.games.map(g => `<span>${g[0]}–${g[1]}</span>`).join("")}</div>${side("b")}</div>
      ${watching || m.done ? "" : `<div class="lv-bottom"><button type="button" class="secondary" data-lv="undo" ${m.hist.length ? "" : "disabled"}>↶ ย้อนแต้ม</button><small>แตะฝั่งของคนที่ได้แต้ม</small></div>`}${done}`;
  }

  async function saveResult(id, btn) {
    if (cur?.club && cur.key === id) return saveClub(btn);
    const l = league(), m = liveFor(l, id) || (cur?.id === id ? cur : null), r = m && L.result(m);
    if (!r) return;
    const a = document.getElementById(`${id}a`), b = document.getElementById(`${id}b`);
    if (!a || !b || typeof updateFromInputs !== "function") return toast("บันทึกได้จากหน้าแรกเท่านั้น", "bad");
    btn?.setAttribute("aria-busy", "true");
    a.value = r.a; b.value = r.b; updateFromInputs(id);
    queue(null, m.key); closeBoard(); toast(`บันทึกผล ${r.a}–${r.b} แล้ว`, "good");
  }

  // ---------- Club matches (tournament games, challenges): not in the league schedule ----------
  // The caller gives { key: "t:<tournamentId>:<matchId>", names: [left, right], ids?: [leftId, rightId], onDone(result, live) }.
  // Same scoreboard and live row; at the end บันทึกผล hands the result to onDone (may return a promise) instead of the
  // league inputs. Specs (with their callbacks) stay on this phone only; the live row carries the names for watchers.
  const clubSpecs = new Map();
  function clubLive(key) { const m = remote[key]; return m && Date.now() - Date.parse(m.at || 0) < STALE_MS ? m : null; }
  function label(l, m, i) { return m?.names?.[i] || nm(l, m?.pair?.[i]); }
  function scoreClub(spec) {
    // Challenges pass { pair: [idA, idB] } (names optional); tournaments pass { names, ids }.
    if (spec && !spec.names && Array.isArray(spec.pair)) spec = { ...spec, names: spec.pair.map(id => nm(league(), id)) };
    if (spec && !spec.ids && Array.isArray(spec.pair)) spec = { ...spec, ids: spec.pair };
    if (!spec?.key || !Array.isArray(spec.names) || spec.names.length !== 2) return;
    clubSpecs.set(spec.key, spec);
    pull().finally(() => setup(spec.key, spec));
  }
  function watchClub(key) { const m = clubLive(key); if (!m) return; cur = m; openBoard("watch"); renderBoard(); }
  async function saveClub(btn) {
    const m = clubLive(cur.key) || cur, r = L.result(m), spec = clubSpecs.get(m.key);
    if (!r || !spec?.onDone) return;
    btn?.setAttribute("aria-busy", "true");
    try { await spec.onDone(r, m); queue(null, m.key); closeBoard(); }
    catch (e) { toast(e?.message || "บันทึกไม่สำเร็จ", "bad"); }
    finally { btn?.removeAttribute("aria-busy"); }
  }

  document.addEventListener("click", e => {
    const s = e.target.closest("[data-lv-score]"); if (s) { e.preventDefault(); return setup(s.dataset.lvScore); }
    const w = e.target.closest("[data-lv-watch]"); if (w) { e.preventDefault(); return watch(w.dataset.lvWatch); }
    const v = e.target.closest("[data-lv-save]"); if (v) { e.preventDefault(); return saveResult(v.dataset.lvSave, v); }
  });

  function boot() {
    if (!document.getElementById("schedule")) return;
    let queued = false;
    new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); }).observe(document.getElementById("schedule"), { childList: true });
    pull().then(paint);
    // Fast while something is live or this phone is scoring, slow otherwise; nothing while the page is hidden.
    const loop = () => { const hot = Object.values(remote).some(m => m && !m.done) || (board && !board.hidden); setTimeout(async () => { if (!document.hidden && cloud !== false) await pull(); loop(); }, hot ? 2500 : 12000); };
    loop();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); else push(); });
    paint();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.LeagueLive = Object.freeze({ setup, watch, pull, state: () => ({ cloud, remote }), scoreClub, watchClub, liveClub: clubLive });
})();
