// Social layer around the league (club row, docs/club-data.md):
// - reactions (🔥 😂 💀 👏 😱, one per person) and short comments under every finished league match card;
// - "วันนี้ที่สนาม": check in for today (Asia/Bangkok date) and vote this ISO week's MVP (one vote each, not yourself);
// - players not checked in yet are marked on the next-up bill and on unplayed match cards (only once someone has
//   checked in today, so a day off does not paint everyone as missing).
// index.js is never edited: like live.js this decorates the rendered cards and watches them with a MutationObserver.
// Writes go through LeagueShared.clubMutate with absolute changes (set my reaction to X, set my vote to Y), so a retry
// on a newer copy and a poll landing mid-save both come out right. Without the club row nothing is shown.
const LeagueSocialCore = (() => {
  const EMOJI = Object.freeze(["🔥", "😂", "💀", "👏", "😱"]);
  const MAX_COMMENT = 140;
  const BKK_MS = 7 * 3600e3; // Asia/Bangkok is UTC+7 all year (no daylight saving)
  const pad = n => String(n).padStart(2, "0");
  const bkk = date => new Date(new Date(date).getTime() + BKK_MS); // read with getUTC* to get Bangkok wall time

  function dateKey(date = new Date()) { const d = bkk(date); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  // ISO 8601 week (weeks start on Monday; week 1 holds the year's first Thursday) of the Bangkok calendar date.
  function weekKey(date = new Date()) {
    const b = bkk(date), d = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()));
    const day = d.getUTCDay() || 7; d.setUTCDate(d.getUTCDate() + 4 - day);
    const year = d.getUTCFullYear(), week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7);
    return `${year}-W${pad(week)}`;
  }
  const prevWeekKey = (date = new Date()) => weekKey(new Date(date).getTime() - 7 * 864e5);

  // Votes {voterId: playerId} -> [{id, n}] most votes first (ties keep first-vote order). Self-votes never count.
  function tally(votes, allowed = null) {
    const counts = new Map();
    Object.entries(votes && typeof votes === "object" ? votes : {}).forEach(([voter, id]) => {
      if (typeof id !== "string" || !id || id === voter || (allowed && !allowed.has(id))) return;
      counts.set(id, (counts.get(id) || 0) + 1);
    });
    return [...counts].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n);
  }
  // Everyone tied on the most votes (empty when nobody has a vote).
  function winners(votes, allowed = null) { const t = tally(votes, allowed); return t.length ? t.filter(x => x.n === t[0].n).map(x => x.id) : []; }
  // Weeks this player won (ties count for all tied), counting only weeks that are over.
  function mvpWins(mvp, id, currentWeek = weekKey()) {
    if (!id || !mvp || typeof mvp !== "object") return 0;
    return Object.entries(mvp).filter(([week, votes]) => /^\d{4}-W\d{2}$/.test(week) && week < currentWeek && winners(votes).includes(id)).length;
  }

  // My reaction after tapping `emoji`: the same one again takes it back.
  const nextReaction = (current, emoji) => current === emoji ? null : emoji;
  // Absolute write (safe to repeat on a newer copy): my reaction on target becomes `emoji` (null removes it).
  function setReaction(reactions, target, userId, emoji) {
    if (!reactions || !target || !userId) return reactions;
    const row = { ...(reactions[target] || {}) };
    if (emoji && EMOJI.includes(emoji)) row[userId] = emoji; else delete row[userId];
    if (Object.keys(row).length) reactions[target] = row; else delete reactions[target];
    return reactions;
  }
  // {emoji: count} plus my own, ignoring anything that is not one of the five.
  function reactionSummary(reactions, target, me = "") {
    const row = reactions?.[target] || {}, counts = Object.fromEntries(EMOJI.map(e => [e, 0]));
    Object.values(row).forEach(e => { if (EMOJI.includes(e)) counts[e]++; });
    return { counts, mine: EMOJI.includes(row[me]) ? row[me] : null, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  }

  // A comment's text: trimmed, inner whitespace kept to single spaces/newlines, 1-140 characters (counted by code point).
  function checkComment(text) {
    const clean = String(text ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!clean) return { ok: false, text: "", error: "พิมพ์อะไรสักหน่อยก่อนส่ง" };
    if ([...clean].length > MAX_COMMENT) return { ok: false, text: clean, error: `ยาวไป ${[...clean].length}/${MAX_COMMENT} ตัวอักษร` };
    return { ok: true, text: clean, error: "" };
  }
  function addComment(social, c) {
    if (!social || !c?.id || social.comments.some(x => x?.id === c.id)) return social;
    social.comments.push({ id: c.id, target: c.target, by: c.by, text: c.text, at: c.at });
    return social;
  }
  const canDelete = (comment, me, admin) => Boolean(comment && me && (comment.by === me || admin));
  function removeComment(social, id) { if (social) social.comments = social.comments.filter(x => x?.id !== id); return social; }
  const commentsFor = (social, target) => (social?.comments || []).filter(c => c && c.target === target && typeof c.text === "string")
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  function setVote(mvp, week, voter, playerId) {
    if (!mvp || !week || !voter) return mvp;
    const votes = { ...(mvp[week] || {}) };
    if (playerId && playerId !== voter) votes[voter] = playerId; else delete votes[voter];
    if (Object.keys(votes).length) mvp[week] = votes; else delete mvp[week];
    return mvp;
  }
  // Check-in for one day; days older than `keepDays` are dropped so the row stays small.
  function setCheckin(checkin, day, userId, on, at = new Date().toISOString(), keepDays = 30) {
    if (!checkin || !day || !userId) return checkin;
    const list = { ...(checkin[day] || {}) };
    if (on) list[userId] = list[userId] || at; else delete list[userId];
    if (Object.keys(list).length) checkin[day] = list; else delete checkin[day];
    const oldest = dateKey(new Date(Date.parse(`${day}T12:00:00+07:00`) - keepDays * 864e5));
    Object.keys(checkin).forEach(k => { if (k < oldest) delete checkin[k]; });
    return checkin;
  }
  const present = (checkin, day) => Object.entries(checkin?.[day] || {}).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id]) => id);

  function timeAgo(iso, now = Date.now()) {
    const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    if (!Number.isFinite(s)) return "";
    if (s < 60) return "เมื่อกี้";
    if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
    if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)} วันที่แล้ว`;
    return (agoFmt ||= new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" })).format(new Date(iso));
  }
  let agoFmt = null; // building a date formatter is slow on a phone; one is enough

  return Object.freeze({ EMOJI, MAX_COMMENT, dateKey, weekKey, prevWeekKey, tally, winners, mvpWins, nextReaction, setReaction,
    reactionSummary, checkComment, addComment, canDelete, removeComment, commentsFor, setVote, setCheckin, present, timeAgo });
})();
if (typeof module !== "undefined") module.exports = LeagueSocialCore;

(() => {
  if (typeof document === "undefined") return;
  const C = LeagueSocialCore, LS = () => typeof LeagueShared !== "undefined" ? LeagueShared : null;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // index.js keeps the live league in `state`; other pages read the local copy.
  const league = () => { try { if (typeof state !== "undefined" && state?.profiles) return state; } catch {} try { const S = LS(); return (S?.peekLocalLeague || S?.readLocalLeague)?.() || null; } catch { return null; } };
  const meId = l => { try { return l ? LS()?.sessionUserId(l) || "" : ""; } catch { return ""; } };
  const adminOf = (l, id) => { try { return !!LS()?.isAdmin(l, id); } catch { return false; } };
  const nm = (l, id) => l?.profiles?.[id]?.displayName || "ผู้เล่น";
  const av = (l, id, size = "sm") => window.LeagueUI?.avatar ? window.LeagueUI.avatar(id, nm(l, id), size) : "";
  const toast = (m, t) => window.LeagueToast ? window.LeagueToast(m, t) : null;
  const valid = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const seasonOf = l => Number(l?.currentSeason) || 1;
  const targetOf = (l, id) => `s${seasonOf(l)}:${id}`;
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isIndex = () => !!document.getElementById("schedule");

  // ---------- Club copy: poll, optimistic changes ----------
  let base = null, available = null, pending = [], busy = false, gen = 0;
  const hasCache = () => { try { return !!localStorage.getItem(LS()?.CLUB_KEY || "pp_club_v1"); } catch { return false; } };
  // What the page shows: the last copy read from the cloud with my unsaved changes laid on top.
  function view() {
    const c = LS()?.normalizeClub?.(structuredClone(base || {})) || null;
    if (c) pending.forEach(p => { try { p.change(c); } catch {} });
    return c;
  }
  async function pull() {
    const S = LS(); if (!S?.clubRead) return;
    const started = gen;
    try {
      const got = await S.clubRead();
      if (started !== gen) return; // a save landed meanwhile: its copy is newer than this read
      if (!got) { available = false; base = null; }
      else { available = true; base = got.club; }
    } catch {
      if (available === null && hasCache()) { available = true; base = S.readLocalClub(); }
    }
    paint();
  }
  function change(fn, failText = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้งนะ") {
    if (!available) { toast("ฟีเจอร์โซเชียลยังไม่เปิด", "bad"); return; }
    pending.push({ change: fn, failText }); paint(); flush();
  }
  async function flush() {
    if (busy || !pending.length) return;
    busy = true;
    const job = pending[0];
    try { const saved = await LS().clubMutate(c => { job.change(c); }); if (saved) { base = saved; gen++; } }
    catch { toast(job.failText, "bad"); }
    finally { pending.shift(); busy = false; paint(); if (pending.length) flush(); }
  }

  // ---------- Match cards: reaction row; absent players ----------
  const REACT_LABEL = { "🔥": "ไฟลุก", "😂": "ขำ", "💀": "ตายแล้ว", "👏": "ปรบมือ", "😱": "ช็อก" };
  function paintCards(l, club, me) {
    const box = document.getElementById("schedule"); if (!box || !l?.rounds) return;
    const today = club ? C.present(club.checkin, C.dateKey()) : [], marking = today.length > 0, here = new Set(today);
    l.rounds.forEach((r, ri) => (r?.m || []).forEach((pair, mi) => {
      const id = `r${ri}m${mi}`, card = document.getElementById(`match-${id}`); if (!card) return;
      const done = valid(l.results?.[id]);
      // reactions + comments under a finished result
      let row = card.querySelector(":scope>.sc-react");
      if (club && done) {
        const t = targetOf(l, id), s = C.reactionSummary(club.social.reactions, t, me), n = C.commentsFor(club.social, t).length;
        const html = C.EMOJI.map(e => `<button type="button" class="sc-rx${s.mine === e ? " mine" : ""}${s.counts[e] ? " has" : ""}" data-sc-rx="${esc(id)}" data-e="${e}" aria-pressed="${s.mine === e}" aria-label="${REACT_LABEL[e]} ${s.counts[e]} คน${s.mine === e ? " (ของคุณ)" : ""}"><span aria-hidden="true">${e}</span>${s.counts[e] ? `<b>${s.counts[e]}</b>` : ""}</button>`).join("")
          + `<button type="button" class="sc-cm${n ? " has" : ""}" data-sc-cm="${esc(id)}" aria-label="ความเห็น ${n} รายการ"><span aria-hidden="true">💬</span><b>${n}</b></button>`;
        if (!row) { row = document.createElement("div"); row.className = "sc-react"; row.innerHTML = '<div class="sc-rx-set"></div>'; const st = card.querySelector(":scope>.status"); if (st) st.after(row); else card.appendChild(row); }
        const set = row.firstElementChild;
        if (set.dataset.html !== html) { set.dataset.html = html; set.innerHTML = html; }
        // index.js's share button joins the row as its last cell (it is pinned over the card's corner otherwise).
        const share = card.querySelector(":scope>.share-poster-btn"); if (share) row.appendChild(share);
      } else if (row) { const share = row.querySelector(".share-poster-btn"); if (share) card.appendChild(share); row.remove(); }
      // who has not checked in yet (unplayed matches only)
      const away = marking && !done ? pair.filter(p => p && !here.has(p)) : [];
      card.classList.toggle("sc-wait", away.length > 0);
      card.querySelectorAll(":scope>.pair>b").forEach((b, i) => b.classList.toggle("sc-away", away.includes(pair[i === 0 ? 0 : 1])));
      let note = card.querySelector(":scope>.sc-wait-note");
      if (away.length) {
        const text = `ยังไม่มา: ${away.map(p => nm(l, p)).join(", ")}`;
        if (!note) { note = document.createElement("div"); note.className = "sc-wait-note"; const st = card.querySelector(":scope>.status"); if (st) st.before(note); else card.appendChild(note); }
        if (note.textContent !== text) note.textContent = text;
      } else note?.remove();
    }));
  }
  function paintNextUp(l, club) {
    const box = document.getElementById("nextUp"); if (!box || !l?.rounds) return;
    const today = club ? C.present(club.checkin, C.dateKey()) : [], here = new Set(today);
    box.querySelectorAll(".next-up-item").forEach(item => {
      const id = item.querySelector("[data-goto]")?.dataset.goto || "", [, ri, mi] = /^r(\d+)m(\d+)$/.exec(id) || [];
      const pair = l.rounds?.[ri]?.m?.[mi] || [], away = today.length ? pair.filter(p => p && !here.has(p)) : [];
      item.classList.toggle("sc-wait", away.length > 0);
      item.querySelectorAll(".next-up-bill b").forEach((b, i) => b.classList.toggle("sc-away", away.includes(pair[i])));
      const tag = item.querySelector(".next-up-tag"); if (!tag) return;
      let chip = tag.querySelector(".sc-tag");
      if (away.length) {
        const text = `ยังไม่มา ${away.map(p => nm(l, p)).join(", ")}`;
        if (!chip) { chip = document.createElement("span"); chip.className = "sc-tag"; tag.appendChild(chip); }
        if (chip.textContent !== text) chip.textContent = text;
      } else chip?.remove();
    });
  }

  // ---------- วันนี้ที่สนาม: check-in + MVP ----------
  let dayFmt = null; // one formatter, built on first use (building one is slow on a phone)
  const dayLabel = () => (dayFmt ||= new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "short", day: "numeric", month: "short" })).format(new Date());
  const voters = l => (LS()?.activeProfiles?.(l) || []).map(p => p.id);
  function todayHtml(l, club, me) {
    const today = C.present(club.checkin, C.dateKey()).filter(id => l.profiles?.[id]), mine = today.includes(me);
    const shown = today.slice(0, 7), more = today.length - shown.length;
    const allowed = new Set(voters(l)), week = club.mvp[C.weekKey()] || {}, t = C.tally(week, allowed), top = t.length ? t[0].n : 0;
    const lastWin = C.winners(club.mvp[C.prevWeekKey()] || {}).filter(id => l.profiles?.[id]);
    const myVote = week[me] && allowed.has(week[me]) ? week[me] : "";
    const stack = shown.length
      ? `<div class="sc-stack" aria-label="มาแล้ว ${today.length} คน">${shown.map(id => av(l, id)).join("")}${more > 0 ? `<span class="sc-more">+${more}</span>` : ""}</div><small>${today.length} คน${mine ? " รวมคุณ" : ""}</small>`
      : `<small class="sc-empty">ยังไม่มีใครเช็กชื่อ • เป็นคนแรกเลย!</small>`;
    const tallyHtml = t.length
      ? t.slice(0, 4).map(x => `<span class="sc-vote-chip${x.n === top ? " lead" : ""}">${x.n === top ? '<i class="sc-crown" aria-hidden="true">👑</i>' : ""}${av(l, x.id)}<b>${esc(nm(l, x.id))}</b><em>${x.n}</em></span>`).join("")
      : '<small class="sc-empty">ยังไม่มีโหวต • ใครโชว์ของสุดสัปดาห์นี้?</small>';
    return `<div class="sc-today-head"><h2>วันนี้ที่สนาม</h2><span class="sc-date">${esc(dayLabel())}</span></div>
      <div class="sc-here">
        <button type="button" class="sc-in${mine ? " on" : ""}" data-sc-in aria-pressed="${mine}" ${me ? "" : "disabled"}>${mine ? '<small>เช็กชื่อแล้ว ✓</small><b>ยกเลิก</b>' : '<small>เช็กชื่อ</small><b>วันนี้มา</b>'}</button>
        <div class="sc-who">${stack}</div>
      </div>
      <button type="button" class="sc-mvp" data-sc-mvp aria-label="โหวต MVP สัปดาห์นี้${myVote ? ` • คุณโหวต ${esc(nm(l, myVote))}` : ""}">
        <span class="sc-mvp-k">โหวต MVP สัปดาห์นี้<span class="sc-mvp-go">${myVote ? "เปลี่ยนโหวต" : "โหวต"} ›</span></span>
        <span class="sc-tally">${tallyHtml}</span>
        ${lastWin.length ? `<span class="sc-last">MVP สัปดาห์ที่แล้ว 👑 ${lastWin.map(id => esc(nm(l, id))).join(" • ")}</span>` : ""}
      </button>`;
  }
  function paintToday(l, club, me) {
    const host = isIndex() ? document.getElementById("competition") : document.querySelector(".dashboard-grid");
    if (!host) return;
    let box = document.getElementById("scToday");
    let html = "";
    if (club && l?.profiles) html = todayHtml(l, club, me);
    else if (available === false && adminOf(l, me)) html = '<p class="sc-note">ฟีเจอร์โซเชียลยังไม่เปิด • แอดมินต้องรัน SQL ก่อน</p>';
    if (!html) { box?.remove(); return; }
    if (!box) {
      box = document.createElement("section"); box.id = "scToday"; box.className = isIndex() ? "sc-today" : "card sc-today sc-card"; box.setAttribute("aria-label", "วันนี้ที่สนาม");
      host.prepend(box);
    }
    if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
  }

  // ---------- Bottom sheets: comments, MVP vote ----------
  let sheet = null, sheetFor = null, lastFocus = null;
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement("div"); sheet.className = "sc-backdrop"; sheet.hidden = true;
    sheet.innerHTML = '<div class="sc-sheet" role="dialog" aria-modal="true" aria-labelledby="scTitle" tabindex="-1"></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener("click", e => {
      if (e.target === sheet || e.target.closest("[data-sc-close]")) return closeSheet();
      const del = e.target.closest("[data-sc-del]"); if (del) return removeMine(del.dataset.scDel);
      const vote = e.target.closest("[data-sc-vote]"); if (vote) return castVote(vote.dataset.scVote);
    });
    sheet.addEventListener("submit", e => { e.preventDefault(); if (e.target.matches(".sc-form")) sendComment(e.target); });
    sheet.addEventListener("input", e => { if (e.target.matches(".sc-form textarea")) count(e.target); });
    sheet.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && e.target.matches(".sc-form textarea")) { e.preventDefault(); e.target.form.requestSubmit(); } });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && sheet && !sheet.hidden) closeSheet(); });
    return sheet;
  }
  function openSheet(kind, id) {
    ensureSheet(); lastFocus = document.activeElement; sheetFor = { kind, id };
    const box = sheet.firstElementChild; box.innerHTML = ""; delete box.dataset.html; renderSheet(true);
    sheet.hidden = false; document.body.classList.add("sc-open");
    requestAnimationFrame(() => { sheet.classList.add("on"); (box.querySelector("textarea") && matchMedia("(hover:hover)").matches ? box.querySelector("textarea") : box).focus({ preventScroll: true }); });
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.classList.remove("on"); document.body.classList.remove("sc-open"); sheetFor = null;
    setTimeout(() => { if (!sheetFor) sheet.hidden = true; }, reduce() ? 0 : 260);
    lastFocus?.focus?.({ preventScroll: true });
  }
  const pairOf = (l, id) => { const [, ri, mi] = /^r(\d+)m(\d+)$/.exec(id) || []; return l?.rounds?.[ri]?.m?.[mi] || null; };
  function renderSheet(first = false) {
    if (!sheet || !sheetFor) return;
    const l = league(), club = view(), me = meId(l), box = sheet.firstElementChild; if (!l || !club) return closeSheet();
    if (sheetFor.kind === "comments") {
      const id = sheetFor.id, pair = pairOf(l, id), x = l.results?.[id]; if (!pair) return closeSheet();
      const list = C.commentsFor(club.social, targetOf(l, id)), admin = adminOf(l, me);
      const items = list.length ? list.map(c => `<li class="sc-c${c.by === me ? " me" : ""}">${av(l, c.by)}<div><p><b>${esc(nm(l, c.by))}</b><time datetime="${esc(c.at)}">${esc(C.timeAgo(c.at))}</time></p><div class="sc-c-text">${esc(c.text)}</div></div>${C.canDelete(c, me, admin) ? `<button type="button" class="sc-del" data-sc-del="${esc(c.id)}" aria-label="ลบความเห็นนี้">ลบ</button>` : ""}</li>`).join("")
        : '<li class="sc-none">ยังเงียบอยู่… แซวคนแรกเลย 😏</li>';
      if (first || !box.querySelector(".sc-list")) {
        box.innerHTML = `<div class="sc-sheet-head"><div><p class="sc-kicker">ความเห็น</p><h2 id="scTitle">${esc(nm(l, pair[0]))} <span>${valid(x) ? `${x.a}–${x.b}` : "vs"}</span> ${esc(nm(l, pair[1]))}</h2></div><button type="button" class="sc-x" data-sc-close aria-label="ปิด">×</button></div>
          <ul class="sc-list" aria-live="polite"></ul>
          ${me ? `<form class="sc-form"><label class="sc-sr" for="scText">เขียนความเห็น</label><textarea id="scText" rows="1" maxlength="${C.MAX_COMMENT + 20}" placeholder="แซวได้ แต่อย่าแรงนะ…" enterkeyhint="send"></textarea><span class="sc-count" aria-live="polite">0/${C.MAX_COMMENT}</span><button type="submit" class="primary">ส่ง</button></form>` : '<p class="sc-note">เข้าสู่ระบบก่อนถึงจะคอมเมนต์ได้</p>'}`;
      }
      const ul = box.querySelector(".sc-list"), atEnd = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 40;
      if (ul.dataset.html !== items) { ul.dataset.html = items; ul.innerHTML = items; if (first || atEnd) ul.scrollTop = ul.scrollHeight; }
      return;
    }
    // MVP vote
    const allowed = voters(l), week = club.mvp[C.weekKey()] || {}, t = C.tally(week, new Set(allowed)), counts = Object.fromEntries(t.map(x => [x.id, x.n])), top = t.length ? t[0].n : 0;
    const mine = week[me] || "", total = t.reduce((a, x) => a + x.n, 0);
    const last = C.tally(club.mvp[C.prevWeekKey()] || {}), lastTop = last.length ? last[0].n : 0;
    const people = allowed.filter(id => id !== me).sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || nm(l, a).localeCompare(nm(l, b), "th"));
    const html = `<div class="sc-sheet-head"><div><p class="sc-kicker">สัปดาห์ ${esc(C.weekKey().split("-W")[1])} • ปิดโหวตคืนวันอาทิตย์</p><h2 id="scTitle">ใครคือ MVP?</h2></div><button type="button" class="sc-x" data-sc-close aria-label="ปิด">×</button></div>
      ${me ? '<p class="sc-hint">แตะชื่อเพื่อโหวต • เปลี่ยนใจได้ตลอด • โหวตตัวเองไม่ได้นะ</p>' : '<p class="sc-note">เข้าสู่ระบบก่อนถึงจะโหวตได้</p>'}
      <ul class="sc-ballot">${people.map(id => { const n = counts[id] || 0, lead = n && n === top;
        return `<li><button type="button" class="sc-pick${mine === id ? " mine" : ""}${lead ? " lead" : ""}" data-sc-vote="${esc(id)}" aria-pressed="${mine === id}" ${me ? "" : "disabled"}>${av(l, id)}<span class="sc-pick-who"><span class="sc-pick-name">${lead ? '<i aria-hidden="true">👑</i>' : ""}${esc(nm(l, id))}</span>${mine === id ? '<em>โหวตแล้ว</em>' : ""}</span><span class="sc-bar" aria-hidden="true"><i style="width:${total ? Math.round(n / total * 100) : 0}%"></i></span><b>${n}</b></button></li>`; }).join("")}</ul>
      ${lastTop ? `<p class="sc-last">MVP สัปดาห์ที่แล้ว 👑 ${last.filter(x => x.n === lastTop).map(x => esc(nm(l, x.id))).join(" • ")} (${lastTop} โหวต)</p>` : ""}`;
    if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
  }
  function count(area) {
    const n = [...area.value.trim()].length, el = area.form.querySelector(".sc-count");
    el.textContent = `${n}/${C.MAX_COMMENT}`; el.classList.toggle("over", n > C.MAX_COMMENT);
    area.style.height = "auto"; area.style.height = `${Math.min(area.scrollHeight, 120)}px`;
  }
  function sendComment(form) {
    const l = league(), me = meId(l), area = form.querySelector("textarea"), id = sheetFor?.id; if (!me || !id) return;
    const ok = C.checkComment(area.value); if (!ok.ok) { toast(ok.error, "bad"); return; }
    const c = { id: `c_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`, target: targetOf(l, id), by: me, text: ok.text, at: new Date().toISOString() };
    area.value = ""; count(area);
    change(club => { C.addComment(club.social, c); }, "ส่งความเห็นไม่สำเร็จ ลองใหม่นะ");
    const ul = sheet.querySelector(".sc-list"); if (ul) ul.scrollTop = ul.scrollHeight;
  }
  function removeMine(commentId) {
    const l = league(), me = meId(l), club = view(), c = club?.social.comments.find(x => x?.id === commentId);
    if (!C.canDelete(c, me, adminOf(l, me))) return;
    if (!confirm(c.by === me ? "ลบความเห็นนี้?" : `ลบความเห็นของ ${nm(l, c.by)}?`)) return;
    change(cl => { C.removeComment(cl.social, commentId); }, "ลบไม่สำเร็จ ลองใหม่นะ");
  }
  function castVote(playerId) {
    const l = league(), me = meId(l), club = view(); if (!me || !club || playerId === me) return;
    const week = C.weekKey(), next = (club.mvp[week] || {})[me] === playerId ? null : playerId;
    change(cl => { C.setVote(cl.mvp, week, me, next); }, "โหวตไม่สำเร็จ ลองใหม่นะ");
    if (next) toast(`โหวต ${nm(l, playerId)} แล้ว 👑`, "good");
  }
  function react(id, emoji) {
    const l = league(), me = meId(l), club = view(); if (!club) return;
    if (!me) return toast("เข้าสู่ระบบก่อนถึงจะรีแอคได้", "bad");
    const t = targetOf(l, id), next = C.nextReaction(C.reactionSummary(club.social.reactions, t, me).mine, emoji);
    change(cl => { C.setReaction(cl.social.reactions, t, me, next); }, "รีแอคไม่สำเร็จ ลองใหม่นะ");
  }
  function checkIn() {
    const l = league(), me = meId(l), club = view(); if (!me || !club) return;
    const day = C.dateKey(), on = !C.present(club.checkin, day).includes(me), at = new Date().toISOString();
    change(cl => { C.setCheckin(cl.checkin, day, me, on, at); }, "เช็กชื่อไม่สำเร็จ ลองใหม่นะ");
    if (on) toast("เช็กชื่อแล้ว วันนี้ตีให้สุด! 🏓", "good");
  }

  document.addEventListener("click", e => {
    const rx = e.target.closest("[data-sc-rx]");
    if (rx) { e.preventDefault(); react(rx.dataset.scRx, rx.dataset.e); if (!reduce()) { rx.classList.remove("pop"); void rx.offsetWidth; rx.classList.add("pop"); } return; }
    const cm = e.target.closest("[data-sc-cm]"); if (cm) { e.preventDefault(); return openSheet("comments", cm.dataset.scCm); }
    if (e.target.closest("[data-sc-in]")) { e.preventDefault(); return checkIn(); }
    if (e.target.closest("[data-sc-mvp]")) { e.preventDefault(); return openSheet("mvp"); }
  });

  // ---------- Paint everything from the current copy ----------
  function paint() {
    const l = league(), me = meId(l), club = available ? view() : null;
    try { paintToday(l, club, me); } catch (err) { console.warn("social: today card", err); }
    try { paintCards(l, club, me); paintNextUp(l, club); } catch (err) { console.warn("social: cards", err); }
    try { renderSheet(); } catch (err) { console.warn("social: sheet", err); }
  }

  // ---------- Notifications (pwa.js events()): comments and reactions on my finished matches ----------
  function events(l, me) {
    const club = available ? view() : LS()?.readLocalClub?.(); if (!l?.rounds || !me || !club) return [];
    const out = [], cutoff = Date.now() - 2 * 864e5;
    l.rounds.forEach((r, ri) => (r?.m || []).forEach((pair, mi) => {
      const id = `r${ri}m${mi}`; if (!pair?.includes(me) || !valid(l.results?.[id])) return;
      const t = targetOf(l, id), other = nm(l, pair[0] === me ? pair[1] : pair[0]);
      C.commentsFor(club.social, t).forEach(c => { if (c.by !== me && Date.parse(c.at) > cutoff) out.push({ key: `cmt:${c.id}`, title: `${nm(l, c.by)} คอมเมนต์คู่ของคุณ`, body: `${c.text.slice(0, 80)} • คู่กับ ${other}`, tag: `pp-cmt-${t}` }); });
      Object.entries(club.social.reactions?.[t] || {}).forEach(([by, e]) => { if (by !== me && C.EMOJI.includes(e)) out.push({ key: `rx:${t}:${by}:${e}`, title: `${nm(l, by)} รีแอค ${e}`, body: `ผลคู่ของคุณกับ ${other}`, tag: `pp-rx-${t}` }); });
    }));
    return out;
  }

  function boot() {
    const watched = isIndex() || document.querySelector(".dashboard-grid");
    if (!watched) return;
    const sched = document.getElementById("schedule"), next = document.getElementById("nextUp");
    let queued = false;
    const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); };
    if (sched) {
      new MutationObserver(soon).observe(sched, { childList: true });
      new MutationObserver(soon).observe(sched, { subtree: true, attributes: true, attributeFilter: ["data-win"] });
    }
    if (next) new MutationObserver(soon).observe(next, { childList: true });
    // The account can change (log in/out) without the schedule re-rendering.
    addEventListener("storage", e => { if (e.key === LS()?.SESSION_KEY || e.key === LS()?.LEAGUE_KEY) soon(); });
    document.getElementById("whoami") && new MutationObserver(soon).observe(document.getElementById("whoami"), { childList: true, characterData: true, subtree: true });
    pull();
    const loop = () => setTimeout(async () => { if (!document.hidden && !busy) await pull(); loop(); }, 15000);
    loop();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pull(); });
    // Times ("5 นาทีที่แล้ว") and today's date roll over even when nothing else changes.
    setInterval(() => { if (!document.hidden) paint(); }, 60000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.LeagueSocial = Object.freeze({
    core: C,
    presentToday: () => { const club = available ? view() : LS()?.readLocalClub?.(); return club ? C.present(club.checkin, C.dateKey()) : []; },
    mvpWins: id => { const club = available ? view() : LS()?.readLocalClub?.(); return club ? C.mvpWins(club.mvp, id) : 0; },
    events, refresh: pull, available: () => available
  });
})();
