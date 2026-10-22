// Poker night (โป๊กเกอร์) — buy-ins, rebuys, chips at the end, and who pays whom. Standalone page.
// A night is an append-only list of events (join / buy / out / undo), so two phones editing at once merge by
// taking the union of their events. Nights live under `poker` inside the `dummy` column of the shared row (same
// rev lock and save function as the Dummy sheet; dummy.js carries `poker` along untouched). localStorage is the
// offline copy.
const PokerNight = (() => {
  const MAX_NIGHTS = 20, MAX_EVENTS = 600, TYPES = ["join", "buy", "out", "undo"];
  const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
  const money = v => { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) ? n : 0; };
  const cleanName = v => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
  const cleanId = v => String(v ?? "").replace(/[^\w-]/g, "").slice(0, 40);
  const newId = (prefix = "e") => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  function normalizeEvent(e) {
    if (!e || typeof e !== "object" || !TYPES.includes(e.t)) return null;
    const out = { id: cleanId(e.id), at: Math.max(0, int(e.at)), t: e.t };
    if (!out.id) return null;
    if (e.t === "undo") { out.ref = cleanId(e.ref); return out.ref ? out : null; }
    out.name = cleanName(e.name); if (!out.name) return null;
    if (e.t === "buy") { out.amount = money(e.amount); if (!(out.amount > 0)) return null; }
    // A join may carry the first buy-in (เข้าโต๊ะ from the player's own phone), so tapping it twice buys only once.
    if (e.t === "join" && money(e.amount) > 0) out.amount = money(e.amount);
    if (e.t === "out") { out.amount = Math.max(0, int(e.amount)); }
    return out;
  }
  function normalizeNight(n) {
    if (!n || typeof n !== "object") return null;
    const night = { id: cleanId(n.id), startedAt: Math.max(0, int(n.startedAt)), buyIn: money(n.buyIn) > 0 ? money(n.buyIn) : 100, chips: int(n.chips) > 0 ? int(n.chips) : 100, closedAt: Math.max(0, int(n.closedAt)) };
    if (!night.id) return null;
    const seen = new Set();
    night.events = (Array.isArray(n.events) ? n.events : []).map(normalizeEvent).filter(e => e && !seen.has(e.id) && seen.add(e.id))
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(-MAX_EVENTS);
    return night;
  }
  function trim(nights) {
    return Object.fromEntries(Object.values(nights).sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_NIGHTS).map(n => [n.id, n]));
  }
  function normalize(raw) {
    const nights = {};
    Object.values(raw && typeof raw === "object" && raw.nights && typeof raw.nights === "object" ? raw.nights : {}).forEach(n => { const x = normalizeNight(n); if (x) nights[x.id] = x; });
    return { nights: trim(nights) };
  }
  // Union of two copies: every night from either side, every event from either side, closed if either side closed it.
  function merge(a, b) {
    a = normalize(a); b = normalize(b);
    const nights = { ...a.nights };
    Object.values(b.nights).forEach(n => {
      const mine = nights[n.id];
      nights[n.id] = mine ? normalizeNight({ ...mine, closedAt: Math.max(mine.closedAt, n.closedAt), events: [...mine.events, ...n.events] }) : n;
    });
    return { nights: trim(nights) };
  }
  const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  // The night still being played: the newest one that has not been closed.
  function current(p) { return Object.values(normalize(p).nights).filter(n => !n.closedAt).sort((a, b) => b.startedAt - a.startedAt)[0] || null; }
  function history(p) { return Object.values(normalize(p).nights).filter(n => n.closedAt).sort((a, b) => b.closedAt - a.closedAt); }

  // Everything the page shows about a night, worked out from its events. Money is baht; chip counts are whole chips.
  function view(night) {
    night = normalizeNight(night);
    const undone = new Set(night.events.filter(e => e.t === "undo").map(e => e.ref));
    const live = night.events.filter(e => e.t !== "undo" && !undone.has(e.id));
    const players = new Map();
    const player = name => { if (!players.has(name)) players.set(name, { name, buys: [], out: null }); return players.get(name); };
    live.forEach(e => {
      if (e.t === "join") { if (!players.has(e.name) && e.amount) player(e.name).buys.push(e.amount); else player(e.name); }
      else if (e.t === "buy") player(e.name).buys.push(e.amount);
      else if (e.t === "out") player(e.name).out = e.amount;
    });
    const rate = night.chips / night.buyIn; // chips per baht
    const list = [...players.values()].map(p => {
      const paid = money(p.buys.reduce((s, v) => s + v, 0));
      const outBaht = p.out === null ? null : money(p.out / rate);
      return { ...p, paid, chipsIn: Math.round(paid * rate), outBaht, net: outBaht === null ? null : money(outBaht - paid) };
    });
    const chipsIn = list.reduce((s, p) => s + p.chipsIn, 0), chipsOut = list.reduce((s, p) => s + (p.out || 0), 0);
    const allOut = list.length > 0 && list.every(p => p.out !== null);
    return { night, rate, players: list, paid: money(list.reduce((s, p) => s + p.paid, 0)), chipsIn, chipsOut, diffChips: chipsOut - chipsIn, allOut, balanced: allOut && chipsOut === chipsIn, lastAction: live[live.length - 1] || null };
  }
  // Fewest transfers: the biggest loser pays the biggest winner until everyone is square. Works in satang; the
  // rounding left over from chips → baht goes to the biggest winner so the transfers always add up.
  function transfers(players) {
    const nets = players.filter(p => p.net !== null && p.net !== undefined).map(p => ({ name: p.name, c: Math.round(p.net * 100) }));
    const drift = nets.reduce((s, p) => s + p.c, 0);
    if (drift && nets.length) { const top = nets.slice().sort((a, b) => b.c - a.c)[0]; top.c -= drift; }
    const pay = nets.filter(p => p.c < 0).map(p => ({ ...p, c: -p.c })).sort((a, b) => b.c - a.c || a.name.localeCompare(b.name));
    const get = nets.filter(p => p.c > 0).sort((a, b) => b.c - a.c || a.name.localeCompare(b.name));
    const out = [];
    let i = 0, j = 0;
    while (i < pay.length && j < get.length) {
      const c = Math.min(pay[i].c, get[j].c);
      if (c > 0) out.push({ from: pay[i].name, to: get[j].name, amount: c / 100 });
      pay[i].c -= c; get[j].c -= c;
      if (!pay[i].c) i++; if (!get[j].c) j++;
    }
    return out;
  }
  function addEvent(p, nightId, event) {
    const copy = normalize(p), night = copy.nights[nightId];
    if (!night) return copy;
    night.events.push({ id: newId(), at: Date.now(), ...event });
    copy.nights[nightId] = normalizeNight(night);
    return copy;
  }
  function startNight(p, { buyIn, chips, names }) {
    const copy = normalize(p), id = newId("n"), at = Date.now();
    const unique = [...new Set(names.map(cleanName).filter(Boolean))];
    copy.nights[id] = normalizeNight({ id, startedAt: at, buyIn, chips, events: unique.flatMap((name, i) => [{ id: newId(), at: at + i * 2, t: "join", name }, { id: newId(), at: at + i * 2 + 1, t: "buy", name, amount: money(buyIn) }]) });
    return { poker: { nights: trim(copy.nights) }, id };
  }
  // The player sits down at the open night with one buy-in; nothing happens if they are already at the table.
  function join(p, nightId, name) {
    const copy = normalize(p), night = copy.nights[nightId], who = cleanName(name);
    if (!night || !who || view(night).players.some(x => x.name === who)) return copy;
    return addEvent(copy, nightId, { t: "join", name: who, amount: night.buyIn });
  }
  function closeNight(p, nightId) { const copy = normalize(p); if (copy.nights[nightId]) copy.nights[nightId].closedAt = Date.now(); return copy; }

  return Object.freeze({ normalize, merge, same, current, history, view, transfers, addEvent, join, startNight, closeNight, cleanName, MAX_NIGHTS });
})();
if (typeof window !== "undefined") window.PokerNight = PokerNight;

(() => {
  if (typeof document === "undefined" || !document.getElementById?.("pokerApp")) return;
  const P = PokerNight, $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const baht = (v, sign = false) => `${sign && v > 0 ? "+" : ""}${Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 })}฿`;
  const chipsText = v => `${Number(v).toLocaleString("th-TH")} ชิป`;
  const KEY = "pp_poker_v1", Cloud = typeof LeagueShared !== "undefined" ? LeagueShared : null;
  let poker = load(), dirty = (() => { try { return localStorage.getItem(KEY + "_dirty") === "1"; } catch { return false; } })();
  let syncing = false, syncTimer = 0, cloudOff = !Cloud, picked = new Set();
  function load() { try { return P.normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return P.normalize(null); } }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(poker)); localStorage.setItem(KEY + "_dirty", dirty ? "1" : "0"); } catch {} }
  function change(next) { poker = next; dirty = true; store(); render(); queueSync(); }

  // ---- cloud ----
  function setSync(text, status = "") { const el = $("pSync"); el.textContent = text; el.className = `pill sync ${status}`; }
  function queueSync() { if (cloudOff) return; setSync("กำลังบันทึก…"); clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 300); }
  async function syncNow() {
    if (cloudOff || syncing) return;
    syncing = true;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await Cloud.loadDummyCloud(), theirs = P.normalize(remote.poker), merged = P.merge(poker, theirs);
        if (P.same(merged, theirs)) { const changed = !P.same(poker, merged); poker = merged; dirty = false; store(); if (changed) render(); setSync("ออนไลน์ • ซิงก์แล้ว", "online"); return; }
        const rev = Math.max(0, Math.floor(Number(remote.rev) || 0));
        const saved = await Cloud.saveDummyCloud({ ...remote, poker: merged, rev: rev + 1 }, rev);
        if (!saved) continue;
        // Anything added while saving is still in `poker`; merging keeps it and the next round sends it.
        poker = P.merge(poker, saved.poker); dirty = !P.same(poker, saved.poker);
        store(); render();
        if (dirty) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 0); } else setSync("ออนไลน์ • บันทึกแล้ว", "online");
        return;
      }
      setSync("มีคนแก้พร้อมกัน • จะลองใหม่", "offline");
    } catch (error) {
      const msg = String(error?.message || "");
      if (/\b400\b/.test(msg)) { cloudOff = true; setSync("ยังไม่เปิดซิงก์ • เก็บในเครื่อง", "offline"); }
      else if (error?.authRequired || /auth|token|login/i.test(msg)) setSync("เข้าสู่ระบบที่หน้าแรกก่อน • เก็บในเครื่อง", "offline");
      else setSync("ออฟไลน์ • เก็บในเครื่อง", "offline");
    } finally { syncing = false; }
  }
  function toast(msg) { const el = $("pToast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2200); }

  // ---- setup ----
  function league() { try { return Cloud?.readLocalLeague?.() || null; } catch { return null; } }
  function leaguePeople() { try { return Cloud.activeProfiles(league()).map(p => p.displayName).filter(Boolean).sort((a, b) => a.localeCompare(b, "th")); } catch { return []; } }
  function avatarFor(name) {
    const UI = window.LeagueUI, person = window.LeagueProfile?.payeeByName?.(league(), name);
    return UI?.avatar ? UI.avatar(person?.id || `guest:${name}`, name, "sm") : "";
  }
  // The signed-in player (league account on this phone), or null.
  function me() { try { const l = league(), id = l && Cloud.sessionUserId(l); return id ? P.cleanName(l.profiles[id]?.displayName) || null : null; } catch { return null; } }
  let preselected = false;
  function renderSetup() {
    if (!preselected && me()) { picked.add(me()); preselected = true; }
    const people = [...new Set([...leaguePeople(), ...picked])];
    $("pPeople").innerHTML = people.length ? people.map(n => `<button type="button" class="p-person" data-person="${esc(n)}" aria-pressed="${picked.has(n)}">${avatarFor(n)}<span>${esc(n)}</span></button>`).join("") : '<div class="muted">ยังไม่มีรายชื่อจากลีก พิมพ์ชื่อด้านล่างได้เลย</div>';
    $("pPickedCount").textContent = picked.size ? `เลือกแล้ว ${picked.size} คน${picked.size < 2 ? " • คนอื่นกดเข้าโต๊ะเองจากมือถือได้" : ""}` : "แตะชื่อคนที่เล่นวงนี้";
    $("pStart").disabled = picked.size < 1;
  }
  $("pPeople").addEventListener("click", e => {
    const b = e.target.closest("[data-person]"); if (!b) return;
    const n = b.dataset.person; if (picked.has(n)) picked.delete(n); else picked.add(n); renderSetup();
  });
  function addGuest(input, onName) {
    const name = P.cleanName(input.value); if (!name) return toast("พิมพ์ชื่อก่อน");
    onName(name); input.value = ""; input.focus();
  }
  $("pGuestAdd").addEventListener("click", () => addGuest($("pGuest"), n => { picked.add(n); renderSetup(); }));
  $("pGuest").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("pGuestAdd").click(); } });
  $("pStart").addEventListener("click", () => {
    const buyIn = Number($("pBuyIn").value), chips = Math.round(Number($("pChips").value));
    if (!(buyIn > 0) || !(chips > 0)) return toast("ใส่ราคาซื้อชิปและจำนวนชิปให้ถูกก่อน");
    if (picked.size < 1) return toast("เลือกผู้เล่นอย่างน้อย 1 คน");
    const { poker: next } = P.startNight(poker, { buyIn, chips, names: [...picked] });
    picked = new Set(); change(next); toast("เริ่มวงแล้ว • ทุกคนซื้อชิปคนละ 1 ไม้");
  });

  // ---- the night ----
  function renderNight(night) {
    const v = P.view(night), n = v.night;
    const myName = me(); renderSeat(v, myName);
    $("pMeta").textContent = `ซื้อ 1 ไม้ = ${baht(n.buyIn)} ได้ ${chipsText(n.chips)} • ${v.players.length} คน • ลงรวม ${baht(v.paid)}`;
    $("pPlayers").innerHTML = v.players.map((p, i) => {
      const tone = p.net > 0 ? "pos" : p.net < 0 ? "neg" : "";
      return `<div class="p-row${p.name === myName ? " p-row-me" : ""}">
<div class="p-row-head">${avatarFor(p.name)}<div class="d-board-name"><b>${esc(p.name)}</b><small>ซื้อ ${p.buys.length} ไม้ • ลง ${baht(p.paid)}</small></div><button type="button" class="secondary p-rebuy" data-buy="${esc(p.name)}" aria-label="${esc(p.name)} ซื้อเพิ่ม 1 ไม้ (${baht(n.buyIn)})">+ ซื้อเพิ่ม</button></div>
<div class="p-row-out"><label for="pOut${i}">ชิปตอนเลิก</label><input id="pOut${i}" type="number" inputmode="numeric" min="0" data-out="${esc(p.name)}" placeholder="นับชิป" value="${p.out ?? ""}"><b class="p-net ${tone}">${p.net === null ? "" : baht(p.net, true)}</b></div></div>`;
    }).join("");
    const check = $("pCheck");
    if (!v.players.some(p => p.out !== null)) check.innerHTML = `<span class="muted">ชิปในวงทั้งหมด ${chipsText(v.chipsIn)} • เลิกเล่นแล้วนับชิปแต่ละคนใส่ช่องด้านบน</span>`;
    else if (!v.allOut) check.innerHTML = `<span class="muted">นับแล้ว ${chipsText(v.chipsOut)} จาก ${chipsText(v.chipsIn)} • ยังไม่ได้ใส่ ${v.players.filter(p => p.out === null).map(p => esc(p.name)).join(", ")}</span>`;
    else if (!v.balanced) check.innerHTML = `<b class="neg">ชิป${v.diffChips > 0 ? "เกิน" : "ขาด"} ${chipsText(Math.abs(v.diffChips))}</b> <span class="muted">ชิปที่นับได้ต้องเท่ากับชิปที่ซื้อ (${chipsText(v.chipsIn)}) นับใหม่อีกรอบก่อนสรุปเงิน</span>`;
    else check.innerHTML = `<b class="pos">ชิปครบ ${chipsText(v.chipsIn)}</b>`;
    const lines = v.balanced ? P.transfers(v.players) : [];
    $("pPay").hidden = !v.balanced;
    $("pPayList").innerHTML = lines.length ? lines.map(payRow).join("") : '<div class="muted">ไม่มีใครต้องจ่าย (เท่าทุนกันหมด)</div>';
    $("pPayCopy").hidden = !lines.length;
    $("pClose").textContent = v.balanced ? "จบวง • เก็บเข้าประวัติ" : "จบวง";
    $("pUndo").disabled = !v.lastAction;
  }
  // เข้าโต๊ะ: each player sits down from their own phone; the bar says who is seated and how to join.
  function renderSeat(v, name) {
    const bar = $("pSeat"), n = v.night;
    if (!name) { bar.innerHTML = '<span class="muted">เข้าสู่ระบบที่<a href="index.html">หน้าแรก</a>ก่อน แล้วกดเข้าโต๊ะเองได้</span>'; return; }
    const seated = v.players.find(p => p.name === name);
    bar.innerHTML = seated
      ? `<span class="p-seat-on">${avatarFor(name)}<b>${esc(name)}</b> นั่งโต๊ะนี้แล้ว • ซื้อ ${seated.buys.length} ไม้</span>`
      : `<button type="button" class="primary p-join" id="pJoin">เข้าโต๊ะ • ซื้อ 1 ไม้ (${esc(baht(n.buyIn))})</button><span class="muted">ในวงตอนนี้ ${v.players.length} คน</span>`;
  }
  $("pSeat").addEventListener("click", async e => {
    if (!e.target.closest("#pJoin")) return;
    const name = me(); if (!name) return;
    // Pick up the latest table first, so a night someone just opened on another phone is the one we sit at.
    if (!cloudOff) { await syncNow(); }
    const night = nightNow(); if (!night) return toast("ยังไม่มีวงเปิดอยู่");
    if (P.view(night).players.some(p => p.name === name)) return render();
    change(P.join(poker, night.id, name)); toast(`เข้าโต๊ะแล้ว • ซื้อ ${baht(night.buyIn)}`);
  });
  function payRow(l) {
    const go = window.LeagueProfile?.openPay ? `<button type="button" class="secondary pay-go" data-pay-to-name="${esc(l.to)}" data-pay-from="${esc(l.from)}" data-pay-amount="${esc(l.amount)}" aria-label="โอนให้ ${esc(l.to)} ${esc(baht(l.amount))}">โอน</button>` : "";
    return `<div class="d-pay-row"><b>${esc(l.from)}</b><span class="d-pay-arrow">จ่าย ➜</span><b>${esc(l.to)}</b><b class="d-pay-amt">${esc(baht(l.amount))}</b>${go}</div>`;
  }
  const nightNow = () => P.current(poker);
  $("pPlayers").addEventListener("click", e => {
    const b = e.target.closest("[data-buy]"); const night = nightNow(); if (!b || !night) return;
    change(P.addEvent(poker, night.id, { t: "buy", name: b.dataset.buy, amount: night.buyIn }));
    toast(`${b.dataset.buy} ซื้อเพิ่ม ${baht(night.buyIn)}`);
  });
  $("pPlayers").addEventListener("change", e => {
    const input = e.target.closest("[data-out]"), night = nightNow(); if (!input || !night) return;
    const name = input.dataset.out, prev = P.view(night).players.find(p => p.name === name)?.out ?? null;
    if (input.value === "") { if (prev !== null) { const last = [...night.events].reverse().find(x => x.t === "out" && x.name === name); if (last) change(P.addEvent(poker, night.id, { t: "undo", ref: last.id })); } return; }
    const chips = Math.max(0, Math.round(Number(input.value)));
    if (chips !== prev) change(P.addEvent(poker, night.id, { t: "out", name, amount: chips }));
  });
  // Moving between chip boxes with the keyboard's Enter key.
  $("pPlayers").addEventListener("keydown", e => {
    if (e.key !== "Enter" || !e.target.matches("[data-out]")) return;
    e.preventDefault(); const names = [...document.querySelectorAll("[data-out]")].map(b => b.dataset.out), next = names[names.indexOf(e.target.dataset.out) + 1];
    // Leaving the box saves it and redraws the list, so look the next box up again by name.
    e.target.blur(); if (next) [...document.querySelectorAll("[data-out]")].find(b => b.dataset.out === next)?.focus();
  });
  $("pLateAdd").addEventListener("click", () => addGuest($("pLate"), name => {
    const night = nightNow(); if (!night) return;
    if (P.view(night).players.some(p => p.name === name)) return toast("มีชื่อนี้ในวงแล้ว");
    let next = P.addEvent(poker, night.id, { t: "join", name }); next = P.addEvent(next, night.id, { t: "buy", name, amount: night.buyIn });
    change(next); toast(`${name} เข้าวง • ซื้อ ${baht(night.buyIn)}`);
  }));
  $("pLate").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("pLateAdd").click(); } });
  $("pUndo").addEventListener("click", () => {
    const night = nightNow(), last = night && P.view(night).lastAction; if (!last) return;
    const what = last.t === "buy" ? `${last.name} ซื้อ ${baht(last.amount)}` : last.t === "out" ? `ชิปของ ${last.name} (${last.amount})` : last.amount ? `${last.name} เข้าโต๊ะ (${baht(last.amount)})` : `${last.name} เข้าวง`;
    change(P.addEvent(poker, night.id, { t: "undo", ref: last.id })); toast(`ย้อนแล้ว: ${what}`);
  });
  $("pClose").addEventListener("click", () => {
    const night = nightNow(); if (!night) return;
    const v = P.view(night);
    if (!v.balanced && !confirm("ชิปยังไม่ครบหรือยังใส่ไม่ครบทุกคน จบวงเลยไหม? (วงนี้จะไม่มีสรุปเงิน)")) return;
    if (v.balanced && !confirm("จบวงนี้แล้วเก็บเข้าประวัติ?")) return;
    change(P.closeNight(poker, night.id)); toast("จบวงแล้ว");
  });
  async function copyText(text) { try { await navigator.clipboard.writeText(text); toast("คัดลอกแล้ว วางในไลน์ได้เลย"); } catch { prompt("คัดลอกข้อความนี้", text); } }
  const dayText = at => new Date(at).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });
  const lineText = night => { const v = P.view(night); return [`♠️ สรุปโป๊กเกอร์ ${dayText(night.startedAt)} (ลงรวม ${baht(v.paid)})`, ...v.players.map(p => `${p.name} ${p.net === null ? "-" : baht(p.net, true)}`), "", ...P.transfers(v.players).map(l => `${l.from} จ่าย ${l.to} ${baht(l.amount)}`)].join("\n"); };
  $("pPayCopy").addEventListener("click", () => { const night = nightNow(); if (night) copyText(lineText(night)); });

  // ---- history ----
  function renderHistory() {
    const list = P.history(poker);
    $("pHistCard").hidden = !list.length;
    $("pHist").innerHTML = list.map((night, i) => {
      const v = P.view(night), lines = v.balanced ? P.transfers(v.players) : [];
      const rows = v.players.slice().sort((a, b) => (b.net ?? -1e9) - (a.net ?? -1e9)).map(p => `<span class="${p.net > 0 ? "pos" : p.net < 0 ? "neg" : ""}">${esc(p.name)} ${p.net === null ? "–" : esc(baht(p.net, true))}</span>`).join("");
      return `<details class="d-day"${i === 0 ? " open" : ""}><summary><b>${esc(dayText(night.startedAt))}</b><span class="muted">${v.players.length} คน • ลงรวม ${esc(baht(v.paid))}</span></summary><div class="d-preview-list">${rows}</div>${v.balanced ? `<div class="d-pay-list">${lines.length ? lines.map(payRow).join("") : '<div class="muted">เท่าทุนกันหมด</div>'}</div><button type="button" class="secondary" data-copy-night="${esc(night.id)}">คัดลอกไปส่งในไลน์</button>` : '<div class="muted">วงนี้ปิดก่อนนับชิปครบ จึงไม่มีสรุปเงิน</div>'}</details>`;
    }).join("");
  }
  $("pHist").addEventListener("click", e => {
    const b = e.target.closest("[data-copy-night]"); if (!b) return;
    const night = P.normalize(poker).nights[b.dataset.copyNight]; if (night) copyText(lineText(night));
  });

  function render() {
    const night = nightNow();
    $("pSetup").hidden = Boolean(night); $("pNight").hidden = !night;
    const active = document.activeElement, typing = active?.matches?.("[data-out]") ? active.dataset.out : null;
    if (night) renderNight(night); else { $("pSeat").innerHTML = ""; renderSetup(); }
    // A sync while someone is typing a chip count keeps their cursor in that box.
    if (typing) { const box = [...document.querySelectorAll("[data-out]")].find(x => x.dataset.out === typing); box?.focus(); }
    renderHistory();
  }
  render();
  if (cloudOff) setSync("ออฟไลน์ • เก็บในเครื่อง", "offline");
  else {
    syncNow();
    setInterval(() => { if (!document.hidden && !document.activeElement?.matches?.("[data-out]")) syncNow(); }, 4000);
    addEventListener("online", syncNow);
    if (dirty) queueSync();
  }
})();
