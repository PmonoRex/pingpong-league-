// A stateful in-memory stand-in for the Supabase project the site talks to, attached to Playwright browser contexts
// with context.route(). Several contexts (one per player / phone) share one FakeSupabase, so their writes interact.
//
// Emulates:
//  - PostgREST on public.app_state rows main / live / club: GET with select=, PATCH with the updated_at=eq. lock (and
//    dummy->>rev=eq.N / is.null for the Dummy column), Prefer: return=representation (PATCH that matches nothing -> []).
//    updated_at is stored and returned the way Postgres prints timestamptz (microseconds, "+00:00").
//  - The phase 2 server-auth RPCs (supabase/migrations/20261019140000_server_auth.sql): pp_auth_version, pp_login,
//    pp_logout, pp_whoami, pp_change_pin, pp_reset_pin, pp_save_league / predictions / dummy / live / club, with the
//    same optimistic locks and (simplified but faithful) authorization rules. `rpc: false` makes every RPC a 404 so the
//    client takes its legacy direct-PATCH path.
//  - Storage uploads (POST /storage/v1/object/media/...) succeed; public GETs of uploaded files serve the bytes back.
//  - Push RPCs (pp_push_subscribe / unsubscribe) succeed as no-ops.
// Every request is logged in `log`; `offline = true` aborts all backend traffic (network loss).

const CRED_FIELDS = ["pin", "pinHash", "mustChangePin", "pinChangedAt"];

// ---- JSON helpers with jsonb semantics (key order does not matter; a missing key is SQL NULL) ----
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const jeq = (a, b) => canon(a) === canon(b);
const minus = (obj, ...keys) => { if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj; const c = { ...obj }; keys.flat().forEach(k => delete c[k]); return c; };
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
const strings = v => { const out = []; const walk = x => { if (typeof x === "string") out.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") Object.values(x).forEach(walk); }; walk(v); return out; };

// Postgres-style timestamptz text and its value in microseconds (for "is distinct from" between timestamps).
function pgStamp(us) {
  const ms = Math.floor(us / 1000), d = new Date(ms), frac = String(us % 1000000).padStart(6, "0");
  return `${d.toISOString().slice(0, 19)}.${frac}+00:00`;
}
function toMicros(text) {
  if (text == null || text === "") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(String(text).trim());
  if (!m) return NaN;
  const base = Date.parse(`${m[1]}T${m[2]}${m[4] && m[4] !== "Z" ? (m[4].length === 3 ? `${m[4]}:00` : m[4]) : "Z"}`);
  return base * 1000 + Number((m[3] || "").padEnd(6, "0"));
}

export class FakeSupabase {
  constructor({ rpc = true, enforce = true, league, predictions = {}, dummy = {}, club = undefined } = {}) {
    this.rpcEnabled = rpc;
    this.enforce = rpc && enforce;
    this.clock = Date.now() * 1000;
    this.offline = false;
    this.log = [];
    this.errors = [];      // server-side refusals worth looking at (403s the client did not expect, shape errors)
    this.media = new Map();
    this.sessions = new Map(); // token -> { userId, expiresAt }
    this.creds = new Map();    // userId -> { pin, mustChange, fails, lockedUntil }
    this.writeCount = { main: 0, live: 0, club: 0 };
    const now = this.stamp();
    this.rows = {
      main: { id: "main", league: { uidLeague: clone(league) }, predictions: { uidPredictions: clone(predictions) }, dummy: clone(dummy), updated_at: now },
      live: { id: "live", league: {}, predictions: {}, dummy: {}, updated_at: now },
      club: { id: "club", league: club === undefined ? { club: { v: 1, matches: [], challenges: [], tournaments: [], social: { reactions: {}, comments: [] }, mvp: {}, checkin: {} } } : club, predictions: {}, dummy: {}, updated_at: now }
    };
    // Credentials start from the row's PIN fields (what import_row_credentials does), then the row is stripped when enforcing.
    Object.values(league?.profiles || {}).forEach(p => this.creds.set(p.id, { pin: typeof p.pin === "string" ? p.pin : "1234", mustChange: p.mustChangePin === true || !p.pinHash, fails: 0, lockedUntil: 0 }));
    if (this.enforce) this.rows.main.league.uidLeague.profiles = this.stripProfiles(this.rows.main.league.uidLeague.profiles);
  }
  stamp() { this.clock = Math.max(this.clock + 1, Date.now() * 1000); return pgStamp(this.clock); }
  stripProfiles(profiles) { return Object.fromEntries(Object.entries(profiles || {}).map(([k, v]) => [k, v && typeof v === "object" ? minus(v, CRED_FIELDS) : v])); }
  get league() { return this.rows.main.league?.uidLeague; }
  get predictions() { return this.rows.main.predictions?.uidPredictions; }
  get club() { return this.rows.club.league?.club; }
  get live() { return this.rows.live.league; }
  profile(id) { return this.league?.profiles?.[id] || null; }
  isAdmin(id) { const p = this.profile(id); return Boolean(p && p.role === "admin" && p.active !== false); }

  // ---------- routing ----------
  async attach(context) {
    await context.route(/\/rest\/v1\//, route => this.handleRest(route));
    await context.route(/\/storage\/v1\//, route => this.handleStorage(route));
    await context.route(/\/functions\/v1\//, route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  }
  json(route, status, body, extraHeaders = {}) {
    return route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...extraHeaders }, body: body === undefined ? "" : JSON.stringify(body) });
  }
  async handleRest(route) {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (this.offline) { this.log.push({ at: Date.now(), method, path: url.pathname, aborted: true }); return route.abort("internetdisconnected"); }
    let body = null; try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch { body = null; }
    const entry = { at: Date.now(), method, path: url.pathname, query: url.search };
    this.log.push(entry);
    try {
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const name = url.pathname.slice("/rest/v1/rpc/".length);
        entry.rpc = name;
        if (name.startsWith("pp_push_")) return this.json(route, 200, null);
        if (!this.rpcEnabled) return this.json(route, 404, { code: "PGRST202", message: `Could not find the function public.${name}` });
        const fn = this.rpcs[name];
        if (!fn) return this.json(route, 404, { code: "PGRST202", message: `Could not find the function public.${name}` });
        const result = fn.call(this, body || {});
        entry.status = 200;
        return this.json(route, 200, result === undefined ? null : result);
      }
      if (url.pathname === "/rest/v1/app_state") return this.handleTable(route, method, url, body, req.headers(), entry);
      return this.json(route, 404, { message: "not found" });
    } catch (error) {
      const status = error.httpStatus || 400;
      entry.status = status; entry.error = error.message;
      this.errors.push({ path: url.pathname, message: error.message, code: error.code });
      return this.json(route, status, { code: error.code || "P0001", message: error.message });
    }
  }
  handleTable(route, method, url, body, headers, entry) {
    const params = url.searchParams, idFilter = params.get("id") || "";
    const id = /^eq\.(.+)$/.exec(idFilter)?.[1];
    const row = this.rows[id];
    const select = (params.get("select") || "*").split(",").map(s => s.trim()).filter(Boolean);
    const project = r => select.includes("*") ? clone(r) : Object.fromEntries(select.map(c => [c, clone(r[c])]));
    if (method === "GET" || method === "HEAD") return this.json(route, 200, row ? [project(row)] : []);
    if (method === "PATCH") {
      if (!row) return this.json(route, 200, []);
      if (this.enforce) throw Object.assign(new Error("app_state: direct writes are disabled, reload the site"), { code: "42501", httpStatus: 403 });
      // Filters other than id: updated_at=eq.X, dummy->>rev=eq.N / is.null
      for (const [key, value] of params.entries()) {
        if (key === "id" || key === "select") continue;
        if (key === "updated_at") {
          const want = /^eq\.(.*)$/.exec(value)?.[1];
          if (toMicros(want) !== toMicros(row.updated_at)) { entry.lockMiss = true; return this.json(route, 200, []); }
        } else if (key === "dummy->>rev") {
          const cur = row.dummy?.rev == null ? null : String(row.dummy.rev);
          if (value === "is.null" ? cur !== null : cur !== /^eq\.(.*)$/.exec(value)?.[1]) { entry.lockMiss = true; return this.json(route, 200, []); }
        } else throw new Error(`fake: unsupported filter ${key}=${value}`);
      }
      const allowed = ["league", "predictions", "dummy", "updated_at"];
      Object.keys(body || {}).forEach(k => { if (!allowed.includes(k)) throw Object.assign(new Error(`permission denied for column ${k}`), { code: "42501", httpStatus: 403 }); });
      Object.entries(body || {}).forEach(([k, v]) => { row[k] = clone(v); });
      // Postgres prints the client's ISO text back as timestamptz.
      if (body && "updated_at" in body) { const us = toMicros(body.updated_at); row.updated_at = Number.isFinite(us) ? pgStamp(us) : this.stamp(); this.clock = Math.max(this.clock, us || 0); }
      this.writeCount[id] = (this.writeCount[id] || 0) + 1;
      entry.wrote = id;
      const prefer = String(headers.prefer || "");
      return this.json(route, 200, prefer.includes("return=representation") ? [project(row)] : undefined);
    }
    return this.json(route, 405, { message: "method not allowed" });
  }
  async handleStorage(route) {
    const req = route.request(), url = new URL(req.url());
    if (this.offline) return route.abort("internetdisconnected");
    const m = /\/storage\/v1\/object\/(public\/)?media\/(.+)$/.exec(url.pathname);
    this.log.push({ at: Date.now(), method: req.method(), path: url.pathname });
    if (!m) return route.fulfill({ status: 404, body: "" });
    if (req.method() === "POST" || req.method() === "PUT") {
      this.media.set(m[2], { body: req.postDataBuffer(), type: req.headers()["content-type"] || "image/webp" });
      return this.json(route, 200, { Key: `media/${m[2]}` });
    }
    const file = this.media.get(m[2]);
    if (!file) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: file.type, body: file.body, headers: { "access-control-allow-origin": "*" } });
  }

  // ---------- auth helpers ----------
  sessionUser(token) {
    const s = this.sessions.get(token || "");
    const p = s && this.profile(s.userId);
    if (!s || s.expiresAt <= Date.now() || !p || p.active === false) throw Object.assign(new Error("session expired"), { code: "28000", httpStatus: 401 });
    return s.userId;
  }
  newToken(userId) {
    const token = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
    const expiresAt = Date.now() + 30 * 864e5;
    this.sessions.set(token, { userId, expiresAt });
    return { token, expiresAt };
  }
  expireSessions(userId) { [...this.sessions].forEach(([t, s]) => { if (!userId || s.userId === userId) this.sessions.delete(t); }); }
  denied(why) { throw Object.assign(new Error(why), { code: "42501", httpStatus: 403 }); }
  checkLock(row, expected) { return expected == null || toMicros(expected) === toMicros(row.updated_at); }
  pinOk(pin) {
    const v = String(pin ?? "");
    if (!/^\d{4,6}$/.test(v) || v === "1234" || /^(\d)\1+$/.test(v)) return false;
    const d = [...v].map(Number), steps = new Set(d.slice(1).map((x, i) => (x - d[i] + 10) % 10));
    return !(steps.size === 1 && (steps.has(1) || steps.has(9)));
  }

  // ---------- authorization rules (private.*_change_denied) ----------
  leagueDenied(uid, admin, oldL, newL) {
    if (admin) return null;
    const norm = l => ({ ...l, rankHistory: Array.isArray(l?.rankHistory) ? l.rankHistory : [], seasonArchives: Array.isArray(l?.seasonArchives) ? l.seasonArchives : [], auditLog: Array.isArray(l?.auditLog) ? l.auditLog : [], schemaVersion: typeof l?.schemaVersion === "number" && l.schemaVersion >= 2 ? l.schemaVersion : 2 });
    const o = norm(oldL || {}), n = norm(newL), ol = o.auditLog, nl = n.auditLog;
    let logOk = false;
    for (let k = 0; k <= Math.min(5, nl.length); k++) {
      if (nl.slice(0, k).every(e => e?.actorId === uid) && jeq(nl.slice(k), ol.slice(0, nl.length - k)) && (nl.length - k === ol.length || nl.length === 200)) { logOk = true; break; }
    }
    if (!logOk) return "players cannot rewrite the audit log";
    if (!jeq(minus(n, "auditLog", "profiles"), minus(o, "auditLog", "profiles"))) return "only an admin can change the league";
    if (!jeq(minus(n.profiles, uid), minus(o.profiles, uid))) return "players can only edit their own profile";
    const allowed = ["displayName", "tagline", "avatar", "avatarHd", "banner", "promptpay", "payQr"];
    const ownNew = n.profiles?.[uid], ownOld = o.profiles?.[uid];
    if (!ownNew || typeof ownNew !== "object" || !jeq(minus(ownNew, allowed), minus(ownOld, allowed))) return "players can only change their name, picture, tagline and payment details";
    const name = String(ownNew.displayName || "").trim();
    if (!name || name.length > 30) return "display name rejected";
    if (Object.entries(n.profiles).some(([k, p]) => k !== uid && String(p?.displayName || "").toLowerCase() === name.toLowerCase())) return "display name already used";
    if (JSON.stringify(ownNew).length > 200000) return "profile too large";
    return null;
  }
  predictionsDenied(uid, admin, oldP, newP) {
    const o = oldP || {}, oldBets = Array.isArray(o.bets) ? o.bets : [], newBets = newP?.bets;
    if (!newP || typeof newP !== "object" || !Array.isArray(newBets)) return "predictions shape rejected";
    if (admin) return null;
    if (!jeq(newP.dealerId, o.dealerId)) return "only an admin can change the dealer";
    if (newBets.length < oldBets.length) return "bets cannot be removed";
    const dealer = o.dealerId === uid;
    if (dealer) {
      if (oldBets.some((b, i) => !jeq(minus(newBets[i], "status", "net", "settledAt"), minus(b, "status", "net", "settledAt")))) return "the dealer can only settle existing bets";
    } else {
      if (!jeq(minus(newP, "bets", "nextBetId"), minus(o, "bets", "nextBetId"))) return "only the dealer can manage markets";
      if (!jeq(newBets.slice(0, oldBets.length), oldBets)) return "players cannot change existing bets";
    }
    for (const b of newBets.slice(oldBets.length)) {
      if (dealer) return "the dealer cannot bet";
      const market = o.markets?.[`s${b.season ?? ""}:${b.matchId ?? ""}`];
      if (b.userId !== uid) return "players can only bet in their own name";
      if (b.status !== "pending" || String(b.net ?? 0) !== "0" || typeof b.stake !== "number" || b.stake <= 0 || !Number.isInteger(b.stake) || b.stake > 1e6) return "bet rejected";
      if (market?.open !== true || !jeq(b.favoriteId, market.favoriteId) || !jeq(b.handicap, market.handicap)) return "this market is not open";
      const pair = strings(b.pair);
      if (pair.includes(uid) || !pair.includes(b.sideId)) return "bet rejected";
      if (newBets.some(x => x.userId === uid && jeq(x.season, b.season) && jeq(x.matchId, b.matchId) && !jeq(x, b))) return "already bet on this match";
    }
    return null;
  }
  liveDenied(uid, admin, oldL, newL) {
    if (!newL || typeof newL !== "object" || Object.keys(minus(newL, "matches")).length || (newL.matches != null && typeof newL.matches !== "object")) return "live shape rejected";
    if (admin) return null;
    const om = oldL?.matches && typeof oldL.matches === "object" ? oldL.matches : {}, nm = newL.matches || {};
    for (const k of new Set([...Object.keys(om), ...Object.keys(nm)])) {
      const o = om[k], n = nm[k];
      if (jeq(o, n)) continue;
      if (strings([o?.pair, o?.by, n?.pair, n?.by]).includes(uid)) continue;
      if (n == null && (Date.parse(o?.at) || -Infinity) < Date.now() - 6 * 3600e3) continue;
      return "only the players of a match can score it live";
    }
    return null;
  }
  itemsDenied(uid, oldA, newA, owner, people, trimAt = 0, ownerFixed = true, tournaments = null) {
    if (newA != null && !Array.isArray(newA)) return "club list shape rejected";
    const key = e => e?.id ?? canon(e);
    const om = Object.fromEntries((Array.isArray(oldA) ? oldA : []).map(e => [key(e), e]));
    const nm = Object.fromEntries((newA || []).map(e => [key(e), e]));
    for (const k of new Set([...Object.keys(om), ...Object.keys(nm)])) {
      const o = om[k], n = nm[k];
      if (jeq(o, n)) continue;
      if (o === undefined) { if (n?.[owner] !== uid) return "new items must be your own"; continue; }
      if (n === undefined && trimAt > 0 && (newA || []).length >= trimAt) continue;
      const involved = strings(people.map(f => o[f])).includes(uid);
      const viaTourney = o.tournamentId != null && (tournaments || []).some(t => t?.id === o.tournamentId && strings([t.by, t.entrants]).includes(uid));
      if (!involved && !viaTourney) return "you can only change items you own or play in";
      if (ownerFixed && n !== undefined && !jeq(n[owner], o[owner])) return "the owner of an item cannot change";
    }
    return null;
  }
  map2Denied(uid, oldM, newM, pruneBefore = null) {
    const om = oldM && typeof oldM === "object" && !Array.isArray(oldM) ? oldM : {}, nm = newM ?? {};
    if (typeof nm !== "object" || Array.isArray(nm)) return "club map shape rejected";
    for (const k of new Set([...Object.keys(om), ...Object.keys(nm)])) {
      const o = om[k] ?? {}, n = nm[k] ?? {};
      if (jeq(o, n)) continue;
      if (nm[k] === undefined && pruneBefore != null && k < pruneBefore) continue;
      if (typeof o !== "object" || typeof n !== "object" || !jeq(minus(o, uid), minus(n, uid))) return "you can only change your own entry";
    }
    return null;
  }
  clubDenied(uid, admin, oldC, newC) {
    const o = oldC && typeof oldC === "object" ? oldC : {};
    if (!newC || typeof newC !== "object" || Array.isArray(newC)) return "club shape rejected";
    if (JSON.stringify(newC).length > 1000000) return "club data too large";
    if (admin) return null;
    if (newC.social != null && (typeof newC.social !== "object" || Array.isArray(newC.social))) return "club shape rejected";
    const tours = [...(Array.isArray(o.tournaments) ? o.tournaments : []), ...(Array.isArray(newC.tournaments) ? newC.tournaments : [])];
    const bkk = new Date(Date.now() + 7 * 3600e3 - 29 * 864e5).toISOString().slice(0, 10);
    const why = this.itemsDenied(uid, o.matches, newC.matches, "by", ["by", "a", "b"], 0, false, tours)
      || this.itemsDenied(uid, o.challenges, newC.challenges, "from", ["from", "to", "teamA", "teamB"])
      || this.itemsDenied(uid, o.tournaments, newC.tournaments, "by", ["by", "entrants"])
      || this.itemsDenied(uid, o.social?.comments, newC.social?.comments, "by", ["by"], 300)
      || this.map2Denied(uid, o.social?.reactions, newC.social?.reactions)
      || this.map2Denied(uid, o.mvp, newC.mvp)
      || this.map2Denied(uid, o.checkin, newC.checkin, bkk);
    if (!why && o.social != null && !jeq(minus(newC.social, "comments", "reactions"), minus(o.social, "comments", "reactions"))) return "club shape rejected";
    return why;
  }

  // ---------- RPCs ----------
  rpcs = {
    pp_auth_version() { return { version: 1, enforce: this.enforce }; },
    pp_login({ p_user_id, p_pin }) {
      const cred = this.creds.get(p_user_id), p = this.profile(p_user_id);
      if (!cred || !p || p.active === false) return { error: "wrong account or PIN" };
      if (cred.lockedUntil > Date.now()) return { error: "locked", retry_after_seconds: Math.ceil((cred.lockedUntil - Date.now()) / 1000) };
      if (String(p_pin) !== cred.pin) {
        cred.fails++;
        if (cred.fails >= 5) { cred.fails = 0; cred.lockedUntil = Date.now() + 15 * 60e3; return { error: "locked", retry_after_seconds: 900 }; }
        return { error: "wrong account or PIN" };
      }
      cred.fails = 0; cred.lockedUntil = 0;
      const { token, expiresAt } = this.newToken(p_user_id);
      return { token, user_id: p_user_id, role: p.role, must_change: cred.mustChange, expires_at: pgStamp(expiresAt * 1000) };
    },
    pp_logout({ p_token }) { this.sessions.delete(p_token || ""); return null; },
    pp_whoami({ p_token }) {
      const s = this.sessions.get(p_token || ""); const p = s && this.profile(s.userId);
      if (!s || s.expiresAt <= Date.now() || !p || p.active === false) return null;
      return { user_id: s.userId, role: p.role, must_change: Boolean(this.creds.get(s.userId)?.mustChange), expires_at: pgStamp(s.expiresAt * 1000) };
    },
    pp_change_pin({ p_token, p_current_pin, p_new_pin }) {
      const uid = this.sessionUser(p_token), cred = this.creds.get(uid);
      if (cred.lockedUntil > Date.now()) return { error: "locked", retry_after_seconds: 60 };
      if (String(p_current_pin) !== cred.pin) { cred.fails++; if (cred.fails >= 5) { cred.fails = 0; cred.lockedUntil = Date.now() + 15 * 60e3; } return { error: "wrong current PIN" }; }
      if (!this.pinOk(p_new_pin) || p_new_pin === p_current_pin) return { error: "PIN not allowed" };
      Object.assign(cred, { pin: String(p_new_pin), mustChange: false, fails: 0, lockedUntil: 0 });
      [...this.sessions].forEach(([t, s]) => { if (s.userId === uid && t !== p_token) this.sessions.delete(t); });
      return { ok: true };
    },
    pp_reset_pin({ p_token, p_target }) {
      const uid = this.sessionUser(p_token);
      if (!this.isAdmin(uid)) this.denied("admin only");
      this.creds.set(p_target, { pin: "1234", mustChange: true, fails: 0, lockedUntil: 0 }); this.expireSessions(p_target);
      return null;
    },
    pp_save_league({ p_token, p_league, p_expected }) {
      const uid = this.sessionUser(p_token), admin = this.isAdmin(uid), row = this.rows.main;
      if (!p_league || typeof p_league !== "object" || !p_league.profiles || typeof p_league.profiles !== "object") throw Object.assign(new Error("league shape rejected"), { code: "23514" });
      if (!this.checkLock(row, p_expected)) return null;
      const old = row.league?.uidLeague || {}, clean = { ...p_league, profiles: this.stripProfiles(p_league.profiles) };
      if (old.profiles) { const why = this.leagueDenied(uid, admin, { ...old, profiles: this.stripProfiles(old.profiles) }, clean); if (why) this.denied(why); }
      else if (!admin) this.denied("only an admin can change the league");
      if (admin) {
        Object.keys(clean.profiles).forEach(k => {
          if (!old.profiles?.[k] && !this.creds.has(k)) this.creds.set(k, { pin: "1234", mustChange: true, fails: 0, lockedUntil: 0 });
          const reset = clean.profiles[k]?.pinResetAt;
          if (old.profiles?.[k] && typeof reset === "string" && reset !== old.profiles[k]?.pinResetAt) { this.creds.set(k, { pin: "1234", mustChange: true, fails: 0, lockedUntil: 0 }); this.expireSessions(k); }
        });
      }
      row.league = { ...(row.league || {}), uidLeague: clone(clean) };
      row.updated_at = this.stamp(); this.writeCount.main++;
      return row.updated_at;
    },
    pp_save_predictions({ p_token, p_predictions, p_expected }) {
      const uid = this.sessionUser(p_token), row = this.rows.main;
      if (!this.checkLock(row, p_expected)) return null;
      const why = this.predictionsDenied(uid, this.isAdmin(uid), row.predictions?.uidPredictions, p_predictions); if (why) this.denied(why);
      row.predictions = { ...(row.predictions || {}), uidPredictions: clone(p_predictions) };
      row.updated_at = this.stamp(); this.writeCount.main++;
      return row.updated_at;
    },
    pp_save_dummy({ p_token, p_dummy, p_expected_rev }) {
      this.sessionUser(p_token);
      if (!p_dummy || typeof p_dummy !== "object" || Array.isArray(p_dummy)) throw Object.assign(new Error("dummy shape rejected"), { code: "23514" });
      const row = this.rows.main, cur = row.dummy?.rev == null ? null : String(row.dummy.rev), exp = Number(p_expected_rev || 0);
      if ((exp === 0 && cur !== null) || (exp !== 0 && cur !== String(exp))) return null;
      row.dummy = clone(p_dummy); this.writeCount.main++;
      return clone(p_dummy);
    },
    pp_save_live({ p_token, p_live, p_expected }) {
      const uid = this.sessionUser(p_token), row = this.rows.live;
      if (!this.checkLock(row, p_expected)) return null;
      const why = this.liveDenied(uid, this.isAdmin(uid), row.league, p_live); if (why) this.denied(why);
      row.league = clone(p_live); row.updated_at = this.stamp(); this.writeCount.live++;
      return row.updated_at;
    },
    pp_save_club({ p_token, p_club, p_expected }) {
      const uid = this.sessionUser(p_token), row = this.rows.club;
      if (!this.checkLock(row, p_expected)) return null;
      const why = this.clubDenied(uid, this.isAdmin(uid), row.league?.club, p_club); if (why) this.denied(why);
      row.league = { ...(row.league || {}), club: clone(p_club) }; row.updated_at = this.stamp(); this.writeCount.club++;
      return row.updated_at;
    }
  };
}

// A fresh league like the one the site creates on first run: an admin and friends, everyone on PIN 1234.
export function seedLeague(names = ["มอส", "กิฟท์", "กอล์ฟ", "มังกร", "เฟิร์น", "พฤษ"], adminName = "มอส") {
  const profiles = {};
  const ids = names.map((name, i) => {
    const id = `u_${["admin", "gift", "golf", "dragon", "fern", "pruek", "x7", "x8"][i] || `p${i}`}`;
    profiles[id] = { id, displayName: name, pin: "1234", mustChangePin: true, role: name === adminName ? "admin" : "player", active: true, createdAt: "2026-10-01T00:00:00.000Z" };
    return id;
  });
  return { schemaVersion: 2, profiles, seasonPlayerIds: [], rounds: [], results: {}, rankHistory: [], seasonArchives: [], auditLog: [], currentSeason: 1, ids };
}
