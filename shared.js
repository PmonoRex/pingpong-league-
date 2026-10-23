// Shared account, permission, validation and cloud rules for every page.
const LeagueShared = (() => {
  const LEAGUE_KEY = "pp_league_v7_uid";
  const PRED_KEY = "pp_predictions_v3_uid";
  const SESSION_KEY = "pp_user_id";
  const LOGIN_GUARD_KEY = "pp_login_guard_v1";
  const SCHEMA_VERSION = 2;
  const SUPABASE_URL = "https://gqlfqoeejgtjpsdvngbh.supabase.co";
  const SUPABASE_KEY = "sb_publishable_A26ocTxGPkLry2Y2iBY2mA_kTWNRI4Z";
  const CLOUD_ENDPOINT = `${SUPABASE_URL}/rest/v1/app_state?id=eq.main`;
  const DEFAULT_PIN = "1234";
  const PIN_HASH_ITERATIONS = 150000;
  // PIN secrets that only the server keeps once phase 2 is on, plus the admin's "reset to 1234" marker.
  const SECRET_FIELDS = ["pin", "pinHash", "mustChangePin", "pinChangedAt"];
  const CREDENTIAL_FIELDS = [...SECRET_FIELDS, "pinResetAt"];
  // Phase 2 (supabase/migrations/20261019140000_server_auth.sql): a server-issued session token, kept beside pp_user_id.
  const TOKEN_KEY = "pp_session_v2";
  const AUTH_CACHE_KEY = "pp_server_auth_v1";
  const AUTH_TTL = 10 * 60 * 1000;

  const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
  const newAccountId = () => `u_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  const profile = (league, id) => league?.profiles?.[id] || null;
  const activeProfile = (league, id) => {
    const person = profile(league, id);
    return person && person.active !== false ? person : null;
  };
  const activeProfiles = league => Object.values(league?.profiles || {}).filter(person => person.active !== false);
  const isAdmin = (league, id) => activeProfile(league, id)?.role === "admin";
  const isDealer = (league, predictions, id) => Boolean(activeProfile(league, id) && predictions?.dealerId === id);
  const canManageMarket = (league, predictions, id) => isDealer(league, predictions, id);
  const marketKey = (season, matchId) => `s${season}:${matchId}`;

  function validateLeague(league) {
    const issues = [];
    if (!league || typeof league !== "object") return ["league missing"];
    if (!league.profiles || typeof league.profiles !== "object") issues.push("profiles invalid");
    if (!Array.isArray(league.seasonPlayerIds)) issues.push("seasonPlayerIds invalid");
    if (!Array.isArray(league.rounds)) issues.push("rounds invalid");
    if (!league.results || typeof league.results !== "object") issues.push("results invalid");
    (league.seasonPlayerIds || []).forEach(id => { if (!league.profiles?.[id]) issues.push(`missing profile:${id}`); });
    Object.entries(league.results || {}).forEach(([id, score]) => {
      if (score?.a != null && (!Number.isInteger(score.a) || score.a < 0)) issues.push(`invalid score:${id}.a`);
      if (score?.b != null && (!Number.isInteger(score.b) || score.b < 0)) issues.push(`invalid score:${id}.b`);
    });
    return issues;
  }
  function normalizeLeague(league) {
    if (!league || typeof league !== "object") return league;
    if (!league.schemaVersion || league.schemaVersion < SCHEMA_VERSION) league.schemaVersion = SCHEMA_VERSION;
    if (!Array.isArray(league.rankHistory)) league.rankHistory = [];
    if (!Array.isArray(league.seasonArchives)) league.seasonArchives = [];
    if (!Array.isArray(league.auditLog)) league.auditLog = [];
    return league;
  }
  function audit(league, action, actorId = "", meta = {}) {
    normalizeLeague(league);
    league.auditLog.unshift({ at:new Date().toISOString(), action, actorId, meta });
    league.auditLog = league.auditLog.slice(0, 200);
  }

  function predictionOutcome(pair, score, market) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair.includes(market?.favoriteId) ||
        !Number.isInteger(score?.a) || score.a < 0 || !Number.isInteger(score?.b) || score.b < 0 ||
        !Number.isFinite(market.handicap) || market.handicap < 0) return null;
    const adjustedA = score.a - (market.favoriteId === pair[0] ? market.handicap : 0);
    const adjustedB = score.b - (market.favoriteId === pair[1] ? market.handicap : 0);
    if (adjustedA === adjustedB) return { type: "push" };
    return { type: "win", winnerId: adjustedA > adjustedB ? pair[0] : pair[1] };
  }
  function settlementOutcome(season, bet, match) {
    if (bet?.season !== season || bet.status !== "pending" || match?.season !== season ||
        match.id !== bet.matchId || !Array.isArray(bet.pair) || bet.pair.length !== 2 ||
        !bet.pair.every((id, index) => id === match.pair?.[index])) return null;
    return predictionOutcome(match.pair, match.score, { favoriteId: bet.favoriteId, handicap: bet.handicap });
  }
  function betEligibility(league, predictions, id, match) {
    if (!activeProfile(league, id)) return { allowed: false, reason: "กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน" };
    if (isDealer(league, predictions, id)) return { allowed: false, reason: "เจ้ามือไม่สามารถทายผลได้" };
    if (!match?.pair || match.pair.includes(id)) return { allowed: false, reason: "ทายคู่ตัวเองไม่ได้" };
    const market = predictions?.markets?.[marketKey(match.season, match.id)];
    if (!market?.open || match.hasResult) return { allowed: false, reason: "คู่นี้ไม่ได้เปิดรับทาย" };
    if (predictions?.bets?.some(bet => bet.season === match.season && bet.matchId === match.id && bet.userId === id)) return { allowed: false, reason: "คุณทายคู่นี้แล้ว" };
    return { allowed: true, reason: "" };
  }

  function sessionUserId(league) {
    const id = localStorage.getItem(SESSION_KEY) || "";
    if (id && activeProfile(league, id)) return id;
    if (id) localStorage.removeItem(SESSION_KEY);
    return "";
  }
  function guardMap(){try{return JSON.parse(localStorage.getItem(LOGIN_GUARD_KEY)||"{}")||{}}catch{return{}}}
  function loginGuardStatus(id){const map=guardMap(),g=map[id]||{fails:0,lockedUntil:0};const remain=Math.max(0,Number(g.lockedUntil||0)-Date.now());return{fails:Number(g.fails||0),locked:remain>0,remainingMs:remain}}
  // A self-chosen PIN: 4-6 digits (the login field is a 6-digit number pad) and not one of the first PINs anyone would try.
  function pinPolicyError(pin) {
    const value = String(pin ?? "");
    if (!/^\d{4,6}$/.test(value)) return "PIN ต้องเป็นตัวเลข 4–6 หลัก";
    if (value === DEFAULT_PIN) return "ห้ามใช้ PIN เริ่มต้น 1234";
    if (/^(\d)\1+$/.test(value)) return "ห้ามใช้เลขซ้ำกันทั้งหมด เช่น 0000";
    const digits = [...value].map(Number), steps = new Set(digits.slice(1).map((d, i) => (d - digits[i] + 10) % 10));
    if (steps.size === 1 && (steps.has(1) || steps.has(9))) return "ห้ามใช้เลขเรียง เช่น 123456 หรือ 9876";
    return "";
  }
  const toHex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  const fromHex = hex => new Uint8Array((hex.match(/../g) || []).map(h => parseInt(h, 16)));
  // pinHash = "pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>". The row is still world-readable, so this only stops a
  // chosen PIN from being read off the page; a 4-6 digit PIN can still be brute-forced from it (see SECURITY_REVIEW.md).
  async function hashPin(pin, saltHex = "", iterations = PIN_HASH_ITERATIONS) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("เบราว์เซอร์นี้เข้ารหัส PIN ไม่ได้ (ต้องเปิดเว็บผ่าน https)");
    const salt = saltHex ? fromHex(saltHex) : globalThis.crypto.getRandomValues(new Uint8Array(16));
    const key = await subtle.importKey("raw", new TextEncoder().encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
    return `pbkdf2-sha256$${iterations}$${toHex(salt)}$${toHex(bits)}`;
  }
  async function verifyPin(person, pin) {
    if (!person || typeof pin !== "string" || !pin) return false;
    // Plaintext "pin" is the legacy format and what an admin reset writes (the public default 1234).
    if (typeof person.pin === "string" && person.pin === pin) return true;
    const parts = typeof person.pinHash === "string" ? person.pinHash.split("$") : [];
    if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256" || !/^[0-9a-f]{32}$/.test(parts[2])) return false;
    const iterations = Number(parts[1]);
    // The row is writable by anyone, so refuse iteration counts that would freeze the phone.
    if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 1000000) return false;
    try { return (await hashPin(pin, parts[2], iterations)) === person.pinHash; } catch { return false; }
  }
  // With server auth (or a row whose PIN fields were already moved to the server) the server's must_change flag, which
  // pp_login put in this browser's session, decides; otherwise the row's fields do, as before.
  const needsPinChange = person => {
    if (!person) return false;
    if (cachedServerAuth()?.available || (!("pin" in person) && !person.pinHash)) {
      const session = readSession();
      return Boolean(session && session.userId === person.id && session.mustChange);
    }
    return person.mustChangePin === true || !person.pinHash;
  };
  // Errors the user can fix by typing a different PIN (as opposed to network or conflict errors).
  const pinInputError = message => Object.assign(new Error(message), { pinInput: true });
  async function setPin(person, pin) {
    const error = pinPolicyError(pin);
    if (error) throw pinInputError(error);
    person.pinHash = await hashPin(pin);
    delete person.pin; delete person.mustChangePin;
    person.pinChangedAt = new Date().toISOString();
    return person;
  }
  // pinResetAt tells the server (pp_save_league) that the admin asked for this reset.
  function resetPin(person) {
    person.pin = DEFAULT_PIN; person.mustChangePin = true; person.pinResetAt = new Date().toISOString();
    delete person.pinHash; delete person.pinChangedAt;
    return person;
  }
  // Credentials change only through setPin/resetPin on the latest cloud copy. Every other league write takes them from the
  // cloud, so restoring an old backup or pushing a stale local copy cannot roll someone's PIN back to 1234.
  function keepCredentials(next, remote) {
    Object.entries(next?.profiles || {}).forEach(([id, person]) => {
      const current = remote?.profiles?.[id];
      if (!current || !person) return;
      CREDENTIAL_FIELDS.forEach(field => { if (field in current) person[field] = current[field]; else delete person[field]; });
    });
    return next;
  }

  // ---- Phase 2: server auth ----
  const RPC_BASE = `${SUPABASE_URL}/rest/v1/rpc/`;
  function readSession() {
    try {
      const s = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      if (!s?.token || !s.userId || (s.expiresAt && Date.parse(s.expiresAt) <= Date.now())) return null;
      return s;
    } catch { return null; }
  }
  function storeSession(s) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify(s)); } catch {} }
  function clearSession() { try { localStorage.removeItem(TOKEN_KEY); } catch {} }
  // The token for the account this browser is signed in as, or "".
  function sessionToken() { const s = readSession(); return s && s.userId === (localStorage.getItem(SESSION_KEY) || "") ? s.token : ""; }
  async function readBody(response) {
    if (typeof response.text === "function") { const text = await response.text(); try { return text ? JSON.parse(text) : null; } catch { return text; } }
    try { return await response.json(); } catch { return null; }
  }
  async function rpc(name, args = {}) {
    const response = await fetch(RPC_BASE + name, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const body = await readBody(response);
    if (response.ok) return body;
    const message = body?.message || `RPC ${name} failed: ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, code: body?.code || "", missing: response.status === 404,
      authExpired: /session expired/i.test(message), denied: body?.code === "42501" });
  }
  // Whether the phase 2 functions exist ({available, enforce}). Cached for 10 minutes (memory + localStorage); a
  // network failure is retried after 30 s. Without them every write is the old direct PATCH.
  let authStatus = null, authProbe = null;
  function cachedServerAuth() {
    if (authStatus && Date.now() - authStatus.at < AUTH_TTL) return authStatus;
    try { const c = JSON.parse(localStorage.getItem(AUTH_CACHE_KEY) || "null"); if (c && Date.now() - c.at < AUTH_TTL) return (authStatus = c); } catch {}
    return null;
  }
  function setServerAuth(status, persist = true) {
    authStatus = status;
    if (persist) { try { localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(status)); } catch {} }
    return status;
  }
  async function serverAuth({ fresh = false } = {}) {
    const cached = !fresh && cachedServerAuth();
    if (cached) return cached;
    if (!authProbe) authProbe = (async () => {
      try {
        const body = await rpc("pp_auth_version");
        const ok = Boolean(body && typeof body === "object" && !Array.isArray(body) && Number(body.version) >= 1);
        return setServerAuth({ available: ok, enforce: ok && body.enforce === true, at: Date.now() });
      } catch (error) {
        if (error.missing) return setServerAuth({ available: false, enforce: false, at: Date.now() });
        return setServerAuth({ available: false, enforce: false, at: Date.now() - AUTH_TTL + 30000 }, false);
      }
    })().finally(() => { authProbe = null; });
    return authProbe;
  }
  // pp_login: {ok, mustChange} or {ok:false, locked, retryAfterMs}. Throws when the server cannot be reached.
  async function serverLogin(id, pin) {
    const r = await rpc("pp_login", { p_user_id: id, p_pin: String(pin ?? "") });
    const map = guardMap();
    if (r?.token) {
      storeSession({ token: r.token, userId: id, mustChange: r.must_change === true, expiresAt: r.expires_at || "" });
      delete map[id]; localStorage.setItem(LOGIN_GUARD_KEY, JSON.stringify(map)); localStorage.setItem(SESSION_KEY, id);
      return { ok: true, mustChange: r.must_change === true };
    }
    if (r?.error === "locked") {
      const retryAfterMs = Math.max(1, Number(r.retry_after_seconds) || 60) * 1000;
      map[id] = { fails: 0, lockedUntil: Date.now() + retryAfterMs }; localStorage.setItem(LOGIN_GUARD_KEY, JSON.stringify(map));
      return { ok: false, locked: true, retryAfterMs };
    }
    return { ok: false, locked: false };
  }
  // Session missing or expired while saving: ask for the PIN again (pin-change.js) and report whether it worked.
  let reauthing = null;
  function reauth() {
    if (reauthing) return reauthing;
    const id = localStorage.getItem(SESSION_KEY) || "";
    const ui = typeof PinChange !== "undefined" && typeof PinChange.relogin === "function" ? PinChange : null;
    if (!id || !ui) return Promise.resolve(false);
    const name = readLocalLeague()?.profiles?.[id]?.displayName || "";
    reauthing = Promise.resolve().then(() => ui.relogin({ userId: id, name })).then(Boolean, () => false).finally(() => { reauthing = null; });
    return reauthing;
  }
  const authRequiredError = () => Object.assign(new Error("กรุณาเข้าสู่ระบบใหม่ก่อนบันทึก"), { authRequired: true });
  async function authedRpc(name, args) {
    for (let round = 0; round < 2; round++) {
      const token = sessionToken();
      if (token) {
        try { return await rpc(name, { p_token: token, ...args }); }
        catch (error) {
          if (error.denied) throw Object.assign(new Error(`ไม่มีสิทธิ์ทำรายการนี้ (${error.message})`), { denied: true });
          if (!error.authExpired) throw error;
          clearSession();
        }
      }
      if (round === 1 || !(await reauth())) throw authRequiredError();
    }
  }
  const stripSecrets = league => (!league?.profiles || typeof league.profiles !== "object") ? league : {
    ...league,
    profiles: Object.fromEntries(Object.entries(league.profiles).map(([id, person]) => {
      if (!person || typeof person !== "object") return [id, person];
      const copy = { ...person }; SECRET_FIELDS.forEach(field => delete copy[field]); return [id, copy];
    }))
  };
  function expectedStamp(extraQuery) { const m = /(?:^|&)updated_at=eq\.([^&]+)/.exec(extraQuery || ""); return m ? decodeURIComponent(m[1]) : null; }
  // Every PATCH the pages make goes through here first. With the phase 2 functions it becomes the matching pp_save_*
  // call and returns what the PATCH would have: [row] when saved, [] when another device saved first (callers retry).
  // Returns null to fall back to the direct PATCH (no server auth, or a body shape no RPC covers).
  async function routedWrite(rowId, body, extraQuery) {
    if (!body || typeof body !== "object" || !(await serverAuth()).available) return null;
    const keys = Object.keys(body).filter(key => key !== "updated_at"), expected = expectedStamp(extraQuery);
    let call = null;
    if (rowId === "main" && keys.length === 1 && keys[0] === "dummy") {
      const m = /dummy->>rev=eq\.(\d+)/.exec(extraQuery || "");
      call = ["pp_save_dummy", { p_dummy: body.dummy, p_expected_rev: m ? Number(m[1]) : 0 }, saved => saved && typeof saved === "object" ? [{ dummy: saved }] : []];
    } else if (rowId === "main" && keys.length === 1 && keys[0] === "league" && body.league?.uidLeague) {
      call = ["pp_save_league", { p_league: stripSecrets(body.league.uidLeague), p_expected: expected }, at => at ? [{ league: body.league, updated_at: at }] : []];
    } else if (rowId === "main" && keys.length === 1 && keys[0] === "predictions" && body.predictions?.uidPredictions) {
      call = ["pp_save_predictions", { p_predictions: body.predictions.uidPredictions, p_expected: expected }, at => at ? [{ predictions: body.predictions, updated_at: at }] : []];
    } else if (rowId === "live" && keys.length === 1 && keys[0] === "league") {
      call = ["pp_save_live", { p_live: body.league, p_expected: expected }, at => at ? [{ league: body.league, updated_at: at }] : []];
    } else if (rowId === "club" && keys.length === 1 && keys[0] === "league" && body.league?.club) {
      call = ["pp_save_club", { p_club: body.league.club, p_expected: expected }, at => at ? [{ league: body.league, updated_at: at }] : []];
    }
    if (!call) return null;
    try { return call[2](await authedRpc(call[0], call[1])); }
    catch (error) {
      if (error.missing) { setServerAuth({ available: false, enforce: false, at: Date.now() }); return null; }
      throw error;
    }
  }

  async function login(league, id, pin) {
    if ((await serverAuth()).available) {
      try {
        const result = await serverLogin(id, pin);
        return result.ok;
      } catch (error) { if (error.missing) setServerAuth({ available: false, enforce: false, at: Date.now() }); }
      // Server unreachable: fall through to the old in-browser check (a local session only; saves need a token).
    }
    const person = activeProfile(league, id), map=guardMap(), g=map[id]||{fails:0,lockedUntil:0};
    if (Number(g.lockedUntil||0) > Date.now()) return false;
    if (!(await verifyPin(person, pin))) {
      g.fails=Number(g.fails||0)+1;
      if(g.fails>=5){g.lockedUntil=Date.now()+60000;g.fails=0}
      map[id]=g;localStorage.setItem(LOGIN_GUARD_KEY,JSON.stringify(map));return false;
    }
    delete map[id];localStorage.setItem(LOGIN_GUARD_KEY,JSON.stringify(map));localStorage.setItem(SESSION_KEY, id);return true;
  }
  function logout() {
    const token = readSession()?.token;
    if (token) rpc("pp_logout", { p_token: token }).catch(() => {});
    clearSession(); localStorage.removeItem(SESSION_KEY);
  }
  function renderLoginOptions(select, league, selectedId = "") {
    const people = activeProfiles(league);
    select.innerHTML = people.length
      ? people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.displayName)}${person.role === "admin" ? " • แอดมิน" : ""}</option>`).join("")
      : '<option value="">ไม่มีบัญชีผู้เล่น</option>';
    if (selectedId && activeProfile(league, selectedId)) select.value = selectedId;
  }
  function readLocalLeague() {
    try { const value = JSON.parse(localStorage.getItem(LEAGUE_KEY) || "null"); return value?.profiles ? normalizeLeague(value) : null; }
    catch { return null; }
  }
  function saveLocalLeague(league) { localStorage.setItem(LEAGUE_KEY, JSON.stringify(normalizeLeague(league))); peekMemo.delete(LEAGUE_KEY); }
  // Read-only copies for the layers that only look (avatars, Elo, notifications, badges): parsed once per stored value
  // and shared, instead of JSON.parse of the whole league (pictures included) on every call, and without even copying
  // the stored string out of localStorage on every call (a page of avatars asks hundreds of times). Writes through
  // this file and other tabs' writes (storage event) drop the copy at once; anything else is noticed within a second,
  // when the stored string is compared again. Callers must never change what these return; use readLocalLeague() /
  // readLocalClub() for a private copy to edit.
  const peekMemo = new Map(), PEEK_RECHECK_MS = 1000;
  function peekStored(key, parse) {
    const hit = peekMemo.get(key), now = Date.now();
    if (hit && now - hit.at < PEEK_RECHECK_MS) return hit.value;
    let raw = null; try { raw = localStorage.getItem(key); } catch {}
    if (hit && hit.raw === raw) { hit.at = now; return hit.value; }
    let value; try { value = parse(raw); } catch { value = null; }
    peekMemo.set(key, { raw, value, at: now });
    return value;
  }
  if (typeof addEventListener === "function") addEventListener("storage", e => { if (e.key === null) peekMemo.clear(); else peekMemo.delete(e.key); });
  const peekLocalLeague = () => peekStored(LEAGUE_KEY, raw => { const value = JSON.parse(raw || "null"); return value?.profiles ? normalizeLeague(value) : null; });

  let scrollFrame = null;
  function smoothScrollTo(target) {
    if (!target) return;
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    const start = window.scrollY;
    const limit = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const destination = Math.max(0, Math.min(limit, start + target.getBoundingClientRect().top - 14));
    const distance = destination - start;
    if (Math.abs(distance) < 2) return;
    const duration = Math.min(650, Math.max(320, Math.abs(distance) * 0.5));
    const started = performance.now();
    const step = now => { const progress = Math.min(1, (now - started) / duration), eased = 1 - Math.pow(1 - progress, 3); window.scrollTo(0, start + distance * eased); scrollFrame = progress < 1 ? requestAnimationFrame(step) : null; };
    scrollFrame = requestAnimationFrame(step);
  }
  // Next unplayed matches in schedule order (round by round); a match counts as played once both scores are whole numbers >= 0.
  function nextUpMatches(rounds, results, limit = 2) {
    const done = x => x && [x.a, x.b].every(v => Number.isInteger(v) && v >= 0);
    const out = [];
    (Array.isArray(rounds) ? rounds : []).forEach((round, ri) => (Array.isArray(round?.m) ? round.m : []).forEach((pair, mi) => {
      const id = `r${ri}m${mi}`;
      if (out.length < limit && !done(results?.[id])) out.push({ id, round: ri + 1, pair: [pair[0], pair[1]], rest: round.rest || null });
    }));
    return out;
  }
  // Every save to the shared row is optimistic: it lands only if the row is still at the version that was read.
  // When several phones save in the same moment one wins and the rest are refused; those wait a short random beat
  // (so they do not collide again) and redo their read-merge-write, instead of giving up and falling back.
  const LOCK_TRIES = 6;
  function lockBackoff(attempt) { return new Promise(done => setTimeout(done, Math.min(1600, 160 * 2 ** attempt) * (0.5 + Math.random()))); }
  async function cloudRequest(columns, method = "GET", body = null, extraQuery = "") {
    if (method === "PATCH") { const routed = await routedWrite("main", body, extraQuery); if (routed) return routed; }
    const options = { method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } };
    if (body !== null) { options.headers["Content-Type"] = "application/json"; options.headers.Prefer = "return=representation"; options.body = JSON.stringify(body); }
    const suffix = extraQuery ? (extraQuery.startsWith("&") ? extraQuery : `&${extraQuery}`) : "";
    const response = await fetch(`${CLOUD_ENDPOINT}${suffix}&select=${columns}`, options);
    if (!response.ok) throw new Error(`Cloud request failed: ${response.status}`);
    return response.json();
  }
  // The small "live" row (live scoring, live.js): same table, its own id, so watchers poll a few KB instead of the league.
  // Missing before the owner runs 20261018130000_harden_shared_state.sql: a GET then returns [] and live.js stays local.
  const LIVE_ENDPOINT = `${SUPABASE_URL}/rest/v1/app_state?id=eq.live`;
  async function liveRequest(method = "GET", body = null, extraQuery = "") {
    if (method === "PATCH") { const routed = await routedWrite("live", body, extraQuery); if (routed) return routed; }
    const options = { method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } };
    if (body !== null) { options.headers["Content-Type"] = "application/json"; options.headers.Prefer = "return=representation"; options.body = JSON.stringify(body); }
    const response = await fetch(`${LIVE_ENDPOINT}${extraQuery ? `&${extraQuery}` : ""}&select=league,updated_at`, options);
    if (!response.ok) throw new Error(`Live request failed: ${response.status}`);
    return response.json();
  }
  // The "club" row (challenges, tournaments, votes, reactions, check-in; docs/club-data.md). Missing until the owner runs
  // 20261019120000_club_row.sql: clubRead() then returns null and the club features stay read-only.
  const CLUB_ENDPOINT = `${SUPABASE_URL}/rest/v1/app_state?id=eq.club`;
  async function clubRequest(method = "GET", body = null, extraQuery = "") {
    if (method === "PATCH") { const routed = await routedWrite("club", body, extraQuery); if (routed) return routed; }
    const options = { method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } };
    if (body !== null) { options.headers["Content-Type"] = "application/json"; options.headers.Prefer = "return=representation"; options.body = JSON.stringify(body); }
    const response = await fetch(`${CLUB_ENDPOINT}${extraQuery ? `&${extraQuery}` : ""}&select=league,updated_at`, options);
    if (!response.ok) throw new Error(`Club request failed: ${response.status}`);
    return response.json();
  }
  const CLUB_KEY = "pp_club_v1";
  const emptyClub = () => ({ v: 1, matches: [], challenges: [], tournaments: [], social: { reactions: {}, comments: [] }, mvp: {}, checkin: {} });
  const normalizeClub = c => { const e = emptyClub(), x = c && typeof c === "object" ? c : {}; return { ...e, ...x, social: { ...e.social, ...(x.social || {}) } }; };
  function readLocalClub() { try { return normalizeClub(JSON.parse(localStorage.getItem(CLUB_KEY) || "null")); } catch { return emptyClub(); } }
  const peekLocalClub = () => peekStored(CLUB_KEY, raw => { try { return normalizeClub(JSON.parse(raw || "null")); } catch { return emptyClub(); } });
  // Several scripts poll the club row (challenge.js, social.js, tournament.js, hall.js): reads that overlap share one
  // request, and a read that was already on its way when this page saved is answered with the saved copy instead, so
  // it cannot put the older row back into pp_club_v1 (and the pages) after the save. Once a copy is known, a read
  // first asks only for the row's updated_at: the whole row (every match, comment and bracket) comes down, is parsed
  // and is stored again only when it changed.
  let clubSeq = 0, clubSavedSeq = -1, clubSaved = null, clubPending = null, clubKnown = null;
  const clubCopy = res => res ? { club: JSON.parse(JSON.stringify(res.club)), updatedAt: res.updatedAt } : res;
  async function clubStamp() {
    const response = await fetch(`${CLUB_ENDPOINT}&select=updated_at`, { method: "GET", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!response.ok) throw new Error(`Club request failed: ${response.status}`);
    const rows = await response.json();
    return rows?.[0] ? rows[0].updated_at || "" : null;
  }
  async function clubRead() {
    if (!clubPending) {
      const seq = ++clubSeq;
      clubPending = (async () => {
        try {
          const known = clubKnown;
          if (known?.updatedAt && await clubStamp() === known.updatedAt) {
            if (seq < clubSavedSeq && clubSaved) return clubSaved;
            return { club: normalizeClub(JSON.parse(known.raw)), updatedAt: known.updatedAt };
          }
          const row = (await clubRequest())[0];
          if (!row) { clubKnown = null; return null; }
          if (seq < clubSavedSeq && clubSaved) return clubSaved;
          const club = normalizeClub(row.league?.club), raw = JSON.stringify(club);
          try { localStorage.setItem(CLUB_KEY, raw); } catch {} peekMemo.delete(CLUB_KEY);
          clubKnown = row.updated_at ? { raw, updatedAt: row.updated_at } : null;
          return { club, updatedAt: row.updated_at };
        } finally { clubPending = null; }
      })();
    }
    return clubCopy(await clubPending);
  }
  // Apply change(club) to the newest copy and save it; change may return false to cancel. Returns the saved club.
  async function clubMutate(change) {
    for (let attempt = 0; attempt < LOCK_TRIES; attempt++) {
      const row = (await clubRequest())[0];
      if (!row) throw new Error("ยังไม่ได้เปิดระบบคลับ (ต้องรัน SQL)");
      const club = normalizeClub(structuredClone(row.league?.club || {}));
      if (change(club) === false) return null;
      if (club.social.comments.length > 300) club.social.comments = club.social.comments.slice(-300);
      const filter = row.updated_at ? `updated_at=eq.${encodeURIComponent(row.updated_at)}` : "";
      const saved = await clubRequest("PATCH", { league: { ...(row.league || {}), club }, updated_at: new Date().toISOString() }, filter);
      if (saved?.length) {
        const raw = JSON.stringify(club);
        try { localStorage.setItem(CLUB_KEY, raw); } catch {} peekMemo.delete(CLUB_KEY);
        clubSavedSeq = ++clubSeq; clubSaved = { club: JSON.parse(raw), updatedAt: saved[0]?.updated_at || "" };
        clubKnown = saved[0]?.updated_at ? { raw, updatedAt: saved[0].updated_at } : null;
        return club;
      }
      await lockBackoff(attempt);
    }
    throw new Error("มีคนบันทึกพร้อมกันหลายครั้ง กรุณาลองใหม่");
  }
  // Self-service PIN change: re-read the cloud row, check the current PIN against it, and write back only this profile's
  // new credentials (optimistic lock on updated_at like every other writer; a lost race re-reads and retries).
  async function changePin(id, currentPin, newPin) {
    const error = pinPolicyError(newPin);
    if (error) throw pinInputError(error);
    if (newPin === currentPin) throw pinInputError("PIN ใหม่ต้องไม่ซ้ำกับ PIN เดิม");
    if ((await serverAuth()).available) return changePinOnServer(id, currentPin, newPin);
    for (let attempt = 0; attempt < LOCK_TRIES; attempt++) {
      if (attempt) await lockBackoff(attempt - 1);
      const row = (await cloudRequest("league,updated_at"))[0], latest = row?.league?.uidLeague;
      if (!latest?.profiles) throw new Error("ไม่พบข้อมูลบัญชีในระบบ");
      const person = activeProfile(latest, id);
      if (!person) throw new Error("บัญชีนี้ถูกปิดใช้งาน");
      if (!(await verifyPin(person, currentPin))) throw Object.assign(pinInputError("PIN เดิมไม่ถูกต้อง"), { wrongCurrent: true });
      await setPin(person, newPin);
      audit(latest, "pin_change", id, { target: id });
      const expected = row.updated_at || "", filter = expected ? `updated_at=eq.${encodeURIComponent(expected)}` : "";
      const saved = await cloudRequest("league,updated_at", "PATCH", { league: { ...(row.league || {}), uidLeague: latest }, updated_at: new Date().toISOString() }, filter);
      if (saved?.length) { saveLocalLeague(latest); return latest; }
    }
    throw new Error("ข้อมูลถูกแก้จากอีกเครื่อง กรุณาลองใหม่");
  }
  // Phase 2: the server checks the current PIN and keeps the new one (bcrypt, private.credentials); nothing goes into the
  // league row. Signs in with the current PIN first when this browser has no session for the account.
  async function changePinOnServer(id, currentPin, newPin) {
    const wrongCurrent = () => Object.assign(pinInputError("PIN เดิมไม่ถูกต้อง"), { wrongCurrent: true });
    for (let round = 0; round < 2; round++) {
      const s = readSession();
      if (!s || s.userId !== id) {
        const signedIn = await serverLogin(id, currentPin);
        if (signedIn.locked) throw new Error(`ใส่ PIN ผิดหลายครั้ง • ลองใหม่ใน ${Math.ceil(signedIn.retryAfterMs / 60000)} นาที`);
        if (!signedIn.ok) throw wrongCurrent();
      }
      let result;
      try { result = await rpc("pp_change_pin", { p_token: readSession().token, p_current_pin: currentPin, p_new_pin: newPin }); }
      catch (error) { if (error.authExpired && round === 0) { clearSession(); continue; } throw error; }
      if (result?.error === "wrong current PIN") throw wrongCurrent();
      if (result?.error === "PIN not allowed") throw pinInputError(pinPolicyError(newPin) || "ใช้ PIN นี้ไม่ได้");
      if (result?.error === "locked") throw new Error("ใส่ PIN ผิดหลายครั้ง • ลองใหม่ภายหลัง");
      if (!result?.ok) throw new Error("เปลี่ยน PIN ไม่สำเร็จ");
      storeSession({ ...readSession(), mustChange: false });
      try { const latest = (await cloudRequest("league,updated_at"))[0]?.league?.uidLeague; if (latest?.profiles) { saveLocalLeague(latest); return latest; } } catch {}
      return readLocalLeague();
    }
    throw new Error("เปลี่ยน PIN ไม่สำเร็จ");
  }
  // Full-resolution pictures (match-card backgrounds) live in the public Supabase Storage bucket "media", not in the
  // league row, so polls stay small. Only URLs under MEDIA_BASE with a plain file path are ever used as a picture.
  const MEDIA_BASE = `${SUPABASE_URL}/storage/v1/object/public/media/`;
  const mediaUrlOk = url => typeof url === "string" && url.length < 300 && url.startsWith(MEDIA_BASE) && /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/.test(url.slice(MEDIA_BASE.length)) && !url.includes("..");
  // Uploads a picture and returns its public URL; throws when the bucket is missing or refuses (see docs/media-storage.md).
  async function uploadMedia(path, blob) {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/media/${path}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": blob.type || "image/webp", "x-upsert": "true", "cache-control": "max-age=31536000" },
      body: blob
    });
    if (!response.ok) { let why = ""; try { const body = await response.json(); why = body?.message || body?.error || ""; } catch {} throw new Error(`ที่เก็บรูปตอบ ${response.status}${why ? `: ${why}` : ""}`); }
    const url = MEDIA_BASE + path;
    if (!mediaUrlOk(url)) throw new Error("Media path not allowed");
    return url;
  }
  // Dummy card scores live in their own `dummy` column. Their optimistic lock is `dummy.rev` (not updated_at),
  // so a Dummy save never makes an in-flight league or predictions save look stale.
  async function loadDummyCloud() {
    const row = (await cloudRequest("dummy"))[0];
    if (!row) throw new Error("Cloud row missing");
    return row.dummy && typeof row.dummy === "object" ? row.dummy : {};
  }
  // Writes only if the cloud copy is still at `baseRev`; returns the saved object, or null when another device got there first.
  async function saveDummyCloud(dummy, baseRev) {
    const rev = Math.max(0, Math.floor(Number(baseRev) || 0));
    const rows = await cloudRequest("dummy", "PATCH", { dummy }, rev ? `dummy->>rev=eq.${rev}` : "dummy->>rev=is.null");
    return rows?.[0]?.dummy || null;
  }

  // Warm the server-auth cache early so needsPinChange() and the first save already know which path to take.
  if (typeof document !== "undefined") serverAuth().catch(() => {});

  return Object.freeze({ LEAGUE_KEY, PRED_KEY, SESSION_KEY, SCHEMA_VERSION, SUPABASE_URL, SUPABASE_KEY, escapeHtml, newAccountId, profile,
    activeProfile, activeProfiles, isAdmin, isDealer, canManageMarket, marketKey, predictionOutcome, settlementOutcome, betEligibility,
    sessionUserId, login, loginGuardStatus, logout, DEFAULT_PIN, pinPolicyError, hashPin, verifyPin, needsPinChange, setPin, resetPin,
    keepCredentials, changePin, serverAuth, serverLogin, authedRpc, hasServerSession: () => Boolean(sessionToken()), sessionToken, TOKEN_KEY, renderLoginOptions, readLocalLeague, peekLocalLeague, saveLocalLeague, normalizeLeague, validateLeague, audit, smoothScrollTo, nextUpMatches, cloudRequest, loadDummyCloud, saveDummyCloud, LOCK_TRIES, lockBackoff, liveRequest, CLUB_KEY, emptyClub, normalizeClub, readLocalClub, peekLocalClub, clubRead, clubMutate, MEDIA_BASE, mediaUrlOk, uploadMedia });
})();
