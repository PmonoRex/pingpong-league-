// ส่องไพ่ (poker.html): pick the board and your two cards, see your best hand and your chance to win.
// Texas Hold'em. A card is 0..51: rank = c >> 2 (0 = 2 … 12 = A), suit = c & 3. Pure helpers are tested in
// tests/poker-cards.test.cjs; the page part only runs when #pcApp exists. Picks stay on this phone (localStorage).
const PokerCards = (() => {
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const SUITS = ["♠", "♥", "♦", "♣"], SUIT_NAMES = ["โพดำ", "โพแดง", "ข้าวหลามตัด", "ดอกจิก"];
  const HANDS = ["ไพ่สูง", "หนึ่งคู่", "สองคู่", "ตอง", "สเตรท", "ฟลัช", "ฟูลเฮาส์", "โฟร์การ์ด", "สเตรทฟลัช"];
  const rank = c => c >> 2;
  const suitOf = c => c & 3;
  const valid = c => Number.isInteger(c) && c >= 0 && c < 52;
  const label = c => `${RANKS[rank(c)]}${SUITS[suitOf(c)]}`;
  const speak = c => `${RANKS[rank(c)]} ${SUIT_NAMES[suitOf(c)]}`;
  const red = c => suitOf(c) === 1 || suitOf(c) === 2;

  // Highest straight in a 13-bit rank mask (bit r = rank r present); -1 if none. A-2-3-4-5 counts, topping at 5.
  function straightTop(mask) {
    for (let top = 12; top >= 4; top--) { const need = 0b11111 << (top - 4); if ((mask & need) === need) return top; }
    return (mask & 0b1000000001111) === 0b1000000001111 ? 3 : -1;
  }
  // Best hand from 1..7 cards: { cat, ranks } where ranks break ties in order. Fewer than 5 cards can only make
  // the hands that need fewer cards (pairs, trips, quads, high card), the same as reading a preflop or flop hand.
  function evaluate(cards) {
    const counts = Array(13).fill(0), bySuit = [[], [], [], []];
    cards.forEach(c => { counts[rank(c)]++; bySuit[suitOf(c)].push(rank(c)); });
    const flushRanks = bySuit.find(s => s.length >= 5);
    if (flushRanks) {
      const top = straightTop(flushRanks.reduce((m, r) => m | 1 << r, 0));
      if (top >= 0) return { cat: 8, ranks: [top] };
    }
    const groups = counts.map((n, r) => [n, r]).filter(([n]) => n).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    const desc = (skip = []) => groups.map(([, r]) => r).filter(r => !skip.includes(r)).sort((a, b) => b - a);
    if (groups[0][0] === 4) return { cat: 7, ranks: [groups[0][1], ...desc([groups[0][1]]).slice(0, 1)] };
    const trips = groups.filter(([n]) => n === 3).map(([, r]) => r), pairs = groups.filter(([n]) => n === 2).map(([, r]) => r);
    if (trips.length && (trips.length > 1 || pairs.length)) return { cat: 6, ranks: [trips[0], Math.max(trips[1] ?? -1, pairs[0] ?? -1)] };
    if (flushRanks) return { cat: 5, ranks: flushRanks.slice().sort((a, b) => b - a).slice(0, 5) };
    const top = straightTop(counts.reduce((m, n, r) => n ? m | 1 << r : m, 0));
    if (top >= 0) return { cat: 4, ranks: [top] };
    if (trips.length) return { cat: 3, ranks: [trips[0], ...desc([trips[0]]).slice(0, 2)] };
    if (pairs.length >= 2) return { cat: 2, ranks: [pairs[0], pairs[1], ...desc([pairs[0], pairs[1]]).slice(0, 1)] };
    if (pairs.length) return { cat: 1, ranks: [pairs[0], ...desc([pairs[0]]).slice(0, 3)] };
    return { cat: 0, ranks: desc().slice(0, 5) };
  }
  // One comparable number per hand (bigger wins): category, then up to five tie-break ranks in base 13.
  const score = h => h.ranks.concat([0, 0, 0, 0, 0]).slice(0, 5).reduce((s, r) => s * 13 + r, h.cat);
  // Thai name of a hand, the way the table says it.
  function name(h) {
    const R = r => RANKS[r];
    switch (h.cat) {
      case 8: return h.ranks[0] === 12 ? "รอยัลสเตรทฟลัช" : `สเตรทฟลัช ถึง ${R(h.ranks[0])}`;
      case 7: return `โฟร์การ์ด ${R(h.ranks[0])}`;
      case 6: return `ฟูลเฮาส์ ${R(h.ranks[0])} เต็ม ${R(h.ranks[1])}`;
      case 5: return `ฟลัช ${R(h.ranks[0])} สูง`;
      case 4: return `สเตรท ถึง ${R(h.ranks[0])}`;
      case 3: return `ตอง ${R(h.ranks[0])}`;
      case 2: return `สองคู่ ${R(h.ranks[0])} กับ ${R(h.ranks[1])}`;
      case 1: return `หนึ่งคู่ ${R(h.ranks[0])}`;
      default: return `ไพ่สูง ${R(h.ranks[0])}`;
    }
  }

  // Small seeded generator so the odds don't flicker between redraws (and tests are repeatable).
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  // Win / tie chances for each seat. seats: arrays of 0..2 known cards (seat 0 = me); unknown cards are dealt at
  // random from what is left, and so is the rest of the board. A tie shares the pot, so `share` counts it as
  // 1/k of a win. With nothing left to deal the answer is exact (one deal).
  function odds(board, seats, { iterations = 4000, seed = 7 } = {}) {
    const used = new Set([...board, ...seats.flat()]);
    const deck = Array.from({ length: 52 }, (_, c) => c).filter(c => !used.has(c));
    const missingBoard = 5 - board.length, missingSeats = seats.reduce((s, h) => s + 2 - h.length, 0);
    const runs = missingBoard + missingSeats === 0 ? 1 : iterations, rand = rng(seed);
    const win = seats.map(() => 0), tie = seats.map(() => 0), share = seats.map(() => 0);
    const pool = deck.slice();
    for (let i = 0; i < runs; i++) {
      // Partial Fisher-Yates: only the cards we need.
      const need = missingBoard + missingSeats;
      for (let k = 0; k < need; k++) { const j = k + Math.floor(rand() * (pool.length - k)); [pool[k], pool[j]] = [pool[j], pool[k]]; }
      let next = 0;
      const full = board.concat(pool.slice(0, missingBoard)); next = missingBoard;
      const scores = seats.map(h => { const hand = h.slice(); while (hand.length < 2) hand.push(pool[next++]); return score(evaluate(hand.concat(full))); });
      const best = Math.max(...scores), winners = scores.map((s, k) => s === best ? k : -1).filter(k => k >= 0);
      winners.forEach(k => { if (winners.length === 1) win[k]++; else tie[k]++; share[k] += 1 / winners.length; });
    }
    return seats.map((_, k) => ({ win: win[k] / runs, tie: tie[k] / runs, share: share[k] / runs }));
  }
  // Showdown of revealed hands on a full board: who takes the pot (several names = split) and with what.
  function showdown(board, hands) {
    const scored = Object.entries(hands).filter(([, h]) => h?.length === 2).map(([who, h]) => { const best = evaluate(h.concat(board)); return { who, best, s: score(best) }; });
    if (!scored.length) return null;
    const top = Math.max(...scored.map(x => x.s)), winners = scored.filter(x => x.s === top);
    return { winners: winners.map(x => x.who), hand: name(winners[0].best), hands: Object.fromEntries(scored.map(x => [x.who, name(x.best)])) };
  }
  // Card artwork (vendor/playing-cards, Vectorized Playing Cards 1.3, LGPL-3): "AS.svg", "10H.svg", …
  const ART = "vendor/playing-cards/";
  const art = c => `${ART}${RANKS[rank(c)]}${"SHDC"[suitOf(c)]}.svg`, BACK = `${ART}Red_Back.svg`;
  return Object.freeze({ RANKS, SUITS, SUIT_NAMES, HANDS, label, speak, red, valid, evaluate, score, name, odds, showdown, straightTop, art, BACK });
})();
if (typeof window !== "undefined") window.PokerCards = PokerCards;

(() => {
  if (typeof document === "undefined" || !document.getElementById?.("pcApp")) return;
  const C = PokerCards, $ = id => document.getElementById(id), KEY = "pp_poker_cards_v1", MAX_OPP = 8;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // Two modes. Solo: everything is on this phone (board, my cards, opponents' cards if known). Table: I am seated at
  // the open poker night (poker.js → window.PokerTable), so the board, who folded and the revealed hands are shared
  // with the table, opponents are the other seated players, and my own cards stay on this phone until I reveal them.
  // state: board (5), mine (2), opp (2-slot hands) for solo; table: { key, mine } for the current shared hand.
  let st = load(), active = null; // active: { group: "board"|"mine"|oppIndex, i }
  function blank() { return { board: [null, null, null, null, null], mine: [null, null], opp: [[null, null]], table: { key: "", mine: [null, null] } }; }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null"), s = blank();
      if (!raw) return s;
      const fix = (arr, n) => Array.from({ length: n }, (_, i) => C.valid(arr?.[i]) ? arr[i] : null);
      s.board = fix(raw.board, 5); s.mine = fix(raw.mine, 2);
      s.opp = (Array.isArray(raw.opp) ? raw.opp : []).slice(0, MAX_OPP).map(h => fix(h, 2)); if (!s.opp.length) s.opp = [[null, null]];
      const seen = new Set(); [s.board, s.mine, ...s.opp].forEach(g => g.forEach((c, i) => { if (c === null) return; if (seen.has(c)) g[i] = null; else seen.add(c); }));
      if (raw.table && typeof raw.table.key === "string") s.table = { key: raw.table.key, mine: fix(raw.table.mine, 2) };
      return s;
    } catch { return blank(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }
  const table = () => { try { return window.PokerTable?.get() || null; } catch { return null; } };
  // My cards for the shared hand; a new deal (new hand key) starts them empty.
  function tableMine(T) { if (st.table.key !== T.handKey) { st.table = { key: T.handKey, mine: [null, null] }; save(); } return st.table.mine; }
  const boardArr = T => T ? T.hand.board : st.board;
  // แจกในแอป: my cards are the ones the app dealt me (opened on this phone), not picked by hand.
  const mineArr = T => T ? (T.app ? (T.myCards ? T.myCards.slice() : [null, null]) : tableMine(T)) : st.mine;
  const groupArr = (g, T) => g === "board" ? boardArr(T) : g === "mine" ? mineArr(T) : st.opp[g];
  const locked = T => Boolean(T && (T.app || T.hand.shown[T.me] || T.hand.folded.includes(T.me)));
  function usedCards(T) {
    const cards = [...boardArr(T), ...mineArr(T)];
    if (T) Object.values(T.hand.shown).forEach(h => cards.push(...h)); else st.opp.forEach(h => cards.push(...h));
    return new Set(cards.filter(c => c !== null));
  }
  function setCard(group, i, c, T) {
    if (T?.app && (group === "board" || group === "mine")) return; // the app deals these
    if (group === "board" && T) return window.PokerTable.setBoard(i, c);
    if (group === "mine" && locked(T)) return;
    groupArr(group, T)[i] = c; save();
  }

  function cardHtml(c, attrs, extra = "") {
    if (c === null) return `<button type="button" class="pc-card pc-empty${extra}" ${attrs}><span aria-hidden="true">+</span></button>`;
    return `<button type="button" class="pc-card pc-art${extra}" ${attrs}>${img(c)}</button>`;
  }
  // The rank and suit stay in the button's aria-label; the picture is decoration for screen readers.
  const img = c => `<img src="${C.art(c)}" alt="" draggable="false" decoding="async">`;
  const faceDown = (n = 2) => `<span class="pc-card pc-art pc-back" aria-hidden="true"><img src="${C.BACK}" alt="" draggable="false" decoding="async"></span>`.repeat(n);
  const faceUp = c => `<span class="pc-card pc-art" role="img" aria-label="${C.speak(c)}">${img(c)}</span>`;
  const BOARD_NAMES = ["ฟล็อป 1", "ฟล็อป 2", "ฟล็อป 3", "เทิร์น", "ริเวอร์"];
  function slot(group, i, c, name, disabled = false) {
    const on = active && active.group === group && active.i === i ? " pc-active" : "";
    return cardHtml(c, `data-slot="${group}:${i}" aria-label="${name}: ${c === null ? "ยังไม่เลือก" : C.speak(c)}"${on ? ' aria-current="true"' : ""}${disabled ? " disabled" : ""}`, on);
  }
  // Board cards count only in order (flop before turn before river), so a gap does not make a 4-card board.
  function boardCards(T) { const out = []; for (const c of boardArr(T)) { if (c === null) break; out.push(c); } return out; }
  const avatar = name => window.LeagueUI?.avatar ? window.LeagueUI.avatar(window.LeagueProfile?.payeeByName?.(LeagueShared.readLocalLeague(), name)?.id || `guest:${name}`, name, "sm") : "";

  function render() {
    const T = table();
    if (T) { const mine = mineArr(T); mine.forEach((c, i) => { if (c !== null && boardArr(T).includes(c)) mine[i] = null; }); }
    if (active && typeof active.group === "number" && T) active = null;
    $("pcBoard").innerHTML = boardArr(T).map((c, i) => slot("board", i, c, BOARD_NAMES[i], Boolean(T?.app))).join("");
    $("pcMine").innerHTML = mineArr(T).map((c, i) => slot("mine", i, c, `ไพ่ของฉันใบที่ ${i + 1}`, locked(T))).join("");
    $("pcMode").textContent = T ? (T.app ? `ตาที่ ${T.hand.no} • ${T.server ? "เซิร์ฟเวอร์แจก" : "แจกในแอป"}: ไพ่กองกลางเปิดเองตามรอบ ไพ่ในมือเห็นแค่ในเครื่องนี้${T.myCards ? "" : " (กำลังเปิดไพ่…)"}` : `ตาที่ ${T.hand.no} • ไพ่กองกลางซิงก์กับทั้งโต๊ะ • ไพ่ในมืออยู่ในเครื่องนี้จนกว่าจะกดเปิด`) : "แตะช่องแล้วเลือกไพ่ • เก็บไว้ในเครื่องนี้เท่านั้น";
    $("pcStepper").hidden = Boolean(T);
    $("pcOppHint").textContent = T ? "คนอื่นเห็นหลังไพ่จนกว่าเจ้าตัวจะกดเปิดไพ่" : "ไม่รู้ไพ่คู่แข่งก็เว้นไว้ ระบบสุ่มให้ • ถ้าเปิดไพ่แล้วใส่ได้";
    if (T) {
      const others = T.players.filter(n => n !== T.me);
      $("pcOpp").innerHTML = others.length ? others.map((n, k) => {
        const shown = T.hand.shown[n], folded = T.hand.folded.includes(n);
        return `<div class="pc-seat${folded ? " pc-folded" : ""}"><span class="pc-seat-name">${avatar(n)}${esc(n)}</span><span class="pc-seat-cards">${shown ? shown.map(faceUp).join("") : faceDown()}</span><span class="pc-odds-mini" id="pcOdd${k}">${folded ? "หมอบ" : shown ? "" : "ยังไม่เปิด"}</span></div>`;
      }).join("") : '<div class="muted">ยังไม่มีใครนั่งโต๊ะด้วย ให้เพื่อนกดเข้าโต๊ะจากมือถือตัวเอง</div>';
      const shownMine = T.hand.shown[T.me], folded = T.hand.folded.includes(T.me), two = mineArr(T).every(c => c !== null);
      $("pcActs").innerHTML = folded ? '<span class="pc-tag">คุณหมอบตานี้</span>' : shownMine ? '<span class="pc-tag pc-tag-on">เปิดไพ่ให้ทุกคนเห็นแล้ว</span>'
        : `<button type="button" class="primary" id="pcShow"${two ? "" : " disabled"}>เปิดไพ่</button><button type="button" class="secondary" id="pcFold">หมอบ</button>`;
    } else {
      $("pcOpp").innerHTML = st.opp.map((h, k) => `<div class="pc-seat"><span class="pc-seat-name">คนที่ ${k + 1}</span><span class="pc-seat-cards">${h.map((c, i) => slot(k, i, c, `คู่แข่งคนที่ ${k + 1} ใบที่ ${i + 1}`)).join("")}</span><span class="pc-odds-mini" id="pcOdd${k}"></span></div>`).join("");
      $("pcOppCount").textContent = `${st.opp.length} คน`;
      $("pcLess").disabled = st.opp.length <= 1; $("pcMore").disabled = st.opp.length >= MAX_OPP;
      $("pcActs").innerHTML = "";
    }
    renderPicker(T); result(T);
  }
  const pct = x => `${Math.round(x * 100)}%`;
  function result(T) {
    const board = boardCards(T), mine = mineArr(T).filter(c => c !== null);
    // The table's showdown is worked out from what everyone can see, so every phone shows the same result.
    if (T) {
      const live = T.players.filter(n => !T.hand.folded.includes(n));
      let banner = "";
      if (T.players.length > 1 && live.length === 1) banner = `<b>${esc(live[0])} ชนะตานี้</b> <span class="muted">คนอื่นหมอบหมด</span>`;
      else if (board.length === 5 && live.length > 1 && live.every(n => T.hand.shown[n])) {
        const sd = C.showdown(board, Object.fromEntries(live.map(n => [n, T.hand.shown[n]])));
        banner = sd.winners.length > 1 ? `<b>เสมอ แบ่งกอง:</b> ${sd.winners.map(esc).join(", ")} <span class="muted">${esc(sd.hand)}</span>` : `<b>${esc(sd.winners[0])} ชนะตานี้</b> <span class="muted">ด้วย ${esc(sd.hand)}</span>`;
        T.players.filter(n => n !== T.me).forEach((n, k) => { const el = $(`pcOdd${k}`); if (el && sd.hands[n]) el.textContent = sd.hands[n]; });
      }
      $("pcShowdown").innerHTML = banner; $("pcShowdown").hidden = !banner;
    } else { $("pcShowdown").hidden = true; }
    if (mine.length < 2) {
      $("pcHand").innerHTML = '<span class="muted">เลือกไพ่ในมือ 2 ใบก่อน</span>'; $("pcOdds").innerHTML = "";
      if (!T) st.opp.forEach((_, k) => { const el = $(`pcOdd${k}`); if (el) el.textContent = ""; });
      return;
    }
    const hand = C.evaluate(mine.concat(board));
    $("pcHand").innerHTML = `<small>${board.length ? "ไพ่ที่ดีที่สุดตอนนี้" : "ในมือ"}</small><b>${C.name(hand)}</b>`;
    if (T && T.hand.folded.includes(T.me)) { $("pcOdds").innerHTML = ""; return; }
    const others = T ? T.players.filter(n => n !== T.me && !T.hand.folded.includes(n)) : null;
    const oppHands = T ? others.map(n => T.hand.shown[n] || []) : st.opp.map(h => h.filter(c => c !== null));
    if (!oppHands.length) { $("pcOdds").innerHTML = ""; return; }
    const seats = [mine, ...oppHands], res = C.odds(board, seats, { iterations: 3000 }), me = res[0];
    const done = board.length === 5 && seats.every(h => h.length === 2);
    const unknown = seats.some(h => h.length < 2);
    $("pcOdds").innerHTML = done
      ? `<b class="${me.win ? "pos" : me.tie ? "" : "neg"}">${me.win ? "คุณชนะ" : me.tie ? "เสมอ แบ่งกอง" : "คุณแพ้"}</b>`
      : `<div class="pc-big"><b>${pct(me.win)}</b><small>โอกาสชนะ</small></div><div class="pc-big"><b>${pct(me.tie)}</b><small>เสมอ</small></div><small class="muted">สุ่ม ${board.length < 5 ? "ไพ่กองกลางที่เหลือ" : ""}${board.length < 5 && unknown ? " และ" : ""}${unknown ? "ไพ่คู่แข่งที่ยังไม่เปิด" : ""} 3,000 รอบ</small>`;
    if (!T) st.opp.forEach((h, k) => {
      const el = $(`pcOdd${k}`); if (!el) return;
      const known = h.filter(c => c !== null);
      el.textContent = known.length === 2 ? (done ? C.name(C.evaluate(known.concat(board))) : `ชนะ ${pct(res[k + 1].win)}`) : "";
    });
    else if (!done) others.forEach((n, j) => {
      const k = T.players.filter(x => x !== T.me).indexOf(n), el = $(`pcOdd${k}`);
      if (el && T.hand.shown[n]) el.textContent = `ชนะ ${pct(res[j + 1].win)}`;
    });
  }

  // ---- picker ----
  function renderPicker(T) {
    const box = $("pcPicker");
    if (!active) { box.hidden = true; return; }
    box.hidden = false;
    const used = usedCards(T), current = groupArr(active.group, T)?.[active.i] ?? null;
    const what = active.group === "board" ? BOARD_NAMES[active.i] : active.group === "mine" ? `ไพ่ของฉันใบที่ ${active.i + 1}` : `คู่แข่งคนที่ ${active.group + 1} ใบที่ ${active.i + 1}`;
    $("pcPickTitle").textContent = `เลือก: ${what}${T && active.group === "board" ? " (ทั้งโต๊ะเห็น)" : ""}`;
    $("pcGrid").innerHTML = [0, 1, 2, 3].map(s => `<div class="pc-suit-row" role="group" aria-label="${C.SUIT_NAMES[s]}">${[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(r => {
      const c = r * 4 + s, taken = used.has(c) && c !== current;
      return `<button type="button" class="pc-pick${C.red(c) ? " pc-red" : ""}${c === current ? " pc-on" : ""}" data-card="${c}" aria-label="${C.speak(c)}"${taken ? " disabled" : ""}>${C.RANKS[r]}<i>${C.SUITS[s]}</i></button>`;
    }).join("")}</div>`).join("");
    $("pcClearSlot").disabled = current === null;
  }
  // After a pick, move on to the next empty slot in the same group (flop → turn → river, first card → second).
  function advance(T) {
    const arr = groupArr(active.group, T), next = arr.findIndex((c, i) => i > active.i && c === null);
    active = next >= 0 ? { group: active.group, i: next } : null;
  }
  $("pcApp").addEventListener("click", e => {
    const T = table();
    const s = e.target.closest("[data-slot]");
    if (s) { const [g, i] = s.dataset.slot.split(":"); const group = g === "board" || g === "mine" ? g : Number(g); active = active && active.group === group && active.i === Number(i) ? null : { group, i: Number(i) }; render(); if (active) $("pcPicker").scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    const p = e.target.closest("[data-card]");
    if (p && active) { setCard(active.group, active.i, Number(p.dataset.card), T); advance(table()); render(); document.dispatchEvent(new CustomEvent("poker:mine")); return; }
    if (e.target.closest("#pcShow") && T) {
      const mine = mineArr(T); if (!mine.every(c => c !== null)) return;
      if (!confirm("เปิดไพ่ให้ทุกคนในโต๊ะเห็น? เปิดแล้วปิดกลับไม่ได้")) return;
      window.PokerTable.show(mine.slice()); active = null; render(); return;
    }
    if (e.target.closest("#pcFold") && T) { if (!confirm("หมอบตานี้?")) return; window.PokerTable.fold(); active = null; render(); }
  });
  $("pcClearSlot").addEventListener("click", () => { if (!active) return; const T = table(); setCard(active.group, active.i, null, T); render(); });
  $("pcDone").addEventListener("click", () => { active = null; render(); });
  $("pcMore").addEventListener("click", () => { if (st.opp.length < MAX_OPP) { st.opp.push([null, null]); save(); render(); } });
  $("pcLess").addEventListener("click", () => { if (st.opp.length > 1) { st.opp.pop(); if (typeof active?.group === "number" && active.group >= st.opp.length) active = null; save(); render(); } });
  $("pcNewHand").addEventListener("click", () => {
    const T = table();
    if (T) { if (!confirm("เริ่มตาใหม่ทั้งโต๊ะ? กองกลางและไพ่ที่เปิดไว้จะถูกล้างให้ทุกคน")) return; window.PokerTable.deal(); }
    else st = { ...blank(), opp: st.opp.map(() => [null, null]), table: st.table };
    active = { group: "mine", i: 0 }; save(); render();
  });
  // poker.js redraws the table after every change and every sync.
  document.addEventListener("poker:table", () => render());
  // My hole cards for the shared hand, for the full-screen table (poker-table.js). They stay on this phone.
  window.PokerMine = Object.freeze({
    get: T => mineArr(T).slice(),
    locked: T => locked(T),
    set(T, i, c) { setCard("mine", i, c, T); render(); document.dispatchEvent(new CustomEvent("poker:mine")); }
  });
  render();
})();
