// ดัมมี่ออนไลน์ (dummy-online.html): rooms lobby, the table and the room's chip standings. The game and the room model are in
// dummy-game.js; rooms sync through the `dummy` column of the shared row under `online` (same rev lock as poker).
(() => {
  if (typeof document === "undefined" || !document.getElementById?.("dummyOnline")) return;
  const G = DummyGame, R = DummyRooms, $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // Results are play chips, not money: no baht, no who-pays-whom, no transfer buttons.
  const chips = (v, sign = false) => `${sign && v > 0 ? "+" : ""}${Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 })} ชิป`;
  const pts = (v, sign = true) => `${sign && v > 0 ? "+" : ""}${Number(v).toLocaleString("th-TH")}`;
  const KEY = "pp_dummy_online_v1", ROOM_KEY = "pp_dummy_online_room", Cloud = typeof LeagueShared !== "undefined" ? LeagueShared : null;
  let online = load(), dirty = (() => { try { return localStorage.getItem(KEY + "_dirty") === "1"; } catch { return false; } })();
  let syncing = false, syncTimer = 0, cloudOff = !Cloud;
  function load() { try { return R.normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return R.normalize(null); } }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(online)); localStorage.setItem(KEY + "_dirty", dirty ? "1" : "0"); } catch {} }
  function change(next) { online = next; dirty = true; store(); render(); queueSync(); }

  // ---- cloud ----
  function setSync(text, status = "") { const el = $("dmSync"); el.textContent = text; el.className = `pill sync ${status}`; }
  function queueSync() { if (cloudOff) return; setSync("กำลังบันทึก…"); clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 200); }
  async function syncNow() {
    if (cloudOff || syncing) return;
    syncing = true;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await Cloud.loadDummyCloud(), theirs = R.normalize(remote.online), merged = R.merge(online, theirs);
        if (R.same(merged, theirs)) { const changed = !R.same(online, merged); online = merged; dirty = false; store(); if (changed) render(); setSync("ออนไลน์ • ซิงก์แล้ว", "online"); return; }
        const rev = Math.max(0, Math.floor(Number(remote.rev) || 0));
        const saved = await Cloud.saveDummyCloud({ ...remote, online: merged, rev: rev + 1 }, rev);
        if (!saved) continue;
        // Anything added while saving is still in `online`; merging keeps it and the next round sends it.
        online = R.merge(online, saved.online); dirty = !R.same(online, saved.online);
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
  function toast(msg) { const el = $("dmToast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600); }

  // ---- who is here ----
  function league() { try { return Cloud?.readLocalLeague?.() || null; } catch { return null; } }
  function avatarFor(name) {
    const UI = window.LeagueUI, person = window.LeagueProfile?.payeeByName?.(league(), name);
    return UI?.avatar ? UI.avatar(person?.id || `guest:${name}`, name, "sm") : "";
  }
  // The signed-in player (league account on this phone), or null.
  function me() { try { const l = league(), id = l && Cloud.sessionUserId(l); return id ? R.cleanName(l.profiles[id]?.displayName) || null : null; } catch { return null; } }
  let roomId = (() => { try { return localStorage.getItem(ROOM_KEY) || ""; } catch { return ""; } })();
  function setRoom(id) { roomId = id || ""; sel.clear(); pickAt = null; try { if (roomId) localStorage.setItem(ROOM_KEY, roomId); else localStorage.removeItem(ROOM_KEY); } catch {} }
  const roomNow = () => (roomId && R.openRooms(online).find(r => r.id === roomId)) || null;
  const dayText = at => new Date(at).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });
  const roomName = r => r.name || `ห้อง ${dayText(r.createdAt)}`;

  // ---- cards ----
  const card = (c, { cls = "", data = "", on = false, dim = false } = {}) =>
    `<button type="button" class="dm-card${cls ? ` ${cls}` : ""}${on ? " dm-on" : ""}${dim ? " dm-dim" : ""}"${data} aria-label="${esc(G.speak(c))}" aria-pressed="${on}"><img src="${G.art(c)}" alt="" draggable="false" decoding="async"></button>`;
  const shown = c => `<span class="dm-card dm-static" role="img" aria-label="${esc(G.speak(c))}"><img src="${G.art(c)}" alt="" draggable="false" decoding="async"></span>`;
  const backs = n => `<span class="dm-backs" aria-label="${n} ใบ">${`<span class="dm-card dm-static dm-back"><img src="${G.BACK}" alt="" draggable="false" decoding="async"></span>`.repeat(Math.min(n, 11))}</span>`;

  // ---- this phone's picks at the table ----
  const sel = new Set();              // cards picked in my hand
  let pickAt = null, byRank = false;  // the discard pile card picked to เก็บ; hand order
  let tableKey = "";                  // resets picks when the table moves on
  const ORDER_KEY = "pp_dummy_online_order";
  try { byRank = localStorage.getItem(ORDER_KEY) === "rank"; } catch {}

  // ---- lobby ----
  function renderLobby() {
    const name = me(), rooms = R.openRooms(online);
    $("dmRooms").innerHTML = rooms.length ? rooms.map(r => {
      const v = R.view(r), mine = v.players.find(p => p.name === name), full = v.seated.length >= R.MAX_SEATS && !mine?.seated;
      const status = v.running ? `กำลังเล่นเกมที่ ${v.game.no}` : "รอเริ่มเกม";
      return `<div class="p-room" role="listitem"><div class="p-room-info"><b>${esc(roomName(r))}</b><small>${v.seated.length}/${R.MAX_SEATS} คนนั่ง • ${status} • ${esc(String(r.divisor))} แต้ม/ชิป${mine ? ` • คุณ ${esc(chips(mine.net, true))}` : ""}</small><span class="p-room-who">${v.seated.map(avatarFor).join("")}</span></div><button type="button" class="${full ? "secondary" : "primary"}" data-room="${esc(r.id)}">${mine?.seated ? "กลับเข้าห้อง" : full ? "ดูโต๊ะ" : "เข้าห้อง"}</button></div>`;
    }).join("") : '<div class="muted p-rooms-empty">ยังไม่มีห้องเปิดอยู่ • สร้างห้องด้านล่างได้เลย</div>';
    $("dmLogin").hidden = Boolean(name);
    $("dmCreate").disabled = !name;
  }
  $("dmRooms").addEventListener("click", e => {
    const b = e.target.closest("[data-room]"); if (!b) return;
    const room = R.openRooms(online).find(r => r.id === b.dataset.room); if (!room) return;
    setRoom(room.id);
    const name = me(), v = R.view(room);
    if (name && !v.seated.includes(name) && v.seated.length < R.MAX_SEATS && !v.running) change(R.join(online, room.id, name));
    else render();
    scrollTo({ top: 0, behavior: "smooth" });
  });
  $("dmCreate").addEventListener("click", () => {
    const name = me(); if (!name) return toast("เข้าสู่ระบบที่หน้าแรกก่อน");
    const divisor = Number($("dmDivisor").value) > 0 ? Number($("dmDivisor").value) : 10;
    const { state, id } = R.create(online, { name: $("dmRoomName").value, divisor, by: name });
    $("dmRoomName").value = "";
    setRoom(id); change(state); toast("สร้างห้องแล้ว • รอเพื่อนเข้าห้อง แล้วกดเริ่มเกม");
  });

  // ---- seat bar ----
  function renderSeat(v, name) {
    const bar = $("dmSeat"), lobby = '<button type="button" class="secondary" data-lobby>ห้องรวม</button>';
    if (!name) { bar.innerHTML = `<span class="muted">เข้าสู่ระบบที่หน้าแรกก่อนถึงจะนั่งเล่นได้</span>${lobby}`; return; }
    const mine = v.players.find(p => p.name === name), playing = v.running && v.game.seats.includes(name);
    if (mine?.seated) {
      bar.innerHTML = `<span class="p-seat-on">${avatarFor(name)}<b>${esc(name)}</b> นั่งอยู่ • ${mine.net > 0 ? "ได้" : mine.net < 0 ? "เสีย" : "เท่าทุน"} ${esc(chips(Math.abs(mine.net)))}</span>${playing ? "" : '<button type="button" class="secondary" data-leave>ลุกจากโต๊ะ</button>'}${lobby}`;
    } else {
      const canSit = v.seated.length < R.MAX_SEATS && !v.running;
      bar.innerHTML = `${canSit ? `<button type="button" class="primary p-join" data-sit>${mine ? "กลับมานั่ง" : "นั่งโต๊ะ"}</button>` : `<span class="muted">${v.running ? "รอจบเกมนี้ก่อนถึงจะนั่งได้" : "โต๊ะเต็มแล้ว"}</span>`}<span class="muted">${v.seated.length}/${R.MAX_SEATS} คนนั่ง</span>${lobby}`;
    }
  }
  $("dmSeat").addEventListener("click", e => {
    if (e.target.closest("[data-lobby]")) { setRoom(""); return render(); }
    const room = roomNow(), name = me(); if (!room || !name) return;
    if (e.target.closest("[data-sit]")) { change(R.join(online, room.id, name)); return toast("นั่งโต๊ะแล้ว • เกมต่อไปได้เล่นด้วย"); }
    if (e.target.closest("[data-leave]")) {
      if (!confirm("ลุกจากโต๊ะ? เกมต่อไปจะไม่ถูกแจก กลับมานั่งใหม่ได้")) return;
      change(R.leave(online, room.id, name)); toast("ลุกจากโต๊ะแล้ว");
    }
  });

  // ---- the table ----
  function renderTable(v, name) {
    const el = $("dmTable"), g = v.game;
    if (!g || !g.table) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    const t = g.table, over = t.over || g.done, turn = over ? null : t.seats[t.turn], mineSeat = t.seats.includes(name), myTurn = !over && turn === name;
    const key = `${g.id}:${t.turnNo}:${t.phase}:${t.pile.length}:${t.melds.length}`;
    if (key !== tableKey) { tableKey = key; sel.clear(); pickAt = null; }
    const hand = mineSeat ? G.sortHand(t.hands[name], byRank) : [];
    [...sel].forEach(c => { if (!hand.includes(c)) sel.delete(c); });
    const picked = [...sel];
    const order = mineSeat ? [...t.seats.slice(t.seats.indexOf(name) + 1), ...t.seats.slice(0, t.seats.indexOf(name))] : t.seats;
    const score = G.score(t);
    // Everyone else: name, cards left, points played so far.
    const opps = order.map(s => `<div class="dm-opp${s === turn ? " dm-turn" : ""}">${avatarFor(s)}<span class="dm-opp-who"><b>${esc(s)}</b><small>${over ? `เหลือ ${t.hands[s].length} ใบ` : `${t.hands[s].length} ใบ`} • ลง ${score[s].played}</small></span>${over ? `<span class="dm-opp-hand">${t.hands[s].map(shown).join("")}</span>` : backs(t.hands[s].length)}${s === turn ? '<span class="dm-turn-tag">ถึงตา</span>' : ""}</div>`).join("");
    // The discard pile, oldest first; tapping a card picks it and everything after it.
    const pile = t.pile.map((x, i) => card(x.c, { cls: `dm-pile-card${x.head ? " dm-head" : ""}`, data: ` data-pile="${i}"`, on: pickAt !== null && i >= pickAt })).join("");
    // Melds by owner; when one card is picked, the melds it could go on light up.
    const fits = picked.length === 1 && myTurn && t.phase === "play" ? new Set(G.fits(t, picked[0])) : new Set();
    const owners = t.seats.filter(s => t.melds.some(m => m.owner === s));
    const melds = owners.length ? owners.map(s => `<div class="dm-meld-row"><span class="dm-meld-owner">${esc(s)}</span><span class="dm-meld-list">${t.melds.filter(m => m.owner === s).map(m => `<button type="button" class="dm-meld${fits.has(m.id) ? " dm-fit" : ""}" data-meld="${m.id}" aria-label="ชุดของ ${esc(s)}">${m.cards.map(x => `<span class="dm-card dm-static${x.by !== m.owner ? " dm-laid" : ""}"><img src="${G.art(x.c)}" alt="${esc(G.label(x.c))}" draggable="false" decoding="async"></span>`).join("")}</button>`).join("")}</span></div>`).join("") : '<div class="muted dm-empty">ยังไม่มีใครลงไพ่</div>';
    const myHand = mineSeat ? `<div class="dm-hand${myTurn ? " dm-hand-turn" : ""}">${hand.map(c => card(c, { cls: `dm-hand-card${c === t.drawn ? " dm-new" : ""}`, data: ` data-card="${c}"`, on: sel.has(c) })).join("")}</div>` : "";
    el.innerHTML = `<div class="dm-top"><h2>เกมที่ ${g.no}</h2><span class="muted">กองจั่ว ${t.stock.length} ใบ${turn ? ` • ตาของ <b>${esc(turn)}</b>` : ""}</span><button type="button" class="primary dm-stage-open" data-stage-open>เปิดโหมดโต๊ะ</button></div>
<div class="dm-opps">${opps}</div>
<div class="dm-zone"><div class="dm-zone-head"><b>กองทิ้ง</b><small class="muted">${myTurn && t.phase === "draw" ? "แตะใบที่จะเก็บ (ได้ใบนั้นกับทุกใบทางขวา)" : `${t.pile.length} ใบ`}</small></div><div class="dm-pile">${pile || '<span class="muted">ว่าง</span>'}</div></div>
<div class="dm-zone"><div class="dm-zone-head"><b>ไพ่ที่ลงแล้ว</b></div><div class="dm-melds">${melds}</div></div>
${last(t)}
${over ? resultPanel(v, g, t, name) : mineSeat ? `<div class="dm-zone dm-mine"><div class="dm-zone-head"><b>ไพ่ของฉัน</b><button type="button" class="dm-sort" data-sort>${byRank ? "เรียงตามดอก" : "เรียงตามแต้ม"}</button></div>${myHand}${actions(t, name, picked)}</div>` : '<p class="muted">คุณดูอยู่ • ไม่ได้เล่นเกมนี้</p>'}`;
  }
  const verbs = { draw: "จั่ว", pick: "เก็บ", meld: "ลง", lay: "ฝาก", discard: "ทิ้ง" };
  function last(t) {
    const l = t.last; if (!l) return "";
    const what = l.a === "discard" || l.a === "lay" ? ` ${G.label(l.c)}` : l.a === "pick" ? ` ${G.label(l.c)}${l.count > 1 ? ` (+${l.count - 1} ใบ)` : ""}` : l.a === "meld" ? ` ${l.cards.length} ใบ` : "";
    return `<p class="dm-last muted">ล่าสุด: <b>${esc(l.by)}</b> ${verbs[l.a]}${esc(what)}</p>`;
  }
  // The buttons for my turn, each enabled only when the move would be allowed.
  function actions(t, name, picked) {
    if (t.seats[t.turn] !== name) return `<p class="dm-wait">รอ <b>${esc(t.seats[t.turn])}</b> เล่น</p>`;
    const ok = act => G.check(t, { by: name, ...act }) === null;
    if (t.phase === "draw") {
      const pickAct = pickAt !== null ? { a: "pick", i: pickAt, with: picked } : null;
      const hint = pickAt === null ? "จั่ว หรือแตะไพ่ในกองทิ้งที่จะเก็บ" : `เก็บ ${G.label(t.pile[pickAt].c)}${t.pile.length - pickAt > 1 ? ` กับอีก ${t.pile.length - pickAt - 1} ใบ` : ""} • เลือกไพ่ในมือที่จะลงคู่กัน`;
      return `<p class="dm-hint">${esc(hint)}</p><div class="dm-acts"><button type="button" class="${pickAt === null ? "primary" : "secondary"}" data-act="draw"${ok({ a: "draw" }) ? "" : " disabled"}>จั่ว</button>${pickAct ? `<button type="button" class="primary" data-act="pick"${ok(pickAct) ? "" : " disabled"}>เก็บแล้วลง</button>` : ""}</div>`;
    }
    const one = picked.length === 1 ? picked[0] : null, fits = one !== null ? G.fits(t, one) : [];
    const hint = !picked.length ? "เลือกไพ่ที่จะลง ฝาก หรือทิ้ง" : one !== null ? (fits.length && t.melds.some(m => m.owner === name) ? `แตะชุดที่ไฮไลต์เพื่อฝาก ${G.label(one)} หรือกดทิ้ง` : `ทิ้ง ${G.label(one)}?`) : `${picked.length} ใบ${G.meldKind(picked) ? " ลงเป็นชุดได้" : " ยังไม่เป็นชุด"}`;
    return `<p class="dm-hint">${esc(hint)}</p><div class="dm-acts"><button type="button" class="secondary" data-act="meld"${picked.length >= 3 && ok({ a: "meld", cards: picked }) ? "" : " disabled"}>ลง</button><button type="button" class="primary" data-act="discard"${one !== null && ok({ a: "discard", c: one }) ? "" : " disabled"}>ทิ้ง${one !== null ? ` ${esc(G.label(one))}` : ""}</button></div>`;
  }
  function resultPanel(v, g, t, name) {
    const sc = G.score(t), divisor = v.room.divisor, won = R.settle(g.seats.map(s => (g.scores || {})[s] ?? sc[s].total), divisor);
    const how = t.over?.reason === "knock" ? `${esc(t.over.knocker)} น็อค${t.over.dark ? "มืด" : ""}${t.over.color ? "สี" : ""}` : "กองจั่วหมด";
    const rows = g.seats.map((s, i) => ({ s, i, sc: sc[s] })).sort((a, b) => b.sc.total - a.sc.total).map(({ s, i, sc: x }) =>
      `<div class="dm-res-row${s === name ? " p-row-me" : ""}"><span class="dm-res-name">${avatarFor(s)}<b>${esc(s)}</b></span><small class="muted">ลง ${x.played} • ค้างมือ −${x.hand}${x.list.map(e => ` • ${esc(e.why)} ${pts(e.pts)}`).join("")}</small><b class="p-net ${x.total > 0 ? "pos" : x.total < 0 ? "neg" : ""}">${pts(x.total)}</b><b class="dm-res-baht ${won[i] > 0 ? "pos" : won[i] < 0 ? "neg" : ""}">${esc(chips(won[i], true))}</b></div>`).join("");
    const seated = v.seated.includes(name);
    return `<div class="dm-zone dm-result"><div class="dm-zone-head"><b>จบเกม • ${how}</b></div>${rows}${seated && v.seated.length >= 2 ? `<div class="actions"><button type="button" class="primary" data-start>เริ่มเกมต่อไป</button></div>` : ""}</div>`;
  }
  function onTableClick(e) {
    if (e.target.closest("[data-stage-close]")) return closeStage();
    if (e.target.closest("[data-stage-open]")) return openStage();
    const room = roomNow(), name = me(); if (!room || !name) return;
    const v = R.view(room), g = v.game, t = g?.table; if (!t) return;
    if (e.target.closest("[data-start]")) return startGame(room);
    if (e.target.closest("[data-sort]")) { byRank = !byRank; try { localStorage.setItem(ORDER_KEY, byRank ? "rank" : "suit"); } catch {} return render(); }
    const myTurn = !t.over && t.seats[t.turn] === name;
    const handCard = e.target.closest("[data-card]");
    if (handCard) { const c = Number(handCard.dataset.card); if (sel.has(c)) sel.delete(c); else sel.add(c); return render(); }
    const pileCard = e.target.closest("[data-pile]");
    if (pileCard) {
      if (!myTurn || t.phase !== "draw") return toast(myTurn ? "เก็บได้แค่ตอนต้นตา ก่อนจั่ว" : "ยังไม่ถึงตาคุณ");
      const i = Number(pileCard.dataset.pile); pickAt = pickAt === i ? null : i; return render();
    }
    const meld = e.target.closest("[data-meld]");
    if (meld) {
      if (!myTurn || t.phase !== "play" || sel.size !== 1) return toast(myTurn ? "เลือกไพ่ในมือ 1 ใบ แล้วแตะชุดที่จะฝาก" : "ยังไม่ถึงตาคุณ");
      return play(room, g, t, name, { a: "lay", c: [...sel][0], m: Number(meld.dataset.meld) });
    }
    const btn = e.target.closest("[data-act]"); if (!btn || !myTurn) return;
    const picked = [...sel];
    if (btn.dataset.act === "draw") return play(room, g, t, name, { a: "draw" });
    if (btn.dataset.act === "pick") return play(room, g, t, name, { a: "pick", i: pickAt, with: picked });
    if (btn.dataset.act === "meld") return play(room, g, t, name, { a: "meld", cards: picked });
    if (btn.dataset.act === "discard") return play(room, g, t, name, { a: "discard", c: picked[0] });
  }
  $("dmTable").addEventListener("click", onTableClick);
  function play(room, g, t, name, act) {
    const why = G.check(t, { by: name, ...act });
    if (why) return toast(why);
    if (act.a === "discard" && t.hands[name].length === 1) toast("น็อค!");
    sel.clear(); pickAt = null;
    change(R.move(online, room.id, g.id, { by: name, ...act }));
  }
  function startGame(room) {
    const v = R.view(room), name = me();
    if (!name || !v.seated.includes(name)) return toast("นั่งโต๊ะก่อนถึงจะเริ่มเกมได้");
    if (v.running) return toast("เกมนี้ยังไม่จบ");
    if (v.seated.length < 2) return toast("ต้องมีคนนั่งอย่างน้อย 2 คน");
    sel.clear(); pickAt = null;
    change(R.start(online, room.id)); toast(`แจกไพ่แล้ว • เกมที่ ${v.games.length + 1}`);
    openStage();
  }

  // ---- โหมดโต๊ะ: a full-screen landscape table (poker.css .pt-root turns it sideways on a phone held upright).
  // Opponents sit around a felt oval, the stock, discard pile and melds are in the middle, my hand and the buttons
  // along the bottom. Same picks and moves as the card above (onTableClick). ----
  let stage = null;
  function openStage() {
    const room = roomNow(); if (!room || !R.view(room).game?.table) return;
    if (!stage) {
      stage = document.createElement("div"); stage.className = "pt-root dm-stage-root";
      stage.setAttribute("role", "dialog"); stage.setAttribute("aria-modal", "true"); stage.setAttribute("aria-label", "โต๊ะดัมมี่");
      document.body.appendChild(stage); stage.addEventListener("click", onTableClick);
      // The phone's back button leaves the table instead of the page.
      try { history.pushState({ dummyTable: 1 }, ""); } catch {}
    }
    document.body.classList.add("pt-open");
    landscape(); render();
  }
  function closeStage(fromHistory = false) {
    if (!stage) return;
    stage.remove(); stage = null; document.body.classList.remove("pt-open");
    try { screen.orientation?.unlock?.(); } catch {}
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
    if (!fromHistory && history.state?.dummyTable) history.back();
  }
  addEventListener("popstate", () => { if (stage) closeStage(true); });
  document.addEventListener("keydown", e => { if (stage && e.key === "Escape") closeStage(); });
  // Android: fullscreen, then lock to landscape (both need the tap that opened the table). Elsewhere CSS rotates.
  async function landscape() {
    try {
      if (!matchMedia("(pointer:coarse)").matches || !document.documentElement.requestFullscreen) return;
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await screen.orientation?.lock?.("landscape");
    } catch {}
  }
  // Where the others sit, in turn order after me: one across, two left and right, three left, across, right.
  const SPOTS = { 1: ["top"], 2: ["left", "right"], 3: ["left", "top", "right"] };
  function renderStage(v, name) {
    if (!stage) return;
    const g = v.game, t = g?.table;
    if (!t) return closeStage();
    const over = t.over || g.done, turn = over ? null : t.seats[t.turn], mineSeat = t.seats.includes(name), myTurn = !over && turn === name;
    const others = mineSeat ? [...t.seats.slice(t.seats.indexOf(name) + 1), ...t.seats.slice(0, t.seats.indexOf(name))] : t.seats;
    const score = G.score(t), spots = SPOTS[others.length] || ["left", "top", "right", "top"];
    const seat = (s, spot) => `<div class="dm-st-seat dm-at-${spot}${s === turn ? " dm-turn" : ""}">${avatarFor(s)}<span class="dm-st-who"><b>${esc(s)}</b><small>${t.hands[s].length} ใบ • ลง ${score[s].played}</small></span>${backs(t.hands[s].length)}${s === turn ? '<span class="dm-turn-tag">ถึงตา</span>' : ""}</div>`;
    const hand = mineSeat ? G.sortHand(t.hands[name], byRank) : [], picked = [...sel];
    const fits = picked.length === 1 && myTurn && t.phase === "play" ? new Set(G.fits(t, picked[0])) : new Set();
    const pile = t.pile.map((x, i) => card(x.c, { cls: `dm-pile-card${x.head ? " dm-head" : ""}`, data: ` data-pile="${i}"`, on: pickAt !== null && i >= pickAt })).join("");
    const melds = t.melds.map(m => `<button type="button" class="dm-meld${fits.has(m.id) ? " dm-fit" : ""}" data-meld="${m.id}" aria-label="ชุดของ ${esc(m.owner)}"><i class="dm-meld-tag">${esc(m.owner)}</i>${m.cards.map(x => `<span class="dm-card dm-static${x.by !== m.owner ? " dm-laid" : ""}"><img src="${G.art(x.c)}" alt="${esc(G.label(x.c))}" draggable="false" decoding="async"></span>`).join("")}</button>`).join("");
    const status = over ? "จบเกม" : myTurn ? (t.phase === "draw" ? "ถึงตาคุณ • จั่วหรือเก็บ" : "ถึงตาคุณ • ลง ฝาก แล้วทิ้ง") : `ตาของ ${esc(turn)}`;
    const bottom = !mineSeat ? '<p class="dm-wait">คุณดูอยู่ • ไม่ได้เล่นเกมนี้</p>'
      : `<div class="dm-st-hand">${hand.map(c => card(c, { cls: `dm-hand-card${c === t.drawn ? " dm-new" : ""}`, data: ` data-card="${c}"`, on: sel.has(c) })).join("")}</div><div class="dm-st-acts">${over ? "" : actions(t, name, picked)}<button type="button" class="dm-sort" data-sort>${byRank ? "เรียงตามดอก" : "เรียงตามแต้ม"}</button></div>`;
    stage.innerHTML = `<div class="pt-stage dm-stage"><header class="dm-st-top"><span>เกมที่ ${g.no} • <b class="${myTurn ? "dm-st-mine" : ""}">${status}</b></span><span class="dm-st-last">${last(t).replace(/<\/?p[^>]*>/g, "")}</span><button type="button" class="pt-exit" data-stage-close aria-label="ออกจากโหมดโต๊ะ">ออก</button></header>
<div class="dm-st-mid"><div class="pt-felt"></div>${others.map((s, i) => seat(s, spots[i])).join("")}
<div class="dm-st-center"><div class="dm-st-row"><span class="dm-st-deck">${t.stock.length ? `<span class="dm-card dm-static dm-back"><img src="${G.BACK}" alt="" draggable="false"></span>` : ""}<small>จั่ว ${t.stock.length}</small></span><div class="dm-pile dm-st-pile">${pile || '<span class="dm-st-empty">กองทิ้งว่าง</span>'}</div></div><div class="dm-st-melds">${melds || '<span class="dm-st-empty">ยังไม่มีใครลงไพ่</span>'}</div></div></div>
<div class="dm-st-bottom">${bottom}</div>
${over ? `<div class="dm-st-over">${resultPanel(v, g, t, name)}</div>` : ""}</div>`;
  }

  // ---- the room: points and chips so far ----
  function renderRoom(v, name) {
    $("dmRoomTitle").textContent = roomName(v.room);
    $("dmMeta").textContent = `${v.seated.length}/${R.MAX_SEATS} คนนั่ง • เล่นไป ${v.games.length} เกม • ${v.room.divisor} แต้มต่อ 1 ชิป`;
    $("dmPlayers").innerHTML = v.players.length ? v.players.slice().sort((a, b) => b.net - a.net || b.points - a.points).map(p => `<div class="p-row${p.name === name ? " p-row-me" : ""}${p.seated ? "" : " p-left"}"><div class="p-row-head">${avatarFor(p.name)}<div class="d-board-name"><b>${esc(p.name)}</b><small>${p.seated ? "นั่งอยู่" : "ลุกแล้ว"} • ${p.games} เกม • แต้มรวม ${pts(p.points)}</small></div><b class="p-net ${p.net > 0 ? "pos" : p.net < 0 ? "neg" : ""}">${esc(chips(p.net, true))}</b></div></div>`).join("") : '<div class="muted">ยังไม่มีใครนั่ง</div>';
    $("dmPayCopy").hidden = !v.games.length;
    const seated = name && v.seated.includes(name), playing = v.running && v.game.seats.includes(name);
    const acts = [];
    if (!v.running && seated && !(v.game?.table && v.game.done)) acts.push(`<button type="button" class="primary" data-start${v.seated.length < 2 ? " disabled" : ""}>${v.seated.length < 2 ? "รอเพื่อนนั่งอีกคน" : `เริ่มเกม • แจกไพ่ ${v.seated.length} คน`}</button>`);
    if (playing) acts.push('<button type="button" class="secondary" data-abort>ยกเลิกเกมนี้</button>');
    if (!v.running) acts.push('<button type="button" class="secondary" data-close>ปิดห้อง • เก็บเข้าประวัติ</button>');
    $("dmRoomActs").innerHTML = acts.join("");
  }
  $("dmRoomActs").addEventListener("click", e => {
    const room = roomNow(); if (!room) return;
    if (e.target.closest("[data-start]")) return startGame(room);
    const v = R.view(room);
    if (e.target.closest("[data-abort]") && v.running) {
      if (!confirm("ยกเลิกเกมนี้? เกมนี้จะไม่นับแต้ม")) return;
      change(R.abort(online, room.id, v.game.id)); return toast("ยกเลิกเกมแล้ว");
    }
    if (e.target.closest("[data-close]") && !v.running) {
      if (!confirm("ปิดห้องนี้แล้วเก็บผลเข้าประวัติ? ทุกคนจะออกจากห้อง")) return;
      change(R.close(online, room.id)); setRoom(""); render(); toast("ปิดห้องแล้ว • ดูสรุปในประวัติ");
    }
  });
  async function copyText(text) { try { await navigator.clipboard.writeText(text); toast("คัดลอกแล้ว วางในไลน์ได้เลย"); } catch { prompt("คัดลอกข้อความนี้", text); } }
  const lineText = room => {
    const v = R.view(room);
    return [`🃏 สรุปดัมมี่ ${dayText(room.createdAt)}${room.name ? ` • ${room.name}` : ""} (${v.games.length} เกม)`, ...v.players.slice().sort((a, b) => b.net - a.net).map((p, i) => `${i + 1}. ${p.name} ${chips(p.net, true)} (${pts(p.points)} แต้ม)`)].join("\n");
  };
  $("dmPayCopy").addEventListener("click", () => { const room = roomNow(); if (room) copyText(lineText(room)); });

  // ---- history ----
  function renderHistory() {
    const list = R.history(online).filter(r => R.view(r).games.length);
    $("dmHistCard").hidden = !list.length;
    $("dmHist").innerHTML = list.map((room, i) => {
      const v = R.view(room);
      const rows = v.players.slice().sort((a, b) => b.net - a.net).map(p => `<span class="${p.net > 0 ? "pos" : p.net < 0 ? "neg" : ""}">${esc(p.name)} ${esc(chips(p.net, true))}</span>`).join("");
      return `<details class="d-day"${i === 0 ? " open" : ""}><summary><b>${esc(dayText(room.createdAt))}</b><span class="muted">${esc(room.name ? `${room.name} • ` : "")}${v.players.length} คน • ${v.games.length} เกม</span></summary><div class="d-preview-list">${rows}</div><button type="button" class="secondary" data-copy-room="${esc(room.id)}">คัดลอกไปส่งในไลน์</button></details>`;
    }).join("");
  }
  $("dmHist").addEventListener("click", e => {
    const b = e.target.closest("[data-copy-room]"); if (!b) return;
    const room = R.normalize(online).rooms[b.dataset.copyRoom]; if (room) copyText(lineText(room));
  });

  // A finished game's result goes into the row once (by a phone that played it), so its moves can be dropped later.
  const written = new Set();
  function render() {
    const room = roomNow(), name = me();
    $("dmLobby").hidden = Boolean(room); $("dmRoom").hidden = !room;
    if (!room) { $("dmSeat").innerHTML = ""; $("dmTable").hidden = true; closeStage(); renderLobby(); renderHistory(); return; }
    const v = R.view(room);
    renderSeat(v, name); renderTable(v, name); renderRoom(v, name); renderHistory(); renderStage(v, name);
    const done = v.needsResult;
    if (done && name && done.seats.includes(name) && !written.has(done.id)) { written.add(done.id); change(R.result(online, room.id, done.id, done.scores)); }
  }

  render();
  if (cloudOff) setSync("ออฟไลน์ • เก็บในเครื่อง", "offline");
  else {
    syncNow();
    // Every 2 s while at a table (someone may be waiting on your move), otherwise every 6 s.
    let lastPoll = 0;
    setInterval(() => { const gap = roomNow() ? 2000 : 6000; if (document.hidden || Date.now() - lastPoll < gap || document.activeElement?.matches?.("input")) return; lastPoll = Date.now(); syncNow(); }, 500);
    addEventListener("online", syncNow);
    if (dirty) queueSync();
  }
})();
