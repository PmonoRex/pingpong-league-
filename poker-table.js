// โหมดโต๊ะ (poker.html): the seated player's full-screen, landscape view of the table. A felt oval with the board
// and pot in the middle, every player in their seat around it (you at the bottom), bets in front of the seats and the
// action buttons in the corner. It reads the shared state through window.PokerTable (poker.js) and your private
// hole cards through window.PokerMine (poker-cards.js), and redraws on their events. On phones held upright it turns
// itself sideways with CSS when the screen cannot be locked to landscape (iPhone).
(() => {
  if (typeof document === "undefined" || !document.getElementById?.("pokerApp")) return;
  const C = PokerCards, $ = sel => root?.querySelector(sel);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = v => Number(v || 0).toLocaleString("th-TH");
  let root = null, picking = null, raise = { key: "", to: 0 }, odds = { key: "", html: "" }, keypad = null, settling = false;
  const table = () => { try { return window.PokerTable?.get() || null; } catch { return null; } };
  const mineOf = t => t.app ? (t.myCards ? t.myCards.slice() : [null, null]) : (window.PokerMine?.get(t) || [null, null]);
  const avatar = name => window.LeagueUI?.avatar ? window.LeagueUI.avatar(window.LeagueProfile?.payeeByName?.(LeagueShared.readLocalLeague(), name)?.id || `guest:${name}`, name, "") : "";
  const cardImg = (c, cls = "") => `<span class="pt-card ${cls}" role="img" aria-label="${C.speak(c)}"><img src="${C.art(c)}" alt="" draggable="false" decoding="async"></span>`;
  const back = (cls = "") => `<span class="pt-card ${cls}" aria-hidden="true"><img src="${C.BACK}" alt="" draggable="false" decoding="async"></span>`;
  const slot = (attrs, label, cls = "") => `<button type="button" class="pt-card pt-slot ${cls}" ${attrs} aria-label="${label}">+</button>`;

  function open() {
    if (!table()) return;
    if (!root) {
      root = document.createElement("div"); root.className = "pt-root";
      root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "โต๊ะโป๊กเกอร์");
      document.body.appendChild(root); root.addEventListener("click", onClick);
      // The phone's back button leaves the table instead of the page.
      try { history.pushState({ pokerTable: 1 }, ""); } catch {}
    }
    document.body.classList.add("pt-open");
    landscape(); render();
  }
  function close(fromHistory = false) {
    if (!root) return;
    root.remove(); root = null; picking = null; document.body.classList.remove("pt-open");
    try { screen.orientation?.unlock?.(); } catch {}
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
    if (!fromHistory && history.state?.pokerTable) history.back();
  }
  addEventListener("popstate", () => { if (root) close(true); });
  document.addEventListener("keydown", e => {
    if (!root) return;
    // A hardware keyboard works on the pad too.
    if (keypad && /^[0-9]$/.test(e.key)) { keypad.value = (keypad.value + e.key).replace(/^0+/, "").slice(0, 7); return render(); }
    if (keypad && e.key === "Backspace") { keypad.value = keypad.value.slice(0, -1); return render(); }
    if (e.key === "Escape") { if (keypad) keypad = null; else if (picking) picking = null; else return close(); render(); }
  });
  // Android: fullscreen, then lock to landscape (both need the tap that opened the table). Elsewhere CSS rotates.
  async function landscape() {
    try {
      if (!matchMedia("(pointer:coarse)").matches || !document.documentElement.requestFullscreen) return;
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      await screen.orientation?.lock?.("landscape");
    } catch {}
  }

  // Everyone at the table in seat order, starting with me (so I sit at the bottom).
  function seatsFrom(t) {
    const order = t.bet ? [...t.bet.players.map(p => p.name), ...t.players.filter(n => !t.bet.players.some(p => p.name === n))] : t.players.slice();
    const i = Math.max(0, order.indexOf(t.me));
    return [...order.slice(i), ...order.slice(0, i)];
  }
  function render() {
    if (!root) return;
    const t = table(); if (!t) return close();
    const bet = t.bet, mine = mineOf(t), seats = seatsFrom(t), n = seats.length;
    const inHand = name => bet?.players.find(p => p.name === name) || null;
    const folded = name => t.hand.folded.includes(name) || inHand(name)?.folded;
    const seatsHtml = seats.map((name, i) => {
      const a = (90 + i * 360 / n) * Math.PI / 180, x = 50 + 45 * Math.cos(a), y = 50 + 41 * Math.sin(a);
      const bx = 50 + 27 * Math.cos(a), by = 50 + 25 * Math.sin(a);
      const p = inHand(name), me = name === t.me, turn = bet?.toAct === name, out = folded(name);
      const shown = t.hand.shown[name];
      let cards = "";
      if (me && t.app) cards = out ? "" : mine.map(c => c === null ? back("pt-mine") : cardImg(c, "pt-mine")).join("");
      else if (me) cards = mine.map((c, k) => c === null ? (out ? "" : slot(`data-pick="mine:${k}"`, `เลือกไพ่ในมือใบที่ ${k + 1}`, "pt-mine")) : `<button type="button" class="pt-cardbtn" data-pick="mine:${k}" aria-label="ไพ่ในมือ: ${C.speak(c)} (แตะเพื่อเปลี่ยน)"${window.PokerMine?.locked(t) ? " disabled" : ""}>${cardImg(c, "pt-mine")}</button>`).join("");
      else if (shown) cards = shown.map(c => cardImg(c)).join("");
      else if (!out && (!bet || p)) cards = back() + back();
      const tags = bet ? [name === bet.button ? '<i class="pt-tag pt-d">D</i>' : "", name === bet.sbName ? '<i class="pt-tag">SB</i>' : "", name === bet.bbName ? '<i class="pt-tag">BB</i>' : ""].join("") : "";
      const state = out ? "หมอบ" : p?.allIn ? "ออลอิน" : turn ? "ถึงตา" : "";
      const chips = p && p.streetBet ? `<div class="pt-bet" style="left:${bx}%;top:${by}%"><i></i>${num(p.streetBet)}</div>` : "";
      return `${chips}<div class="pt-seat${me ? " pt-me" : ""}${y < 45 ? " pt-upper" : ""}${turn ? " pt-turn" : ""}${out ? " pt-out" : ""}" style="left:${x}%;top:${y}%"><div class="pt-cards">${cards}</div><div class="pt-plate">${avatar(name)}<span class="pt-who"><b>${esc(name)}</b><small>${num(t.stacks[name])}</small></span>${tags}</div>${state ? `<span class="pt-state">${state}</span>` : ""}</div>`;
    }).join("");
    const board = t.hand.board.map((c, i) => t.app ? (c === null ? '<span class="pt-card pt-slot pt-wait" aria-hidden="true"></span>' : cardImg(c)) : c === null ? slot(`data-pick="board:${i}"`, `ไพ่กองกลางใบที่ ${i + 1}`) : `<button type="button" class="pt-cardbtn" data-pick="board:${i}" aria-label="กองกลาง: ${C.speak(c)} (แตะเพื่อเปลี่ยน)">${cardImg(c)}</button>`).join("");
    const center = `<div class="pt-center"><div class="pt-pot">${bet ? `<small>${esc(bet.streetName)}</small>กอง <b>${num(bet.pot)}</b>` : `<small>บลายด์ ${num(t.sb)}/${num(t.bb)}</small>ยังไม่เริ่มตา`}</div><div class="pt-board">${board}</div>${centerNote(t)}</div>`;
    root.innerHTML = `<div class="pt-stage"><header class="pt-top"><span>ตาที่ ${t.hand.no}${t.app ? ` • <i class="pt-modeflag">${t.server ? "เซิร์ฟเวอร์แจก" : "แจกในแอป"}</i>` : ""}</span><span class="pt-myhand">${myHand(t, mine)}</span>${t.settle ? '<button type="button" class="pt-exit pt-settle-btn" data-act="settle">ใครจ่ายใคร</button>' : ""}<button type="button" class="pt-exit" data-act="exit" aria-label="ออกจากโหมดโต๊ะ">ออก</button></header>
<div class="pt-table"><div class="pt-felt"></div>${center}${seatsHtml}</div><div class="pt-bar">${actions(t, mine)}</div>${picking ? picker(t, mine) : ""}${keypad ? pad(t) : ""}${settling ? settlePanel(t) : ""}</div>`;
  }
  function centerNote(t) {
    const bet = t.bet;
    if (!bet || bet.street < 4) return "";
    let html = "";
    bet.pots.forEach((pot, k) => {
      const label = bet.pots.length > 1 ? (k ? `กองข้าง ${k}` : "กองกลาง") : "กอง";
      if (pot.winners) html += `<div class="pt-won">${esc(pot.winners.join(", "))} ได้${label} ${num(pot.amount)}${pot.hand ? ` • ${esc(pot.hand)}` : ""}</div>`;
      else html += `<div class="pt-award"><span>${label} ${num(pot.amount)} • ใครชนะ?</span><span>${pot.eligible.map(nm => `<button type="button" class="pt-chip" data-win="${k}" data-name="${esc(nm)}" aria-pressed="false">${esc(nm)}</button>`).join("")}<button type="button" class="pt-go" data-award="${k}">ให้กอง</button></span></div>`;
    });
    return `<div class="pt-showdown">${html}</div>`;
  }
  // My best hand and (while the hand is open) my chance against the players still in it.
  function myHand(t, mine) {
    const cards = mine.filter(c => c !== null); if (cards.length < 2) return "";
    const board = []; for (const c of t.hand.board) { if (c === null) break; board.push(c); }
    const label = C.name(C.evaluate(cards.concat(board)));
    if (t.hand.folded.includes(t.me) || t.bet?.players.find(p => p.name === t.me)?.folded) return `<b>${esc(label)}</b>`;
    const others = (t.bet ? t.bet.players.filter(p => !p.folded).map(p => p.name) : t.players).filter(n => n !== t.me && !t.hand.folded.includes(n));
    if (!others.length) return `<b>${esc(label)}</b>`;
    const key = JSON.stringify([cards, board, others.map(n => t.hand.shown[n] || [])]);
    if (odds.key !== key) {
      const r = C.odds(board, [cards, ...others.map(n => t.hand.shown[n] || [])], { iterations: 2000 })[0];
      odds = { key, html: ` • ชนะ ${Math.round(r.win * 100)}%` };
    }
    return `<b>${esc(label)}</b>${odds.html}`;
  }
  function actions(t, mine) {
    const bet = t.bet, meIn = bet?.players.find(p => p.name === t.me);
    const reveal = mine.every(c => c !== null) && !t.hand.shown[t.me] && !t.hand.folded.includes(t.me) && !meIn?.folded
      ? '<button type="button" class="pt-btn" data-act="show">เปิดไพ่</button>' : "";
    if (!bet || bet.done) return `<span class="pt-msg">${bet?.done ? resultLine(bet) : t.mode === "app" ? "กดแจกไพ่ แอปจะสับและแจกให้ทุกคน" : t.mode === "server" ? "กดแจกไพ่ เซิร์ฟเวอร์จะสับและแจกให้ทุกคน" : "แตะ + บนโต๊ะเพื่อเลือกไพ่ได้"}</span>${reveal}${t.canDeal ? `<button type="button" class="pt-btn pt-primary" data-act="deal">แจกไพ่ตาใหม่</button>` : ""}`;
    if (bet.street >= 4) return `<span class="pt-msg">โชว์ไพ่ • เลือกคนชนะกลางโต๊ะ หรือทุกคนเปิดไพ่ให้ระบบตัดสิน</span>${reveal}`;
    if (bet.toAct !== t.me) return `<span class="pt-msg">${meIn && !meIn.folded ? "รอ " : ""}<b>${esc(bet.toAct || "")}</b> กำลังตัดสินใจ</span>${reveal}`;
    const key = `${t.handKey}:${bet.street}:${bet.currentBet}`;
    if (raise.key !== key) raise = { key, to: bet.minTo };
    const canRaise = bet.maxTo > bet.currentBet;
    const allInCall = bet.toCall >= (meIn?.stack ?? 0);
    const quick = (to, text) => `<button type="button" class="pt-chip" data-to="${to}">${text}</button>`;
    const potTo = share => Math.max(bet.minTo, Math.min(bet.maxTo, bet.currentBet + Math.round((bet.pot + bet.toCall) * share)));
    return `<button type="button" class="pt-btn" data-act="fold">หมอบ</button>${bet.toCall ? `<button type="button" class="pt-btn pt-primary" data-act="call">${allInCall ? "คอล ออลอิน" : "คอล"} ${num(bet.toCall)}</button>` : '<button type="button" class="pt-btn pt-primary" data-act="check">เช็ค</button>'}`
      + (canRaise ? `<span class="pt-raise"><button type="button" class="pt-step" data-step="-1" aria-label="ลด">−</button><button type="button" class="pt-amount" data-act="keypad" aria-label="พิมพ์ยอดเอง: ${num(raise.to)}">${num(raise.to)}</button><button type="button" class="pt-step" data-step="1" aria-label="เพิ่ม">+</button><button type="button" class="pt-btn pt-raise-go" data-act="raise">${bet.currentBet ? "เรส" : "เบท"}</button></span><span class="pt-quick">${quick(bet.minTo, "ขั้นต่ำ")}${quick(potTo(.5), "½ กอง")}${quick(potTo(1), "กอง")}${quick(bet.maxTo, "ออลอิน")}</span>` : "");
  }
  const resultLine = bet => bet.players.map(p => { const d = bet.delta[p.name] || 0; return `<span class="${d > 0 ? "pos" : d < 0 ? "neg" : ""}">${esc(p.name)} ${d > 0 ? "+" : ""}${num(d)}</span>`; }).join(" ");
  // Your own bet: an on-screen number pad (the phone keyboard would come up sideways on a turned stage).
  function pad(t) {
    const bet = t.bet;
    if (!bet || bet.toAct !== t.me || bet.maxTo <= bet.currentBet) { keypad = null; return ""; }
    const value = Number(keypad.value || 0), allIn = value >= bet.maxTo, ok = value >= bet.minTo || allIn;
    const to = Math.min(value, bet.maxTo), verb = bet.currentBet ? "เรสเป็น" : "เบท";
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
    return `<div class="pt-picker pt-pad" role="dialog" aria-label="พิมพ์ยอด"><div class="pt-pick-head"><b>${verb}เท่าไหร่?</b><span><button type="button" class="pt-chip" data-act="pad-close">ปิด</button></span></div>
<div class="pt-pad-show"><b aria-live="polite">${keypad.value ? num(value) : "0"}</b><small>ขั้นต่ำ ${num(bet.minTo)} • มีอยู่ ${num(bet.maxTo)}${allIn && value ? " • ออลอิน" : ""}</small></div>
<div class="pt-pad-keys">${keys.map(k => `<button type="button" class="pt-key" data-key="${k}" aria-label="${k === "C" ? "ล้าง" : k === "⌫" ? "ลบ" : k}">${k === "C" ? "ล้าง" : k}</button>`).join("")}</div>
<button type="button" class="pt-btn pt-primary pt-pad-go" data-act="pad-go"${ok && value ? "" : " disabled"}>${ok && value ? `${allIn ? "ออลอิน" : verb} ${num(to)}` : `อย่างน้อย ${num(bet.minTo)}`}</button></div>`;
  }
  // ใครจ่ายใคร ถ้าเลิกตอนนี้ (PokerNight.liveSettle): each player's money now and the fewest transfers.
  function settlePanel(t) {
    const live = t.settle; if (!live) { settling = false; return ""; }
    const baht = v => `${v > 0 ? "+" : ""}${Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 })}฿`;
    const nets = live.rows.map(r => `<span class="${r.net > 0 ? "pos" : r.net < 0 ? "neg" : ""}">${esc(r.name)} ${baht(r.net)}</span>`).join("");
    const lines = live.transfers.length ? live.transfers.map(l => `<div class="pt-pay-row"><b>${esc(l.from)}</b><span>จ่าย ➜</span><b>${esc(l.to)}</b><b class="pt-pay-amt">${baht(l.amount).replace("+", "")}</b>${window.LeagueProfile?.openPay ? `<button type="button" class="pt-chip" data-pay="${esc(l.to)}" data-from="${esc(l.from)}" data-amount="${l.amount}">โอน</button>` : ""}</div>`).join("") : '<div class="pt-msg">ยังเท่าทุนกันหมด</div>';
    return `<div class="pt-picker pt-settle" role="dialog" aria-label="ใครจ่ายใคร"><div class="pt-pick-head"><b>ใครจ่ายใคร <small>ถ้าเลิกตอนนี้</small></b><span><button type="button" class="pt-chip" data-act="settle-close">ปิด</button></span></div><div class="pt-settle-nets">${nets}</div>${lines}<small class="pt-settle-note">คิดจากชิปบนโต๊ะ ÷ ${esc(String(t.rate))} ชิปต่อบาท ลบเงินที่ซื้อ${live.pending ? " • ตาที่กำลังเล่นยังไม่นับ" : ""}</small></div>`;
  }
  function picker(t, mine) {
    const used = new Set([...t.hand.board, ...mine, ...Object.values(t.hand.shown).flat()].filter(c => c !== null));
    const [group, i] = picking.split(":"), current = group === "board" ? t.hand.board[i] : mine[i];
    const title = group === "board" ? ["ฟล็อป 1", "ฟล็อป 2", "ฟล็อป 3", "เทิร์น", "ริเวอร์"][i] + " (ทั้งโต๊ะเห็น)" : `ไพ่ในมือใบที่ ${Number(i) + 1} (เห็นแค่คุณ)`;
    return `<div class="pt-picker" role="dialog" aria-label="เลือกไพ่"><div class="pt-pick-head"><b>${title}</b><span>${current !== null && current !== undefined ? '<button type="button" class="pt-chip" data-act="clear">เอาออก</button>' : ""}<button type="button" class="pt-chip" data-act="unpick">ปิด</button></span></div>`
      + [0, 1, 2, 3].map(s => `<div class="pt-pick-row">${[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(r => { const c = r * 4 + s; return `<button type="button" class="pt-pick${C.red(c) ? " pt-red" : ""}" data-card="${c}" aria-label="${C.speak(c)}"${used.has(c) && c !== current ? " disabled" : ""}>${C.RANKS[r]}<i>${C.SUITS[s]}</i></button>`; }).join("")}</div>`).join("") + "</div>";
  }

  function onClick(e) {
    const t = table(); if (!t) return close();
    const el = sel => e.target.closest(sel);
    if (el('[data-act="exit"]')) return close();
    if (el('[data-act="settle"]')) { settling = !settling; picking = null; keypad = null; return render(); }
    if (el('[data-act="settle-close"]')) { settling = false; return render(); }
    // โอน: the QR sheet lives on the page, so leave the table first.
    const pay = el("[data-pay]");
    if (pay) { const args = { toName: pay.dataset.pay, fromName: pay.dataset.from, amount: Number(pay.dataset.amount) }; settling = false; close(); return window.LeagueProfile?.openPay(args); }
    const pick = el("[data-pick]"); if (pick && !t.app) { picking = picking === pick.dataset.pick ? null : pick.dataset.pick; return render(); }
    const card = el("[data-card]");
    if (card && picking) {
      const [group, i] = picking.split(":"), c = Number(card.dataset.card);
      if (group === "board") window.PokerTable.setBoard(Number(i), c); else window.PokerMine?.set(t, Number(i), c);
      // Move on to the next empty slot of the same row (flop → turn → river, first card → second).
      const t2 = table(), arr = group === "board" ? t2.hand.board : mineOf(t2), next = arr.findIndex((x, k) => k > Number(i) && x === null);
      picking = next >= 0 ? `${group}:${next}` : null; return render();
    }
    if (el('[data-act="clear"]') && picking) { const [group, i] = picking.split(":"); if (group === "board") window.PokerTable.setBoard(Number(i), null); else window.PokerMine?.set(t, Number(i), null); return render(); }
    if (el('[data-act="unpick"]')) { picking = null; return render(); }
    if (el('[data-act="keypad"]')) { keypad = { value: "" }; return render(); }
    if (el('[data-act="pad-close"]')) { keypad = null; return render(); }
    const key = el("[data-key]");
    if (key && keypad) { const k = key.dataset.key; keypad.value = k === "C" ? "" : k === "⌫" ? keypad.value.slice(0, -1) : (keypad.value + k).replace(/^0+/, "").slice(0, 7); return render(); }
    if (el('[data-act="pad-go"]') && keypad && t.bet) {
      const to = Math.min(Number(keypad.value || 0), t.bet.maxTo); keypad = null;
      if (to >= t.bet.minTo || to === t.bet.maxTo) { raise.to = to; return window.PokerTable.act("raise", to); }
      return render();
    }
    const step = el("[data-step]");
    if (step && t.bet) { raise.to = Math.max(t.bet.minTo, Math.min(t.bet.maxTo, raise.to + Number(step.dataset.step) * t.bb)); return render(); }
    const to = el("[data-to]"); if (to) { raise.to = Number(to.dataset.to); return render(); }
    const win = el("[data-win]"); if (win) { win.setAttribute("aria-pressed", String(win.getAttribute("aria-pressed") !== "true")); return; }
    const award = el("[data-award]");
    if (award) { const k = Number(award.dataset.award), names = [...root.querySelectorAll(`[data-win="${k}"][aria-pressed="true"]`)].map(b => b.dataset.name); if (names.length) window.PokerTable.award(k, names); return; }
    const act = el("[data-act]")?.dataset.act;
    if (act === "deal") { if (t.bet && !t.bet.done && !confirm("ตานี้ยังไม่จบ ยกเลิกแล้วแจกใหม่?")) return; picking = null; return window.PokerTable.deal(); }
    if (act === "show") { const m = mineOf(t); if (m.every(c => c !== null) && confirm("เปิดไพ่ให้ทุกคนในโต๊ะเห็น?")) window.PokerTable.show(m.slice()); return; }
    if (act === "fold") return window.PokerTable.act("fold");
    if (act === "check" || act === "call") return window.PokerTable.act(act);
    if (act === "raise" && t.bet) return window.PokerTable.act("raise", raise.to);
  }
  document.addEventListener("poker:table", render);
  document.addEventListener("poker:mine", render);
  window.PokerTableView = Object.freeze({ open, close, isOpen: () => Boolean(root) });
})();
