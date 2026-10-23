// ดัมมี่ออนไลน์ (dummy-online.html): the game itself and the rooms it is played in. Pure code, tested in
// tests/dummy-game.test.cjs; the page is dummy-online.js.
//
// A card is 0..51: rank = c >> 2 (0 = 2 … 12 = A), suit = c & 3 (♠ ♥ ♦ ♣), the same numbering as poker-cards.js.
// A game is its seed (the shuffled deck), its seats and dealer, plus the list of moves; every phone replays the moves
// from the deal and so sees the same table. The deck sits in the shared row, so this is a friends' game: the page only
// shows each player their own cards (same trust as แจกในแอป in poker).
//
// Rules (common Thai Dummy):
//   2 players get 11 cards, 3 get 9, 4 get 7; the next card is turned up as the first card of the discard pile (หัว).
//   A turn: draw from the stock (จั่ว) or pick a card from the discard pile (เก็บ) together with every card discarded
//   after it, and meld that card at once with cards from your hand. Then meld (ลง) sets of 3-4 of a rank or runs of
//   3+ in a suit (A is low or high, no wrapping), lay cards off (ฝาก) on any meld once you have a meld of your own,
//   and discard one card (ทิ้ง). Discarding your last card is a knock (น็อค) and ends the game; so does the discard
//   after the last stock card is drawn.
//   Points: 2-9 = 5, 10/J/Q/K = 10, A = 15, 2♣ and Q♠ (สเปโต) = 50. Cards you melded or laid off count for you, cards
//   left in your hand count against you. Melding the head card +50. Knock +50, doubled for น็อคมืด (everything melded in
//   the knocking turn) and doubled again for น็อคสี (every card you played is one suit). A discard that someone picks
//   up and melds costs the discarder 50 when it was a สเปโต (ทิ้งสเปโต) or could have been laid off (ทิ้งโง่).
const DummyGame = (() => {
  const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
  const SUITS = ["♠", "♥", "♦", "♣"], SUIT_NAMES = ["โพดำ", "โพแดง", "ข้าวหลามตัด", "ดอกจิก"];
  const rank = c => c >> 2, suit = c => c & 3;
  const valid = c => Number.isInteger(c) && c >= 0 && c < 52;
  const SPECIAL = [3, 40]; // 2♣, Q♠
  const HAND_SIZE = { 2: 11, 3: 9, 4: 7 }, BONUS = 50;
  const label = c => `${RANKS[rank(c)]}${SUITS[suit(c)]}`;
  const speak = c => `${RANKS[rank(c)]} ${SUIT_NAMES[suit(c)]}`;
  const red = c => suit(c) === 1 || suit(c) === 2;
  function points(c) { if (SPECIAL.includes(c)) return 50; const r = rank(c); return r === 12 ? 15 : r >= 8 ? 10 : 5; }
  const ART = "vendor/playing-cards/";
  const art = c => `${ART}${RANKS[rank(c)]}${"SHDC"[suit(c)]}.svg`, BACK = `${ART}Red_Back.svg`;

  // "set" (ตอง), "run" (เรียง) or null.
  function meldKind(cards) {
    if (!Array.isArray(cards) || cards.length < 3 || !cards.every(valid) || new Set(cards).size !== cards.length) return null;
    if (cards.every(c => rank(c) === rank(cards[0]))) return cards.length <= 4 ? "set" : null;
    if (!cards.every(c => suit(c) === suit(cards[0]))) return null;
    const steps = list => list.sort((a, b) => a - b).every((r, i) => !i || r === list[i - 1] + 1);
    return steps(cards.map(rank)) || steps(cards.map(c => rank(c) === 12 ? -1 : rank(c))) ? "run" : null;
  }
  // A meld in reading order: a run low to high (A first when it is A-2-3), a set by suit.
  function sortMeld(cards) {
    if (meldKind(cards) !== "run") return cards.slice().sort((a, b) => suit(a) - suit(b));
    const low = cards.some(c => rank(c) === 0) && !cards.some(c => rank(c) === 11);
    return cards.slice().sort((a, b) => (low && rank(a) === 12 ? -1 : rank(a)) - (low && rank(b) === 12 ? -1 : rank(b)));
  }
  // A hand sorted by suit then rank (or by rank then suit).
  const sortHand = (cards, byRank = false) => cards.slice().sort((a, b) => byRank ? rank(a) - rank(b) || suit(a) - suit(b) : suit(a) - suit(b) || rank(a) - rank(b));

  // Deterministic shuffle from the game's seed (xmur3 hash → mulberry32), so every phone deals the same deck.
  function shuffle(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    const rand = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const deck = Array.from({ length: 52 }, (_, c) => c);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    return deck;
  }

  // The table right after the deal. game: { seed, seats: [names], dealer: seat index }.
  function deal(game) {
    const seats = game.seats, n = seats.length, deck = shuffle(String(game.seed)), size = HAND_SIZE[n] || 7;
    const hands = Object.fromEntries(seats.map(s => [s, []]));
    let k = 0;
    for (let r = 0; r < size; r++) for (let i = 1; i <= n; i++) hands[seats[(game.dealer + i) % n]].push(deck[k++]);
    return {
      seats: seats.slice(), hands, stock: deck.slice(k + 1), pile: [{ c: deck[k], by: null, head: true }], melds: [],
      turn: (game.dealer + 1) % n, phase: "draw", turnNo: 0, drawn: null, firstPlay: {}, extras: Object.fromEntries(seats.map(s => [s, []])),
      over: null, last: null
    };
  }
  const total = list => list.reduce((s, x) => s + x, 0);
  // Applies one move to the table (in place). Returns null, or why the move is not allowed.
  function apply(s, act) {
    if (s.over) return "เกมจบแล้ว";
    const who = s.seats[s.turn];
    if (!act || act.by !== who) return "ยังไม่ถึงตาคุณ";
    const hand = s.hands[who], n = s.seats.length;
    const holds = cs => Array.isArray(cs) && cs.every(c => hand.includes(c)) && new Set(cs).size === cs.length;
    const take = cs => cs.forEach(c => hand.splice(hand.indexOf(c), 1));
    const played = () => { if (s.firstPlay[who] === undefined) s.firstPlay[who] = s.turnNo; };
    const addMeld = cards => { s.melds.push({ id: s.melds.length, owner: who, cards: sortMeld(cards).map(c => ({ c, by: who })) }); played(); };
    const extra = (name, why, pts) => s.extras[name].push({ why, pts });
    if (act.a === "draw") {
      if (s.phase !== "draw") return "จั่วหรือเก็บไปแล้วในตานี้";
      if (!s.stock.length) return "กองจั่วหมดแล้ว";
      const c = s.stock.shift(); hand.push(c); s.drawn = c; s.phase = "play";
      s.last = { by: who, a: "draw" };
      return null;
    }
    if (act.a === "pick") {
      if (s.phase !== "draw") return "จั่วหรือเก็บไปแล้วในตานี้";
      const i = act.i;
      if (!Number.isInteger(i) || i < 0 || i >= s.pile.length) return "แตะเลือกไพ่ในกองทิ้งก่อน";
      const target = s.pile[i], others = s.pile.slice(i + 1).map(x => x.c), withCards = Array.isArray(act.with) ? act.with : [];
      const pool = [...hand, ...others];
      if (!withCards.every(c => pool.includes(c)) || new Set(withCards).size !== withCards.length) return "เลือกไพ่ในมือที่จะลงคู่กับใบที่เก็บ";
      if (!meldKind([target.c, ...withCards])) return `ไพ่ที่เก็บต้องลงเป็นชุดทันที: เลือกไพ่ในมือที่เข้าชุดกับ ${label(target.c)} (ตองหรือเรียง 3 ใบขึ้นไป)`;
      if (hand.length + others.length - withCards.length < 1) return "ต้องเหลือไพ่ไว้ทิ้งอย่างน้อย 1 ใบ";
      s.pile = s.pile.slice(0, i); hand.push(...others); take(withCards);
      addMeld([target.c, ...withCards]);
      if (target.head) extra(who, "เก็บหัว", BONUS);
      if (target.by && target.by !== who && target.dumb) extra(target.by, target.dumb, -BONUS);
      s.phase = "play"; s.drawn = null;
      s.last = { by: who, a: "pick", c: target.c, count: others.length + 1 };
      return null;
    }
    if (s.phase !== "play") return "จั่วหรือเก็บไพ่ก่อน";
    if (act.a === "meld") {
      if (!holds(act.cards)) return "เลือกไพ่ในมือที่จะลง";
      if (!meldKind(act.cards)) return "ลงได้เฉพาะตอง (3-4 ใบหน้าเดียวกัน) หรือเรียง (3 ใบขึ้นไป ดอกเดียวกัน)";
      if (hand.length - act.cards.length < 1) return "ต้องเหลือไพ่ไว้ทิ้งอย่างน้อย 1 ใบ";
      take(act.cards); addMeld(act.cards);
      s.last = { by: who, a: "meld", cards: act.cards.slice() };
      return null;
    }
    if (act.a === "lay") {
      const meld = s.melds[act.m];
      if (!holds([act.c])) return "เลือกไพ่ 1 ใบที่จะฝาก";
      if (!meld) return "แตะชุดบนโต๊ะที่จะฝาก";
      if (!s.melds.some(m => m.owner === who)) return "ต้องลงชุดของตัวเองก่อนถึงจะฝากได้";
      if (!meldKind([...meld.cards.map(x => x.c), act.c])) return `${label(act.c)} ต่อชุดนี้ไม่ได้`;
      if (hand.length - 1 < 1) return "ต้องเหลือไพ่ไว้ทิ้งอย่างน้อย 1 ใบ";
      take([act.c]);
      const order = sortMeld([...meld.cards.map(x => x.c), act.c]), by = new Map(meld.cards.map(x => [x.c, x.by]));
      meld.cards = order.map(c => ({ c, by: c === act.c ? who : by.get(c) }));
      played();
      s.last = { by: who, a: "lay", c: act.c, m: meld.id };
      return null;
    }
    if (act.a === "discard") {
      if (!holds([act.c])) return "เลือกไพ่ 1 ใบที่จะทิ้ง";
      const c = act.c;
      const dumb = SPECIAL.includes(c) ? "ทิ้งสเปโต" : s.melds.some(m => meldKind([...m.cards.map(x => x.c), c])) ? "ทิ้งโง่" : "";
      take([c]); s.pile.push({ c, by: who, dumb });
      s.last = { by: who, a: "discard", c };
      if (!hand.length) {
        const mine = s.melds.flatMap(m => m.cards).filter(x => x.by === who).map(x => x.c);
        const dark = s.firstPlay[who] === s.turnNo, color = mine.length > 0 && mine.every(x => suit(x) === suit(mine[0]));
        s.over = { reason: "knock", knocker: who, dark, color };
        extra(who, `น็อค${dark ? "มืด" : ""}${color ? "สี" : ""}`, BONUS * (dark ? 2 : 1) * (color ? 2 : 1));
      } else if (!s.stock.length) s.over = { reason: "stock" };
      else { s.turn = (s.turn + 1) % n; s.phase = "draw"; s.turnNo++; s.drawn = null; }
      return null;
    }
    return "ไม่รู้จักท่านี้";
  }
  // Replays a game: the table after every allowed move (moves that were not allowed are skipped).
  function play(game, acts = []) {
    const s = deal(game);
    acts.forEach(a => apply(s, a));
    return s;
  }
  // Would this move be allowed? null, or the reason it is not. Leaves the table as it is.
  function check(s, act) { return apply(JSON.parse(JSON.stringify(s)), act); }
  // Points of a finished (or running) table, per seat: played (melded and laid off), hand (still held), extras.
  function score(s) {
    return Object.fromEntries(s.seats.map(name => {
      const played = total(s.melds.flatMap(m => m.cards).filter(x => x.by === name).map(x => points(x.c)));
      const hand = total(s.hands[name].map(points)), extras = total(s.extras[name].map(x => x.pts));
      return [name, { played, hand, extras, list: s.extras[name].slice(), total: played - hand + extras }];
    }));
  }
  // Which melds a card could be laid off on.
  const fits = (s, c) => s.melds.filter(m => meldKind([...m.cards.map(x => x.c), c])).map(m => m.id);
  return Object.freeze({ RANKS, SUITS, SUIT_NAMES, SPECIAL, HAND_SIZE, BONUS, rank, suit, valid, label, speak, red, points, art, BACK,
    meldKind, sortMeld, sortHand, shuffle, deal, apply, play, check, score, fits });
})();

// Rooms live under `online` inside the `dummy` column of the shared row (same rev lock as the score sheet and the
// poker nights; dummy.js and poker.js carry it along untouched). A room is a list of events, merged by union:
//   join / leave {name}             sit down at the table / stand up
//   start {g, seed, seats, dealer}  a new game (ignored while another game is still being played)
//   act {g, by, a, …}               a move in game g (DummyGame.apply decides whether it counts)
//   res {g, scores}                 the result of a finished game, written by whichever phone sees it end first;
//                                   once it is there the game's moves can be dropped
//   abort {g}                       a game called off (no score)
const DummyRooms = (() => {
  const G = DummyGame;
  const MAX_ROOMS = 20, MAX_SEATS = 4, MAX_GAMES = 300, TYPES = ["join", "leave", "start", "act", "res", "abort"], MOVES = ["draw", "pick", "meld", "lay", "discard"];
  const int = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; };
  const money = v => { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) ? n : 0; };
  const cleanName = v => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
  const cleanId = v => String(v ?? "").replace(/[^\w-]/g, "").slice(0, 40);
  const newId = (prefix = "e") => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const cards = (v, max) => Array.isArray(v) && v.length <= max && v.every(G.valid) && new Set(v).size === v.length ? v.slice() : null;

  function normalizeEvent(e) {
    if (!e || typeof e !== "object" || !TYPES.includes(e.t)) return null;
    const out = { id: cleanId(e.id), at: Math.max(0, int(e.at)), t: e.t };
    if (!out.id) return null;
    if (e.t === "join" || e.t === "leave") { out.name = cleanName(e.name); return out.name ? out : null; }
    out.g = cleanId(e.g); if (!out.g) return null;
    if (e.t === "start") {
      out.seed = cleanId(e.seed);
      out.seats = [...new Set((Array.isArray(e.seats) ? e.seats : []).map(cleanName).filter(Boolean))].slice(0, MAX_SEATS);
      out.dealer = int(e.dealer);
      return out.seed && out.seats.length >= 2 && out.dealer >= 0 && out.dealer < out.seats.length ? out : null;
    }
    if (e.t === "res") {
      const scores = Object.entries(e.scores && typeof e.scores === "object" ? e.scores : {}).map(([k, v]) => [cleanName(k), int(v)]).filter(([k]) => k).slice(0, MAX_SEATS);
      out.scores = Object.fromEntries(scores);
      return scores.length >= 2 ? out : null;
    }
    if (e.t === "abort") return out;
    out.by = cleanName(e.by); out.a = e.a;
    if (!out.by || !MOVES.includes(out.a)) return null;
    if (out.a === "pick") { out.i = int(e.i); out.with = cards(e.with, 12); return out.with && out.i >= 0 ? out : null; }
    if (out.a === "meld") { out.cards = cards(e.cards, 12); return out.cards ? out : null; }
    if (out.a === "lay") { out.c = e.c; out.m = int(e.m); return G.valid(out.c) && out.m >= 0 ? out : null; }
    if (out.a === "discard") { out.c = e.c; return G.valid(out.c) ? out : null; }
    return out;
  }
  const order = (a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function normalizeRoom(r) {
    if (!r || typeof r !== "object") return null;
    const room = { id: cleanId(r.id), name: cleanName(r.name), divisor: money(r.divisor) > 0 ? money(r.divisor) : 10,
      createdAt: Math.max(0, int(r.createdAt)), closedAt: Math.max(0, int(r.closedAt)) };
    if (!room.id) return null;
    const seen = new Set();
    const all = (Array.isArray(r.events) ? r.events : []).map(normalizeEvent).filter(e => e && !seen.has(e.id) && seen.add(e.id)).sort(order);
    // The first result of each game counts; the moves of a game with a result are dropped unless it is the latest game
    // (so the finished table stays on screen until the next deal).
    const resOf = new Map(); all.forEach(e => { if (e.t === "res" && !resOf.has(e.g)) resOf.set(e.g, e); });
    const starts = all.filter(e => e.t === "start").slice(-MAX_GAMES), startIds = new Set(starts.map(e => e.g)), latest = starts.length ? starts[starts.length - 1].g : null;
    room.events = all.filter(e => {
      if (e.t === "join" || e.t === "leave") return true;
      if (!startIds.has(e.g)) return false;
      if (e.t === "res") return resOf.get(e.g) === e;
      if (e.t === "act") return e.g === latest || !resOf.has(e.g);
      return true;
    });
    return room;
  }
  function trim(rooms) {
    return Object.fromEntries(Object.values(rooms).sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_ROOMS).map(r => [r.id, r]));
  }
  function normalize(raw) {
    const rooms = {};
    Object.values(raw && typeof raw === "object" && raw.rooms && typeof raw.rooms === "object" ? raw.rooms : {}).forEach(r => { const x = normalizeRoom(r); if (x) rooms[x.id] = x; });
    return { rooms: trim(rooms) };
  }
  function merge(a, b) {
    a = normalize(a); b = normalize(b);
    const rooms = { ...a.rooms };
    Object.values(b.rooms).forEach(r => {
      const mine = rooms[r.id];
      rooms[r.id] = mine ? normalizeRoom({ ...mine, closedAt: Math.max(mine.closedAt, r.closedAt), events: [...mine.events, ...r.events] }) : r;
    });
    return { rooms: trim(rooms) };
  }
  const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

  // Points → play chips (not money) like แบบ 1 on the score sheet: each score ÷ divisor rounded to whole chips (halves away from zero),
  // and every pair settles the difference, so a player's net is their value × players − everyone's values.
  function settle(scores, divisor) {
    const vals = scores.map(v => { const x = int(v) / divisor; return Math.sign(x) * Math.round(Math.abs(x)) || 0; }), sum = vals.reduce((a, b) => a + b, 0);
    return vals.map(v => money(v * vals.length - sum));
  }
  // Everything the page shows about a room.
  //   seated: names at the table now (join order); players: everyone who ever sat, with games, points and chips so far
  //   game: the game being played or just finished { id, no, seats, dealer, table, over, scores } (or null)
  //   games: finished games [{ id, scores, chips }]
  function view(room) {
    room = normalizeRoom(room);
    const seated = [], everyone = [], games = [];
    let game = null, acts = [];
    const live = () => game && !game.done && !game.aborted;
    const end = scores => { game.done = true; game.scores = Object.fromEntries(game.seats.map(s => [s, int(scores[s])])); games.push(game); };
    // A game whose moves ended it counts as finished even before anyone has written its result.
    const settleMoves = () => {
      if (!live()) return;
      const t = G.play(game, acts);
      if (t.over) end(Object.fromEntries(Object.entries(G.score(t)).map(([k, v]) => [k, v.total])));
    };
    room.events.forEach(e => {
      if (e.t === "join") {
        if (!everyone.includes(e.name)) everyone.push(e.name);
        if (!seated.includes(e.name) && seated.length < MAX_SEATS) seated.push(e.name);
      } else if (e.t === "leave") {
        // Nobody stands up from a game they are playing.
        if (!(live() && game.seats.includes(e.name)) && seated.includes(e.name)) seated.splice(seated.indexOf(e.name), 1);
      } else if (e.t === "start") {
        settleMoves();
        if (live() || !e.seats.every(s => seated.includes(s))) return;
        game = { id: e.g, no: games.length + 1, seed: e.seed, seats: e.seats, dealer: e.dealer, done: false, aborted: false };
        acts = [];
      } else if (!game || e.g !== game.id) {
        // belongs to a game that is not the one at the table
      } else if (e.t === "act") {
        if (live()) acts.push(e);
      } else if (e.t === "abort") {
        if (live()) game.aborted = true;
      } else if (e.t === "res" && live()) {
        // The result is replayed from the moves when they are still here; otherwise the written one is all there is.
        settleMoves();
        if (live()) end(e.scores);
      }
    });
    settleMoves();
    if (game && !game.aborted && (acts.length || !game.done)) game.table = G.play(game, acts);
    const totals = {}, nets = {}, played = {};
    everyone.forEach(n => { totals[n] = 0; nets[n] = 0; played[n] = 0; });
    const finished = games.map(g => {
      const names = g.seats, m = settle(names.map(s => g.scores[s] || 0), room.divisor);
      names.forEach((s, i) => { totals[s] = (totals[s] || 0) + (g.scores[s] || 0); nets[s] = money((nets[s] || 0) + m[i]); played[s] = (played[s] || 0) + 1; });
      return { id: g.id, no: g.no, seats: names, scores: g.scores, chips: Object.fromEntries(names.map((s, i) => [s, m[i]])) };
    });
    return {
      room, seated, running: Boolean(live()), game: game && !game.aborted ? game : null, games: finished,
      players: everyone.map(name => ({ name, seated: seated.includes(name), games: played[name] || 0, points: totals[name] || 0, net: nets[name] || 0 })),
      // A finished game whose result is not in the row yet (the page writes it).
      needsResult: game && game.done && !room.events.some(e => e.t === "res" && e.g === game.id) ? game : null
    };
  }

  function addEvent(p, roomId, event) {
    const copy = normalize(p), room = copy.rooms[roomId];
    if (!room) return copy;
    const last = room.events.reduce((m, e) => Math.max(m, e.at), 0);
    room.events.push({ id: newId(), at: Math.max(Date.now(), last + 1), ...event });
    copy.rooms[roomId] = normalizeRoom(room);
    return copy;
  }
  function create(p, { name = "", divisor = 10, by = "" }) {
    const copy = normalize(p), id = newId("r");
    copy.rooms[id] = normalizeRoom({ id, name, divisor, createdAt: Date.now(), events: by ? [{ id: newId(), at: Date.now(), t: "join", name: by }] : [] });
    return { state: { rooms: trim(copy.rooms) }, id };
  }
  const join = (p, id, name) => addEvent(p, id, { t: "join", name });
  const leave = (p, id, name) => addEvent(p, id, { t: "leave", name });
  // A new game for everyone seated; the deal moves one seat to the left each game.
  function start(p, id, seed = newId("s")) {
    const room = normalize(p).rooms[id]; if (!room) return p;
    const v = view(room); if (v.running || v.seated.length < 2) return p;
    return addEvent(p, id, { t: "start", g: newId("g"), seed, seats: v.seated.slice(0, MAX_SEATS), dealer: v.games.length % Math.min(v.seated.length, MAX_SEATS) });
  }
  const move = (p, id, g, act) => addEvent(p, id, { t: "act", g, ...act });
  const abort = (p, id, g) => addEvent(p, id, { t: "abort", g });
  const result = (p, id, g, scores) => addEvent(p, id, { t: "res", g, scores });
  function close(p, id) { const copy = normalize(p); if (copy.rooms[id]) copy.rooms[id].closedAt = Date.now(); return copy; }
  const openRooms = p => Object.values(normalize(p).rooms).filter(r => !r.closedAt).sort((a, b) => b.createdAt - a.createdAt);
  const history = p => Object.values(normalize(p).rooms).filter(r => r.closedAt).sort((a, b) => b.closedAt - a.closedAt);
  return Object.freeze({ MAX_SEATS, cleanName, normalize, normalizeRoom, merge, same, settle, view, addEvent, create, join, leave, start, move, abort, result, close, openRooms, history });
})();
if (typeof window !== "undefined") { window.DummyGame = DummyGame; window.DummyRooms = DummyRooms; }
