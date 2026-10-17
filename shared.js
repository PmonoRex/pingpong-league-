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
  function login(league, id, pin) {
    const person = activeProfile(league, id), map=guardMap(), g=map[id]||{fails:0,lockedUntil:0};
    if (Number(g.lockedUntil||0) > Date.now()) return false;
    if (!person || person.pin !== pin) {
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
  async function cloudRequest(columns, method = "GET", body = null, extraQuery = "") {
    const options = { method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } };
    if (body !== null) { options.headers["Content-Type"] = "application/json"; options.headers.Prefer = "return=representation"; options.body = JSON.stringify(body); }
    const suffix = extraQuery ? (extraQuery.startsWith("&") ? extraQuery : `&${extraQuery}`) : "";
    const response = await fetch(`${CLOUD_ENDPOINT}${suffix}&select=${columns}`, options);
    if (!response.ok) throw new Error(`Cloud request failed: ${response.status}`);
    return response.json();
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
    sessionUserId, login, loginGuardStatus, logout, renderLoginOptions, readLocalLeague, saveLocalLeague, normalizeLeague, validateLeague, audit, smoothScrollTo, nextUpMatches, cloudRequest, loadDummyCloud, saveDummyCloud });
})();
