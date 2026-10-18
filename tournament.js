// Tournaments (ทัวร์นาเมนต์): knockout brackets, group stage into knockout, and the end-of-season playoff.
// TourneyEngine is pure (no DOM, no storage) and runs in Node (tests/tournament.test.cjs). The page part below it reads
// and writes club.tournaments through LeagueShared.clubMutate (docs/club-data.md) and adds a club.matches entry
// (kind "tournament") for every game played, so Elo and head-to-head can count them.
//
// Bracket data (inside a tournament, saved in the club row):
//   knockout: { type: "knockout", seeds: [entrantIndex…] (seed 1 first), size, rounds, third: "p3" | null,
//               matches: { "r0m0": { id, r, i, a, b, s, w, bye }, …, "p3"? } }
//     a / b are entrant indexes, -1 for a bye, null while the feeder match is unplayed; s = { a, b } points or games;
//     w = "a" | "b" once decided. Everything except s is derived again by resolveKnockout() after every change, and a
//     stored s whose players changed (an earlier result was edited) is dropped, which resets the later matches.
//   groups:   { type: "groups", advance, thirdPlace, groups: [{ name, members: [entrantIndex…], matches: { "g0m0": { id, a, b, s } } }],
//               ko: knockout | null }  (ko is built once every group game has a result, from the group tables)
const TourneyEngine = (() => {
  const BYE = -1;
  const KINDS = ["knockout", "groups", "playoff"], FORMATS = ["singles", "doubles"];
  const okScore = s => !!s && Number.isInteger(s.a) && Number.isInteger(s.b) && s.a >= 0 && s.b >= 0 && s.a !== s.b;
  const pow2 = n => { let p = 1; while (p < n) p *= 2; return p; };
  const other = side => side === "a" ? "b" : "a";

  // Seed positions for a bracket of size p (a power of two): 1 v p, and the top seeds meet as late as possible.
  function seedOrder(p) { let o = [1]; while (o.length < p) { const m = o.length * 2 + 1; o = o.flatMap(s => [s, m - s]); } return o; }
  // Thai round name from how many matches the round has.
  function roundName(r, rounds, unit = "คน") {
    const count = 2 ** (rounds - 1 - r);
    if (count === 1) return "ชิงชนะเลิศ";
    if (count === 2) return "รองชนะเลิศ";
    if (count === 4) return "ก่อนรองชนะเลิศ";
    return r === 0 ? "รอบแรก" : `รอบ ${count * 2} ${unit}สุดท้าย`;
  }
  const finalId = ko => `r${ko.rounds - 1}m0`;
  const winnerOf = m => m && m.w ? m[m.w] : null;
  const loserOf = m => m && m.w ? m[other(m.w)] : null;

  function createKnockout(seeds, { thirdPlace = false } = {}) {
    const n = seeds.length;
    if (n < 2) throw new Error("ต้องมีผู้เข้าแข่งอย่างน้อย 2");
    const size = pow2(n), rounds = Math.log2(size), matches = {};
    for (let r = 0; r < rounds; r++) for (let i = 0; i < size / 2 ** (r + 1); i++) matches[`r${r}m${i}`] = { id: `r${r}m${i}`, r, i, a: null, b: null, s: null };
    const third = thirdPlace && n >= 4 && rounds >= 2 ? "p3" : null;
    if (third) matches.p3 = { id: "p3", r: rounds - 1, i: 1, third: true, a: null, b: null, s: null };
    const ko = { type: "knockout", seeds: [...seeds], size, rounds, third, matches };
    resolveKnockout(ko);
    return ko;
  }
  // Work out every match's players and winner from the seeds and the stored scores. Returns the ids whose stored
  // result was dropped because the players in that match changed.
  function resolveKnockout(ko) {
    const cleared = [], order = seedOrder(ko.size), M = ko.matches;
    const seedAt = pos => pos <= ko.seeds.length ? ko.seeds[pos - 1] : BYE;
    const decide = m => {
      m.w = null; m.bye = m.a === BYE || m.b === BYE;
      if (m.bye) {
        if (m.s) { cleared.push(m.id); m.s = null; }
        if (m.a === BYE && m.b === BYE) m.w = "a";
        else if (m.a === BYE && m.b !== null) m.w = "b";
        else if (m.b === BYE && m.a !== null) m.w = "a";
      } else if (m.a !== null && m.b !== null && okScore(m.s)) m.w = m.s.a > m.s.b ? "a" : "b";
      else if (m.s && (m.a === null || m.b === null)) { cleared.push(m.id); m.s = null; }
    };
    const set = (m, a, b) => {
      if (m.a !== a || m.b !== b) { if (m.s) cleared.push(m.id); m.s = null; m.a = a; m.b = b; }
      decide(m);
    };
    for (let r = 0; r < ko.rounds; r++) for (let i = 0; i < ko.size / 2 ** (r + 1); i++) {
      const m = M[`r${r}m${i}`];
      if (r === 0) set(m, seedAt(order[2 * i]), seedAt(order[2 * i + 1]));
      else set(m, winnerOf(M[`r${r - 1}m${2 * i}`]), winnerOf(M[`r${r - 1}m${2 * i + 1}`]));
    }
    if (ko.third && M.p3) set(M.p3, loserOf(M[`r${ko.rounds - 2}m0`]), loserOf(M[`r${ko.rounds - 2}m1`]));
    return cleared;
  }

  // Group sizes between 3 and 5, about four per group.
  function groupSizes(n) {
    if (n < 3) throw new Error("แบ่งกลุ่มต้องมีอย่างน้อย 3");
    let g = Math.max(1, Math.round(n / 4));
    while (Math.ceil(n / g) > 5) g++;
    while (g > 1 && Math.floor(n / g) < 3) g--;
    const base = Math.floor(n / g), extra = n % g;
    return Array.from({ length: g }, (_, i) => base + (i < extra ? 1 : 0));
  }
  // Round-robin order (circle method) so nobody plays twice in a row when it can be helped.
  function roundRobin(list) {
    const a = [...list]; if (a.length % 2) a.push(null);
    const out = [], n = a.length;
    for (let r = 0; r < n - 1; r++) {
      for (let i = 0; i < n / 2; i++) { const x = a[i], y = a[n - 1 - i]; if (x !== null && y !== null) out.push([x, y]); }
      a.splice(1, 0, a.pop());
    }
    return out;
  }
  function createGroups(n, { advance = 2, thirdPlace = false } = {}) {
    const sizes = groupSizes(n), groups = sizes.map((_, gi) => ({ name: "ABCDEFGHIJKL"[gi] || String(gi + 1), members: [], matches: {} }));
    // Snake the seeds into the groups: A B C C B A …
    let next = 0;
    for (let row = 0; next < n; row++) {
      const idx = groups.map((_, i) => i); if (row % 2) idx.reverse();
      idx.forEach(gi => { if (next < n && groups[gi].members.length < sizes[gi]) groups[gi].members.push(next++); });
    }
    groups.forEach((g, gi) => roundRobin(g.members).forEach(([a, b], k) => { g.matches[`g${gi}m${k}`] = { id: `g${gi}m${k}`, a, b, s: null }; }));
    let k = Math.max(1, Math.min(Number(advance) || 2, Math.min(...sizes)));
    if (groups.length === 1 && k < 2) k = 2;
    const b = { type: "groups", advance: k, thirdPlace: !!thirdPlace, groups, ko: null };
    resolveGroups(b);
    return b;
  }
  // Table for one group: wins, then point difference, then points scored, then the seed.
  function groupTable(g) {
    const rows = new Map(g.members.map(e => [e, { e, p: 0, w: 0, l: 0, pf: 0, pa: 0, diff: 0 }]));
    Object.values(g.matches).forEach(m => {
      if (!okScore(m.s)) return;
      const A = rows.get(m.a), B = rows.get(m.b); if (!A || !B) return;
      A.p++; B.p++; A.pf += m.s.a; A.pa += m.s.b; B.pf += m.s.b; B.pa += m.s.a;
      if (m.s.a > m.s.b) { A.w++; B.l++; } else { B.w++; A.l++; }
    });
    return [...rows.values()].map(x => ({ ...x, diff: x.pf - x.pa })).sort((x, y) => y.w - x.w || y.diff - x.diff || y.pf - x.pf || x.e - y.e);
  }
  const groupsDone = b => b.groups.every(g => Object.values(g.matches).every(m => okScore(m.s)));
  // Group winners first (A1, B1, …), then runners-up, so the bracket keeps group-mates apart as long as it can.
  function qualifiers(b) { const tables = b.groups.map(groupTable), out = []; for (let p = 0; p < b.advance; p++) tables.forEach(t => { if (t[p]) out.push(t[p].e); }); return out; }
  const played = ko => Object.values(ko?.matches || {}).filter(m => m.s).map(m => m.id);
  function resolveGroups(b) {
    if (!groupsDone(b)) { const cleared = played(b.ko); b.ko = null; return cleared; }
    const q = qualifiers(b);
    if (b.ko && b.ko.seeds.length === q.length && b.ko.seeds.every((e, i) => e === q[i])) return resolveKnockout(b.ko);
    const cleared = played(b.ko);
    b.ko = q.length >= 2 ? createKnockout(q, { thirdPlace: b.thirdPlace }) : null;
    return cleared;
  }

  const knockoutOf = t => t?.bracket?.type === "groups" ? t.bracket.ko : t?.bracket?.type === "knockout" ? t.bracket : null;
  // Champion, runner-up and third (entrant indexes) and the status that follows from them.
  function finalize(t) {
    const ko = knockoutOf(t), fin = ko?.matches?.[finalId(ko)];
    const champ = fin ? winnerOf(fin) : null, has = champ !== null && champ >= 0;
    const p3 = ko?.third ? ko.matches.p3 : null;
    const third = p3 ? winnerOf(p3) : null;
    t.champion = has ? t.entrants[champ] : null;
    t.placings = has ? { first: champ, second: loserOf(fin), third: third !== null && third >= 0 ? third : null } : null;
    t.status = has && (!p3 || p3.w) ? "done" : "running";
    if (t.status === "done" && !t.doneAt) t.doneAt = t.lastAt || null;
    if (t.status !== "done") delete t.doneAt;
    return t;
  }

  // Every match of a tournament in play order, with a label: group games first, then the knockout rounds.
  function allMatches(t) {
    const out = [], unit = t?.format === "doubles" ? "ทีม" : "คน";
    const b = t?.bracket;
    if (b?.type === "groups") b.groups.forEach((g, gi) => Object.values(g.matches).forEach(m => out.push({ ...m, stage: "group", group: gi, label: `กลุ่ม ${g.name}` })));
    const ko = knockoutOf(t);
    if (ko) {
      for (let r = 0; r < ko.rounds; r++) Object.values(ko.matches).filter(m => m.r === r && !m.third).sort((x, y) => x.i - y.i).forEach(m => out.push({ ...m, stage: "ko", label: roundName(r, ko.rounds, unit) }));
      if (ko.third) out.push({ ...ko.matches.p3, stage: "ko", label: "ชิงอันดับ 3" });
    }
    return out;
  }
  const findMatch = (t, id) => allMatches(t).find(m => m.id === id) || null;
  // A match two real entrants can play now (players known, no bye).
  const playable = m => !!m && m.a !== null && m.b !== null && m.a >= 0 && m.b >= 0 && !m.bye;

  // Store (or with s === null, clear) one result and work out everything after it. Returns the ids reset as a result.
  function recordResult(t, matchId, s) {
    if (s !== null && !okScore(s)) throw new Error("คะแนนต้องเป็นเลขจำนวนเต็ม และห้ามเสมอ");
    const b = t.bracket; let cleared;
    const g = b.type === "groups" ? b.groups.find(x => x.matches[matchId]) : null;
    if (g) {
      g.matches[matchId].s = s ? { a: s.a, b: s.b } : null;
      cleared = resolveGroups(b);
    } else {
      const ko = knockoutOf(t), m = ko?.matches?.[matchId];
      if (!m) throw new Error("ไม่พบคู่นี้ในทัวร์นาเมนต์");
      if (!playable(m)) throw new Error("คู่นี้ยังไม่พร้อมแข่ง");
      m.s = s ? { a: s.a, b: s.b } : null;
      cleared = resolveKnockout(ko);
    }
    finalize(t);
    return cleared;
  }

  const entrantIds = e => Array.isArray(e) ? e.filter(Boolean) : e ? [e] : [];
  function validEntrants(format, entrants) {
    if (!Array.isArray(entrants) || entrants.length < 2) return "ต้องมีผู้เข้าแข่งอย่างน้อย 2";
    const seen = new Set();
    for (const e of entrants) {
      if (format === "doubles" ? !(Array.isArray(e) && e.length === 2 && e[0] && e[1] && e[0] !== e[1]) : typeof e !== "string" || !e) return format === "doubles" ? "ทีมคู่ต้องมี 2 คนไม่ซ้ำกัน" : "รายชื่อผู้เล่นไม่ถูกต้อง";
      for (const id of entrantIds(e)) { if (seen.has(id)) return "มีผู้เล่นซ้ำกัน"; seen.add(id); }
    }
    return "";
  }
  function createTournament({ id, name, kind = "knockout", format = "singles", entrants, season = null, thirdPlace = false, advance = 2, by = "", at = "" }) {
    if (!KINDS.includes(kind)) throw new Error("ประเภททัวร์นาเมนต์ไม่ถูกต้อง");
    if (!FORMATS.includes(format)) throw new Error("รูปแบบการแข่งไม่ถูกต้อง");
    const title = String(name || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 40);
    if (!title) throw new Error("ตั้งชื่อทัวร์นาเมนต์ก่อน");
    const why = validEntrants(format, entrants); if (why) throw new Error(why);
    if (kind === "groups" && entrants.length < 3) throw new Error("แบ่งกลุ่มต้องมีอย่างน้อย 3");
    const list = entrants.map(e => Array.isArray(e) ? [e[0], e[1]] : e), seeds = list.map((_, i) => i);
    const bracket = kind === "groups" ? createGroups(list.length, { advance, thirdPlace }) : createKnockout(seeds, { thirdPlace });
    const t = { id, name: title, kind, format, season: season ?? null, entrants: list, bracket, status: "running", champion: null,
      title: kind === "playoff" ? "แชมป์เพลย์ออฟ" : "แชมป์", at, by };
    return finalize(t);
  }

  // Keep club.matches in step with one tournament: one entry per finished game (byes excluded), updated by id, and
  // entries for games that were reset are removed. Safe to run again on a newer copy of the club.
  function syncClubMatches(club, t, by = "", at = "") {
    if (!Array.isArray(club.matches)) club.matches = [];
    const want = new Map();
    allMatches(t).filter(m => playable(m) && okScore(m.s)).forEach(m => want.set(`${t.id}_${m.id}`, m));
    club.matches = club.matches.filter(x => x?.tournamentId !== t.id || want.has(x.id));
    want.forEach((m, id) => {
      const entry = { id, kind: "tournament", format: t.format, a: t.entrants[m.a], b: t.entrants[m.b], s: { a: m.s.a, b: m.s.b }, tournamentId: t.id, matchId: m.id };
      const old = club.matches.find(x => x.id === id);
      if (old && old.s?.a === entry.s.a && old.s?.b === entry.s.b && JSON.stringify(old.a) === JSON.stringify(entry.a) && JSON.stringify(old.b) === JSON.stringify(entry.b)) return;
      const next = { ...entry, at: at || new Date().toISOString(), by };
      if (old) Object.assign(old, next); else club.matches.push(next);
    });
    return club;
  }
  // The club-level write for one result: tournament bracket + club.matches. Returns the ids that were reset.
  function applyResult(club, tournamentId, matchId, s, by = "", at = "") {
    const t = (club.tournaments || []).find(x => x.id === tournamentId);
    if (!t) throw new Error("ไม่พบทัวร์นาเมนต์นี้");
    t.lastAt = at || new Date().toISOString();
    const cleared = recordResult(t, matchId, s);
    finalize(t);
    syncClubMatches(club, t, by, at);
    return cleared;
  }
  function removeTournament(club, tournamentId) {
    club.tournaments = (club.tournaments || []).filter(t => t.id !== tournamentId);
    club.matches = (club.matches || []).filter(m => m?.tournamentId !== tournamentId);
    return club;
  }
  // Titles a player holds (for the player card / badges): finished tournaments they won.
  function titlesFor(club, playerId) {
    return (club?.tournaments || []).filter(t => t.status === "done" && entrantIds(t.champion).includes(playerId))
      .map(t => ({ id: t.id, name: t.name, title: t.title || (t.kind === "playoff" ? "แชมป์เพลย์ออฟ" : "แชมป์"), kind: t.kind, season: t.season ?? null, format: t.format }));
  }
  function progress(t) { const list = allMatches(t).filter(playable); return { played: list.filter(m => okScore(m.s)).length, total: allMatches(t).filter(m => !m.bye).length }; }

  // ---------- Seeding, ratings, doubles teams ----------
  function shuffle(list, rand = Math.random) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  // League standings like index.js standingsData: points (3/1/0), then difference, points for, wins, name.
  function standings(league) {
    const valid = x => x && Number.isInteger(x.a) && x.a >= 0 && Number.isInteger(x.b) && x.b >= 0;
    const s = {}; (league?.seasonPlayerIds || []).forEach(id => { s[id] = { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }; });
    (league?.rounds || []).forEach((r, ri) => (r?.m || []).forEach((pair, mi) => {
      const x = league.results?.[`r${ri}m${mi}`]; if (!valid(x)) return;
      const A = s[pair[0]], B = s[pair[1]]; if (!A || !B) return;
      A.p++; B.p++; A.gf += x.a; A.ga += x.b; B.gf += x.b; B.ga += x.a;
      if (x.a > x.b) { A.w++; A.pts += 3; B.l++; } else if (x.b > x.a) { B.w++; B.pts += 3; A.l++; } else { A.d++; B.d++; A.pts++; B.pts++; }
    }));
    const name = id => league?.profiles?.[id]?.displayName || "";
    return Object.values(s).map(x => ({ ...x, gd: x.gf - x.ga })).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.w - a.w || name(a.id).localeCompare(name(b.id), "th"));
  }
  // Playoff seeds: the top k of the current table among players who are still active.
  function playoffSeeds(league, k = 4) {
    return standings(league).filter(x => league?.profiles?.[x.id] && league.profiles[x.id].active !== false).slice(0, k).map(x => x.id);
  }
  // A rating per player: Elo when elo.js is on the page, else RP from finished seasons plus this season's points,
  // else nothing (everyone 0, so seeding and pairing are random).
  function ratingSource(league, club, g = typeof globalThis !== "undefined" ? globalThis : {}) {
    const E = g?.LeagueElo;
    if (E && typeof E.ratings === "function") {
      try {
        const map = E.ratings(league, club), get = id => { const x = map instanceof Map ? map.get(id) : map?.[id]; return Number(x && typeof x === "object" ? x.elo ?? x.rating : x); };
        const size = map instanceof Map ? map.size : map && typeof map === "object" ? Object.keys(map).length : 0;
        if (size) return { source: "elo", of: id => { const v = get(id); return Number.isFinite(v) ? v : 1000; } };
      } catch {}
    }
    const rp = {};
    (league?.rankHistory || []).forEach(h => (h?.standings || []).forEach(r => { if (r?.userId) rp[r.userId] = (rp[r.userId] || 0) + (Number(r.rpAward) || 0); }));
    const pts = {}; standings(league).forEach(x => { pts[x.id] = x.pts; });
    const any = Object.values(rp).some(Boolean) || Object.values(pts).some(Boolean);
    return any ? { source: "rp", of: id => (rp[id] || 0) * 100 + (pts[id] || 0) } : { source: "random", of: () => 0 };
  }
  const teamRating = (e, of) => { const ids = entrantIds(e); return ids.length ? ids.reduce((s, id) => s + of(id), 0) / ids.length : 0; };
  // Seed order: by rating (ties in random order) or fully random.
  function seedEntrants(entrants, of, mode = "rating", rand = Math.random) {
    const mixed = shuffle(entrants, rand);
    return mode === "random" ? mixed : mixed.map((e, i) => ({ e, i, r: teamRating(e, of) })).sort((x, y) => y.r - x.r || x.i - y.i).map(x => x.e);
  }
  // Doubles teams: strongest with weakest, second with second-weakest… With an odd count the middle player sits out.
  function pairTeams(ids, of = () => 0, mode = "balanced", rand = Math.random) {
    const mixed = shuffle([...new Set(ids)], rand);
    const list = mode === "random" ? mixed : mixed.map((id, i) => ({ id, i, r: of(id) })).sort((x, y) => y.r - x.r || x.i - y.i).map(x => x.id);
    const teams = [], n = list.length, half = Math.floor(n / 2);
    if (mode === "random") for (let i = 0; i + 1 < n; i += 2) teams.push([list[i], list[i + 1]]);
    else for (let i = 0; i < half; i++) teams.push([list[i], list[n - 1 - i]]);
    const used = new Set(teams.flat());
    return { teams, left: list.filter(id => !used.has(id)) };
  }

  return Object.freeze({ BYE, okScore, seedOrder, roundName, createKnockout, resolveKnockout, groupSizes, roundRobin, createGroups, groupTable,
    qualifiers, resolveGroups, knockoutOf, finalize, allMatches, findMatch, playable, recordResult, createTournament, syncClubMatches, applyResult,
    removeTournament, titlesFor, progress, entrantIds, standings, playoffSeeds, ratingSource, seedEntrants, pairTeams, shuffle, winnerOf, loserOf, finalId });
})();
if (typeof module !== "undefined") module.exports = TourneyEngine;
if (typeof window !== "undefined") window.TourneyEngine = TourneyEngine;

// ---------- Page: tournament.html ----------
(() => {
  if (typeof document === "undefined" || !document.getElementById("tApp")) return;
  const T = TourneyEngine, LS = LeagueShared, esc = LS.escapeHtml, $ = id => document.getElementById(id);
  const toast = (m, t = "") => window.LeagueToast ? window.LeagueToast(m, t) : null;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let league = LS.readLocalLeague() || { profiles: {} }, club = LS.readLocalClub(), mode = "loading", stamp = "", me = "", admin = false;
  const name = id => league?.profiles?.[id]?.displayName || id || "?";
  const label = (t, idx) => idx === null || idx === undefined ? "" : idx < 0 ? "บาย" : (e => Array.isArray(e) ? e.map(name).join(" / ") : name(e))(t.entrants[idx]);
  const KIND = { knockout: "น็อกเอาต์", groups: "แบ่งกลุ่ม + น็อกเอาต์", playoff: "เพลย์ออฟท้ายซีซั่น" }, FORMAT = { singles: "เดี่ยว", doubles: "คู่" };
  const unit = t => t.format === "doubles" ? "ทีม" : "คน";
  const writable = () => mode === "ok";
  const today = () => { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } };
  const liveKey = (t, m) => `t:${t.id}:${m.id}`;
  const liveOf = key => { try { return window.LeagueLive?.liveClub?.(key) || null; } catch { return null; } };
  // A stored score as page text: the club row is written by every member, so only whole numbers are shown.
  const pts = v => Number.isInteger(v) ? v : "";
  const svg = (d, w = 20) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const TROPHY = '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3"/><path d="M12 13v4M8.5 20h7"/>';
  const who = () => { me = LS.sessionUserId(league); admin = LS.isAdmin(league, me); };
  const inMatch = (t, m) => [m.a, m.b].filter(x => x >= 0).flatMap(x => T.entrantIds(t.entrants[x])).includes(me);
  const canScore = (t, m) => writable() && !!me && (admin || inMatch(t, m));
  const current = () => { const id = decodeURIComponent((location.hash.match(/^#t=(.+)$/) || [])[1] || ""); return id ? (club?.tournaments || []).find(t => t.id === id) || null : null; };

  // ---------- List ----------
  function itemHtml(t) {
    const p = T.progress(t), pct = p.total ? Math.round(p.played / p.total * 100) : 0, done = t.status === "done";
    const champ = t.champion ? (Array.isArray(t.champion) ? t.champion.map(name).join(" / ") : name(t.champion)) : "";
    return `<li><a class="t-item${done ? " is-done" : ""}" href="#t=${encodeURIComponent(t.id)}">
      <span class="t-item-top"><b>${esc(t.name)}</b><span class="t-status ${done ? "done" : "running"}">${done ? "จบแล้ว" : `<i aria-hidden="true"></i>กำลังแข่ง`}</span></span>
      <span class="t-item-meta">${esc(KIND[t.kind] || t.kind)} • ${FORMAT[t.format]} • ${t.entrants.length} ${unit(t)}${t.season ? ` • ซีซั่น ${esc(t.season)}` : ""}</span>
      ${done ? `<span class="t-item-champ">${svg(TROPHY, 18)}<span>${esc(t.title || "แชมป์")}</span><b>${esc(champ)}</b></span>`
             : `<span class="t-bar" role="img" aria-label="แข่งแล้ว ${p.played} จาก ${p.total} คู่"><i style="width:${pct}%"></i></span><span class="t-item-foot">แข่งแล้ว ${p.played}/${p.total} คู่</span>`}
    </a></li>`;
  }
  function renderList() {
    const list = [...(club?.tournaments || [])].sort((a, b) => (a.status === "done") - (b.status === "done") || String(b.at).localeCompare(String(a.at)));
    const hint = admin && writable() ? "กด “สร้างทัวร์นาเมนต์” เพื่อเปิดศึกแรก" : "รอแอดมินเปิดศึกแรก";
    const empty = window.LeagueUI?.empty ? window.LeagueUI.empty("ยังไม่มีทัวร์นาเมนต์", hint) : `<p class="muted">ยังไม่มีทัวร์นาเมนต์ • ${hint}</p>`;
    return `<section class="card t-list-card"><div class="t-list-head"><h2>ทัวร์นาเมนต์ทั้งหมด</h2>${admin && writable() ? `<button type="button" class="primary t-new" data-act="new">${svg('<path d="M12 5v14M5 12h14"/>', 18)}สร้างทัวร์นาเมนต์</button>` : ""}</div>
      ${list.length ? `<ul class="t-list">${list.map(itemHtml).join("")}</ul>` : empty}</section>`;
  }

  // ---------- Detail: bracket, groups, champion ----------
  function matchCard(t, m, ko) {
    const live = T.playable(m) ? liveOf(liveKey(t, m)) : null;
    const row = side => {
      const idx = m[side], seed = ko && idx >= 0 ? ko.seeds.indexOf(idx) + 1 : 0, won = !m.bye && m.w === side, lost = !m.bye && m.w && m.w !== side;
      const text = idx === null ? "รอผู้ชนะ" : label(t, idx);
      return `<span class="tb-row${won ? " win" : ""}${lost ? " lose" : ""}${idx === null ? " tbd" : ""}${idx === -1 ? " bye" : ""}"><i class="tb-seed">${seed || ""}</i><b>${esc(text)}</b><em>${m.s ? pts(m.s[side]) : ""}</em></span>`;
    };
    const aria = `${m.label || ""} ${label(t, m.a) || "รอผู้ชนะ"} พบ ${label(t, m.b) || "รอผู้ชนะ"}${m.s ? ` ผล ${m.s.a}-${m.s.b}` : ""}`;
    return `<button type="button" class="tb-m${m.w && !m.bye ? " done" : ""}${m.bye ? " is-bye" : ""}${live && !live.done ? " is-live" : ""}" data-match="${esc(m.id)}" ${T.playable(m) ? "" : "disabled"} aria-label="${esc(aria)}">${row("a")}${row("b")}${live ? `<span class="tb-live"><i aria-hidden="true"></i>${live.done ? "จบแล้ว" : "LIVE"} ${live.done ? "" : live.cur.join("–")}</span>` : ""}</button>`;
  }
  function bracketHtml(t, ko) {
    const u = unit(t), cols = [];
    for (let r = 0; r < ko.rounds; r++) {
      const ms = Object.values(ko.matches).filter(m => m.r === r && !m.third).sort((a, b) => a.i - b.i).map(m => ({ ...m, label: T.roundName(r, ko.rounds, u) }));
      cols.push(`<div class="tb-col${r === ko.rounds - 1 ? " final" : ""}"><h3 class="tb-round">${T.roundName(r, ko.rounds, u)}</h3><div class="tb-slots">${ms.map(m => `<div class="tb-slot${m.w && !(m.a === -1 && m.b === -1) ? " won" : ""}">${matchCard(t, m, ko)}</div>`).join("")}</div></div>`);
    }
    const third = ko.third ? `<div class="tb-third"><h3 class="tb-round">ชิงอันดับ 3</h3>${matchCard(t, { ...ko.matches.p3, label: "ชิงอันดับ 3" }, ko)}</div>` : "";
    return `<div class="tb-scroll" role="region" aria-label="สายการแข่งขัน เลื่อนซ้ายขวาได้" tabindex="0"><div class="tb">${cols.join("")}</div></div>${third}`;
  }
  function groupsHtml(t) {
    const b = t.bracket;
    return `<div class="tg-grid">${b.groups.map(g => {
      const rows = T.groupTable(g), ms = Object.values(g.matches);
      return `<div class="tg"><h3>กลุ่ม ${esc(g.name)}</h3><table class="tg-table"><thead><tr><th>#</th><th class="l">ชื่อ</th><th>ชนะ</th><th>แพ้</th><th>+/-</th></tr></thead><tbody>
        ${rows.map((r, i) => `<tr class="${i < b.advance ? "q" : ""}"><td>${i + 1}</td><td class="l">${esc(label(t, r.e))}</td><td>${r.w}</td><td>${r.l}</td><td>${r.diff > 0 ? "+" : ""}${r.diff}</td></tr>`).join("")}</tbody></table>
        <div class="tg-matches">${ms.map(m => matchCard(t, { ...m, label: `กลุ่ม ${g.name}`, w: m.s ? (m.s.a > m.s.b ? "a" : "b") : null }, null)).join("")}</div></div>`;
    }).join("")}</div><p class="t-hint">เข้ารอบ ${b.advance} อันดับแรกของแต่ละกลุ่ม (แถบแดง) • เรียงตามชนะ แล้วผลต่างแต้ม</p>`;
  }
  function champHtml(t) {
    if (!t.placings) return "";
    const p = t.placings, done = t.status === "done";
    return `<section class="t-champ" id="tChamp" aria-label="${esc(t.title || "แชมป์")}">
      <div class="t-trophy" aria-hidden="true">${svg(TROPHY, 56)}</div>
      <p class="t-champ-kicker">${esc(t.title || "แชมป์")}${t.season ? ` • ซีซั่น ${esc(t.season)}` : ""}</p>
      <h2 class="t-champ-name">${esc(label(t, p.first))}</h2>
      <p class="t-champ-rest">${p.second !== null && p.second >= 0 ? `<span>รองแชมป์ <b>${esc(label(t, p.second))}</b></span>` : ""}${p.third !== null ? `<span>อันดับ 3 <b>${esc(label(t, p.third))}</b></span>` : ""}${!done ? `<span>รอนัดชิงอันดับ 3</span>` : ""}</p>
      ${t.bonusNote ? `<p class="t-bonus">${esc(t.bonusNote)}</p>` : ""}
      <div class="t-champ-actions"><button type="button" class="secondary" data-act="share">${svg('<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/>', 18)}แชร์แชมป์เข้า LINE</button>
      ${admin && writable() && t.kind === "playoff" ? `<button type="button" class="secondary" data-act="bonus">${t.bonusNote ? "แก้โน้ตโบนัส RP" : "เพิ่มโน้ตโบนัส RP"}</button>` : ""}</div></section>`;
  }
  function renderDetail(t) {
    const ko = T.knockoutOf(t), p = T.progress(t);
    const koPart = ko ? `<section class="card"><h2>${t.kind === "groups" ? "รอบน็อกเอาต์" : "สายการแข่งขัน"}</h2>${bracketHtml(t, ko)}</section>`
      : `<section class="card"><h2>รอบน็อกเอาต์</h2><p class="muted">สายน็อกเอาต์จะขึ้นเมื่อแข่งในกลุ่มครบทุกคู่</p></section>`;
    return `<div class="t-detail">
      <a class="t-back" href="#">${svg('<path d="M15 6l-6 6 6 6"/>', 18)}ทัวร์นาเมนต์ทั้งหมด</a>
      <section class="card t-head"><p class="t-kicker">${esc(KIND[t.kind] || t.kind)} • ${FORMAT[t.format]} • ${t.entrants.length} ${unit(t)}${t.season ? ` • ซีซั่น ${esc(t.season)}` : ""}</p>
        <h2 class="t-title">${esc(t.name)}</h2><p class="t-sub">${t.status === "done" ? "จบแล้ว" : `กำลังแข่ง • แข่งแล้ว ${p.played}/${p.total} คู่`}${me ? "" : " • เข้าสู่ระบบที่หน้าแรกเพื่อกรอกผล"}</p></section>
      ${champHtml(t)}
      ${t.bracket.type === "groups" ? `<section class="card"><h2>รอบแบ่งกลุ่ม</h2>${groupsHtml(t)}</section>` : ""}
      ${koPart}
      ${admin && writable() ? `<div class="t-admin"><button type="button" class="danger" data-act="delete">ลบทัวร์นาเมนต์นี้</button></div>` : ""}
    </div>`;
  }

  // ---------- Render ----------
  let lastHtml = "";
  const celebrated = new Set();
  function render() {
    who();
    const t = current(), box = $("tApp");
    const notice = mode === "missing" ? `<div class="t-notice" role="status">ระบบทัวร์นาเมนต์ยังไม่เปิด • แอดมินต้องรัน SQL ก่อน</div>`
      : mode === "offline" ? `<div class="t-notice" role="status">ออฟไลน์ • แสดงข้อมูลล่าสุดในเครื่อง (ดูได้อย่างเดียว)</div>` : "";
    const html = mode === "loading" && !club?.tournaments?.length ? `<p class="muted t-loading">กำลังโหลด…</p>` : notice + (t ? renderDetail(t) : renderList());
    $("tSub").textContent = t ? `${KIND[t.kind] || ""} • ${t.status === "done" ? "จบแล้ว" : "กำลังแข่ง"}` : `${(club?.tournaments || []).filter(x => x.status !== "done").length} รายการกำลังแข่ง`;
    if (html === lastHtml) return;
    const left = box.querySelector(".tb-scroll")?.scrollLeft || 0;
    lastHtml = html; box.innerHTML = html;
    const s2 = box.querySelector(".tb-scroll"); if (s2 && left) s2.scrollLeft = left;
    if (t?.status === "done" && !celebrated.has(t.id)) {
      celebrated.add(t.id);
      const card = $("tChamp");
      if (card && window.ArenaFX?.burst && !still()) requestAnimationFrame(() => { const r = card.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) window.ArenaFX.burst(r.left + r.width / 2, r.top + 60, 120, 1.3); });
    }
  }

  // ---------- Sheets (score entry, create) ----------
  let sheet = null, lastFocus = null;
  function openSheet(html, labelId) {
    closeSheet(false); lastFocus = document.activeElement;
    sheet = document.createElement("div"); sheet.className = "t-sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-labelledby", labelId);
    sheet.innerHTML = `<div class="t-sheet-card">${html}</div>`;
    sheet.addEventListener("click", e => { if (e.target === sheet || e.target.closest("[data-close]")) closeSheet(); });
    document.body.appendChild(sheet); document.body.classList.add("t-sheet-open");
    setTimeout(() => sheet?.querySelector("input:not([type=hidden]):not([type=radio]):not([type=checkbox]),button:not([data-close])")?.focus({ preventScroll: true }), 40);
    return sheet;
  }
  function closeSheet(back = true) { if (!sheet) return; sheet.remove(); sheet = null; document.body.classList.remove("t-sheet-open"); if (back) lastFocus?.focus?.({ preventScroll: true }); }
  document.addEventListener("keydown", e => {
    if (!sheet) return;
    if (e.key === "Escape") closeSheet();
    if (e.key === "Tab") { const f = [...sheet.querySelectorAll("a[href],button:not(:disabled),input:not(:disabled),select")].filter(x => x.offsetParent); if (!f.length) return; if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); } }
  });

  function openMatch(t, id) {
    const m = T.findMatch(t, id); if (!m || !T.playable(m)) return;
    const can = canScore(t, m), key = liveKey(t, m), live = liveOf(key), A = label(t, m.a), B = label(t, m.b);
    const field = (side, nm) => `<div class="ts-row"><label for="ts${side}">${esc(nm)}</label><div class="ts-ctrl"><button type="button" class="secondary" data-step="${side}:-1" aria-label="ลดแต้ม ${esc(nm)}">−</button><input id="ts${side}" type="number" inputmode="numeric" min="0" max="99" value="${m.s ? pts(m.s[side]) : ""}"><button type="button" class="secondary" data-step="${side}:1" aria-label="เพิ่มแต้ม ${esc(nm)}">+</button></div></div>`;
    const liveDone = live?.done && typeof LiveScore !== "undefined" ? LiveScore.result(live) : null; // a top-level const: not on window
    openSheet(`<button type="button" class="t-x" data-close aria-label="ปิด">×</button>
      <p class="t-kicker">${esc(m.label || "")}</p><h2 id="tsTitle" class="ts-title"><span>${esc(A)}</span><em>VS</em><span>${esc(B)}</span></h2>
      ${live && !live.done ? `<button type="button" class="secondary ts-wide" data-ts="watch"><i class="lv-dot" aria-hidden="true"></i>ดูสด ${live.cur.join("–")}</button>` : ""}
      ${can ? `<form class="ts-form" novalidate>${field("a", A)}${field("b", B)}<p class="t-err" role="alert"></p>
        ${liveDone ? `<button type="button" class="secondary ts-wide" data-ts="fromlive">ใช้ผลจากนับสด ${liveDone.a}–${liveDone.b}</button>` : ""}
        <button type="submit" class="primary ts-wide">บันทึกผล</button>
        <div class="ts-more">${window.LeagueLive?.scoreClub ? `<button type="button" class="secondary" data-ts="live"><i class="lv-dot" aria-hidden="true"></i>${live && !live.done ? "นับต่อ" : "นับสด"}</button>` : ""}${m.s && admin ? `<button type="button" class="danger" data-ts="clear">ล้างผล</button>` : ""}</div></form>`
        : `<p class="ts-result">${m.s ? `ผล <b>${pts(m.s.a)}–${pts(m.s.b)}</b>` : "ยังไม่มีผล"}</p><p class="muted ts-note">${!writable() ? "ตอนนี้ดูได้อย่างเดียว" : me ? "แอดมินหรือผู้เล่นในคู่นี้เท่านั้นที่กรอกผลได้" : "เข้าสู่ระบบที่หน้าแรกก่อนกรอกผล"}</p>`}`, "tsTitle");
    const form = sheet.querySelector(".ts-form"), err = sheet.querySelector(".t-err");
    sheet.querySelectorAll("[data-step]").forEach(b => b.onclick = () => { const [side, d] = b.dataset.step.split(":"), inp = $(`ts${side}`); inp.value = Math.max(0, (Number(inp.value) || 0) + Number(d)); });
    const submit = async s => {
      const btn = form.querySelector("[type=submit]");
      try { btn.disabled = true; await saveResult(t.id, id, s); closeSheet(); toast(s ? `บันทึกผล ${s.a}–${s.b} แล้ว` : "ล้างผลแล้ว", "good"); }
      catch (e) { err.textContent = e?.message || "บันทึกไม่สำเร็จ"; } finally { btn.disabled = false; }
    };
    form?.addEventListener("submit", e => {
      e.preventDefault();
      const a = $("tsa").value, b = $("tsb").value, s = { a: Number(a), b: Number(b) };
      if (a === "" || b === "") { err.textContent = "กรอกแต้มทั้งสองฝั่ง"; return; }
      if (!T.okScore(s)) { err.textContent = s.a === s.b ? "ปิงปองไม่มีเสมอ • แก้แต้มก่อน" : "แต้มต้องเป็นเลขจำนวนเต็ม 0 ขึ้นไป"; return; }
      submit(s);
    });
    sheet.querySelector('[data-ts="clear"]')?.addEventListener("click", () => { if (confirm("ล้างผลคู่นี้? คู่ถัดไปที่ขึ้นกับผลนี้จะถูกล้างด้วย")) submit(null); });
    sheet.querySelector('[data-ts="fromlive"]')?.addEventListener("click", () => { $("tsa").value = liveDone.a; $("tsb").value = liveDone.b; submit(liveDone); });
    sheet.querySelector('[data-ts="watch"]')?.addEventListener("click", () => { closeSheet(false); window.LeagueLive?.watchClub?.(key); });
    sheet.querySelector('[data-ts="live"]')?.addEventListener("click", () => {
      closeSheet(false);
      const ids = t.format === "singles" ? [t.entrants[m.a], t.entrants[m.b]] : [null, null];
      window.LeagueLive.scoreClub({ key, names: [A, B], ids, onDone: r => saveResult(t.id, id, r).then(() => toast(`บันทึกผล ${r.a}–${r.b} แล้ว`, "good")) });
    });
  }
  async function saveResult(tid, mid, s) {
    if (!writable()) throw new Error("ตอนนี้บันทึกไม่ได้ (ดูได้อย่างเดียว)");
    const at = new Date().toISOString(), before = (club?.tournaments || []).find(x => x.id === tid)?.status;
    const saved = await LS.clubMutate(c => {
      const t = c.tournaments.find(x => x.id === tid); if (!t) throw new Error("ไม่พบทัวร์นาเมนต์นี้ (อาจถูกลบไปแล้ว)");
      const m = T.findMatch(t, mid);
      if (!m || !T.playable(m)) throw new Error("คู่นี้เปลี่ยนไปแล้ว • โหลดใหม่แล้วลองอีกครั้ง");
      if (!LS.isAdmin(league, me) && !inMatch(t, m)) throw new Error("แอดมินหรือผู้เล่นในคู่นี้เท่านั้นที่กรอกผลได้");
      T.applyResult(c, tid, mid, s, me, at);
    });
    if (saved) { club = saved; if (before !== "done") celebrated.delete(tid); lastHtml = ""; render(); }
  }

  // ---------- Create ----------
  // Preview and submit use the same seeded random numbers, so what the admin sees is what gets created.
  const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let draftSeed = Date.now() % 1e9, nameTouched = false;
  function defaultName(kind) {
    const d = new Date(), dm = `${d.getDate()}/${d.getMonth() + 1}`;
    return kind === "playoff" ? `เพลย์ออฟ ซีซั่น ${Number(league.currentSeason) || 1}` : kind === "groups" ? `ศึกแบ่งกลุ่ม ${dm}` : `ศึกน็อกเอาต์ ${dm}`;
  }
  function readForm(f) {
    const v = n => f.querySelector(`[name=${n}]:checked`)?.value;
    return { kind: v("kind") || "knockout", format: v("kind") === "playoff" ? "singles" : v("format") || "singles", top: Number(v("top") || 4), seeding: v("seeding") || "rating",
      pairing: v("pairing") || "balanced", advance: Number(v("advance") || 2), third: f.querySelector("[name=third]").checked, name: f.querySelector("[name=name]").value,
      ids: [...f.querySelectorAll("[name=player]:checked")].map(x => x.value) };
  }
  function draft(o) {
    const rate = T.ratingSource(league, club, { LeagueElo: typeof LeagueElo !== "undefined" ? LeagueElo : null }), rand = mulberry(draftSeed);
    if (o.kind === "playoff") return { entrants: T.playoffSeeds(league, o.top), left: [], source: "table" };
    if (o.format === "doubles") { const p = T.pairTeams(o.ids, rate.of, o.pairing, rand); return { entrants: T.seedEntrants(p.teams, rate.of, o.seeding, rand), left: p.left, source: rate.source }; }
    return { entrants: T.seedEntrants(o.ids, rate.of, o.seeding, rand), left: [], source: rate.source };
  }
  function openCreate() {
    if (!admin || !writable()) return;
    const people = LS.activeProfiles(league), checked = Object.keys(club?.checkin?.[today()] || {}).filter(id => people.some(p => p.id === id));
    const radio = (n, v, text, on) => `<label class="t-opt"><input type="radio" name="${n}" value="${v}"${on ? " checked" : ""}><span>${text}</span></label>`;
    openSheet(`<button type="button" class="t-x" data-close aria-label="ปิด">×</button><p class="t-kicker">แอดมิน</p><h2 id="tcTitle" class="tc-title">สร้างทัวร์นาเมนต์</h2>
      <form class="tc-form" novalidate>
        <label class="tc-field"><span>ชื่อทัวร์นาเมนต์</span><input name="name" maxlength="40" autocomplete="off" value="${esc(defaultName("knockout"))}"></label>
        <fieldset><legend>รูปแบบ</legend><div class="t-opts">${radio("kind", "knockout", "น็อกเอาต์", true)}${radio("kind", "groups", "แบ่งกลุ่ม", false)}${radio("kind", "playoff", "เพลย์ออฟท้ายซีซั่น", false)}</div></fieldset>
        <fieldset data-show="normal"><legend>ประเภท</legend><div class="t-opts">${radio("format", "singles", "เดี่ยว", true)}${radio("format", "doubles", "คู่", false)}</div></fieldset>
        <fieldset data-show="playoff"><legend>เข้ารอบจากตารางลีก</legend><div class="t-opts">${radio("top", 4, "4 อันดับแรก", true)}${radio("top", 8, "8 อันดับแรก", false)}</div></fieldset>
        <fieldset data-show="normal"><legend>ผู้เข้าแข่ง</legend>
          <div class="tc-quick"><button type="button" class="secondary" data-pick="all">เลือกทั้งหมด</button><button type="button" class="secondary" data-pick="none">ล้าง</button>${checked.length ? `<button type="button" class="secondary" data-pick="checkin">เลือกคนที่เช็กชื่อวันนี้ (${checked.length})</button>` : ""}</div>
          <div class="tc-people">${people.map(p => `<label class="tc-person"><input type="checkbox" name="player" value="${esc(p.id)}"><span>${window.LeagueUI?.avatar ? window.LeagueUI.avatar(p.id, p.displayName, "sm") : ""}<b>${esc(p.displayName)}</b></span></label>`).join("")}</div></fieldset>
        <fieldset data-show="doubles"><legend>จับคู่</legend><div class="t-opts">${radio("pairing", "balanced", "เก่งคู่กับมือใหม่", true)}${radio("pairing", "random", "สุ่ม", false)}</div></fieldset>
        <fieldset data-show="normal"><legend>มือวาง</legend><div class="t-opts">${radio("seeding", "rating", "ตามฝีมือ", true)}${radio("seeding", "random", "สุ่ม", false)}</div></fieldset>
        <fieldset data-show="groups"><legend>เข้ารอบต่อกลุ่ม</legend><div class="t-opts">${radio("advance", 1, "อันดับ 1", false)}${radio("advance", 2, "2 อันดับแรก", true)}</div></fieldset>
        <label class="tc-check"><input type="checkbox" name="third"><span>มีนัดชิงอันดับ 3</span></label>
        <div class="tc-preview" aria-live="polite"></div>
        <p class="t-err" role="alert"></p>
        <button type="submit" class="primary ts-wide">สร้างและเริ่มแข่ง</button>
      </form>`, "tcTitle");
    const f = sheet.querySelector("form"), err = sheet.querySelector(".t-err");
    nameTouched = false;
    f.querySelector("[name=name]").addEventListener("input", () => { nameTouched = true; });
    const update = () => {
      const o = readForm(f);
      f.querySelectorAll("[data-show]").forEach(el => { const s = el.dataset.show; el.hidden = s === "playoff" ? o.kind !== "playoff" : s === "normal" ? o.kind === "playoff" : s === "doubles" ? o.kind === "playoff" || o.format !== "doubles" : o.kind !== "groups"; });
      if (!nameTouched) f.querySelector("[name=name]").value = defaultName(o.kind);
      const d = draft(o), u = o.format === "doubles" ? "ทีม" : "คน", n = d.entrants.length, ent = e => Array.isArray(e) ? e.map(name).join(" / ") : name(e);
      const key = o.kind === "playoff" ? "table" : o.seeding === "random" ? "shuffle" : d.source;
      const src = { elo: "จัดมือวางตาม Elo", rp: "จัดมือวางตาม RP และแต้มซีซั่นนี้", random: "ยังไม่มีคะแนนให้เทียบ • สุ่มมือวาง", table: "มือวางตามตารางลีกตอนนี้", shuffle: "สุ่มมือวาง" }[key];
      let summary = "";
      if (n >= 2) {
        if (o.kind === "groups") { try { const sz = T.groupSizes(n); summary = `${sz.length} กลุ่ม (${sz.join(", ")} ${u})`; } catch { summary = `ต้องมีอย่างน้อย 3 ${u}`; } }
        else { let p = 1; while (p < n) p *= 2; summary = `${Math.log2(p)} รอบ${p - n ? ` • บาย ${p - n} ${u}` : ""}`; }
      }
      const reroll = (o.format === "doubles" && o.kind !== "playoff") || (o.seeding === "random" && o.kind !== "playoff");
      f.querySelector(".tc-preview").innerHTML = n ? `<p class="tc-sum"><b>${n} ${u}</b>${summary ? ` • ${summary}` : ""}<small>${src}</small></p>
        <ol class="tc-seeds">${d.entrants.map(e => `<li>${esc(ent(e))}</li>`).join("")}</ol>
        ${d.left.length ? `<p class="t-hint">${esc(d.left.map(name).join(", "))} ไม่มีคู่ (จำนวนคนเป็นเลขคี่)</p>` : ""}
        ${reroll ? `<button type="button" class="secondary" data-act="reroll">สุ่มใหม่</button>` : ""}`
        : `<p class="muted">${o.kind === "playoff" ? "ยังไม่มีผู้เล่นในตารางซีซั่นนี้" : `เลือกผู้เข้าแข่งอย่างน้อย ${o.format === "doubles" ? 4 : 2} คน`}</p>`;
      f.querySelector(".tc-preview [data-act=reroll]")?.addEventListener("click", () => { draftSeed = (draftSeed * 7 + 13) % 1e9; update(); });
      return { o, d };
    };
    f.addEventListener("change", update);
    f.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { const set = b.dataset.pick === "checkin" ? new Set(checked) : null; f.querySelectorAll("[name=player]").forEach(x => { x.checked = b.dataset.pick === "all" || !!set?.has(x.value); }); update(); });
    update();
    f.addEventListener("submit", async e => {
      e.preventDefault(); err.textContent = "";
      const { o, d } = update(), btn = f.querySelector("[type=submit]");
      if (o.kind === "playoff" && d.entrants.length < Math.min(4, o.top)) { err.textContent = "ผู้เล่นในตารางซีซั่นนี้ยังไม่พอ"; return; }
      try {
        const t = T.createTournament({ id: `t_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`, name: o.name, kind: o.kind, format: o.format, entrants: d.entrants,
          season: o.kind === "playoff" ? Number(league.currentSeason) || 1 : null, thirdPlace: o.third, advance: o.advance, by: me, at: new Date().toISOString() });
        btn.disabled = true;
        const saved = await LS.clubMutate(c => { if (!c.tournaments.some(x => x.id === t.id)) c.tournaments.push(t); });
        if (saved) club = saved;
        closeSheet(false); toast(`สร้าง “${t.name}” แล้ว`, "good"); location.hash = `t=${encodeURIComponent(t.id)}`;
      } catch (x) { err.textContent = x?.message || "สร้างไม่สำเร็จ"; } finally { btn.disabled = false; }
    });
  }

  // ---------- Admin: delete, bonus note ----------
  async function removeT(t) {
    if (!confirm(`ลบ “${t.name}”? ผลทุกคู่ในทัวร์นาเมนต์นี้จะหายด้วย`)) return;
    try { const saved = await LS.clubMutate(c => { T.removeTournament(c, t.id); }); if (saved) club = saved; toast("ลบแล้ว", "good"); location.hash = ""; lastHtml = ""; render(); }
    catch (e) { toast(e?.message || "ลบไม่สำเร็จ", "bad"); }
  }
  async function bonusNote(t) {
    const note = prompt("โน้ตโบนัสสำหรับแชมป์ (เช่น +30 RP) • แสดงบนการ์ดแชมป์เท่านั้น ไม่แก้ตารางแรงค์", t.bonusNote || "");
    if (note === null) return;
    try { const saved = await LS.clubMutate(c => { const x = c.tournaments.find(y => y.id === t.id); if (!x) return false; x.bonusNote = note.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60); }); if (saved) club = saved; lastHtml = ""; render(); }
    catch (e) { toast(e?.message || "บันทึกไม่สำเร็จ", "bad"); }
  }

  // ---------- Champion poster (1080x1350 PNG; names drawn with fillText, never markup) ----------
  async function sharePoster(t, btn) {
    if (!t.placings || btn?.getAttribute("aria-busy") === "true") return;
    btn?.setAttribute("aria-busy", "true");
    try {
      await window.SharePoster?.loadFonts?.();
      const W = 1080, H = 1350, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d");
      const fit = (str, x, y, size, min, font, color, maxW) => { let s = size; c.font = font(s); while (s > min && c.measureText(str).width > maxW) { s -= 2; c.font = font(s); } c.fillStyle = color; c.textAlign = "center"; c.fillText(str, x, y, maxW); };
      const disp = s => `italic 800 ${s}px Kanit, Anuphan, sans-serif`, ui = s => `700 ${s}px Anuphan, system-ui, sans-serif`;
      c.fillStyle = "#0a0b0e"; c.fillRect(0, 0, W, H);
      const g = c.createRadialGradient(W / 2, 430, 0, W / 2, 430, 760); g.addColorStop(0, "rgba(229,36,47,.45)"); g.addColorStop(1, "rgba(229,36,47,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.lineWidth = 4; c.strokeStyle = "rgba(255,71,82,.55)"; c.strokeRect(22, 22, W - 44, H - 44);
      fit("ทัวร์นาเมนต์", W / 2, 130, 40, 24, ui, "#9ba1ad", 900);
      fit(t.name, W / 2, 210, 72, 36, disp, "#fff", 940);
      c.save(); c.translate(W / 2, 470); c.fillStyle = "#f5b80b"; c.strokeStyle = "#f5b80b"; c.lineWidth = 22; c.lineCap = "round";
      c.beginPath(); c.moveTo(-130, -150); c.lineTo(130, -150); c.lineTo(110, 10); c.quadraticCurveTo(0, 110, -110, 10); c.closePath(); c.fill();
      c.beginPath(); c.arc(-140, -70, 55, Math.PI * .5, Math.PI * 1.5); c.stroke(); c.beginPath(); c.arc(140, -70, 55, -Math.PI * .5, Math.PI * .5); c.stroke();
      c.fillRect(-20, 60, 40, 80); c.fillRect(-100, 140, 200, 40); c.restore();
      c.font = disp(46); const tw = c.measureText(t.title || "แชมป์").width + 90;
      c.fillStyle = "#d81e29"; c.beginPath(); if (c.roundRect) c.roundRect(W / 2 - tw / 2, 714, tw, 84, 42); else c.rect(W / 2 - tw / 2, 714, tw, 84); c.fill();
      fit(t.title || "แชมป์", W / 2, 772, 46, 28, disp, "#fff", 800);
      fit(label(t, t.placings.first), W / 2, 930, 120, 48, disp, "#fff", 960);
      const rest = [t.placings.second !== null && t.placings.second >= 0 ? `รองแชมป์ ${label(t, t.placings.second)}` : "", t.placings.third !== null ? `อันดับ 3 ${label(t, t.placings.third)}` : ""].filter(Boolean);
      rest.forEach((line, i) => fit(line, W / 2, 1040 + i * 64, 44, 26, ui, "#c9cdd5", 920));
      if (t.bonusNote) fit(t.bonusNote, W / 2, 1190, 40, 24, ui, "#ff4752", 900);
      const d = new Date(); fit(`ตีให้สุด หยุดที่เบ้าตา  •  ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`, W / 2, H - 62, 28, 18, ui, "#9ba1ad", 960);
      const blob = await new Promise(ok => cv.toBlob(ok, "image/png")); if (!blob) throw new Error("no image");
      const file = typeof File === "function" ? new File([blob], `pingpong-tournament-${t.id}.png`, { type: "image/png" }) : null;
      if (file && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: t.name, text: `${t.name} • ${t.title || "แชมป์"}: ${label(t, t.placings.first)}` }); return; } catch (e) { if (e?.name === "AbortError") return; } }
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = file?.name || "tournament.png"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast("บันทึกโปสเตอร์แล้ว ส่งเข้า LINE ได้เลย", "good");
    } catch { toast("ทำโปสเตอร์ไม่สำเร็จ", "bad"); } finally { btn?.removeAttribute("aria-busy"); }
  }

  // ---------- Wiring ----------
  $("tApp").addEventListener("click", e => {
    const t = current(), m = e.target.closest("[data-match]"), act = e.target.closest("[data-act]")?.dataset.act;
    if (m && t) return openMatch(t, m.dataset.match);
    if (act === "new") return openCreate();
    if (act === "delete" && t) return removeT(t);
    if (act === "bonus" && t) return bonusNote(t);
    if (act === "share" && t) return sharePoster(t, e.target.closest("[data-act]"));
  });
  addEventListener("hashchange", () => { lastHtml = ""; render(); scrollTo({ top: 0, behavior: "auto" }); });
  addEventListener("storage", e => { if (e.key === LS.SESSION_KEY) { lastHtml = ""; render(); } });

  async function loadClub() {
    try {
      const res = await LS.clubRead();
      if (!res) { mode = "missing"; club = LS.readLocalClub(); }
      else { mode = "ok"; if (res.updatedAt !== stamp) { stamp = res.updatedAt; club = res.club; } }
    } catch { if (mode !== "ok") mode = "offline"; }
  }
  async function boot() {
    try { const row = (await LS.cloudRequest("league,updated_at"))[0]; if (row?.league?.uidLeague?.profiles) league = row.league.uidLeague; } catch {}
    await loadClub(); render();
    let tick = 0;
    const loop = () => setTimeout(async () => {
      if (!document.hidden && !sheet && !document.body.classList.contains("lv-open")) {
        try { await window.LeagueLive?.pull?.(); } catch {}
        if (tick++ % 2 === 0) await loadClub();
        render();
      }
      loop();
    }, 4000);
    loop();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loadClub().then(render); });
  }
  render(); boot();
})();
