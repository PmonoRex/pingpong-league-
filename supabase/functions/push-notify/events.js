// Which push notifications one UPDATE of public.app_state should send. Pure: no network, no clock, no randomness.
// Mirrors pwa.js events() (result entered, your turn, prediction market opened) and adds the club row (docs/club-data.md):
// a new challenge to you, your challenge accepted, a comment on your match.
//
// Loaded two ways, so it is a plain script and not an ES/CommonJS module:
//   - Node tests:      const E = require("../supabase/functions/push-notify/events.js")
//   - Deno (index.ts): import "./events.js"; const E = globalThis.PushEvents
//
// rowEvents(record, oldRecord, ctx) -> [{ to, key, title, body, tag, url }]
//   record / oldRecord: the new and old app_state rows from the Database Webhook payload.
//   ctx.league (optional): { currentSeason, rounds, profiles: { id: { displayName, active } } } for the club row, whose
//   own data has no names and no league schedule. Without it club events still go out, with ids instead of names.
(function (root) {
  "use strict";
  const MAX_PER_USER = 3;        // pwa.js shows at most 3 fresh items at a time; do the same per person per write
  const MAX_TOTAL = 200;         // one write can never fan out into a flood
  const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const arr = v => Array.isArray(v) ? v : [];
  const valid = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const idOk = id => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);
  const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  const pairOf = p => Array.isArray(p) && p.length === 2 && idOk(p[0]) && idOk(p[1]) ? p : null;
  const samePair = (x, y) => !!x && !!y && x[0] === y[0] && x[1] === y[1];

  const leagueOf = row => isObj(row?.league?.uidLeague) ? row.league.uidLeague : null;
  const predOf = row => isObj(row?.predictions?.uidPredictions) ? row.predictions.uidPredictions : null;
  const clubOf = row => isObj(row?.league?.club) ? row.league.club : null;
  const active = (l, id) => idOk(id) && isObj(l?.profiles?.[id]) && l.profiles[id].active !== false;
  const namer = l => id => clip(isObj(l?.profiles?.[id]) && l.profiles[id].displayName || id, 40);

  // { "r2m1": [a, b] } for the current schedule.
  function pairs(l) {
    const out = {};
    arr(l?.rounds).forEach((r, i) => arr(r?.m).forEach((p, mi) => { const q = pairOf(p); if (q) out[`r${i}m${mi}`] = q; }));
    return out;
  }
  // pwa.js: the first round that still has an unplayed match; every unplayed match in it is "up".
  function upNow(l) {
    const rounds = arr(l?.rounds), res = isObj(l?.results) ? l.results : {};
    const ri = rounds.findIndex((r, i) => arr(r?.m).some((p, mi) => pairOf(p) && !valid(res[`r${i}m${mi}`])));
    const out = {};
    if (ri < 0) return out;
    arr(rounds[ri].m).forEach((p, mi) => { const q = pairOf(p); if (q && !valid(res[`r${ri}m${mi}`])) out[`r${ri}m${mi}`] = { ri, pair: q }; });
    return out;
  }

  function mainEvents(rec, old) {
    const l = leagueOf(rec), o = leagueOf(old), out = [];
    if (!l?.profiles) return out;
    const nm = namer(l), season = Number(l.currentSeason) || 1, oldSeason = Number(o?.currentSeason) || 1;
    const sameSeason = !!o && season === oldSeason;
    const now = pairs(l), was = sameSeason ? pairs(o) : {};
    const res = isObj(l.results) ? l.results : {}, oldRes = sameSeason && isObj(o.results) ? o.results : {};

    // 1. A result was entered (or corrected) for a match: tell both players. Same tag per match, so a correction replaces
    //    the earlier notification on the phone instead of stacking.
    Object.entries(now).forEach(([mid, p]) => {
      const x = res[mid]; if (!valid(x)) return;
      const y = samePair(was[mid], p) ? oldRes[mid] : null;
      if (valid(y) && y.a === x.a && y.b === x.b) return;
      p.forEach((me, side) => {
        if (!active(l, me)) return;
        const mine = side === 0 ? [x.a, x.b] : [x.b, x.a], other = nm(p[1 - side]);
        out.push({ to: me, key: `res:${season}:${mid}:${x.a}-${x.b}`, url: "index.html",
          title: mine[0] > mine[1] ? "ชนะแล้ว!" : mine[0] < mine[1] ? "ผลออกแล้ว" : "เสมอ",
          body: `คุณ ${mine[0]}–${mine[1]} ${other}`, tag: `pp-res-${mid}` });
      });
    });

    // 2. Your match is now in the current round ("ถึงคิวคุณแล้ว"): only matches that were not already up before.
    const upOld = o ? upNow(o) : {};
    Object.entries(upNow(l)).forEach(([mid, { ri, pair }]) => {
      if (sameSeason && upOld[mid] && samePair(upOld[mid].pair, pair)) return;
      pair.forEach(me => {
        if (!active(l, me)) return;
        out.push({ to: me, key: `next:${season}:${mid}`, url: "index.html", title: "ถึงคิวคุณแล้ว",
          body: `รอบ ${ri + 1} • ${nm(pair[0])} vs ${nm(pair[1])}`, tag: "pp-next" });
      });
    });

    // 3. A prediction market opened for a match that has no result yet: everyone except the dealer and the two players
    //    (they cannot bet on their own match, predictions.js betEligibility).
    const pred = predOf(rec), oldPred = predOf(old);
    const markets = isObj(pred?.markets) ? pred.markets : {}, oldMarkets = isObj(oldPred?.markets) ? oldPred.markets : {};
    Object.entries(markets).forEach(([key, m]) => {
      if (!m?.open || oldMarkets[key]?.open || !key.startsWith(`s${season}:`)) return;
      const mid = key.slice(`s${season}:`.length), p = now[mid];
      if (!p || valid(res[mid])) return;
      Object.keys(l.profiles).forEach(id => {
        if (!active(l, id) || id === pred.dealerId || p.includes(id)) return;
        out.push({ to: id, key: `mkt:${key}`, url: "predictions.html", title: "เปิดทายผลแล้ว",
          body: `${nm(p[0])} vs ${nm(p[1])} • เข้าไปทายได้เลย`, tag: `pp-mkt-${key}` });
      });
    });
    return out;
  }

  const team = (v, fallback) => (Array.isArray(v) ? v : [fallback]).filter(idOk);
  function clubEvents(rec, old, ctx) {
    const c = clubOf(rec), o = clubOf(old) || {}, out = [];
    if (!c) return out;
    const l = isObj(ctx?.league) ? ctx.league : null, nm = namer(l);
    const ok = id => idOk(id) && (!l?.profiles || active(l, id));
    const oldCh = new Map(arr(o.challenges).filter(isObj).map(x => [x.id, x]));

    arr(c.challenges).forEach(ch => {
      if (!isObj(ch) || typeof ch.id !== "string" || !idOk(ch.from)) return;
      const prev = oldCh.get(ch.id), doubles = ch.format === "doubles" ? " (คู่)" : "";
      const sideA = new Set([ch.from, ...team(ch.teamA, ch.from)]), sideB = [...new Set([...team(ch.teamB, ch.to), ...team(null, ch.to)])];
      // 4. A new open challenge: the challenged side.
      if (!prev && ch.status === "open") {
        const note = clip(ch.note, 60);
        sideB.filter(id => !sideA.has(id) && ok(id)).forEach(id => out.push({ to: id, key: `ch:${ch.id}`, url: "index.html",
          title: "มีคนท้าดวลคุณ!", body: `${nm(ch.from)} ท้าคุณ${doubles}${note ? ` • ${note}` : ""}`, tag: `pp-ch-${ch.id}` }));
      }
      // 5. Accepted: the side that sent it.
      if (ch.status === "accepted" && prev && prev.status !== "accepted") {
        const who = idOk(ch.to) ? nm(ch.to) : "คู่ท้า";
        [...sideA].filter(id => ok(id) && !sideB.includes(id)).forEach(id => out.push({ to: id, key: `cha:${ch.id}`, url: "index.html",
          title: "รับคำท้าแล้ว", body: `${who} รับคำท้าของคุณ${doubles} • นัดตีได้เลย`, tag: `pp-ch-${ch.id}` }));
      }
    });

    // 6. A new comment on a match you played in (not your own comment). Target "s4:r2m1" (league) or "c:<matchId>" (club).
    const seen = new Set(arr(o.social?.comments).map(x => x?.id));
    const cm = new Map(arr(c.matches).filter(isObj).map(m => [m.id, m]));
    const leaguePairs = l ? pairs(l) : {}, season = Number(l?.currentSeason) || 0;
    arr(c.social?.comments).forEach(cmt => {
      if (!isObj(cmt) || typeof cmt.id !== "string" || seen.has(cmt.id) || typeof cmt.target !== "string") return;
      let players = [], label = "";
      const lm = /^s(\d+):(r\d+m\d+)$/.exec(cmt.target);
      if (lm && Number(lm[1]) === season && leaguePairs[lm[2]]) { players = leaguePairs[lm[2]]; label = `${nm(players[0])} vs ${nm(players[1])}`; }
      else if (cmt.target.startsWith("c:") && cm.get(cmt.target.slice(2))) {
        const m = cm.get(cmt.target.slice(2)), a = team(m.a, m.a), b = team(m.b, m.b);
        players = [...a, ...b]; label = `${a.map(nm).join("/")} vs ${b.map(nm).join("/")}`;
      }
      const text = clip(cmt.text, 80);
      [...new Set(players)].filter(id => id !== cmt.by && ok(id)).forEach(id => out.push({ to: id, key: `cm:${cmt.id}`, url: "index.html",
        title: `${nm(cmt.by)} คอมเมนต์แมตช์คุณ`, body: text ? `${label} • ${text}` : label, tag: `pp-cm-${cmt.target}` }));
    });
    return out;
  }

  function rowEvents(record, oldRecord, ctx) {
    if (!isObj(record) || !isObj(oldRecord) || record.id !== oldRecord.id) return [];
    const raw = record.id === "main" ? mainEvents(record, oldRecord) : record.id === "club" ? clubEvents(record, oldRecord, ctx) : [];
    const seen = new Set(), per = {}, out = [];
    for (const e of raw) {
      const k = `${e.to}|${e.key}`;
      if (seen.has(k)) continue; seen.add(k);
      per[e.to] = (per[e.to] || 0) + 1;
      if (per[e.to] > MAX_PER_USER || out.length >= MAX_TOTAL) continue;
      out.push({ to: e.to, key: e.key, title: clip(e.title, 60), body: clip(e.body, 140), tag: clip(e.tag, 64), url: e.url });
    }
    return out;
  }
  // The club row needs names and the league schedule from 'main'; nothing else does.
  const needsLeague = (record, oldRecord) => record?.id === "club" && JSON.stringify(clubOf(record) || null) !== JSON.stringify(clubOf(oldRecord) || null);
  // The small web-push payload the service worker reads.
  const payloadOf = e => JSON.stringify({ title: e.title, body: e.body, tag: e.tag, url: e.url });

  const api = Object.freeze({ rowEvents, needsLeague, payloadOf, MAX_PER_USER, MAX_TOTAL });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.PushEvents = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
