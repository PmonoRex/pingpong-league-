// Betting for one Texas Hold'em hand (poker.html). Pure: the hand is replayed from what was recorded at the deal
// (seats, stacks, dealer button, blinds) plus every action in order; an action that is not legal at that moment
// (not your turn, raise too small) is ignored, so two phones acting at once always end in the same state.
// Streets: 0 ก่อนฟล็อป, 1 ฟล็อป, 2 เทิร์น, 3 ริเวอร์, 4 = betting over (showdown or everyone else folded).
const PokerBet = (() => {
  const STREETS = ["ก่อนฟล็อป", "ฟล็อป", "เทิร์น", "ริเวอร์", "โชว์ไพ่"];
  const ACTIONS = ["fold", "check", "call", "raise"];
  const whole = v => Math.max(0, Math.floor(Number(v) || 0));

  // input: { seats, stacks, button, sb, bb, acts: [{ name, a, to }], board, shown, awards: [{ pot, names }] }
  // cards (optional): PokerCards, to settle a pot by itself once the board and every hand in it are face up.
  function play(input, cards = null) {
    const sb = Math.max(1, whole(input.sb)), bb = Math.max(sb, whole(input.bb));
    const seats = (input.seats || []).filter((name, i, all) => all.indexOf(name) === i && whole(input.stacks?.[name]) > 0);
    const n = seats.length;
    const P = seats.map(name => ({ name, start: whole(input.stacks[name]), stack: whole(input.stacks[name]), committed: 0, streetBet: 0, folded: false, allIn: false, acted: false }));
    if (n < 2) return { active: false, reason: "ต้องมีผู้เล่นที่มีชิปอย่างน้อย 2 คน", players: P, pots: [], done: false, delta: {} };
    const b = Math.max(0, seats.indexOf(input.button)), heads = n === 2;
    const sbI = heads ? b : (b + 1) % n, bbI = heads ? (b + 1) % n : (b + 2) % n;
    const put = (p, amount) => { const x = Math.min(whole(amount), p.stack); p.stack -= x; p.committed += x; p.streetBet += x; if (!p.stack) p.allIn = true; return x; };
    put(P[sbI], sb); put(P[bbI], bb);
    let street = 0, currentBet = Math.max(P[sbI].streetBet, P[bbI].streetBet), minRaise = bb;
    const canAct = p => !p.folded && !p.allIn, live = () => P.filter(p => !p.folded);
    const nextFrom = i => { for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (canAct(P[j])) return j; } return -1; };
    // Heads-up the button is the small blind and acts first before the flop; otherwise the seat after the big blind.
    let toAct = heads ? (canAct(P[sbI]) ? sbI : nextFrom(sbI)) : nextFrom(bbI);
    function settle() {
      for (;;) {
        if (live().length <= 1) { street = 4; toAct = -1; return; }
        const actors = P.filter(canAct);
        // Nobody left who can still put chips in: deal the rest out and go to the showdown.
        if (!actors.length || (actors.length === 1 && actors[0].streetBet >= currentBet)) { street = 4; toAct = -1; return; }
        if (!actors.every(p => p.acted && p.streetBet === currentBet)) return;
        street++;
        P.forEach(p => { p.streetBet = 0; p.acted = false; });
        currentBet = 0; minRaise = bb;
        if (street >= 4) { street = 4; toAct = -1; return; }
        toAct = nextFrom(b); // after the flop the first player left of the button speaks first
      }
    }
    settle();
    for (const e of input.acts || []) {
      const i = seats.indexOf(e?.name); if (i < 0 || street >= 4) continue;
      const p = P[i]; if (p.folded || !ACTIONS.includes(e.a)) continue;
      // A fold counts whenever it comes (people muck out of turn at a real table).
      if (e.a === "fold") { p.folded = true; p.acted = true; if (i === toAct) toAct = nextFrom(i); settle(); continue; }
      if (i !== toAct) continue;
      const owe = currentBet - p.streetBet;
      if (e.a === "check") { if (owe > 0) continue; p.acted = true; }
      else if (e.a === "call") { if (owe <= 0) continue; put(p, owe); p.acted = true; }
      else {
        const max = p.streetBet + p.stack, to = Math.min(whole(e.to), max);
        if (to <= currentBet) { if (to === max && owe > 0) { put(p, p.stack); p.acted = true; } else continue; } // all-in for less than a call
        else {
          const full = to - currentBet >= minRaise;
          if (!full && to !== max) continue; // a raise must be at least the last raise, unless it is all-in
          if (full) minRaise = to - currentBet;
          put(p, to - p.streetBet); currentBet = to;
          P.forEach(q => { if (q !== p) q.acted = false; }); p.acted = true;
        }
      }
      toAct = nextFrom(i); settle();
    }

    // Pots: one layer per all-in level; a layer only the folded paid into goes to the top live layer.
    const pots = [];
    if (street === 4) {
      const levels = [...new Set(live().map(p => p.committed))].sort((x, y) => x - y);
      let prev = 0;
      for (const L of levels) {
        const amount = P.reduce((s, p) => s + Math.min(p.committed, L) - Math.min(p.committed, prev), 0);
        const eligible = P.filter(p => !p.folded && p.committed >= L).map(p => p.name);
        const last = pots[pots.length - 1];
        if (amount > 0) { if (last && last.eligible.join("\n") === eligible.join("\n")) last.amount += amount; else pots.push({ amount, eligible }); }
        prev = L;
      }
      const above = P.reduce((s, p) => s + Math.max(0, p.committed - prev), 0);
      if (above && pots.length) pots[pots.length - 1].amount += above;
      const board = (input.board || []).filter(c => c !== null && c !== undefined), shown = input.shown || {};
      pots.forEach((pot, k) => {
        if (pot.eligible.length === 1) { pot.winners = pot.eligible.slice(); pot.how = "only"; return; }
        if (cards && board.length === 5 && pot.eligible.every(nm => shown[nm]?.length === 2)) {
          const sd = cards.showdown(board, Object.fromEntries(pot.eligible.map(nm => [nm, shown[nm]])));
          if (sd) { pot.winners = sd.winners; pot.hand = sd.hand; pot.how = "cards"; return; }
        }
        const award = (input.awards || []).filter(a => a && a.pot === k && Array.isArray(a.names) && a.names.length && a.names.every(nm => pot.eligible.includes(nm))).pop();
        pot.winners = award ? award.names.slice() : null; pot.how = award ? "picked" : null;
      });
    }
    const done = street === 4 && pots.every(p => p.winners);
    const won = Object.fromEntries(seats.map(s => [s, 0]));
    if (done) pots.forEach(pot => {
      // Odd chips go one each to the winners closest to the left of the button.
      const order = pot.winners.slice().sort((x, y) => ((seats.indexOf(x) - b - 1 + n) % n) - ((seats.indexOf(y) - b - 1 + n) % n));
      const share = Math.floor(pot.amount / order.length), odd = pot.amount - share * order.length;
      order.forEach((nm, k) => { won[nm] += share + (k < odd ? 1 : 0); });
    });
    const delta = done ? Object.fromEntries(P.map(p => [p.name, won[p.name] - p.committed])) : {};
    const me = toAct >= 0 ? P[toAct] : null;
    return {
      active: true, street, streetName: STREETS[street], button: seats[b], sbName: seats[sbI], bbName: seats[bbI], sb, bb,
      players: P.map(p => ({ name: p.name, start: p.start, stack: done ? p.stack + won[p.name] : p.stack, committed: p.committed, streetBet: p.streetBet, folded: p.folded, allIn: p.allIn })),
      toAct: me ? me.name : null, currentBet, pot: P.reduce((s, p) => s + p.committed, 0),
      toCall: me ? Math.min(currentBet - me.streetBet, me.stack) : 0,
      minTo: me ? Math.min(currentBet + minRaise, me.streetBet + me.stack) : 0, maxTo: me ? me.streetBet + me.stack : 0,
      pots, done, delta
    };
  }
  return Object.freeze({ play, STREETS, ACTIONS });
})();
if (typeof window !== "undefined") window.PokerBet = PokerBet;
