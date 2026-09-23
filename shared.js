// Shared account, permission and cloud rules for every page.
const LeagueShared = (() => {
  const LEAGUE_KEY = "pp_league_v7_uid";
  const PRED_KEY = "pp_predictions_v3_uid";
  const SESSION_KEY = "pp_user_id";
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
  const canManageMarket = (league, predictions, id) => isAdmin(league, id) || isDealer(league, predictions, id);

  function betEligibility(league, predictions, id, match) {
    if (!activeProfile(league, id)) return { allowed: false, reason: "กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน" };
    if (isDealer(league, predictions, id)) return { allowed: false, reason: "เจ้ามือไม่สามารถทายผลได้" };
    if (!match?.pair || match.pair.includes(id)) return { allowed: false, reason: "ทายคู่ตัวเองไม่ได้" };
    const market = predictions?.markets?.[match.id];
    if (!market?.open || match.hasResult) return { allowed: false, reason: "คู่นี้ไม่ได้เปิดรับทาย" };
    if (predictions?.bets?.some(bet => bet.matchId === match.id && bet.userId === id)) {
      return { allowed: false, reason: "คุณทายคู่นี้แล้ว" };
    }
    return { allowed: true, reason: "" };
  }

  function sessionUserId(league) {
    const id = localStorage.getItem(SESSION_KEY) || "";
    if (id && activeProfile(league, id)) return id;
    if (id) localStorage.removeItem(SESSION_KEY);
    return "";
  }
  function login(league, id, pin) {
    const person = activeProfile(league, id);
    if (!person || person.pin !== pin) return false;
    localStorage.setItem(SESSION_KEY, id);
    return true;
  }
  function logout() { localStorage.removeItem(SESSION_KEY); }
  function renderLoginOptions(select, league, selectedId = "") {
    const people = activeProfiles(league);
    select.innerHTML = people.length
      ? people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.displayName)}${person.role === "admin" ? " • Admin" : ""}</option>`).join("")
      : '<option value="">ไม่มีบัญชีผู้เล่น</option>';
    if (selectedId && activeProfile(league, selectedId)) select.value = selectedId;
  }
  function readLocalLeague() {
    try {
      const value = JSON.parse(localStorage.getItem(LEAGUE_KEY) || "null");
      return value?.profiles ? value : null;
    } catch { return null; }
  }
  function saveLocalLeague(league) { localStorage.setItem(LEAGUE_KEY, JSON.stringify(league)); }

  async function cloudRequest(columns, method = "GET", body = null) {
    const options = { method, headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } };
    if (body !== null) {
      options.headers["Content-Type"] = "application/json";
      options.headers.Prefer = "return=representation";
      options.body = JSON.stringify(body);
    }
    const response = await fetch(`${CLOUD_ENDPOINT}&select=${columns}`, options);
    if (!response.ok) throw new Error(`Cloud request failed: ${response.status}`);
    return response.json();
  }

  return Object.freeze({ LEAGUE_KEY, PRED_KEY, SESSION_KEY, escapeHtml, newAccountId, profile,
    activeProfile, activeProfiles, isAdmin, isDealer, canManageMarket, betEligibility,
    sessionUserId, login, logout, renderLoginOptions, readLocalLeague, saveLocalLeague, cloudRequest });
})();
