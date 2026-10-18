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
  const CREDENTIAL_FIELDS = ["pin", "pinHash", "mustChangePin", "pinChangedAt"];

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
  const needsPinChange = person => Boolean(person) && (person.mustChangePin === true || !person.pinHash);
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
  function resetPin(person) {
    person.pin = DEFAULT_PIN; person.mustChangePin = true;
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

  async function login(league, id, pin) {
    const person = activeProfile(league, id), map=guardMap(), g=map[id]||{fails:0,lockedUntil:0};
    if (Number(g.lockedUntil||0) > Date.now()) return false;
    if (!(await verifyPin(person, pin))) {
      g.fails=Number(g.fails||0)+1;
      if(g.fails>=5){g.lockedUntil=Date.now()+60000;g.fails=0}
      map[id]=g;localStorage.setItem(LOGIN_GUARD_KEY,JSON.stringify(map));return false;
    }
    delete map[id];localStorage.setItem(LOGIN_GUARD_KEY,JSON.stringify(map));localStorage.setItem(SESSION_KEY, id);return true;
  }
  function logout() { localStorage.removeItem(SESSION_KEY); }
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
  function saveLocalLeague(league) { localStorage.setItem(LEAGUE_KEY, JSON.stringify(normalizeLeague(league))); }

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
    const options = { method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } };
    if (body !== null) { options.headers["Content-Type"] = "application/json"; options.headers.Prefer = "return=representation"; options.body = JSON.stringify(body); }
    const suffix = extraQuery ? (extraQuery.startsWith("&") ? extraQuery : `&${extraQuery}`) : "";
    const response = await fetch(`${CLOUD_ENDPOINT}${suffix}&select=${columns}`, options);
    if (!response.ok) throw new Error(`Cloud request failed: ${response.status}`);
    return response.json();
  }
  // Self-service PIN change: re-read the cloud row, check the current PIN against it, and write back only this profile's
  // new credentials (optimistic lock on updated_at like every other writer; a lost race re-reads and retries).
  async function changePin(id, currentPin, newPin) {
    const error = pinPolicyError(newPin);
    if (error) throw pinInputError(error);
    if (newPin === currentPin) throw pinInputError("PIN ใหม่ต้องไม่ซ้ำกับ PIN เดิม");
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

  return Object.freeze({ LEAGUE_KEY, PRED_KEY, SESSION_KEY, SCHEMA_VERSION, escapeHtml, newAccountId, profile,
    activeProfile, activeProfiles, isAdmin, isDealer, canManageMarket, marketKey, predictionOutcome, settlementOutcome, betEligibility,
    sessionUserId, login, loginGuardStatus, logout, DEFAULT_PIN, pinPolicyError, hashPin, verifyPin, needsPinChange, setPin, resetPin,
    keepCredentials, changePin, renderLoginOptions, readLocalLeague, saveLocalLeague, normalizeLeague, validateLeague, audit, smoothScrollTo, nextUpMatches, cloudRequest, loadDummyCloud, saveDummyCloud, LOCK_TRIES, lockBackoff, MEDIA_BASE, mediaUrlOk, uploadMedia });
})();
