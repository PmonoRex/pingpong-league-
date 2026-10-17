// The predictions page as a fight bill: handicap odds per corner, the live betting board (กระดานทาย) and the
// settled-market banter. Pure functions over pred.bets / markets (no DOM, no storage); predictions.js renders them.
const PredBoard = (() => {
  // Stake chips add to the amount already typed, like the old +10/+50 buttons.
  const STAKE_CHIPS = Object.freeze([10, 20, 50, 100, 500]);
  const WIN_STAMP = "ได้เงิน";
  const WIN_LINES = Object.freeze([
    "ตาถึงจริง เลี้ยงน้ำด้วย",
    "เซียนมาเอง",
    "อ่านเกมขาด",
    "เจ้ามือร้องไห้แล้ว"
  ]);
  // Friendly ribbing for a lost pick: about the guess, never about the person.
  const TEASE_LINES = Object.freeze([
    "เงินบินแล้วจ้า",
    "ตาถึง แต่เงินไม่ถึง",
    "เชียร์ผิดมุม ชีวิตเปลี่ยน",
    "ทายแม่นเหมือนพยากรณ์อากาศ",
    "ไม่เป็นไร ถือว่าทำบุญให้เจ้ามือ",
    "คราวหน้าลองโยนเหรียญดู",
    "ดวงยังไม่มา ใจเย็น ๆ",
    "เจ้ามือฝากขอบคุณ"
  ]);
  const PUSH_LINES = Object.freeze(["เสมอราคา คืนทุนไป", "รอดตัวไปหนึ่งยก"]);

  // Same seed, same line: a bet keeps its line across re-renders and devices.
  function pick(list, seed) {
    const text = String(seed ?? "");
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
    return list[h % list.length];
  }
  const teaseLine = seed => pick(TEASE_LINES, seed);
  const winLine = seed => pick(WIN_LINES, seed);
  const pushLine = seed => pick(PUSH_LINES, seed);

  // Handicap the way the hall says it: 0.5 ครึ่งลูก, 1 1 ลูก, 1.5 ลูกครึ่ง, 2.5 2 ลูกครึ่ง.
  function handicapWords(h) {
    const n = Number(h);
    if (!Number.isFinite(n) || n <= 0) return "";
    const whole = Math.floor(n), half = n - whole >= 0.5;
    if (!half) return `${whole} ลูก`;
    if (whole === 0) return "ครึ่งลูก";
    return whole === 1 ? "ลูกครึ่ง" : `${whole} ลูกครึ่ง`;
  }
  // One odds line per corner, red then blue: the favourite gives (ต่อ), the other takes (รอง); 0 is even money.
  function odds(pair, market) {
    const h = Number(market?.handicap);
    const words = handicapWords(h);
    return (Array.isArray(pair) ? pair : []).slice(0, 2).map(id => {
      if (!words || !pair.includes(market?.favoriteId)) return { id, role: "even", label: "เสมอราคา", num: "0" };
      return id === market.favoriteId
        ? { id, role: "fav", label: `ต่อ ${words}`, num: `−${h}` }
        : { id, role: "dog", label: `รอง ${words}`, num: `+${h}` };
    });
  }

  // กระดานทาย for one match: picks and stake per corner. Void bets were refunded, so they drop off the board.
  function tally(bets, season, matchId, pair) {
    const corners = (Array.isArray(pair) ? pair : []).slice(0, 2).map(id => ({ id, count: 0, stake: 0 }));
    (Array.isArray(bets) ? bets : []).forEach(b => {
      if (Number(b?.season) !== Number(season) || b.matchId !== matchId || b.status === "void") return;
      const corner = corners.find(c => c.id === b.sideId);
      if (!corner) return;
      corner.count++;
      corner.stake += Number(b.stake) || 0;
    });
    const count = corners.reduce((s, c) => s + c.count, 0), stake = corners.reduce((s, c) => s + c.stake, 0);
    // Red corner's share of the money (by picks when nothing is staked), for the split bar; 50 when the board is empty.
    const basis = stake ? "stake" : "count", total = stake || count;
    const redShare = total ? Math.round((corners[0]?.[basis] || 0) / total * 100) : 50;
    return { corners, count, stake, redShare };
  }

  const SETTLED = ["won", "lost", "push"];
  // Settled bets of one Season grouped per match, newest first. statusOf(bet) gives the status to show
  // (BetSettle.effective on the page, so a corrected score shows at once).
  function settledMatches(bets, season, statusOf = b => b.status) {
    const groups = new Map();
    (Array.isArray(bets) ? bets : []).forEach(b => {
      if (Number(b?.season) !== Number(season)) return;
      const status = statusOf(b);
      if (!SETTLED.includes(status)) return;
      if (!groups.has(b.matchId)) groups.set(b.matchId, { matchId: b.matchId, pair: b.pair, won: [], lost: [], push: [], last: "" });
      const g = groups.get(b.matchId);
      g[status].push(b);
      const at = String(b.settledAt || b.createdAt || "");
      if (at > g.last) g.last = at;
    });
    return [...groups.values()].sort((a, b) => (b.last > a.last ? 1 : b.last < a.last ? -1 : 0));
  }

  const addStake = (current, chip) => Math.max(0, Math.floor(Number(current) || 0)) + Math.max(0, Math.floor(Number(chip) || 0));

  return Object.freeze({ STAKE_CHIPS, WIN_STAMP, WIN_LINES, TEASE_LINES, PUSH_LINES, teaseLine, winLine, pushLine,
    handicapWords, odds, tally, settledMatches, addStake });
})();
