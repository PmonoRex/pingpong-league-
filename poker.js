// Poker night (โป๊กเกอร์) — buy-ins, rebuys, chips at the end, and who pays whom. Standalone page.
// A night is an append-only list of events (join / buy / out / undo, plus the shared hand: board / show / fold /
// deal), so two phones editing at once merge by
// taking the union of their events. Nights live under `poker` inside the `dummy` column of the shared row (same
// rev lock and save function as the Dummy sheet; dummy.js carries `poker` along untouched). localStorage is the
// offline copy.
const PokerNight = (() => {
  // Deals are never trimmed below MAX_DEALS: each one carries the chip result of the hand before it.
  const MAX_NIGHTS = 20, MAX_EVENTS = 600, MAX_DEALS = 1000, TYPES = ["join", "buy", "out", "undo", "board", "show", "fold", "deal", "act", "award", "key", "mode", "leave"];
  // A room without buy-ins (credit) gives everyone this many chips of headroom; at 1 chip = 1 baht their result is
  // simply chips minus CREDIT, and nobody can run out or be all-in.
  const CREDIT = 1e9;
  const MONEY = ["join", "buy", "out", "undo", "leave"], HAND = ["board", "show", "fold", "act", "award"], BET_ACTIONS = ["fold", "check", "call", "raise"];
  const MODES = ["real", "app", "server"];
  const b64 = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(v);
  const nameList = (v, max) => [...new Set((Array.isArray(v) ? v : []).map(cleanName).filter(Boolean))].slice(0, max);
  const cardOk = c => Number.isInteger(c) && c >= 0 && c < 52;
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
    // A deal records who is dealt in, the dealer button and the chips won or lost in the hand before it.
    if (e.t === "deal") {
      const seats = nameList(e.seats, 10); if (seats.length) { out.seats = seats; out.button = seats.includes(cleanName(e.button)) ? cleanName(e.button) : seats[0]; }
      const res = Object.entries(e.res && typeof e.res === "object" ? e.res : {}).map(([k, v]) => [cleanName(k), int(v)]).filter(([k, v]) => k && v);
      if (res.length) out.res = Object.fromEntries(res.slice(0, 10));
      // แจกในแอป: who dealt, their one-off public key and one sealed box of hole cards per seat (poker-deal.js).
      if (e.mode === "app" && out.seats && b64(e.epk, 200) && e.holes && typeof e.holes === "object") {
        const holes = out.seats.map(nm => [nm, e.holes[nm]]).filter(([, h]) => h && b64(h.iv, 40) && b64(h.ct, 200)).map(([nm, h]) => [nm, { iv: h.iv, ct: h.ct }]);
        if (holes.length === out.seats.length) Object.assign(out, { mode: "app", by: cleanName(e.by), epk: e.epk, holes: Object.fromEntries(holes) });
      }
      // แจกจากเซิร์ฟเวอร์: the deck is on the server under this deal's id (supabase pp_poker_* functions).
      if (e.mode === "server" && out.seats) Object.assign(out, { mode: "server", by: cleanName(e.by) });
      return out;
    }
    // A player's public key for แจกในแอป (the private half never leaves their phone), and the table's card mode.
    if (e.t === "key") { out.name = cleanName(e.name); out.pub = e.pub; return out.name && b64(e.pub, 200) ? out : null; }
    if (e.t === "mode") { out.mode = MODES.includes(e.mode) ? e.mode : "real"; return out; }
    if (e.t === "award") { out.pot = e.pot; out.names = nameList(e.names, 10); return Number.isInteger(out.pot) && out.pot >= 0 && out.pot < 20 && out.names.length ? out : null; }
    // A board slot (0-2 flop, 3 turn, 4 river) set to a card, or -1 to clear it. Anyone at the table can set it.
    if (e.t === "board") { out.i = e.i; out.card = e.card; return Number.isInteger(out.i) && out.i >= 0 && out.i < 5 && (out.card === -1 || cardOk(out.card)) ? out : null; }
    out.name = cleanName(e.name); if (!out.name) return null;
    if (e.t === "buy") { out.amount = money(e.amount); if (!(out.amount > 0)) return null; }
    // A join may carry the first buy-in (เข้าโต๊ะ from the player's own phone), so tapping it twice buys only once.
    if (e.t === "join" && money(e.amount) > 0) out.amount = money(e.amount);
    if (e.t === "out") { out.amount = Math.max(0, int(e.amount)); }
    if (e.t === "act") { if (!BET_ACTIONS.includes(e.a)) return null; out.a = e.a; if (e.a === "raise") { out.to = Math.max(0, int(e.to)); if (!out.to) return null; } }
    // Hole cards reach the shared row only when their owner reveals them (เปิดไพ่); until then they stay on that phone.
    if (e.t === "show") { out.cards = Array.isArray(e.cards) ? e.cards.slice(0, 2) : []; if (out.cards.length !== 2 || !out.cards.every(cardOk) || out.cards[0] === out.cards[1]) return null; }
    return out;
  }
  function normalizeNight(n) {
    if (!n || typeof n !== "object") return null;
    const night = { id: cleanId(n.id), startedAt: Math.max(0, int(n.startedAt)), buyIn: money(n.buyIn) > 0 ? money(n.buyIn) : 100, chips: int(n.chips) > 0 ? int(n.chips) : 100, closedAt: Math.max(0, int(n.closedAt)) };
    // Blinds in chips; a night from before betting gets a big blind of about 1/50 of a buy-in.
    night.bb = int(n.bb) > 0 ? int(n.bb) : Math.max(1, Math.round(night.chips / 50));
    night.sb = int(n.sb) > 0 ? Math.min(int(n.sb), night.bb) : Math.max(1, Math.floor(night.bb / 2));
    night.mode = MODES.includes(n.mode) ? n.mode : "real";
    // A room: its name, and whether people just sit and play for baht (credit) instead of buying chips.
    night.name = cleanName(n.name);
    night.credit = n.credit === true;
    if (night.credit) { night.buyIn = 1; night.chips = 1; }
    if (!night.id) return null;
    const seen = new Set();
    const all = (Array.isArray(n.events) ? n.events : []).map(normalizeEvent).filter(e => e && !seen.has(e.id) && seen.add(e.id))
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Money events are kept (up to MAX_EVENTS); of the card events only the current hand is kept, so a long night
    // of hands never pushes a buy-in out of the row.
    const lastDeal = all.map(e => e.t).lastIndexOf("deal"), moneyEvents = all.filter(e => MONEY.includes(e.t)).slice(-MAX_EVENTS);
    const deals = all.filter(e => e.t === "deal").slice(-MAX_DEALS), dealIds = new Set(deals.map(e => e.id));
    // The latest key of each player and the latest mode change are all that matter of those.
    const latest = t => { const m = new Map(); all.filter(e => e.t === t).forEach(e => m.set(t === "key" ? e.name : "mode", e)); return [...m.values()]; };
    const keep = new Set([...moneyEvents, ...deals, ...latest("key"), ...latest("mode")]);
    const kept = all.filter((e, i) => keep.has(e) || (HAND.includes(e.t) && i > lastDeal) || (e.t === "deal" && dealIds.has(e.id)));
    // Sealed hole cards only matter for the hand being played.
    const lastKept = kept.map(e => e.t).lastIndexOf("deal");
    night.events = kept.map((e, i) => e.t === "deal" && e.holes && i < lastKept ? (({ epk, holes, ...rest }) => rest)(e) : e);
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
  // Every room that is still open, newest first.
  function openNights(p) { return Object.values(normalize(p).nights).filter(n => !n.closedAt).sort((a, b) => b.startedAt - a.startedAt); }
  function current(p) { return Object.values(normalize(p).nights).filter(n => !n.closedAt).sort((a, b) => b.startedAt - a.startedAt)[0] || null; }
  function history(p) { return Object.values(normalize(p).nights).filter(n => n.closedAt).sort((a, b) => b.closedAt - a.closedAt); }

  // Everything the page shows about a night, worked out from its events. Money is baht; chip counts are whole chips.
  // ext.server: { key, board, shown } from the server for a แจกจากเซิร์ฟเวอร์ hand; its board and shown hands are the
  // only ones that count for that hand (board / show events in the row are ignored, so nobody can fake them).
  function view(night, ext = {}) {
    night = normalizeNight(night);
    const undone = new Set(night.events.filter(e => e.t === "undo").map(e => e.ref));
    const live = night.events.filter(e => e.t !== "undo" && !undone.has(e.id));
    // The hand being played: everything after the latest deal.
    const lastDeal = live.map(e => e.t).lastIndexOf("deal"), dealEvent = lastDeal >= 0 ? live[lastDeal] : null;
    const hand = { no: Math.max(1, live.filter(e => e.t === "deal").length), deals: live.filter(e => e.t === "deal").length, key: dealEvent ? dealEvent.id : "first", board: [null, null, null, null, null], shown: {}, folded: [], button: dealEvent?.button || null, bet: null,
      app: dealEvent?.mode === "app", server: dealEvent?.mode === "server", by: dealEvent?.by || null, epk: dealEvent?.epk || null, holes: dealEvent?.holes || null };
    const srv = hand.server && ext.server?.key === hand.key ? ext.server : null;
    if (srv) {
      hand.board = [0, 1, 2, 3, 4].map(i => Number.isInteger(srv.board?.[i]) ? srv.board[i] : null);
      hand.shown = Object.fromEntries(Object.entries(srv.shown || {}).filter(([, c]) => Array.isArray(c) && c.length === 2));
    }
    const keys = {}; let mode = night.mode;
    live.forEach(e => { if (e.t === "key") keys[e.name] = e.pub; else if (e.t === "mode") mode = e.mode; });
    const acts = [], awards = [];
    live.slice(lastDeal + 1).forEach(e => {
      if (e.t === "board") { if (!hand.server) hand.board[e.i] = e.card < 0 ? null : e.card; }
      else if (e.t === "show") { if (!hand.server) hand.shown[e.name] = e.cards; }
      else if (e.t === "fold" || (e.t === "act" && e.a === "fold")) { if (!hand.folded.includes(e.name)) hand.folded.push(e.name); if (e.t === "fold") acts.push({ name: e.name, a: "fold" }); else acts.push(e); }
      else if (e.t === "act") acts.push(e);
      else if (e.t === "award") awards.push(e);
    });
    const players = new Map();
    const player = name => { if (!players.has(name)) players.set(name, { name, buys: [], out: null, seated: true }); return players.get(name); };
    live.forEach(e => {
      if (e.t === "join") { if (!players.has(e.name) && e.amount) player(e.name).buys.push(e.amount); else player(e.name); player(e.name).seated = true; }
      else if (e.t === "leave") { if (players.has(e.name)) player(e.name).seated = false; }
      else if (e.t === "buy") player(e.name).buys.push(e.amount);
      else if (e.t === "out") player(e.name).out = e.amount;
    });
    const rate = night.chips / night.buyIn; // chips per baht
    // Chips each player has at the table: everything bought, plus what every finished hand moved (recorded on the
    // deal that followed it). `atDeal` is the same count at the moment the current hand was dealt.
    const bank = {}, joined = new Set(); let atDeal = {};
    live.forEach(e => {
      // Same rule as the player list: a join's buy-in counts only for the first time that name sits down.
      const first = e.t === "join" && !joined.has(e.name);
      if (first && night.credit) bank[e.name] = CREDIT;
      if (e.t === "join" || e.t === "buy") { if (e.t === "buy" || (first && e.amount)) bank[e.name] = (bank[e.name] || 0) + Math.round(e.amount * rate); joined.add(e.name); }
      if (e.t === "deal") { Object.entries(e.res || {}).forEach(([k, v]) => { bank[k] = (bank[k] || 0) + v; }); if (e === dealEvent) atDeal = { ...bank }; }
    });
    if (dealEvent?.seats && typeof PokerBet !== "undefined") {
      hand.bet = PokerBet.play({ seats: dealEvent.seats, stacks: atDeal, button: dealEvent.button, sb: night.sb, bb: night.bb, acts, board: hand.board, shown: hand.shown, awards }, typeof PokerCards !== "undefined" ? PokerCards : null);
      if (!hand.bet.active) hand.bet = null;
    }
    const list = [...players.values()].map(p => {
      const paid = money(p.buys.reduce((s, v) => s + v, 0));
      const outBaht = p.out === null ? null : money(p.out / rate);
      const inHand = hand.bet?.players.find(x => x.name === p.name);
      const stack = (bank[p.name] || 0) + (inHand ? (hand.bet.done ? hand.bet.delta[p.name] || 0 : -inHand.committed) : 0);
      // In a credit room the result is live: chips over or under the starting headroom, in baht.
      if (night.credit) return { ...p, paid: 0, chipsIn: 0, outBaht: null, net: money((stack - CREDIT) / rate), stack };
      return { ...p, paid, chipsIn: Math.round(paid * rate), outBaht, net: outBaht === null ? null : money(outBaht - paid), stack };
    });
    const chipsIn = list.reduce((s, p) => s + p.chipsIn, 0), chipsOut = list.reduce((s, p) => s + (p.out || 0), 0);
    const allOut = list.length > 0 && list.every(p => p.out !== null);
    return { night, rate, players: list, paid: money(list.reduce((s, p) => s + p.paid, 0)), chipsIn, chipsOut, diffChips: chipsOut - chipsIn, allOut, balanced: night.credit ? !(hand.bet && !hand.bet.done) : allOut && chipsOut === chipsIn, credit: night.credit, lastAction: live.filter(e => MONEY.includes(e.t)).pop() || null, hand, bank, keys, mode };
  }
  // Fewest transfers: the biggest loser pays the biggest winner until everyone is square. Works in satang; the
  // rounding left over from chips → baht goes to the biggest winner so the transfers always add up.
  // "ถ้าเลิกตอนนี้": everyone's money from the chips they have at the table right now (a hand still being played
  // counts as not played: chips in its pot go back to whoever put them in), and the fewest transfers to settle.
  // null until a hand has been bet (before that chips only change hands on the felt, which the app cannot see).
  function liveSettle(v) {
    if (!v.night.events.some(e => e.t === "deal" && e.seats)) return null;
    const bet = v.hand.bet, finished = Boolean(bet?.done);
    const rows = v.players.map(p => {
      const chips = finished ? p.stack : (v.bank[p.name] || 0);
      const net = money((chips - (v.credit ? CREDIT : 0)) / v.rate - p.paid);
      return { name: p.name, chips, paid: p.paid, net };
    });
    return { rows, transfers: transfers(rows), pending: Boolean(bet && !bet.done) };
  }
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
    // Strictly after this night's last event, so two taps in the same millisecond keep their order.
    const last = night.events.reduce((m, e) => Math.max(m, e.at), 0);
    night.events.push({ id: newId(), at: Math.max(Date.now(), last + 1), ...event });
    copy.nights[nightId] = normalizeNight(night);
    return copy;
  }
  // A room. credit: no buy-ins, everyone named just sits down; otherwise each buys in once.
  function startNight(p, { buyIn, chips, names = [], sb, bb, mode, name = "", credit = false }) {
    const copy = normalize(p), id = newId("n"), at = Date.now();
    const unique = [...new Set(names.map(cleanName).filter(Boolean))];
    const seat = (who, i) => credit ? [{ id: newId(), at: at + i, t: "join", name: who }] : [{ id: newId(), at: at + i * 2, t: "join", name: who }, { id: newId(), at: at + i * 2 + 1, t: "buy", name: who, amount: money(buyIn) }];
    copy.nights[id] = normalizeNight({ id, startedAt: at, buyIn, chips, sb, bb, mode, name, credit, events: unique.flatMap(seat) });
    return { poker: { nights: trim(copy.nights) }, id };
  }
  // The player sits down at the open night with one buy-in; nothing happens if they are already at the table.
  // In a credit room a player who stood up can sit down again (no buy-in); in a buy-in room joining buys in once.
  function join(p, nightId, name) {
    const copy = normalize(p), night = copy.nights[nightId], who = cleanName(name);
    if (!night || !who) return copy;
    const seen = view(night).players.find(x => x.name === who);
    if (seen?.seated) return copy;
    return addEvent(copy, nightId, night.credit || seen ? { t: "join", name: who } : { t: "join", name: who, amount: night.buyIn });
  }
  // Standing up: not dealt into the next hand; their result so far stays.
  function leave(p, nightId, name) {
    const copy = normalize(p), night = copy.nights[nightId], who = cleanName(name);
    if (!night || !view(night).players.find(x => x.name === who)?.seated) return copy;
    return addEvent(copy, nightId, { t: "leave", name: who });
  }
  // The shared hand: board cards, a player revealing or folding, and a new deal that clears it for everyone.
  const setBoard = (p, nightId, i, card) => addEvent(p, nightId, { t: "board", i, card: card === null ? -1 : card });
  const show = (p, nightId, name, cards) => addEvent(p, nightId, { t: "show", name, cards });
  const fold = (p, nightId, name) => addEvent(p, nightId, { t: "act", name, a: "fold" });
  const act = (p, nightId, name, a, to) => addEvent(p, nightId, { t: "act", name, a, ...(a === "raise" ? { to } : {}) });
  const award = (p, nightId, pot, names) => addEvent(p, nightId, { t: "award", pot, names });
  // A new hand: closes the one being played (its chip result is recorded here; an unfinished hand is called off and
  // everyone keeps what they had), deals in everyone seated with chips, and moves the button one seat left.
  function nextDeal(night, ext = {}) {
    const v = view(night, ext), bet = v.hand.bet, res = bet?.done ? bet.delta : {};
    const order = v.players.map(x => x.name), after = nm => (v.bank[nm] || 0) + (res[nm] || 0);
    const seated = new Set(v.players.filter(x => x.seated).map(x => x.name));
    const seats = order.filter(nm => after(nm) > 0 && seated.has(nm));
    let button = seats[0] || null;
    if (v.hand.button && seats.length) { const from = order.indexOf(v.hand.button); for (let k = 1; k <= order.length; k++) { const c = order[(from + k) % order.length]; if (seats.includes(c)) { button = c; break; } } }
    return { seats, button, res: Object.fromEntries(Object.entries(res).filter(([, d]) => d)) };
  }
  // `sealed` (แจกในแอป) adds { mode: "app", by, epk, holes } from poker-deal.js; it must cover exactly these seats.
  // `sealed` may also carry the deal's own id and the seats it was made for (แจกจากเซิร์ฟเวอร์ deals the server first).
  function deal(p, nightId, sealed = null, ext = {}) {
    const copy = normalize(p), night = copy.nights[nightId]; if (!night) return copy;
    return addEvent(copy, nightId, { t: "deal", ...nextDeal(night, ext), ...(sealed || {}) });
  }
  const setKey = (p, nightId, name, pub) => addEvent(p, nightId, { t: "key", name, pub });
  const setMode = (p, nightId, mode) => addEvent(p, nightId, { t: "mode", mode });
  function closeNight(p, nightId) { const copy = normalize(p); if (copy.nights[nightId]) copy.nights[nightId].closedAt = Date.now(); return copy; }

  return Object.freeze({ normalize, merge, same, current, history, view, transfers, liveSettle, addEvent, join, leave, openNights, CREDIT, setBoard, show, fold, act, award, nextDeal, deal, setKey, setMode, startNight, closeNight, cleanName, MAX_NIGHTS });
})();
if (typeof window !== "undefined") window.PokerNight = PokerNight;

(() => {
  if (typeof document === "undefined" || !document.getElementById?.("pokerApp")) return;
  const P = PokerNight, $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // Rooms are played for chips, not money: no baht, no who-pays-whom, no transfer buttons.
  const chips = (v, sign = false) => `${sign && v > 0 ? "+" : ""}${Number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 })} ชิป`;
  const chipsText = v => `${Number(v).toLocaleString("th-TH")} ชิป`;
  const KEY = "pp_poker_v1", Cloud = typeof LeagueShared !== "undefined" ? LeagueShared : null;
  // แจกจากเซิร์ฟเวอร์: what the server says about the hand being played (board turned so far, hands shown, my cards).
  // Every view of the night on this page goes through V so that hand's board and shown hands come from here.
  let srv = { key: "", board: [], shown: {}, mine: null, at: 0 }, serverReady = null, serverBusy = false;
  const ext = () => ({ server: srv });
  const V = night => P.view(night, ext());
  const rpc = (name, args) => Cloud.authedRpc(name, args);
  // Whether supabase/migrations/20261023120000_poker_server_deal.sql has been run (and this phone is signed in).
  async function probeServer() {
    if (serverReady !== null) return serverReady;
    if (!Cloud?.authedRpc || !Cloud.sessionToken?.()) return false;
    try { await rpc("pp_poker_hand", { p_night: "probe", p_hand: "probe" }); serverReady = true; }
    catch (error) { if (error.missing) serverReady = false; else return false; }
    render(); return serverReady;
  }
  let poker = load(), dirty = (() => { try { return localStorage.getItem(KEY + "_dirty") === "1"; } catch { return false; } })();
  let syncing = false, syncTimer = 0, cloudOff = !Cloud;
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
  function addGuest(input, onName) {
    const name = P.cleanName(input.value); if (!name) return toast("พิมพ์ชื่อก่อน");
    onName(name); input.value = ""; input.focus();
  }
  // ---- ห้อง: the lobby of open rooms; this phone remembers which room it is looking at ----
  const ROOM_KEY = "pp_poker_room";
  let roomId = (() => { try { return localStorage.getItem(ROOM_KEY) || ""; } catch { return ""; } })();
  function setRoom(id) { roomId = id || ""; try { if (roomId) localStorage.setItem(ROOM_KEY, roomId); else localStorage.removeItem(ROOM_KEY); } catch {} }
  const roomName = n => n.name || `วง ${dayText(n.startedAt)}`;
  // Only rooms (credit nights) are shown; nights from the old buy-in flow stay in storage but are not listed.
  const openRooms = () => P.openNights(poker).filter(n => n.credit);
  const modeName = { real: "ไพ่จริง", app: "แจกในแอป", server: "เซิร์ฟเวอร์แจก" };
  function renderSetup() {
    const name = me(), rooms = openRooms();
    $("pRooms").innerHTML = rooms.length ? rooms.map(n => {
      const v = V(n), seated = v.players.filter(p => p.seated), mine = v.players.find(p => p.name === name);
      const stakes = `บลายด์ ${n.sb}/${n.bb} ชิป`;
      return `<div class="p-room" role="listitem"><div class="p-room-info"><b>${esc(roomName(n))}</b><small>${seated.length} คนนั่งอยู่ • ${esc(stakes)} • ${esc(modeName[v.mode] || "")}${mine?.seated ? " • คุณนั่งอยู่" : mine ? ` • คุณ ${esc(chips(mine.net ?? 0, true))}` : ""}</small><span class="p-room-who">${seated.slice(0, 9).map(p => avatarFor(p.name)).join("")}</span></div><button type="button" class="primary" data-room="${esc(n.id)}">${mine?.seated ? "กลับเข้าห้อง" : "เข้าห้อง"}</button></div>`;
    }).join("") : '<div class="muted p-rooms-empty">ยังไม่มีห้องเปิดอยู่ • สร้างห้องด้านล่างได้เลย</div>';
    if (!$("pRoomName").value) $("pRoomName").placeholder = `โต๊ะ ${rooms.length + 1}`;
    $("pStart").disabled = !name;
    $("pStart").textContent = name ? "สร้างห้องแล้วนั่งเลย" : "เข้าสู่ระบบที่หน้าแรกก่อน";
  }
  // Entering a room sits you down (credit rooms); the table view opens on the same tap.
  $("pRooms").addEventListener("click", e => {
    const b = e.target.closest("[data-room]"); if (!b) return;
    const night = openRooms().find(n => n.id === b.dataset.room); if (!night) return render();
    setRoom(night.id);
    const name = me(), seat = V(night).players.find(p => p.name === name);
    if (name && night.credit && !seat?.seated) { change(P.join(poker, night.id, name)); toast(`นั่งโต๊ะ ${roomName(night)} แล้ว`); }
    else render();
    if (name && (night.credit || seat?.seated)) window.PokerTableView?.open();
  });
  $("pStart").addEventListener("click", () => {
    const name = me(); if (!name) return toast("เข้าสู่ระบบที่หน้าแรกก่อน");
    const sb = Math.round(Number($("pSb").value)), bb = Math.round(Number($("pBb").value));
    if (!(sb > 0) || !(bb > 0)) return toast("ใส่บลายด์ให้ถูกก่อน");
    if (sb > bb) return toast("บลายด์เล็กต้องไม่มากกว่าบลายด์ใหญ่");
    const chosen = document.querySelector('input[name="pMode"]:checked')?.value, mode = ["app", "server"].includes(chosen) ? chosen : "real";
    const title = P.cleanName($("pRoomName").value) || `โต๊ะ ${openRooms().length + 1}`;
    const { poker: next, id } = P.startNight(poker, { name: title, credit: true, names: [name], sb, bb, mode });
    $("pRoomName").value = ""; setRoom(id); change(next); toast(`สร้างห้อง ${title} แล้ว • ชวนเพื่อนกดเข้าห้องได้เลย`);
    window.PokerTableView?.open();
  });

  // ---- the night ----
  // A room: everyone's chips won or lost so far and who is seated.
  function renderRoom(v, myName) {
    const n = v.night, seated = v.players.filter(p => p.seated).length, inPlay = v.hand.bet && !v.hand.bet.done;
    $("pRoomTitle").textContent = roomName(n);
    $("pMeta").textContent = `บลายด์ ${n.sb}/${n.bb} ชิป • ${seated} คนนั่งอยู่${v.players.length > seated ? ` • ลุกไปแล้ว ${v.players.length - seated} คน` : ""} • เล่นไป ${v.hand.deals} ตา`;
    $("pPlayers").innerHTML = v.players.slice().sort((a, b) => b.net - a.net).map(p => `<div class="p-row p-room-row${p.name === myName ? " p-row-me" : ""}${p.seated ? "" : " p-left"}"><div class="p-row-head">${avatarFor(p.name)}<div class="d-board-name"><b>${esc(p.name)}</b><small>${p.seated ? "นั่งอยู่" : "ลุกแล้ว"}</small></div><b class="p-net ${p.net > 0 ? "pos" : p.net < 0 ? "neg" : ""}">${esc(chips(p.net, true))}</b></div></div>`).join("");
    $("pLateRow").hidden = true; $("pUndo").hidden = true;
    $("pCheck").innerHTML = inPlay ? '<span class="muted">กำลังเล่นตาหนึ่งอยู่ • ยอดด้านบนนับถึงตาที่จบแล้ว</span>' : "";
    $("pPay").hidden = !v.hand.deals;
    $("pClose").textContent = "ปิดห้อง • เก็บเข้าประวัติ";
    $("pClose").disabled = Boolean(inPlay);
  }
  function renderNight(night) {
    const v = V(night);
    const myName = me(); renderSeat(v, myName); renderBet(v, myName);
    // Only rooms are opened (nightNow); nights from the old buy-in flow are no longer shown.
    renderRoom(v, myName);
  }
  // เข้าโต๊ะ: each player sits down from their own phone; the bar says who is seated and how to join.
  function renderSeat(v, name) {
    const bar = $("pSeat"), n = v.night;
    if (!name) { bar.innerHTML = '<span class="muted">เข้าสู่ระบบที่<a href="index.html">หน้าแรก</a>ก่อน แล้วกดเข้าโต๊ะเองได้</span>'; return; }
    const mine = v.players.find(p => p.name === name), lobby = '<button type="button" class="secondary" data-lobby>ห้องรวม</button>';
    const table = window.PokerTableView ? '<button type="button" class="primary p-tablemode" data-tablemode>เปิดโหมดโต๊ะ</button>' : "";
    if (mine?.seated) {
      const detail = n.credit ? `${mine.net > 0 ? "ได้" : mine.net < 0 ? "เสีย" : "เท่าทุน"} ${esc(chips(Math.abs(mine.net)))}` : `ซื้อ ${mine.buys.length} ไม้`;
      bar.innerHTML = `<span class="p-seat-on">${avatarFor(name)}<b>${esc(name)}</b> นั่งอยู่ • ${detail}</span>${table}<button type="button" class="secondary" data-leave>ลุกจากโต๊ะ</button>${lobby}`;
    } else {
      const sitting = v.players.filter(p => p.seated).length;
      bar.innerHTML = n.credit
        ? `<button type="button" class="primary p-join" id="pJoin">${mine ? "กลับมานั่ง" : "นั่งโต๊ะ"}</button><span class="muted">${sitting} คนนั่งอยู่${mine ? ` • คุณ ${esc(chips(mine.net, true))}` : ""}</span>${lobby}`
        : `<button type="button" class="primary p-join" id="pJoin">${mine ? "กลับมานั่ง" : `เข้าโต๊ะ • ซื้อ 1 ไม้ (${esc(chips(n.buyIn))})`}</button><span class="muted">ในวงตอนนี้ ${sitting} คน</span>${lobby}`;
    }
  }
  $("pSeat").addEventListener("click", async e => {
    if (e.target.closest("[data-tablemode]")) return window.PokerTableView?.open();
    if (e.target.closest("[data-lobby]")) { setRoom(""); return render(); }
    if (e.target.closest("[data-leave]")) {
      const night = nightNow(), name = me(); if (!night || !name) return;
      const v = V(night), inHand = v.hand.bet && !v.hand.bet.done && v.hand.bet.players.find(p => p.name === name && !p.folded);
      if (inHand) return toast("หมอบหรือรอจบตานี้ก่อน แล้วค่อยลุก");
      if (!confirm("ลุกจากโต๊ะ? ตาต่อไปจะไม่ถูกแจกไพ่ กลับมานั่งใหม่ได้")) return;
      change(P.leave(poker, night.id, name));
      const net = V(nightNow() || night).players.find(p => p.name === name)?.net;
      return toast(night.credit && net ? `ลุกแล้ว • คุณ${net > 0 ? "ได้" : "เสีย"} ${chips(Math.abs(net))}` : "ลุกจากโต๊ะแล้ว");
    }
    if (!e.target.closest("#pJoin")) return;
    const name = me(); if (!name) return;
    // Pick up the latest table first, so a night someone just opened on another phone is the one we sit at.
    if (!cloudOff) { await syncNow(); }
    const night = nightNow(); if (!night) return toast("ยังไม่มีวงเปิดอยู่");
    const seen = V(night).players.find(p => p.name === name);
    if (seen?.seated) return render();
    change(P.join(poker, night.id, name)); toast(night.credit || seen ? "นั่งโต๊ะแล้ว" : `เข้าโต๊ะแล้ว • ซื้อ ${chips(night.buyIn)}`);
    // Sitting down opens the table view (same tap, so fullscreen and the landscape lock are allowed).
    window.PokerTableView?.open();
  });
  // ---- เดิมพัน: the hand being bet, replayed by PokerBet from the deal and every action ----
  let raiseDraft = { key: "", value: "" };
  const tag = (on, text, cls = "") => on ? `<span class="pb-tag ${cls}">${text}</span>` : "";
  // ไพ่จริง (cards dealt at the table, entered by hand) or แจกในแอป (the app shuffles and deals). Switch between hands.
  function modeSwitch(v, seated) {
    if (serverReady === null) probeServer();
    const busy = v.hand.bet && !v.hand.bet.done, opt = (m, label, off = false) => `<button type="button" class="pb-mode-opt" data-mode="${m}" aria-pressed="${v.mode === m}"${busy || !seated || off ? " disabled" : ""}>${label}</button>`;
    const note = { app: "แอปสับไพ่และแจกให้ ไพ่ในมือเห็นแค่ในมือถือของแต่ละคน • เครื่องที่กดแจกเป็นคนสับ", server: "เซิร์ฟเวอร์สับและเก็บสำรับไว้ ไม่มีใครเห็นไพ่ของคนอื่น รวมถึงคนที่กดแจก" }[v.mode];
    return `<div class="pb-mode" role="group" aria-label="วิธีแจกไพ่">${opt("real", "ไพ่จริง")}${opt("app", "แจกในแอป")}${opt("server", "เซิร์ฟเวอร์แจก", serverReady === false && v.mode !== "server")}</div>`
      + (note || busy ? `<p class="muted pb-hint">${busy ? "ตาถัดไปค่อยสลับโหมดได้" : ""}${busy && note ? " • " : ""}${note || ""}</p>` : "")
      + (serverReady === false ? '<p class="muted pb-hint">เซิร์ฟเวอร์แจกยังไม่เปิดใช้ (เจ้าของเว็บต้องรัน SQL ไฟล์ poker_server_deal ก่อน)</p>' : "");
  }
  function renderBet(v, myName) {
    const el = $("pBet"), bet = v.hand.bet, n = v.night, seated = v.players.some(p => p.name === myName && p.seated);
    el.hidden = false;
    const canDeal = seated && v.players.filter(p => p.seated && p.stack > 0).length >= 2;
    // Rooms: a row shows the player's chips won or lost so far instead of a stack.
    const unit = " ชิป", stackOf = p => n.credit ? chips(p.stack - P.CREDIT, true) : p.stack.toLocaleString("th-TH");
    const head = `<div class="pb-head"><h2 id="pbTitle">เดิมพัน</h2><span class="muted">บลายด์ ${n.sb}/${n.bb}${unit}</span></div>${modeSwitch(v, seated)}`;
    if (!bet) {
      el.innerHTML = `${head}<p class="muted">กดแจกไพ่เพื่อเริ่มตา ระบบวางบลายด์ บอกว่าใครถึงตา และจ่ายกองให้คนชนะ</p>${canDeal ? `<button type="button" class="primary pb-wide" data-bet="deal">แจกไพ่ • เริ่มตาที่ ${v.hand.deals + 1}</button>` : `<p class="muted">${seated ? (n.credit ? "ต้องมีคนนั่งอย่างน้อย 2 คน" : "ต้องมีคนที่มีชิปอย่างน้อย 2 คน") : "กดนั่งโต๊ะก่อนถึงจะเล่นได้"}</p>`}`;
      return;
    }
    const mine = bet.players.find(p => p.name === myName), myTurn = bet.toAct && bet.toAct === myName;
    const rows = bet.players.map(p => `<div class="pb-seat${p.name === bet.toAct ? " pb-turn" : ""}${p.folded ? " pb-out" : ""}"><span class="pb-name">${avatarFor(p.name)}<b>${esc(p.name)}</b>${tag(p.name === bet.button, "D", "pb-d")}${tag(p.name === bet.sbName, "SB")}${tag(p.name === bet.bbName, "BB")}</span><span class="pb-stack">${esc(stackOf(p))}</span><span class="pb-in">${p.folded ? "หมอบ" : p.allIn ? "ออลอิน" : p.streetBet ? `ลง ${p.streetBet.toLocaleString("th-TH")}` : p.name === bet.toAct ? "ถึงตา" : ""}</span></div>`).join("");
    let body = "";
    if (bet.street < 4) {
      if (myTurn) {
        const key = `${v.hand.key}:${bet.street}:${bet.currentBet}`, canRaise = bet.maxTo > bet.currentBet;
        if (raiseDraft.key !== key) raiseDraft = { key, value: String(bet.minTo) };
        const allInCall = bet.toCall >= mine.stack;
        body = `<div class="pb-acts"><button type="button" class="secondary" data-bet="fold">หมอบ</button>${bet.toCall ? `<button type="button" class="primary" data-bet="call">${allInCall ? "คอล ออลอิน" : "คอล"} ${bet.toCall.toLocaleString("th-TH")}</button>` : '<button type="button" class="primary" data-bet="check">เช็ค</button>'}</div>`
          + (canRaise ? `<div class="pb-raise"><label for="pbTo">${bet.currentBet ? "เรสเป็น" : "เบท"}</label><input id="pbTo" type="number" inputmode="numeric" min="${bet.minTo}" max="${bet.maxTo}" value="${esc(raiseDraft.value)}"><button type="button" class="primary" data-bet="raise">${bet.currentBet ? "เรส" : "เบท"}</button></div><div class="pb-quick"><button type="button" class="secondary" data-to="${bet.minTo}">ขั้นต่ำ</button><button type="button" class="secondary" data-to="${potTo(bet, .5)}">½ กอง</button><button type="button" class="secondary" data-to="${potTo(bet, 1)}">เต็มกอง</button>${n.credit ? "" : `<button type="button" class="secondary" data-to="${bet.maxTo}">ออลอิน ${bet.maxTo.toLocaleString("th-TH")}</button>`}</div>` : "");
      } else body = `<p class="pb-wait">${bet.toAct ? `รอ <b>${esc(bet.toAct)}</b> ตัดสินใจ${mine && !mine.folded ? " • ถึงตาคุณแล้วปุ่มจะขึ้นตรงนี้" : ""}` : ""}</p>`;
      const boardIn = v.hand.board.filter(c => c !== null).length, need = [0, 3, 4, 5][bet.street];
      if (bet.street > 0 && boardIn < need) body += `<p class="muted pb-hint">เปิดไพ่${bet.streetName}แล้วใส่ในส่องไพ่ได้ (ไม่บังคับ แต่ถ้าใส่ครบและทุกคนเปิดไพ่ ระบบตัดสินกองให้เอง)</p>`;
    } else {
      body = bet.pots.map((pot, k) => {
        const label = bet.pots.length > 1 ? (k ? `กองข้าง ${k}` : "กองกลาง") : "กองกลาง";
        if (pot.winners) return `<div class="pb-pot"><span>${label} <b>${pot.amount.toLocaleString("th-TH")}</b></span><span class="pos">${pot.winners.map(esc).join(", ")} ได้${pot.hand ? ` (${esc(pot.hand)})` : ""}</span></div>`;
        return `<div class="pb-pot pb-pending"><span><span>${label} <b>${pot.amount.toLocaleString("th-TH")}</b></span><span>ใครชนะ?</span></span><span class="pb-pick">${pot.eligible.map(nm => `<button type="button" class="secondary" data-win="${k}" data-name="${esc(nm)}" aria-pressed="false">${esc(nm)}</button>`).join("")}${seated ? `<button type="button" class="primary" data-award="${k}">ให้กองนี้</button>` : ""}</span><small class="muted">เลือกได้หลายคนถ้าแบ่งกอง • หรือใส่ไพ่ครบในส่องไพ่ให้ระบบตัดสิน</small></div>`;
      }).join("");
      if (bet.done) body += `<div class="pb-result">${bet.players.map(p => { const d = bet.delta[p.name] || 0; return `<span class="${d > 0 ? "pos" : d < 0 ? "neg" : ""}">${esc(p.name)} ${d > 0 ? "+" : ""}${d.toLocaleString("th-TH")}</span>`; }).join("")}</div>`;
    }
    const dealBtn = canDeal ? `<button type="button" class="${bet.done ? "primary" : "secondary"} pb-wide" data-bet="deal">${bet.done ? `แจกไพ่ตาใหม่ (ตาที่ ${v.hand.deals + 1})` : "ยกเลิกตานี้ แจกใหม่"}</button>` : "";
    el.innerHTML = `${head}<div class="pb-street"><span>ตาที่ ${v.hand.no} • <b>${bet.streetName}</b></span><span class="pb-pot-total">กอง <b>${bet.pot.toLocaleString("th-TH")}</b></span></div><div class="pb-seats">${rows}</div>${body}${dealBtn}`;
  }
  // Raise-to for a fraction of the pot: call first, then raise by that share of the pot after the call.
  function potTo(bet, share) { const to = bet.currentBet + Math.round((bet.pot + bet.toCall) * share); return Math.max(bet.minTo, Math.min(bet.maxTo, to)); }
  $("pBet").addEventListener("input", e => { if (e.target.id === "pbTo") raiseDraft.value = e.target.value; });
  $("pBet").addEventListener("click", e => {
    const night = nightNow(), name = me(); if (!night || !name) return;
    const quick = e.target.closest("[data-to]"); if (quick) { raiseDraft.value = quick.dataset.to; $("pbTo").value = quick.dataset.to; return; }
    const pickBtn = e.target.closest("[data-win]"); if (pickBtn) { pickBtn.setAttribute("aria-pressed", String(pickBtn.getAttribute("aria-pressed") !== "true")); return; }
    const awardBtn = e.target.closest("[data-award]");
    if (awardBtn) {
      const k = Number(awardBtn.dataset.award), names = [...$("pBet").querySelectorAll(`[data-win="${k}"][aria-pressed="true"]`)].map(b => b.dataset.name);
      if (!names.length) return toast("แตะชื่อคนชนะก่อน");
      change(P.award(poker, night.id, k, names)); return;
    }
    const b = e.target.closest("[data-bet]"); if (!b) return;
    const v = V(night), bet = v.hand.bet, a = b.dataset.bet;
    const modeBtn = e.target.closest("[data-mode]");
    if (modeBtn) { if (V(night).mode !== modeBtn.dataset.mode) change(P.setMode(poker, night.id, modeBtn.dataset.mode)); return; }
    if (a === "deal") {
      if (bet && !bet.done && !confirm("ตานี้ยังไม่จบ ยกเลิกแล้วแจกใหม่? ทุกคนได้ชิปที่ลงไปคืน")) return;
      window.PokerTable.deal(); return;
    }
    if (!bet || bet.toAct !== name) return toast("ยังไม่ถึงตาคุณ");
    if (a === "raise") {
      const to = Math.round(Number($("pbTo").value));
      if (!(to >= bet.minTo && to <= bet.maxTo)) return toast(`ใส่ ${bet.minTo.toLocaleString("th-TH")}–${bet.maxTo.toLocaleString("th-TH")} ชิป`);
      change(P.act(poker, night.id, name, "raise", to)); return;
    }
    change(P.act(poker, night.id, name, a));
  });
  const nightNow = () => (roomId && openRooms().find(n => n.id === roomId)) || null;
  $("pPlayers").addEventListener("click", e => {
    const b = e.target.closest("[data-buy]"); const night = nightNow(); if (!b || !night) return;
    change(P.addEvent(poker, night.id, { t: "buy", name: b.dataset.buy, amount: night.buyIn }));
    toast(`${b.dataset.buy} ซื้อเพิ่ม ${chips(night.buyIn)}`);
  });
  $("pPlayers").addEventListener("change", e => {
    const input = e.target.closest("[data-out]"), night = nightNow(); if (!input || !night) return;
    const name = input.dataset.out, prev = V(night).players.find(p => p.name === name)?.out ?? null;
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
  $("pCheck").addEventListener("click", e => {
    if (!e.target.closest("#pFill")) return;
    const night = nightNow(); if (!night) return;
    let next = poker;
    V(night).players.forEach(p => { if (p.out !== p.stack) next = P.addEvent(next, night.id, { t: "out", name: p.name, amount: p.stack }); });
    change(next); toast("ใส่ชิปตามโต๊ะแล้ว");
  });
  $("pLateAdd").addEventListener("click", () => addGuest($("pLate"), name => {
    const night = nightNow(); if (!night) return;
    if (V(night).players.some(p => p.name === name)) return toast("มีชื่อนี้ในวงแล้ว");
    let next = P.addEvent(poker, night.id, { t: "join", name }); next = P.addEvent(next, night.id, { t: "buy", name, amount: night.buyIn });
    change(next); toast(`${name} เข้าวง • ซื้อ ${chips(night.buyIn)}`);
  }));
  $("pLate").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("pLateAdd").click(); } });
  $("pUndo").addEventListener("click", () => {
    const night = nightNow(), last = night && V(night).lastAction; if (!last) return;
    const what = last.t === "buy" ? `${last.name} ซื้อ ${chips(last.amount)}` : last.t === "out" ? `ชิปของ ${last.name} (${last.amount})` : last.amount ? `${last.name} เข้าโต๊ะ (${chips(last.amount)})` : `${last.name} เข้าวง`;
    change(P.addEvent(poker, night.id, { t: "undo", ref: last.id })); toast(`ย้อนแล้ว: ${what}`);
  });
  $("pClose").addEventListener("click", () => {
    const night = nightNow(); if (!night) return;
    const v = V(night);
    if (!v.balanced && !confirm("ชิปยังไม่ครบหรือยังใส่ไม่ครบทุกคน จบวงเลยไหม?")) return;
    if (v.balanced && !confirm(night.credit ? "ปิดห้องนี้แล้วเก็บผลได้เสียเข้าประวัติ? ทุกคนจะออกจากห้อง" : "จบวงนี้แล้วเก็บเข้าประวัติ?")) return;
    change(P.closeNight(poker, night.id)); setRoom(""); render(); toast(night.credit ? "ปิดห้องแล้ว • ดูสรุปในประวัติ" : "จบวงแล้ว");
  });
  async function copyText(text) { try { await navigator.clipboard.writeText(text); toast("คัดลอกแล้ว วางในไลน์ได้เลย"); } catch { prompt("คัดลอกข้อความนี้", text); } }
  const dayText = at => new Date(at).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });
  const lineText = night => { const v = V(night); return [`♠️ อันดับชิปโป๊กเกอร์ ${dayText(night.startedAt)}${night.name ? ` • ${night.name}` : ""} (เล่น ${v.hand.deals} ตา)`, ...v.players.slice().sort((a, b) => (b.net ?? 0) - (a.net ?? 0)).map((p, i) => `${i + 1}. ${p.name} ${chips(p.net ?? 0, true)}`)].join("\n"); };
  $("pPayCopy").addEventListener("click", () => { const night = nightNow(); if (night) copyText(lineText(night)); });

  // ---- history ----
  function renderHistory() {
    const list = P.history(poker).filter(n => n.credit);
    $("pHistCard").hidden = !list.length;
    $("pHist").innerHTML = list.map((night, i) => {
      const v = V(night);
      const rows = v.players.slice().sort((a, b) => (b.net ?? -1e9) - (a.net ?? -1e9)).map(p => `<span class="${p.net > 0 ? "pos" : p.net < 0 ? "neg" : ""}">${esc(p.name)} ${p.net === null ? "–" : esc(chips(p.net, true))}</span>`).join("");
      return `<details class="d-day"${i === 0 ? " open" : ""}><summary><b>${esc(dayText(night.startedAt))}</b><span class="muted">${esc(night.name ? `${night.name} • ` : "")}${v.players.length} คน • ${v.hand.deals} ตา</span></summary><div class="d-preview-list">${rows}</div><button type="button" class="secondary" data-copy-night="${esc(night.id)}">คัดลอกอันดับไปส่งในไลน์</button></details>`;
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
    if (night) renderNight(night); else { $("pSeat").innerHTML = ""; $("pBet").hidden = true; renderSetup(); }
    // A sync while someone is typing a chip count keeps their cursor in that box.
    if (typing) { const box = [...document.querySelectorAll("[data-out]")].find(x => x.dataset.out === typing); box?.focus(); }
    renderHistory();
    document.dispatchEvent(new CustomEvent("poker:table"));
    if (night) setTimeout(() => { appChores(night.id); serverSync(); }, 0);
  }
  // แจกในแอป housekeeping, run after every redraw on each phone at the table:
  // publish this phone's key, open my sealed cards, turn the board over (the phone that dealt), reveal at showdown.
  let choring = false;
  async function appChores(nightId) {
    const D = window.PokerDeal, name = me(), night = nightNow();
    if (choring || !D || !name || !night || night.id !== nightId || !globalThis.crypto?.subtle) return;
    let v = V(night); if (!v.players.some(p => p.name === name)) return;
    choring = true;
    try {
      const pub = (await D.myKeys()).pub;
      if (v.keys[name] !== pub) { change(P.setKey(poker, night.id, name, pub)); return; }
      const h = v.hand, bet = h.bet; if (!h.app) return;
      if (h.holes?.[name] && !D.myCards(h.key) && await D.unlock(h.key, h.epk, h.holes[name])) { document.dispatchEvent(new CustomEvent("poker:mine")); render(); return; }
      if (!bet) return;
      const live = bet.players.filter(p => !p.folded), board = D.boardFor(h.key);
      if (h.by === name && board) {
        const target = bet.street >= 4 ? (live.length >= 2 ? 5 : 0) : [0, 3, 4, 5][bet.street];
        let next = poker, changed = false;
        for (let i = 0; i < target; i++) if (h.board[i] === null) { next = P.setBoard(next, night.id, i, board[i]); changed = true; }
        if (changed) { change(next); return; }
      }
      const mine = D.myCards(h.key);
      if (bet.street >= 4 && live.length >= 2 && h.board.every(c => c !== null) && live.some(p => p.name === name) && !h.shown[name] && mine) change(P.show(poker, night.id, name, mine));
    } catch {} finally { choring = false; }
  }
  // A new hand. แจกในแอป: shuffle here, seal each seat's two cards to that player's key, keep the board on this phone.
  async function dealHand() {
    const night = nightNow(); if (!night) return;
    const v = V(night), D = window.PokerDeal;
    if (v.mode === "server") return dealServer(night);
    if (v.mode !== "app") { change(P.deal(poker, night.id, null, ext())); return toast(`แจกไพ่ตาที่ ${V(nightNow()).hand.no}`); }
    if (!D || !globalThis.crypto?.subtle) return toast("มือถือเครื่องนี้แจกในแอปไม่ได้ • ใช้โหมดไพ่จริงแทน");
    const { seats } = P.nextDeal(night, ext()), missing = seats.filter(nm => !v.keys[nm]);
    if (seats.length < 2) return toast("ต้องมีคนที่มีชิปอย่างน้อย 2 คน");
    if (missing.length) return toast(`${missing.join(", ")} ยังไม่ได้เปิดหน้าโป๊กเกอร์ในมือถือตัวเอง • แจกในแอปต้องให้ทุกคนเปิดก่อน`);
    const deck = D.shuffle(), hands = Object.fromEntries(seats.map((nm, i) => [nm, [deck[i], deck[i + seats.length]]]));
    const sealed = await D.seal(Object.fromEntries(seats.map(nm => [nm, v.keys[nm]])), hands);
    const current = nightNow(); if (!current || current.id !== night.id) return;
    change(P.deal(poker, night.id, { mode: "app", by: me(), epk: sealed.epk, holes: sealed.boxes }, ext()));
    const h = V(nightNow()).hand;
    if (!h.app) return toast("คนในโต๊ะเปลี่ยนระหว่างแจก • กดแจกใหม่อีกครั้ง");
    D.saveBoard(h.key, deck.slice(seats.length * 2, seats.length * 2 + 5));
    toast(`แจกไพ่ตาที่ ${h.no} • ไพ่ของแต่ละคนอยู่ในมือถือตัวเอง`);
  }
  // แจกจากเซิร์ฟเวอร์: the server shuffles first (under a fresh deal id), then the deal event goes into the row.
  async function dealServer(night) {
    if (!(await probeServer())) return toast("เซิร์ฟเวอร์แจกยังไม่เปิดใช้ • ใช้ไพ่จริงหรือแจกในแอปแทน");
    const next = P.nextDeal(night, ext()), id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    if (next.seats.length < 2) return toast("ต้องมีคนที่มีชิปอย่างน้อย 2 คน");
    try { srv = { key: id, ...normState(await rpc("pp_poker_deal", { p_night: night.id, p_hand: id, p_seats: next.seats })), mine: null, at: Date.now() }; }
    catch (error) { return toast(`แจกไม่ได้: ${error.message}`); }
    change(P.deal(poker, night.id, { ...next, id, mode: "server", by: me() }, ext()));
    toast(`แจกไพ่ตาที่ ${V(nightNow()).hand.no} • เซิร์ฟเวอร์สับให้แล้ว`);
    serverSync(true);
  }
  const normState = st => ({ board: Array.isArray(st?.board) ? st.board.filter(Number.isInteger).slice(0, 5) : [], shown: st?.shown && typeof st.shown === "object" ? st.shown : {} });
  // Keeps srv up to date for the hand being played, turns the board over when a betting round ends, shows my cards
  // at the showdown. Any seated phone may do it; the server only ever moves forward, so doing it twice is harmless.
  async function serverSync(force = false) {
    const night = nightNow(), name = me(); if (!night || !name || serverBusy) return;
    let v = V(night), h = v.hand;
    if (!h.server || !h.bet?.players.some(p => p.name === name)) return;
    if (!force && srv.key === h.key && Date.now() - srv.at < 2000) return;
    serverBusy = true;
    try {
      const args = { p_night: night.id, p_hand: h.key };
      const before = JSON.stringify([srv.key, srv.board, srv.shown, srv.mine]);
      if (srv.key !== h.key) srv = { key: h.key, board: [], shown: {}, mine: null, at: 0 };
      Object.assign(srv, normState(await rpc("pp_poker_hand", args)), { at: Date.now() });
      if (!srv.mine) { const c = await rpc("pp_poker_my_cards", args); if (Array.isArray(c) && c.length === 2) srv.mine = c; }
      v = V(night); h = v.hand;
      const bet = h.bet, live = bet ? bet.players.filter(p => !p.folded) : [];
      if (bet) {
        const target = bet.street >= 4 ? (live.length >= 2 ? 5 : 0) : [0, 3, 4, 5][bet.street];
        if (srv.board.length < target) Object.assign(srv, normState(await rpc("pp_poker_board", { ...args, p_count: target })));
        v = V(night); h = v.hand;
        if (bet.street >= 4 && live.length >= 2 && srv.board.length === 5 && live.some(p => p.name === name) && !srv.shown[name]) Object.assign(srv, normState(await rpc("pp_poker_show", args)));
      }
      if (JSON.stringify([srv.key, srv.board, srv.shown, srv.mine]) !== before) { render(); document.dispatchEvent(new CustomEvent("poker:mine")); }
    } catch {} finally { serverBusy = false; }
  }
  async function showServer() {
    const night = nightNow(), h = night && V(night).hand; if (!h?.server) return;
    try { Object.assign(srv, normState(await rpc("pp_poker_show", { p_night: night.id, p_hand: h.key }))); render(); } catch (error) { toast(`เปิดไพ่ไม่ได้: ${error.message}`); }
  }
  // The shared hand for ส่องไพ่ (poker-cards.js): only for a player seated at the open night.
  window.PokerTable = Object.freeze({
    get() {
      const night = nightNow(), name = me(); if (!night || !name) return null;
      const v = V(night), inHand = n => v.hand.bet?.players.some(p => p.name === n);
      if (!v.players.some(p => p.name === name && (p.seated || inHand(name)))) return null;
      const sitting = v.players.filter(p => p.seated || inHand(p.name));
      return { nightId: night.id, me: name, players: sitting.map(p => p.name), hand: v.hand, handKey: `${night.id}:${v.hand.key}`,
        bet: v.hand.bet, stacks: Object.fromEntries(v.players.map(p => [p.name, p.stack])), sb: night.sb, bb: night.bb, credit: night.credit,
        nets: Object.fromEntries(v.players.map(p => [p.name, p.net])),
        canDeal: sitting.filter(p => p.seated && p.stack > 0).length >= 2, rate: v.rate, mode: v.mode, app: v.hand.app || v.hand.server, server: v.hand.server,
        myCards: v.hand.app ? window.PokerDeal?.myCards(v.hand.key) || null : v.hand.server ? (srv.key === v.hand.key ? srv.mine : null) : null };
    },
    act(a, to) { const night = nightNow(), name = me(); if (night && name) change(P.act(poker, night.id, name, a, to)); },
    award(pot, names) { const night = nightNow(); if (night) change(P.award(poker, night.id, pot, names)); },
    setBoard(i, card) { const night = nightNow(); if (night) change(P.setBoard(poker, night.id, i, card)); },
    show(cards) { const night = nightNow(), name = me(); if (!night || !name) return; if (V(night).hand.server) return showServer(); change(P.show(poker, night.id, name, cards)); },
    fold() { const night = nightNow(), name = me(); if (night && name) change(P.fold(poker, night.id, name)); },
    deal: dealHand
  });
  render();
  if (cloudOff) setSync("ออฟไลน์ • เก็บในเครื่อง", "offline");
  else {
    syncNow();
    // Every 2.5 s while a table is open (someone may be waiting on your bet), otherwise every 6 s.
    let lastPoll = 0;
    setInterval(() => { const gap = nightNow() ? 2500 : 6000; if (document.hidden || Date.now() - lastPoll < gap || document.activeElement?.matches?.("[data-out],#pbTo")) return; lastPoll = Date.now(); syncNow(); serverSync(); }, 500);
    addEventListener("online", syncNow);
    if (dirty) queueSync();
  }
})();
