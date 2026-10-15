(() => {
  const BACKUP_KEY = "pp_league_recovery_v1";
  const MAX_SNAPSHOTS = 24;
  let candidates = [];
  let selectedIndex = -1;
  let snapshotTimer = null;

  const clone = value => JSON.parse(JSON.stringify(value));
  const safeParse = value => { try { return JSON.parse(value || "null"); } catch { return null; } };
  const isScore = score => Number.isInteger(score?.a) && score.a >= 0 && Number.isInteger(score?.b) && score.b >= 0;
  const playedCount = results => Object.values(results || {}).filter(isScore).length;
  const totalFromIds = ids => Array.isArray(ids) ? ids.length * (ids.length - 1) / 2 : 0;

  function readSnapshots() {
    const value = safeParse(localStorage.getItem(BACKUP_KEY));
    return Array.isArray(value) ? value : [];
  }
  function writeSnapshots(list) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(list.slice(0, MAX_SNAPSHOTS))); } catch {}
  }
  function snapshotCurrent(reason = "อัตโนมัติ") {
    if (typeof state === "undefined" || !state?.profiles) return;
    const played = playedCount(state.results);
    if (!played) return;
    const snapshots = readSnapshots();
    const payload = {
      id: `snap_${Date.now()}`,
      savedAt: new Date().toISOString(),
      reason,
      league: clone({
        profiles: state.profiles,
        seasonPlayerIds: state.seasonPlayerIds,
        rounds: state.rounds,
        results: state.results,
        rankHistory: state.rankHistory,
        currentSeason: state.currentSeason
      })
    };
    const fingerprint = JSON.stringify([payload.league.currentSeason, payload.league.seasonPlayerIds, payload.league.results]);
    const filtered = snapshots.filter(item => JSON.stringify([item.league?.currentSeason, item.league?.seasonPlayerIds, item.league?.results]) !== fingerprint);
    writeSnapshots([payload, ...filtered]);
  }
  function scheduleSnapshot(reason) {
    clearTimeout(snapshotTimer);
    snapshotTimer = setTimeout(() => snapshotCurrent(reason), 700);
  }

  function nameMap() {
    const map = new Map();
    Object.values(state?.profiles || {}).forEach(p => map.set(String(p.displayName || "").trim(), p.id));
    return map;
  }
  function mapLegacyPlayer(value, map) {
    if (!value) return null;
    if (state.profiles?.[value]) return value;
    return map.get(String(value).trim()) || null;
  }
  function normalize(raw, source, savedAt = null, reason = "") {
    if (!raw) return null;
    if (raw.uidLeague) raw = raw.uidLeague;
    const map = nameMap();
    let ids = [], rounds = [], results = raw.results || {}, season = Number(raw.currentSeason) || null;

    if (raw.profiles && Array.isArray(raw.seasonPlayerIds)) {
      ids = raw.seasonPlayerIds.filter(id => state.profiles?.[id] || raw.profiles?.[id]);
      rounds = Array.isArray(raw.rounds) ? clone(raw.rounds) : [];
      rounds = rounds.map(r => ({
        rest: mapLegacyPlayer(r.rest, map),
        m: (r.m || []).map(pair => [mapLegacyPlayer(pair?.[0], map), mapLegacyPlayer(pair?.[1], map)]).filter(pair => pair[0] && pair[1])
      }));
    } else if (Array.isArray(raw.players)) {
      ids = raw.players.map(name => mapLegacyPlayer(name, map)).filter(Boolean);
      rounds = (raw.rounds || []).map(r => ({
        rest: mapLegacyPlayer(r.rest, map),
        m: (r.m || []).map(pair => [mapLegacyPlayer(pair?.[0], map), mapLegacyPlayer(pair?.[1], map)]).filter(pair => pair[0] && pair[1])
      }));
    } else return null;

    const played = playedCount(results);
    if (ids.length < 2 || !rounds.length || !played) return null;
    return { source, savedAt, reason, ids, rounds, results: clone(results), season, played, total: totalFromIds(ids) };
  }

  function collectCandidates() {
    const list = [];
    readSnapshots().forEach(item => {
      const c = normalize(item.league, "สำรองอัตโนมัติ", item.savedAt, item.reason || "");
      if (c) list.push(c);
    });

    const currentKey = typeof LeagueShared !== "undefined" ? LeagueShared.LEAGUE_KEY : "pp_league_v7_uid";
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("pp_league") || key === BACKUP_KEY) continue;
      const raw = safeParse(localStorage.getItem(key));
      const c = normalize(raw, key === currentKey ? "ข้อมูลในเครื่องปัจจุบัน" : `ข้อมูลเก่าในเครื่อง (${key})`);
      if (c) list.push(c);
    }

    const seen = new Set();
    candidates = list.filter(c => {
      const fp = JSON.stringify([c.season, c.ids, c.results]);
      if (seen.has(fp)) return false;
      seen.add(fp); return true;
    }).sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || "") || b.played - a.played);
    selectedIndex = candidates.length ? 0 : -1;
    renderCandidates();
  }

  function fmtDate(value) {
    if (!value) return "ไม่ทราบเวลา";
    try { return new Date(value).toLocaleString("th-TH"); } catch { return value; }
  }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[c]);
  function playerNames(ids) {
    return ids.map(id => state.profiles?.[id]?.displayName || id).join(", ");
  }
  function renderCandidates() {
    const list = document.getElementById("recoveryList");
    const preview = document.getElementById("recoveryPreview");
    if (!list || !preview) return;
    if (!candidates.length) {
      list.innerHTML = '<div class="recovery-empty">ไม่พบข้อมูลคะแนนเก่าที่กู้ได้ในเครื่องนี้</div>';
      preview.innerHTML = '<div class="hint">ถ้าคะแนนเคยกรอกจากเครื่องอื่น ให้เปิดเว็บจากเครื่องนั้นแล้วกดปุ่มกู้ข้อมูลอีกครั้ง</div>';
      document.getElementById("restoreRecovery").disabled = true;
      return;
    }
    list.innerHTML = candidates.map((c, i) => `<button type="button" class="recovery-item ${i===selectedIndex?"active":""}" data-recovery-index="${i}"><span><strong>${esc(c.source)}</strong><small>${esc(`${c.season?`Season ${c.season} • `:""}${fmtDate(c.savedAt)}${c.reason?` • ${c.reason}`:""}`)}</small></span><span class="recovery-count">${esc(c.played)}/${esc(c.total)}</span></button>`).join("");
    list.querySelectorAll("[data-recovery-index]").forEach(btn => btn.onclick = () => { selectedIndex = Number(btn.dataset.recoveryIndex); renderCandidates(); });
    const c = candidates[selectedIndex];
    preview.innerHTML = `<strong>ตัวอย่างก่อนกู้</strong><div class="recovery-preview-grid"><div><b>${esc(c.season || "-")}</b><small>Season เดิม</small></div><div><b>${esc(c.played)}</b><small>แมตช์ที่มีคะแนน</small></div><div><b>${c.ids.length}</b><small>ผู้เล่น</small></div></div><div class="hint" style="margin-top:9px">${esc(playerNames(c.ids))}</div>`;
    document.getElementById("restoreRecovery").disabled = false;
  }

  function openRecovery() {
    if (typeof isAdmin === "function" && !isAdmin()) return alert("เฉพาะ Admin เท่านั้น");
    collectCandidates();
    document.getElementById("recoveryBackdrop")?.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeRecovery() {
    document.getElementById("recoveryBackdrop")?.classList.remove("open");
    document.body.style.overflow = "";
  }
  function restoreSelected() {
    if (selectedIndex < 0 || !candidates[selectedIndex]) return;
    if (typeof isAdmin === "function" && !isAdmin()) return alert("เฉพาะ Admin เท่านั้น");
    const c = candidates[selectedIndex];
    const rankExists = c.season && (state.rankHistory || []).some(s => Number(s.season) === Number(c.season));
    const warning = `กำลังกู้ ${c.played} แมตช์${c.season?` จาก Season ${c.season}`:""}\n\nระบบจะสำรองข้อมูลปัจจุบันก่อนกู้ และจะอัปเดตขึ้นฐานข้อมูลหลังยืนยัน${rankExists?"\n\nหมายเหตุ: Season นี้มีประวัติแรงค์แล้ว ระบบจะไม่ย้อนหมายเลข Season เพื่อป้องกันแรงค์ซ้ำ":""}`;
    if (!confirm(warning)) return;
    snapshotCurrent("ก่อนกู้ข้อมูล");
    state.seasonPlayerIds = clone(c.ids);
    state.rounds = clone(c.rounds);
    state.results = clone(c.results);
    if (c.season && !rankExists) state.currentSeason = c.season;
    if (typeof saveLocal === "function") saveLocal();
    if (typeof saveState === "function") saveState();
    if (typeof render === "function") render();
    closeRecovery();
    alert(`กู้คะแนนสำเร็จ ${c.played} แมตช์ กรุณาตรวจสอบคะแนนก่อนกดจบ Season`);
  }

  function bind() {
    document.getElementById("openRecovery")?.addEventListener("click", openRecovery);
    document.getElementById("closeRecovery")?.addEventListener("click", closeRecovery);
    document.getElementById("cancelRecovery")?.addEventListener("click", closeRecovery);
    document.getElementById("restoreRecovery")?.addEventListener("click", restoreSelected);
    document.getElementById("recoveryBackdrop")?.addEventListener("click", e => { if (e.target.id === "recoveryBackdrop") closeRecovery(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeRecovery(); });

    ["finishSeason","applyRoster","clearScores"].forEach(id => document.getElementById(id)?.addEventListener("click", () => snapshotCurrent(`ก่อน ${id}`), true));
    document.getElementById("schedule")?.addEventListener("input", () => scheduleSnapshot("กรอกคะแนน"));
    document.getElementById("schedule")?.addEventListener("click", e => { if (e.target.closest("[data-score]")) scheduleSnapshot("แก้คะแนน"); });
    snapshotCurrent("เปิดหน้าเว็บ");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind); else bind();
})();
