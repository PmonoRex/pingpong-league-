// Session 1: preserve a full Season snapshot before the next Season starts.
(() => {
  if (typeof finishSeason !== "function" || typeof state === "undefined") return;
  const originalFinishSeason = finishSeason;
  const clone = value => JSON.parse(JSON.stringify(value));
  const validScore = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const nameMap = profiles => Object.fromEntries(Object.entries(profiles || {}).map(([id,p]) => [id,p?.displayName || id]));

  function storeArchive(archive) {
    state.seasonArchives = Array.isArray(state.seasonArchives) ? state.seasonArchives : [];
    const existingIndex = state.seasonArchives.findIndex(item => Number(item.season) === Number(archive.season));
    if (existingIndex >= 0) state.seasonArchives[existingIndex] = archive;
    else state.seasonArchives.push(archive);
    state.seasonArchives.sort((a,b) => Number(a.season) - Number(b.season));
  }

  finishSeason = function archiveAwareFinishSeason(...args) {
    const beforeSeason = Number(state.currentSeason) || 1;
    const before = {
      season: beforeSeason,
      startedRoster: clone(state.seasonPlayerIds || []),
      rounds: clone(state.rounds || []),
      results: clone(state.results || {}),
      profiles: clone(state.profiles || {})
    };

    const result = originalFinishSeason.apply(this, args);
    if ((Number(state.currentSeason) || 0) !== beforeSeason + 1) return result;

    const history = (state.rankHistory || []).find(item => Number(item.season) === beforeSeason);
    storeArchive({
      season: beforeSeason,
      finishedAt: history?.finishedAt || new Date().toISOString(),
      playerIds: before.startedRoster,
      rounds: before.rounds,
      results: before.results,
      standings: clone(history?.standings || []),
      profileNames: nameMap(before.profiles)
    });
    saveState();
    return result;
  };

  // QA A1: index.js binds the button to the original function before this file runs,
  // so reassigning the global alone never reached the button. Call through the global at click time.
  const finishBtn = document.getElementById("finishSeason");
  if (finishBtn && finishBtn.onclick === originalFinishSeason) finishBtn.onclick = function(event){ return finishSeason.call(this, event); };

  // One-off back-fill: Seasons finished while the bug was live have rankHistory but no archive.
  // Their per-match scores survive only in this device's local snapshots (recovery.js / safety-hooks.js).
  // A snapshot is used only when it is complete and reproduces the recorded points of every player.
  function snapshotSources() {
    const read = key => { try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
    return [
      ...read("pp_league_recovery_v1").map(x => ({ league: x?.league, savedAt: x?.savedAt || "", source: "recovery" })),
      ...read("pp_backup_center_v1").map(x => ({ league: x?.state, savedAt: x?.savedAt || "", source: "backup" }))
    ].filter(x => x.league && Array.isArray(x.league.rounds));
  }
  function pointsFrom(rounds, results) {
    const pts = {}; let played = 0, total = 0;
    rounds.forEach((r,ri) => (r?.m || []).forEach((pair,mi) => {
      total++;
      const x = results?.[`r${ri}m${mi}`];
      if (!validScore(x)) return;
      played++;
      const [a,b] = pair; pts[a] = pts[a] || { pts:0, gd:0 }; pts[b] = pts[b] || { pts:0, gd:0 };
      pts[a].gd += x.a - x.b; pts[b].gd += x.b - x.a;
      if (x.a > x.b) pts[a].pts += 3; else if (x.b > x.a) pts[b].pts += 3; else { pts[a].pts++; pts[b].pts++; }
    }));
    return { pts, played, total };
  }
  function findBackfill(league = state) {
    const archived = new Set((league.seasonArchives || []).map(a => Number(a.season)));
    const snapshots = snapshotSources().sort((a,b) => String(b.savedAt).localeCompare(String(a.savedAt)));
    const out = [];
    (league.rankHistory || []).forEach(history => {
      const season = Number(history.season);
      if (archived.has(season) || !(history.standings || []).length) return;
      const match = snapshots.find(s => {
        if (Number(s.league.currentSeason) !== season) return false;
        const { pts, played, total } = pointsFrom(s.league.rounds, s.league.results);
        if (!total || played !== total) return false;
        return history.standings.every(row => row.userId && pts[row.userId] && pts[row.userId].pts === row.pts && (row.gd == null || pts[row.userId].gd === row.gd));
      });
      if (!match) return;
      out.push({
        season,
        finishedAt: history.finishedAt || null,
        playerIds: clone(match.league.seasonPlayerIds || history.standings.map(r => r.userId)),
        rounds: clone(match.league.rounds),
        results: clone(match.league.results),
        standings: clone(history.standings),
        profileNames: { ...nameMap(match.league.profiles), ...nameMap(league.profiles) },
        backfilled: { from: match.source, snapshotAt: match.savedAt, at: new Date().toISOString() }
      });
    });
    return out;
  }
  function applyBackfill() {
    if (typeof isAdmin === "function" && !isAdmin()) return 0;
    const list = findBackfill();
    if (!list.length) return 0;
    const lines = list.map(a => `• ซีซั่น ${a.season}: ${Object.keys(a.results).length} แมตช์ (จากสำรองในเครื่อง ${a.backfilled.snapshotAt ? new Date(a.backfilled.snapshotAt).toLocaleString("th-TH") : "-"})`).join("\n");
    if (!confirm(`เติมคลังย้อนหลังจากข้อมูลสำรองในเครื่องนี้?\n\n${lines}\n\nตรวจแล้วว่าแต้มทุกคนตรงกับแรงค์ที่บันทึกไว้ ระบบจะบันทึกขึ้น Cloud`)) return 0;
    list.forEach(storeArchive);
    saveState();
    if (typeof render === "function") render();
    window.LeagueToast?.(`เติมคลังแล้ว ${list.length} ซีซั่น`, "good");
    return list.length;
  }
  function refreshBackfillButton() {
    const host = document.querySelector?.("#standingsCard .actions");
    if (!host) return;
    let btn = document.getElementById("archiveBackfill");
    const count = typeof isAdmin === "function" && isAdmin() ? findBackfill().length : 0;
    if (!count) { btn?.remove(); return; }
    if (!btn) { btn = document.createElement("button"); btn.id = "archiveBackfill"; btn.type = "button"; btn.className = "secondary"; btn.onclick = applyBackfill; host.appendChild(btn); }
    btn.textContent = `📚 เติมคลังย้อนหลัง (${count} ซีซั่น)`;
  }
  if (typeof render === "function") {
    const originalRender = render;
    render = function backfillAwareRender(...args) { const r = originalRender.apply(this, args); try { refreshBackfillButton(); } catch {} return r; };
  }
  try { refreshBackfillButton(); } catch {}
  globalThis.LeagueArchiveBackfill = Object.freeze({ find: findBackfill, apply: applyBackfill });
})();
