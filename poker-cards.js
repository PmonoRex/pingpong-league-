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
  return Object.freeze({ RANKS, SUITS, SUIT_NAMES, HANDS, label, speak, red, valid, evaluate, score, name, odds, straightTop });
})();
if (typeof window !== "undefined") window.PokerCards = PokerCards;

(() => {
  if (typeof document === "undefined" || !document.getElementById?.("pcApp")) return;
  const C = PokerCards, $ = id => document.getElementById(id), KEY = "pp_poker_cards_v1", MAX_OPP = 8;
  // state: board (5 slots), mine (2), opp: array of 2-slot hands (empty slot = unknown, dealt at random)
  let st = load(), active = null; // active: { group: "board"|"mine"|oppIndex, i }
  function blank() { return { board: [null, null, null, null, null], mine: [null, null], opp: [[null, null]] }; }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || "null"), s = blank();
      if (!raw) return s;
      const fix = (arr, n) => Array.from({ length: n }, (_, i) => C.valid(arr?.[i]) ? arr[i] : null);
      s.board = fix(raw.board, 5); s.mine = fix(raw.mine, 2);
      s.opp = (Array.isArray(raw.opp) ? raw.opp : []).slice(0, MAX_OPP).map(h => fix(h, 2)); if (!s.opp.length) s.opp = [[null, null]];
      const seen = new Set(); [s.board, s.mine, ...s.opp].forEach(g => g.forEach((c, i) => { if (c === null) return; if (seen.has(c)) g[i] = null; else seen.add(c); }));
      return s;
    } catch { return blank(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }
  const groupArr = g => g === "board" ? st.board : g === "mine" ? st.mine : st.opp[g];
  const usedCards = () => new Set([st.board, st.mine, ...st.opp].flat().filter(c => c !== null));

  function cardHtml(c, attrs, extra = "") {
    if (c === null) return `<button type="button" class="pc-card pc-empty${extra}" ${attrs}><span aria-hidden="true">+</span></button>`;
    return `<button type="button" class="pc-card${C.red(c) ? " pc-red" : ""}${extra}" ${attrs}><b>${C.RANKS[c >> 2]}</b><i>${C.SUITS[c & 3]}</i></button>`;
  }
  const BOARD_NAMES = ["ฟล็อป 1", "ฟล็อป 2", "ฟล็อป 3", "เทิร์น", "ริเวอร์"];
  function slot(group, i, c, name) {
    const on = active && active.group === group && active.i === i ? " pc-active" : "";
    return cardHtml(c, `data-slot="${group}:${i}" aria-label="${name}: ${c === null ? "ยังไม่เลือก" : C.speak(c)}"${on ? ' aria-current="true"' : ""}`, on);
  }
  // Board cards count only in order (flop before turn before river), so a gap does not make a 4-card board.
  function boardCards() { const out = []; for (const c of st.board) { if (c === null) break; out.push(c); } return out; }

  function render() {
    $("pcBoard").innerHTML = st.board.map((c, i) => slot("board", i, c, BOARD_NAMES[i])).join("");
    $("pcMine").innerHTML = st.mine.map((c, i) => slot("mine", i, c, `ไพ่ของฉันใบที่ ${i + 1}`)).join("");
    $("pcOpp").innerHTML = st.opp.map((h, k) => `<div class="pc-seat"><span class="pc-seat-name">คนที่ ${k + 1}</span><span class="pc-seat-cards">${h.map((c, i) => slot(k, i, c, `คู่แข่งคนที่ ${k + 1} ใบที่ ${i + 1}`)).join("")}</span><span class="pc-odds-mini" id="pcOdd${k}"></span></div>`).join("");
    $("pcOppCount").textContent = `${st.opp.length} คน`;
    $("pcLess").disabled = st.opp.length <= 1; $("pcMore").disabled = st.opp.length >= MAX_OPP;
    renderPicker(); result();
  }
  function result() {
    const mine = st.mine.filter(c => c !== null), board = boardCards();
    if (mine.length < 2) {
      $("pcHand").innerHTML = '<span class="muted">เลือกไพ่ในมือ 2 ใบก่อน</span>';
      $("pcOdds").innerHTML = ""; st.opp.forEach((_, k) => { const el = $(`pcOdd${k}`); if (el) el.textContent = ""; }); return;
    }
    const hand = C.evaluate(mine.concat(board));
    $("pcHand").innerHTML = `<small>${board.length ? "ไพ่ที่ดีที่สุดตอนนี้" : "ในมือ"}</small><b>${C.name(hand)}</b>`;
    const seats = [mine, ...st.opp.map(h => h.filter(c => c !== null))];
    const res = C.odds(board, seats, { iterations: 3000 }), me = res[0], pct = x => `${Math.round(x * 100)}%`;
    const done = board.length === 5 && seats.every(h => h.length === 2);
    $("pcOdds").innerHTML = done
      ? `<b class="${me.win ? "pos" : me.tie ? "" : "neg"}">${me.win ? "คุณชนะ" : me.tie ? "เสมอ แบ่งกอง" : "คุณแพ้"}</b>`
      : `<div class="pc-big"><b>${pct(me.win)}</b><small>โอกาสชนะ</small></div><div class="pc-big"><b>${pct(me.tie)}</b><small>เสมอ</small></div><small class="muted">สุ่ม ${board.length < 5 ? "ไพ่กองกลางที่เหลือ" : ""}${board.length < 5 && seats.some(h => h.length < 2) ? " และ" : ""}${seats.some(h => h.length < 2) ? "ไพ่คู่แข่งที่ไม่รู้" : ""} 3,000 รอบ</small>`;
    st.opp.forEach((h, k) => {
      const el = $(`pcOdd${k}`); if (!el) return;
      const known = h.filter(c => c !== null);
      el.textContent = known.length === 2 && board.length + known.length >= 2 ? `${done ? C.name(C.evaluate(known.concat(board))) : `ชนะ ${pct(res[k + 1].win)}`}` : "";
    });
  }

  // ---- picker ----
  function renderPicker() {
    const box = $("pcPicker");
    if (!active) { box.hidden = true; return; }
    box.hidden = false;
    const used = usedCards(), current = groupArr(active.group)?.[active.i] ?? null;
    const what = active.group === "board" ? BOARD_NAMES[active.i] : active.group === "mine" ? `ไพ่ของฉันใบที่ ${active.i + 1}` : `คู่แข่งคนที่ ${active.group + 1} ใบที่ ${active.i + 1}`;
    $("pcPickTitle").textContent = `เลือก: ${what}`;
    $("pcGrid").innerHTML = [0, 1, 2, 3].map(s => `<div class="pc-suit-row" role="group" aria-label="${C.SUIT_NAMES[s]}">${[12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(r => {
      const c = r * 4 + s, taken = used.has(c) && c !== current;
      return `<button type="button" class="pc-pick${C.red(c) ? " pc-red" : ""}${c === current ? " pc-on" : ""}" data-card="${c}" aria-label="${C.speak(c)}"${taken ? " disabled" : ""}>${C.RANKS[r]}<i>${C.SUITS[s]}</i></button>`;
    }).join("")}</div>`).join("");
    $("pcClearSlot").disabled = current === null;
  }
  // After a pick, move on to the next empty slot in the same group (flop → turn → river, first card → second).
  function advance() {
    const arr = groupArr(active.group), next = arr.findIndex((c, i) => i > active.i && c === null);
    active = next >= 0 ? { group: active.group, i: next } : null;
  }
  document.getElementById("pcApp").addEventListener("click", e => {
    const s = e.target.closest("[data-slot]");
    if (s) { const [g, i] = s.dataset.slot.split(":"); const group = g === "board" || g === "mine" ? g : Number(g); active = active && active.group === group && active.i === Number(i) ? null : { group, i: Number(i) }; render(); if (active) $("pcPicker").scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    const p = e.target.closest("[data-card]");
    if (p && active) { groupArr(active.group)[active.i] = Number(p.dataset.card); advance(); save(); render(); return; }
  });
  $("pcClearSlot").addEventListener("click", () => { if (!active) return; groupArr(active.group)[active.i] = null; save(); render(); });
  $("pcDone").addEventListener("click", () => { active = null; render(); });
  $("pcMore").addEventListener("click", () => { if (st.opp.length < MAX_OPP) { st.opp.push([null, null]); save(); render(); } });
  $("pcLess").addEventListener("click", () => { if (st.opp.length > 1) { st.opp.pop(); if (typeof active?.group === "number" && active.group >= st.opp.length) active = null; save(); render(); } });
  $("pcNewHand").addEventListener("click", () => { st = { ...blank(), opp: st.opp.map(() => [null, null]) }; active = { group: "mine", i: 0 }; save(); render(); });
  render();
})();
