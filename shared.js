// Shared account, permission, validation and cloud rules for every page.
const LeagueShared = (() => {
  const LEAGUE_KEY = "pp_league_v7_uid";
  const PRED_KEY = "pp_predictions_v3_uid";
  const SESSION_KEY = "pp_user_id";
  const TOKEN_KEY = "pp_session_token_v1";
  const SCHEMA_VERSION = 2;
  const SUPABASE_URL = "https://gqlfqoeejgtjpsdvngbh.supabase.co";
  const SUPABASE_KEY = "sb_publishable_A26ocTxGPkLry2Y2iBY2mA_kTWNRI4Z";
  const CLOUD_ENDPOINT = `${SUPABASE_URL}/rest/v1/app_state?id=eq.main`;

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
    Object.values(league.profiles || {}).forEach(person => { if (person && typeof person === "object") delete person.pin; });
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

  // PINs are checked by the login RPC; the browser only keeps the opaque session token.
  const sessionToken = () => localStorage.getItem(TOKEN_KEY) || "";
  function clearSession() { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(TOKEN_KEY); }
  function sessionUserId(league) {
    const id = localStorage.getItem(SESSION_KEY) || "";
    if (id && sessionToken() && activeProfile(league, id)) return id;
    if (id || sessionToken()) clearSession();
    return "";
  }
  const validNewPin = (pin, oldPin) => /^[0-9]{4,6}$/.test(pin) && pin !== "1234" && pin !== oldPin;
  function askNewPin(oldPin) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const next = globalThis.prompt?.("ตั้ง PIN ใหม่ก่อนใช้งาน (ตัวเลข 4-6 หลัก ห้ามใช้ 1234 หรือ PIN เดิม)");
      if (next == null) return null;
      if (!validNewPin(next.trim(), oldPin)) { globalThis.alert?.("PIN ใหม่ต้องเป็นตัวเลข 4-6 หลัก ห้ามใช้ 1234 หรือ PIN เดิม"); continue; }
      if (globalThis.prompt?.("ยืนยัน PIN ใหม่อีกครั้ง") === next.trim()) return next.trim();
      globalThis.alert?.("PIN ไม่ตรงกัน");
    }
    return null;
  }
  async function login(id, pin) {
    let result;
    try { result = await rpc("login", { p_profile_id: id, p_pin: pin }); }
    catch { return { ok: false, reason: "เชื่อมต่อระบบไม่ได้ กรุณาลองใหม่" }; }
    if (!result?.ok) return { ok: false, locked: Boolean(result?.locked), reason: result?.locked ? `ใส่ PIN ผิดหลายครั้ง กรุณารอ ${Math.ceil(Number(result.retry_after_ms || 60000) / 1000)} วินาที` : "PIN ไม่ถูกต้องหรือบัญชีถูกปิดใช้งาน" };
    if (result.must_change) {
      const next = askNewPin(pin);
      const changed = next ? await rpc("change_pin", { p_token: result.token, p_old_pin: pin, p_new_pin: next }).catch(error => { globalThis.alert?.(error.message); return false; }) : false;
      if (!changed) { rpc("logout", { p_token: result.token }).catch(() => {}); return { ok: false, reason: "ต้องตั้ง PIN ใหม่ก่อนเข้าใช้งาน" }; }
    }
    localStorage.setItem(TOKEN_KEY, result.token); localStorage.setItem(SESSION_KEY, id); return { ok: true, reason: "" };
  }
  async function changePin() {
    if (!sessionToken()) return false;
    const oldPin = globalThis.prompt?.("PIN ปัจจุบัน"); if (oldPin == null) return false;
    const next = askNewPin(oldPin); if (!next) return false;
    try { if (await rpc("change_pin", { p_token: sessionToken(), p_old_pin: oldPin, p_new_pin: next })) return true; globalThis.alert?.("PIN ปัจจุบันไม่ถูกต้อง"); }
    catch (error) { globalThis.alert?.(error.message); }
    return false;
  }
  function logout() { const token = sessionToken(); clearSession(); if (token) rpc("logout", { p_token: token }).catch(() => {}); }
  function renderLoginOptions(select, league, selectedId = "") {
    const people = activeProfiles(league);
    select.innerHTML = people.length
      ? people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.displayName)}${person.role === "admin" ? " • Admin" : ""}</option>`).join("")
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
  async function cloudRequest(columns, method = "GET", body = null, extraQuery = "") {
    const options = { method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } };
    if (body !== null) { options.headers["Content-Type"] = "application/json"; options.headers.Prefer = "return=representation"; options.body = JSON.stringify(body); }
    const suffix = extraQuery ? (extraQuery.startsWith("&") ? extraQuery : `&${extraQuery}`) : "";
    const response = await fetch(`${CLOUD_ENDPOINT}${suffix}&select=${columns}`, options);
    if (!response.ok) throw new Error(`Cloud request failed: ${response.status}`);
    return response.json();
  }
  // Writes go through SECURITY DEFINER RPCs (app_state is read-only for anon). Errors carry the Postgres code:
  // 28000 = session invalid (cleared here, log in again), 28P01 = PIN change required, 42501 = not allowed.
  async function rpc(name, args) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.message || `Cloud request failed: ${response.status}`); error.code = data?.code || "";
      if (["28000", "28P01"].includes(error.code)) clearSession();
      throw error;
    }
    return data;
  }
  // Both return [{updated_at}] on success and [] when expectedUpdatedAt is stale (same contract as the old filtered PATCH).
  const saveLeague = (league, expectedUpdatedAt) => rpc("save_league", { p_token: sessionToken(), p_league: normalizeLeague(JSON.parse(JSON.stringify(league))), p_expected_updated_at: expectedUpdatedAt || null });
  const savePredictions = (predictions, expectedUpdatedAt) => rpc("save_predictions", { p_token: sessionToken(), p_predictions: predictions, p_expected_updated_at: expectedUpdatedAt || null });
  const resetPin = id => rpc("reset_pin", { p_token: sessionToken(), p_profile_id: id });

  return Object.freeze({ LEAGUE_KEY, PRED_KEY, SESSION_KEY, TOKEN_KEY, SCHEMA_VERSION, escapeHtml, newAccountId, profile,
    activeProfile, activeProfiles, isAdmin, isDealer, canManageMarket, marketKey, predictionOutcome, settlementOutcome, betEligibility,
    sessionUserId, sessionToken, login, logout, changePin, renderLoginOptions, readLocalLeague, saveLocalLeague, normalizeLeague, validateLeague, audit, smoothScrollTo,
    cloudRequest, rpc, saveLeague, savePredictions, resetPin });
})();
