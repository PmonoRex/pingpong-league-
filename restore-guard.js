// QA B1: "กู้เฉพาะคะแนน" restores a result only when its match id still maps to the same pair.
// results are keyed by position (r{round}m{match}); a backup taken before the roster/schedule changed
// would otherwise put the old pair's score on whoever plays at that position now.
const RestoreGuard = (() => {
  const validScore = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const pairAt = (league, id) => { const m = /^r(\d+)m(\d+)$/.exec(id || ""); const pair = m && league?.rounds?.[Number(m[1])]?.m?.[Number(m[2])]; return Array.isArray(pair) && pair.length === 2 ? pair : null; };
  const name = (league, id) => league?.profiles?.[id]?.displayName || id;

  // Returns {ok, message, results, apply:[...], skipped:[...]} without touching either league.
  function planScores(current, backup) {
    const plan = { ok: false, message: "", results: JSON.parse(JSON.stringify(current?.results || {})), apply: [], skipped: [] };
    if (!backup || !current) { plan.message = "ไม่พบข้อมูล Backup"; return plan; }
    if (Number(backup.currentSeason) !== Number(current.currentSeason)) {
      plan.message = `Backup นี้เป็นของ Season ${backup.currentSeason ?? "-"} แต่ตอนนี้เป็น Season ${current.currentSeason ?? "-"} จึงกู้เฉพาะคะแนนไม่ได้ (ใช้ "กู้ทั้ง Season" แทน)`;
      Object.entries(backup.results || {}).filter(([, s]) => validScore(s)).forEach(([id, s]) => plan.skipped.push({ id, score: s, backupPair: pairAt(backup, id), currentPair: pairAt(current, id), reason: "คนละ Season" }));
      return plan;
    }
    const ids = new Set([...Object.keys(backup.results || {}), ...(current.rounds || []).flatMap((r, ri) => (r?.m || []).map((_, mi) => `r${ri}m${mi}`))]);
    ids.forEach(id => {
      const before = pairAt(backup, id), now = pairAt(current, id), score = backup.results?.[id];
      const has = validScore(score);
      if (!now) { if (has) plan.skipped.push({ id, score, backupPair: before, currentPair: null, reason: "ไม่มีคู่นี้ในตารางปัจจุบัน" }); return; }
      if (!before) { if (has) plan.skipped.push({ id, score, backupPair: null, currentPair: now, reason: "Backup ไม่มีตารางของคู่นี้" }); return; }
      const same = before[0] === now[0] && before[1] === now[1], swapped = before[0] === now[1] && before[1] === now[0];
      if (!same && !swapped) { if (has) plan.skipped.push({ id, score, backupPair: before, currentPair: now, reason: "คู่ไม่ตรงกับตารางปัจจุบัน" }); return; }
      if (has) { const next = swapped ? { a: score.b, b: score.a } : { a: score.a, b: score.b }; plan.results[id] = next; plan.apply.push({ id, pair: now, score: next }); }
      else if (id in plan.results) { delete plan.results[id]; plan.apply.push({ id, pair: now, score: null }); }
    });
    plan.ok = plan.apply.length > 0;
    if (!plan.ok) plan.message = plan.skipped.length ? `ไม่มีคะแนนที่ตรงคู่กับตารางปัจจุบัน (ข้าม ${plan.skipped.length} คู่) จึงไม่กู้คะแนน` : "Backup นี้ไม่มีคะแนนให้กู้";
    return plan;
  }

  const pairText = (league, pair) => pair ? `${name(league, pair[0])} vs ${name(league, pair[1])}` : "-";
  const scoreText = s => s ? `${s.a}-${s.b}` : "ล้างผล";
  function describe(plan, current, backup) {
    const lines = [];
    if (plan.message) lines.push(plan.message);
    lines.push(`จะกู้ ${plan.apply.length} คู่ • ข้าม ${plan.skipped.length} คู่`);
    plan.apply.forEach(x => lines.push(`✓ ${x.id} ${pairText(current, x.pair)} ${scoreText(x.score)}`));
    plan.skipped.forEach(x => lines.push(`✗ ${x.id} Backup: ${pairText(backup, x.backupPair)} ${scoreText(x.score)} → ตอนนี้: ${pairText(current, x.currentPair)} (${x.reason})`));
    return lines.join("\n");
  }
  return Object.freeze({ planScores, describe });
})();

// Backup page wiring (backup.js calls restore()/render() through their global names, so these take over at click time).
if (typeof restore === "function" && typeof document !== "undefined" && document.getElementById("restoreScores")) {
  const originalRestore = restore;
  restore = async function scoreSafeRestore(mode) {
    if (mode !== "scores") return originalRestore(mode);
    if (!selected || !isAdmin()) return alert("เฉพาะ Admin เท่านั้น");
    const plan = RestoreGuard.planScores(league, selected.state);
    if (!plan.ok) { $("backupStatus").textContent = plan.message; return alert(plan.message); }
    const warn = plan.skipped.length ? `\n\nข้าม ${plan.skipped.length} คู่ที่ไม่ตรงกับตารางปัจจุบัน (ดูใน Preview)` : "";
    if (!confirm(`กู้คะแนน ${plan.apply.length} คู่จาก Backup นี้?${warn}`)) return;
    snapshot("ก่อน Restore");
    const next = JSON.parse(JSON.stringify(league));
    next.results = plan.results;
    LeagueShared.audit(next, "restore_scores", currentId, { backupId: selected.id, backupAt: selected.savedAt, restored: plan.apply.length, skipped: plan.skipped.map(x => x.id) });
    LeagueShared.saveLocalLeague(next);
    try { await pushCloud(next); league = next; $("backupStatus").textContent = `Restore คะแนน ${plan.apply.length} คู่ และซิงก์ขึ้น Cloud สำเร็จ`; alert("กู้คืนสำเร็จ"); }
    catch (e) { league = LeagueShared.readLocalLeague() || league; $("backupStatus").textContent = `Restore ยังไม่ซิงก์: ${e.message}`; alert(e.message); }
  };
  // Preview: show what "กู้เฉพาะคะแนน" would restore and skip, after backup.js fills in the JSON.
  $("backupList").addEventListener("click", event => {
    if (!event.target.closest?.("[data-view]") || !selected) return;
    $("backupPreview").textContent = `${RestoreGuard.describe(RestoreGuard.planScores(league, selected.state), league, selected.state)}\n\n${$("backupPreview").textContent}`;
  });
}
