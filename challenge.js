// ท้าดวล (challenges): a signed-in player challenges another (singles) or two others with a partner (doubles), with a
// short note. The challenged side accepts or declines, the challenger can cancel. An accepted challenge is played with
// the live scoreboard (live.js LeagueLive.scoreClub) or a typed score, and the result lands in club.matches
// (kind "challenge"): it feeds Elo and head-to-head, never the league table. Everything is stored in the club row
// through LeagueShared.clubMutate (docs/club-data.md); every change below is safe to re-run on a newer copy.
// ChallengeCore is pure (tests/challenge.test.cjs); the sheet, menu badge and player-card button follow.
const ChallengeCore = (() => {
  const NOTE_MAX = 80, KEEP = 200;
  const valid = x => Number.isInteger(x?.a) && x.a >= 0 && x.a <= 99 && Number.isInteger(x?.b) && x.b >= 0 && x.b <= 99;
  const active = (league, id) => { const p = league?.profiles?.[id]; return typeof id === "string" && !!id && !!p && p.active !== false; };
  const cleanNote = s => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  const newId = () => `ch_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  const list = club => Array.isArray(club?.challenges) ? club.challenges.filter(c => c && typeof c === "object") : [];
  const sides = ch => ch?.format === "doubles" ? [(ch.teamA || []).slice(0, 2), (ch.teamB || []).slice(0, 2)] : [[ch?.from], [ch?.to]];
  const players = ch => sides(ch).flat().filter(Boolean);
  const targets = ch => ch?.format === "doubles" ? (ch.teamB || []) : [ch?.to];
  const isTarget = (ch, me) => !!me && targets(ch).includes(me);
  const isIn = (ch, me) => !!me && players(ch).includes(me);
  const matchIdFor = ch => `cm_${String(ch.id).replace(/^ch_/, "")}`;
  const key = ch => players(ch).slice().sort().join("|") + `#${ch.format}`;

  // Error text for a new challenge, or "" when it can be sent.
  function validate(input, league, club) {
    const from = input?.from, format = input?.format === "doubles" ? "doubles" : "singles";
    if (!active(league, from)) return "เข้าสู่ระบบก่อนถึงจะท้าดวลได้";
    let ids;
    if (format === "singles") {
      if (!active(league, input.to)) return "เลือกคู่ต่อสู้";
      if (input.to === from) return "ท้าตัวเองไม่ได้";
      ids = [from, input.to];
    } else {
      const a = input.teamA || [], b = input.teamB || [];
      if (a[0] !== from) return "คุณต้องอยู่ฝั่งผู้ท้า";
      if (!active(league, a[1])) return "เลือกคู่หูของคุณ";
      if (!active(league, b[0]) || !active(league, b[1])) return "เลือกคู่ต่อสู้ให้ครบ 2 คน";
      ids = [...a.slice(0, 2), ...b.slice(0, 2)];
      if (new Set(ids).size !== 4) return "ผู้เล่น 4 คนต้องไม่ซ้ำกัน";
    }
    const draft = { format, from, to: format === "singles" ? input.to : input.teamB[0], teamA: input.teamA, teamB: input.teamB };
    if (list(club).some(c => (c.status === "open" || c.status === "accepted") && key(c) === key(draft))) return "มีคำท้าคู่นี้ค้างอยู่แล้ว";
    if (list(club).filter(c => c.from === from && c.status === "open").length >= 5) return "ส่งคำท้าค้างไว้ได้ไม่เกิน 5 อัน";
    return "";
  }
  // Adds the challenge (once per id). Returns the stored challenge.
  function create(club, input, { id = newId(), at = new Date().toISOString() } = {}) {
    club.challenges = list(club);
    const found = club.challenges.find(c => c.id === id); if (found) return found;
    const doubles = input.format === "doubles";
    const ch = { id, from: input.from, to: doubles ? input.teamB[0] : input.to, format: doubles ? "doubles" : "singles",
      ...(doubles ? { teamA: input.teamA.slice(0, 2), teamB: input.teamB.slice(0, 2) } : {}), note: cleanNote(input.note), status: "open", at };
    club.challenges.push(ch);
    // Keep the list small: drop the oldest finished ones past KEEP (the results stay in club.matches).
    while (club.challenges.length > KEEP) { const i = club.challenges.findIndex(c => c.status !== "open" && c.status !== "accepted"); if (i < 0) break; club.challenges.splice(i, 1); }
    return ch;
  }
  const can = (ch, me, action, admin = false) => {
    if (!ch || !me) return false;
    if (action === "accept" || action === "decline") return ch.status === "open" && isTarget(ch, me);
    if (action === "cancel") return (ch.status === "open" && ch.from === me) || (ch.status === "accepted" && (isIn(ch, me) || admin));
    if (action === "score") return ch.status === "accepted" && (isIn(ch, me) || admin);
    return false;
  };
  const NEXT = { accept: "accepted", decline: "declined", cancel: "cancelled" };
  // accept / decline / cancel. Returns "" (changed), "same" (already in that state) or an error.
  function respond(club, id, me, action, { at = new Date().toISOString(), admin = false } = {}) {
    const ch = list(club).find(c => c.id === id);
    if (!ch) return "ไม่พบคำท้านี้";
    if (ch.status === NEXT[action]) return "same";
    if (!can(ch, me, action, admin)) return ch.status === "open" || ch.status === "accepted" ? "คุณทำรายการนี้ไม่ได้" : "คำท้านี้ปิดไปแล้ว";
    ch.status = NEXT[action]; ch.by = me; ch.answeredAt = at;
    return "";
  }
  // Writes the result as a club match and closes the challenge. "" (saved), "same" (this result is already in) or an error.
  function finish(club, id, me, score, { at = new Date().toISOString(), admin = false, liveKey = "" } = {}) {
    const ch = list(club).find(c => c.id === id);
    if (!ch) return "ไม่พบคำท้านี้";
    const s = { a: Number(score?.a), b: Number(score?.b) };
    if (!valid(s)) return "คะแนนต้องเป็นเลข 0–99";
    if (s.a === 0 && s.b === 0) return "ใส่คะแนนก่อนบันทึก";
    const matchId = matchIdFor(ch);
    club.matches = Array.isArray(club.matches) ? club.matches : [];
    if (ch.status === "done") return ch.matchId === matchId && club.matches.some(m => m.id === matchId) ? "same" : "คำท้านี้มีผลแล้ว";
    if (!can(ch, me, "score", admin)) return ch.status === "accepted" ? "บันทึกได้เฉพาะคนที่แข่งคู่นี้" : "คำท้านี้ยังไม่ได้รับ";
    const [a, b] = sides(ch);
    if (!club.matches.some(m => m.id === matchId)) club.matches.push({ id: matchId, kind: "challenge", format: ch.format,
      a: ch.format === "doubles" ? a : a[0], b: ch.format === "doubles" ? b : b[0], s, at, by: me, challengeId: ch.id, ...(liveKey ? { liveKey } : {}) });
    ch.status = "done"; ch.matchId = matchId; ch.doneAt = at;
    return "";
  }
  const byTime = (x, y) => String(y.at || "").localeCompare(String(x.at || ""));
  const openForMe = (club, me) => list(club).filter(c => c.status === "open" && isTarget(c, me)).sort(byTime);
  const sentByMe = (club, me) => list(club).filter(c => c.status === "open" && c.from === me).sort(byTime);
  const ready = (club, me) => list(club).filter(c => c.status === "accepted" && isIn(c, me)).sort(byTime);
  const others = (club, me) => list(club).filter(c => (c.status === "open" || c.status === "accepted") && !isIn(c, me)).sort(byTime);
  // Finished challenge matches, latest first.
  const history = (club, limit = 20) => (Array.isArray(club?.matches) ? club.matches : []).filter(m => m?.kind === "challenge" && m.s)
    .slice().sort(byTime).slice(0, limit);
  const badge = (club, me) => openForMe(club, me).length;

  return Object.freeze({ NOTE_MAX, cleanNote, newId, sides, players, targets, isTarget, isIn, matchIdFor, validate, create, can, respond, finish,
    openForMe, sentByMe, ready, others, history, badge });
})();
if (typeof module !== "undefined") module.exports = ChallengeCore;

(() => {
  if (typeof document === "undefined") return;
  const C = ChallengeCore, LS = () => typeof LeagueShared !== "undefined" ? LeagueShared : null;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const league = () => { try { if (typeof state !== "undefined" && state?.profiles) return state; } catch {} try { const S = LS(); return (S?.peekLocalLeague || S?.readLocalLeague)?.() || null; } catch { return null; } };
  const meId = l => { try { return l ? LS().sessionUserId(l) : ""; } catch { return ""; } };
  const isAdmin = (l, id) => { try { return !!LS()?.isAdmin(l, id); } catch { return false; } };
  const nm = (l, id) => l?.profiles?.[id]?.displayName || id || "?";
  const toast = (m, t) => window.LeagueToast ? window.LeagueToast(m, t) : null;
  const UI = () => window.LeagueUI;
  const av = (l, id, size = "") => UI()?.avatar ? UI().avatar(id, nm(l, id), size) : "";
  const elo = () => { try { return window.LeagueEloView?.table() || {}; } catch { return {}; } };
  const E = () => typeof LeagueElo !== "undefined" ? LeagueElo : null;
  const rating = (t, id) => t?.[id]?.rating ?? 1000;
  const teamRating = (t, ids) => Math.round(ids.reduce((s, id) => s + rating(t, id), 0) / Math.max(1, ids.length));
  const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4l9.5 9.5M4 4v3.5M4 4h3.5M20 4l-9.5 9.5M20 4v3.5M20 4h-3.5"/><path d="M7.5 14.5 5 17l2 2 2.5-2.5M16.5 14.5 19 17l-2 2-2.5-2.5"/></svg>';

  function ago(at) {
    const s = (Date.now() - Date.parse(at || 0)) / 1000;
    if (!Number.isFinite(s) || s < 0) return "";
    if (s < 60) return "เมื่อสักครู่"; if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
    if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`; if (s < 86400 * 30) return `${Math.floor(s / 86400)} วันที่แล้ว`;
    try { return new Date(at).toLocaleDateString("th-TH", { day: "numeric", month: "short" }); } catch { return ""; }
  }

  // ---------- Club row ----------
  // undefined: not read yet • null: the row does not exist (SQL not run) • { club, updatedAt }
  let row, loading = null;
  const club = () => row?.club || null;
  function announce() { try { window.dispatchEvent(new CustomEvent("pp-club", { detail: club() })); } catch {} paintBadge(); if (wrap && !wrap.hidden) render(); }
  async function refresh() {
    if (!LS()?.clubRead) { row = null; return row; }
    if (loading) return loading;
    loading = (async () => { try { row = await LS().clubRead(); } catch { if (row === undefined) row = { club: LS().readLocalClub(), updatedAt: "", offline: true }; } finally { loading = null; } announce(); return row; })();
    return loading;
  }
  // Runs change(club) through clubMutate; change returns an error string, "same" or "". Throws with the error text.
  async function mutate(change) {
    let err = "";
    const saved = await LS().clubMutate(c => { err = change(c); return err ? false : undefined; });
    if (err && err !== "same") throw new Error(err);
    if (saved) row = { club: saved, updatedAt: new Date().toISOString() }; else await refresh();
    announce();
    return saved;
  }

  // ---------- Badge (เมนู tab) ----------
  const badge = () => { const l = league(), me = meId(l); return me ? C.badge(club() || (LS()?.peekLocalClub || LS()?.readLocalClub)?.(), me) : 0; };
  function paintBadge() {
    const btn = document.querySelector(".sport-tabbar .tab-menu"); if (!btn) return;
    const n = row === null ? 0 : badge();
    let dot = btn.querySelector(".ch-badge");
    if (!n) { dot?.remove(); btn.removeAttribute("aria-label"); return; }
    if (!dot) { dot = document.createElement("i"); dot.className = "ch-badge"; dot.setAttribute("aria-hidden", "true"); btn.appendChild(dot); }
    dot.textContent = n > 9 ? "9+" : String(n);
    btn.setAttribute("aria-label", `เมนู • มีคำท้ารอตอบ ${n}`);
  }

  // ---------- Sheet ----------
  let wrap = null, view = { name: "home" }, lastFocus = null, busy = false;
  function ensure() {
    if (wrap) return wrap;
    wrap = document.createElement("div"); wrap.className = "pc-backdrop ch-backdrop"; wrap.hidden = true;
    wrap.innerHTML = '<div class="pc-sheet ch-sheet" role="dialog" aria-modal="true" aria-labelledby="chTitle" tabindex="-1"></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener("click", onClick);
    wrap.addEventListener("change", e => { if (e.target.closest("[data-ch-form]")) formPreview(); });
    wrap.addEventListener("input", e => { if (e.target.name === "note") { const c = wrap.querySelector(".ch-count"); if (c) c.textContent = `${e.target.value.length}/${C.NOTE_MAX}`; } });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && wrap && !wrap.hidden && !document.body.classList.contains("lv-open")) close(); });
    return wrap;
  }
  function open(opts = {}) {
    ensure(); lastFocus = document.activeElement;
    view = opts.to ? { name: "new", to: opts.to } : { name: "home" };
    render();
    wrap.hidden = false; document.body.classList.add("pc-open");
    requestAnimationFrame(() => { wrap.classList.add("on"); wrap.firstElementChild.focus({ preventScroll: true }); });
    refresh();
  }
  function close() {
    if (!wrap || wrap.hidden) return;
    wrap.classList.remove("on"); document.body.classList.remove("pc-open");
    setTimeout(() => { wrap.hidden = true; }, 260);
    lastFocus?.focus?.({ preventScroll: true });
  }
  const closeBtn = '<button type="button" class="pc-close" data-ch="close" aria-label="ปิด"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
  function render() {
    if (!wrap) return;
    const sheet = wrap.firstElementChild, l = league(), me = meId(l);
    const head = (title, kicker) => `<header class="ch-head">${closeBtn}<p class="ch-kicker">${ICON}<span>${esc(kicker)}</span></p><h2 id="chTitle">${esc(title)}</h2></header>`;
    let body;
    if (row === undefined) body = '<p class="ch-loading" role="status">กำลังโหลดคำท้า…</p>';
    else if (row === null) body = `<div class="ch-off"><b>ระบบท้าดวลยังไม่เปิด • แอดมินต้องรัน SQL ก่อน</b><small>ไฟล์ supabase/migrations/20261019120000_club_row.sql</small></div>`;
    else if (view.name === "new" && me) body = newHtml(l, me);
    else if (view.name === "score" && me) body = scoreHtml(l, me);
    else body = homeHtml(l, me);
    const title = view.name === "new" && row ? "ส่งคำท้า" : view.name === "score" && row ? "กรอกผลท้าดวล" : "ท้าดวล";
    sheet.innerHTML = head(title, "ดวลนอกตาราง • ไม่นับคะแนนลีก") + `<div class="ch-body">${body}</div>`;
    if (view.name === "new") formPreview();
  }

  function sideHtml(l, ids, t, cls) {
    return `<div class="ch-side ${cls}"><span class="ch-avs">${ids.map(id => av(l, id, "lg")).join("")}</span><b>${ids.map(id => esc(nm(l, id))).join(" & ")}</b><small>Elo ${teamRating(t, ids)}</small></div>`;
  }
  function cardHtml(l, me, ch, t) {
    const [a, b] = C.sides(ch), admin = isAdmin(l, me), ra = teamRating(t, a), rb = teamRating(t, b);
    const mine = C.isIn(ch, me), myA = a.includes(me), chance = E() ? Math.round(E().expected(myA ? ra : rb, myA ? rb : ra) * 100) : 50;
    const acts = [];
    if (C.can(ch, me, "accept")) acts.push(`<button type="button" class="primary" data-ch="accept" data-id="${esc(ch.id)}">รับคำท้า</button>`, `<button type="button" class="secondary" data-ch="decline" data-id="${esc(ch.id)}">ปฏิเสธ</button>`);
    if (C.can(ch, me, "score", admin)) acts.push(`<button type="button" class="primary ch-live" data-ch="live" data-id="${esc(ch.id)}"><i class="lv-dot" aria-hidden="true"></i>เริ่มนับสด</button>`, `<button type="button" class="secondary" data-ch="manual" data-id="${esc(ch.id)}">กรอกผลเอง</button>`);
    if (C.can(ch, me, "cancel", admin)) acts.push(`<button type="button" class="ch-link" data-ch="cancel" data-id="${esc(ch.id)}">${ch.status === "accepted" ? "ยกเลิกนัดนี้" : "ยกเลิกคำท้า"}</button>`);
    const state = ch.status === "accepted" ? '<span class="ch-tag go">รับคำท้าแล้ว • รอแข่ง</span>' : ch.from === me ? `<span class="ch-tag">รอ ${esc(C.targets(ch).map(id => nm(l, id)).join(" / "))} ตอบ</span>` : '<span class="ch-tag hot">รอตอบ</span>';
    return `<article class="ch-card${ch.status === "accepted" ? " is-ready" : ""}">
<div class="ch-top">${state}<small>${esc(ago(ch.at))}</small></div>
<div class="ch-vs">${sideHtml(l, a, t, "a")}<span class="ch-x">VS</span>${sideHtml(l, b, t, "b")}</div>
${ch.note ? `<p class="ch-note">“${esc(ch.note)}”<small>— ${esc(nm(l, ch.from))}</small></p>` : ""}
${mine ? `<p class="ch-odds">โอกาสชนะของคุณตาม Elo <b>${chance}%</b></p>` : ""}
${acts.length ? `<div class="ch-acts">${acts.join("")}</div>` : ""}</article>`;
  }
  function historyHtml(l, me) {
    const list = C.history(club(), 20);
    if (!list.length) return '<p class="ch-empty">ยังไม่มีผลท้าดวล • ผลจะขึ้นที่นี่หลังแข่งจบ</p>';
    const names = v => (Array.isArray(v) ? v : [v]).map(id => esc(nm(l, id))).join(" & ");
    return `<ol class="ch-hist">${list.map(m => { const aw = m.s.a > m.s.b, bw = m.s.b > m.s.a, mine = [m.a, m.b].flat().includes(me);
      return `<li${mine ? ' class="mine"' : ""}><span class="ch-h-a${aw ? " win" : ""}">${names(m.a)}</span><b class="ch-h-s">${m.s.a}–${m.s.b}</b><span class="ch-h-b${bw ? " win" : ""}">${names(m.b)}</span><small>${m.format === "doubles" ? "คู่ • " : ""}${esc(ago(m.at))}</small></li>`; }).join("")}</ol>`;
  }
  function homeHtml(l, me) {
    const c = club(), t = elo(), sec = (title, items, extra = "") => items.length ? `<section class="ch-sec"><h3>${esc(title)}<span>${items.length}</span></h3>${extra}${items.map(ch => cardHtml(l, me, ch, t)).join("")}</section>` : "";
    const offline = row?.offline ? '<p class="ch-warn">ออฟไลน์อยู่ • แสดงข้อมูลล่าสุดที่เครื่องจำไว้</p>' : "";
    if (!me) return `${offline}<div class="ch-off"><b>เข้าสู่ระบบก่อนถึงจะท้าดวลได้</b><small>ดูผลท้าดวลล่าสุดได้ด้านล่าง</small></div><section class="ch-sec"><h3>ผลท้าดวล</h3>${historyHtml(l, me)}</section>`;
    const inbox = C.openForMe(c, me), ready = C.ready(c, me), sent = C.sentByMe(c, me), rest = C.others(c, me).slice(0, 6);
    const none = !inbox.length && !ready.length && !sent.length;
    return `${offline}<button type="button" class="primary ch-new" data-ch="new">${ICON}<span>ท้าใครดี?</span></button>
${sec("รอคุณตอบ", inbox)}${sec("พร้อมแข่ง", ready)}${sec("คำท้าที่คุณส่ง", sent)}
${none ? '<p class="ch-empty">ยังไม่มีคำท้าค้างอยู่ • กดปุ่มด้านบน หรือกด “ท้าดวล” บนการ์ดผู้เล่น</p>' : ""}
${rest.length ? `<section class="ch-sec"><h3>คำท้าในก๊วน<span>${rest.length}</span></h3><ul class="ch-mini">${rest.map(ch => { const [a, b] = C.sides(ch); return `<li><b>${a.map(id => esc(nm(l, id))).join(" & ")}</b><i>vs</i><b>${b.map(id => esc(nm(l, id))).join(" & ")}</b><small>${ch.status === "accepted" ? "รอแข่ง" : "รอตอบ"}</small></li>`; }).join("")}</ul></section>` : ""}
<section class="ch-sec"><h3>ผลท้าดวล</h3>${historyHtml(l, me)}</section>`;
  }

  function newHtml(l, me) {
    const t = elo(), people = Object.values(l.profiles || {}).filter(p => p && p.active !== false && p.id !== me).sort((x, y) => rating(t, y.id) - rating(t, x.id));
    const opts = (sel, placeholder) => `<option value="">${placeholder}</option>` + people.map(p => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.displayName || p.id)} • Elo ${rating(t, p.id)}</option>`).join("");
    const to = view.to && people.some(p => p.id === view.to) ? view.to : "";
    return `<form class="ch-form" data-ch-form novalidate>
<fieldset><legend>แบบไหน</legend><div class="lv-opts"><label class="lv-opt"><input type="radio" name="format" value="singles" checked><span>เดี่ยว 1 ต่อ 1</span></label><label class="lv-opt"><input type="radio" name="format" value="doubles"><span>คู่ 2 ต่อ 2</span></label></div></fieldset>
<label class="ch-field"><span>ท้าใคร</span><select name="to" required>${opts(to, "เลือกคู่ต่อสู้")}</select></label>
<div class="ch-dbl" hidden><label class="ch-field"><span>คู่หูของคุณ</span><select name="partner">${opts("", "เลือกคู่หู")}</select></label>
<label class="ch-field"><span>คู่ต่อสู้คนที่ 2</span><select name="to2">${opts("", "เลือกคู่ต่อสู้อีกคน")}</select></label></div>
<label class="ch-field"><span>ข้อความถึงคู่ต่อสู้ <small class="ch-count">0/${C.NOTE_MAX}</small></span><input name="note" maxlength="${C.NOTE_MAX}" autocomplete="off" placeholder="เช่น แพ้เลี้ยงชานม • ไม่ใส่ก็ได้"></label>
<div class="ch-preview" aria-live="polite"></div>
<p class="ch-err" role="alert"></p>
<div class="ch-acts"><button type="button" class="primary" data-ch="send">ส่งคำท้า</button><button type="button" class="secondary" data-ch="home">กลับ</button></div>
<p class="ch-fine">ผลท้าดวลนับ Elo และสถิติตัวต่อตัว แต่ไม่นับคะแนนในตารางลีก</p></form>`;
  }
  function formInput() {
    const f = wrap?.querySelector("[data-ch-form]"); if (!f) return null;
    const l = league(), me = meId(l), v = n => f.elements[n]?.value || "", format = f.querySelector("[name=format]:checked")?.value || "singles";
    return format === "doubles" ? { from: me, format, to: v("to"), teamA: [me, v("partner")], teamB: [v("to"), v("to2")], note: v("note") } : { from: me, format, to: v("to"), note: v("note") };
  }
  function formPreview() {
    const f = wrap?.querySelector("[data-ch-form]"); if (!f) return;
    const input = formInput(), dbl = input.format === "doubles"; f.querySelector(".ch-dbl").hidden = !dbl;
    const box = f.querySelector(".ch-preview"), l = league(), t = elo();
    const a = dbl ? input.teamA : [input.from], b = dbl ? input.teamB : [input.to];
    if (![...a, ...b].every(Boolean)) { box.innerHTML = ""; return; }
    const ra = teamRating(t, a), rb = teamRating(t, b), chance = E() ? Math.round(E().expected(ra, rb) * 100) : 50;
    const n = E() ? E().handicapHint(Math.max(ra, rb), Math.min(ra, rb)) : 0, strong = ra >= rb ? a : b;
    box.innerHTML = `<div class="ch-vs small">${sideHtml(l, a, t, "a")}<span class="ch-x">VS</span>${sideHtml(l, b, t, "b")}</div>
<p class="ch-odds">โอกาสชนะของคุณ <b>${chance}%</b>${n ? ` • Elo แนะนำให้ ${esc(strong.map(id => nm(l, id)).join(" & "))} ต่อ ${n} แต้ม` : " • สูสีกันมาก"}</p>
<div class="ch-meter" role="img" aria-label="โอกาสชนะ ${chance}%"><i style="width:${chance}%"></i></div>`;
  }

  function scoreHtml(l, me) {
    const ch = (club()?.challenges || []).find(c => c.id === view.id);
    if (!ch || ch.status !== "accepted") return '<p class="ch-empty">คำท้านี้ปิดไปแล้ว</p><div class="ch-acts"><button type="button" class="secondary" data-ch="home">กลับ</button></div>';
    const [a, b] = C.sides(ch), who = ids => ids.map(id => esc(nm(l, id))).join(" & ");
    return `<form class="ch-form ch-score" data-id="${esc(ch.id)}" novalidate>
<div class="ch-score-row"><label><span>${who(a)}</span><input name="a" type="number" inputmode="numeric" min="0" max="99" required></label><i>–</i><label><span>${who(b)}</span><input name="b" type="number" inputmode="numeric" min="0" max="99" required></label></div>
<p class="ch-fine">ใส่แต้มของเกม (เช่น 11–7) หรือจำนวนเกมที่ชนะ (เช่น 3–1)</p>
<p class="ch-err" role="alert"></p>
<div class="ch-acts"><button type="button" class="primary" data-ch="savescore" data-id="${esc(ch.id)}">บันทึกผล</button><button type="button" class="secondary" data-ch="home">กลับ</button></div></form>`;
  }

  // ---------- Actions ----------
  const failText = e => e?.message && !/^(Club|Cloud) request failed/.test(e.message) ? e.message : "บันทึกไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  async function run(btn, task) {
    if (busy) return; busy = true; btn?.setAttribute("aria-busy", "true"); if (btn) btn.disabled = true;
    try { await task(); } catch (e) { const err = wrap?.querySelector(".ch-err"); if (err) err.textContent = failText(e); toast(failText(e), "bad"); }
    finally { busy = false; if (btn?.isConnected) { btn.disabled = false; btn.removeAttribute("aria-busy"); } }
  }
  function ensureLive() {
    if (window.LeagueLive?.scoreClub) return Promise.resolve(window.LeagueLive);
    return new Promise((ok, no) => { const s = document.createElement("script"); s.src = "live.js?v=20261019-tourney"; s.onload = () => window.LeagueLive?.scoreClub ? ok(window.LeagueLive) : no(new Error("live")); s.onerror = () => no(new Error("โหลดกระดานนับแต้มไม่ได้")); document.head.appendChild(s); });
  }
  async function saveScore(id, score, liveKey = "") {
    const l = league(), me = meId(l), admin = isAdmin(l, me);
    await mutate(c => C.finish(c, id, me, score, { admin, liveKey }));
  }
  function onClick(e) {
    if (e.target === wrap) return close();
    const t = e.target.closest("[data-ch]"); if (!t) return;
    const act = t.dataset.ch, id = t.dataset.id, l = league(), me = meId(l), admin = isAdmin(l, me);
    if (act === "close") return close();
    if (act === "home") { view = { name: "home" }; return render(); }
    if (act === "new") { view = { name: "new" }; return render(); }
    if (act === "manual") { view = { name: "score", id }; render(); return wrap.querySelector("[name=a]")?.focus(); }
    if (act === "send") {
      const input = formInput(), err = C.validate(input, l, club()), box = wrap.querySelector(".ch-err");
      if (err) { box.textContent = err; return; }
      return run(t, async () => {
        const id = C.newId();
        await mutate(c => { const e2 = C.validate(input, l, c); if (e2) return c.challenges?.some(x => x.id === id) ? "same" : e2; C.create(c, input, { id }); return ""; });
        view = { name: "home" }; render();
        const target = input.format === "doubles" ? `${nm(l, input.teamB[0])} & ${nm(l, input.teamB[1])}` : nm(l, input.to);
        toast(`ส่งคำท้าถึง ${target} แล้ว`, "good");
      });
    }
    if (act === "accept" || act === "decline" || act === "cancel") {
      if (act !== "accept" && !confirm(act === "decline" ? "ปฏิเสธคำท้านี้?" : "ยกเลิกคำท้านี้?")) return;
      return run(t, async () => {
        await mutate(c => C.respond(c, id, me, act, { admin }));
        toast(act === "accept" ? "รับคำท้าแล้ว! นัดเวลาแล้วกด เริ่มนับสด ได้เลย" : act === "decline" ? "ปฏิเสธคำท้าแล้ว" : "ยกเลิกแล้ว", act === "accept" ? "good" : "");
      });
    }
    if (act === "savescore") {
      const f = wrap.querySelector(".ch-score"), a = f?.elements.a.value, b = f?.elements.b.value, box = wrap.querySelector(".ch-err");
      if (a === "" || b === "") { box.textContent = "ใส่คะแนนทั้งสองฝั่ง"; return; }
      return run(t, async () => { await saveScore(id, { a: Number(a), b: Number(b) }); view = { name: "home" }; render(); toast(`บันทึกผล ${a}–${b} แล้ว • Elo อัปเดตแล้ว`, "good"); });
    }
    if (act === "live") {
      const ch = (club()?.challenges || []).find(c => c.id === id); if (!ch) return;
      const [a, b] = C.sides(ch), key = `c:${C.matchIdFor(ch)}`, dbl = ch.format === "doubles";
      return run(t, async () => {
        const live = await ensureLive();
        close();
        await live.scoreClub({ key, pair: [a[0], b[0]], ...(dbl ? { names: [a, b].map(ids => ids.map(x => nm(l, x)).join(" & ")) } : {}),
          onDone: r => saveScore(id, r, key) });
      });
    }
  }

  // ---------- Player card button, menu entry ----------
  function cardButton(l, id, viewer) {
    if (!viewer || viewer === id || !l?.profiles?.[id] || l.profiles[id].active === false) return "";
    return `<button type="button" class="primary ch-card-btn" data-ch-to="${esc(id)}">${ICON}<span>ท้าดวล ${esc(nm(l, id))}</span></button>`;
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-ch-to],[data-ch-open]"); if (!b) return;
    e.preventDefault(); window.PlayerCard?.close?.();
    setTimeout(() => open(b.dataset.chTo ? { to: b.dataset.chTo } : {}), b.dataset.chTo ? 120 : 0);
  });

  // ---------- Polling ----------
  function boot() {
    try { const cached = LS()?.readLocalClub?.(); if (cached) paintBadge(); } catch {}
    refresh();
    const loop = () => setTimeout(async () => { if (!document.hidden) await refresh(); loop(); }, row === null ? 300000 : 45000);
    loop();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    new MutationObserver(() => { if (!document.querySelector(".sport-tabbar .tab-menu .ch-badge") && badge()) paintBadge(); }).observe(document.body, { childList: true });
    if (/[?&]challenge(=|&|$)/.test(location.search)) open();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  window.LeagueChallenge = Object.freeze({ open, close, refresh, badge: () => row === null ? 0 : badge(), cardButton, available: () => row !== null });
})();
