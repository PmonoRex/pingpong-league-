// Session 1: preserve a full Season snapshot before the next Season starts.
(() => {
  if (typeof finishSeason !== "function" || typeof state === "undefined") return;
  const originalFinishSeason = finishSeason;
  const clone = value => JSON.parse(JSON.stringify(value));

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

    state.seasonArchives = Array.isArray(state.seasonArchives) ? state.seasonArchives : [];
    const history = (state.rankHistory || []).find(item => Number(item.season) === beforeSeason);
    const archive = {
      season: beforeSeason,
      finishedAt: history?.finishedAt || new Date().toISOString(),
      playerIds: before.startedRoster,
      rounds: before.rounds,
      results: before.results,
      standings: clone(history?.standings || []),
      profileNames: Object.fromEntries(Object.entries(before.profiles).map(([id,p]) => [id,p?.displayName || id]))
    };

    const existingIndex = state.seasonArchives.findIndex(item => Number(item.season) === beforeSeason);
    if (existingIndex >= 0) state.seasonArchives[existingIndex] = archive;
    else state.seasonArchives.push(archive);
    state.seasonArchives.sort((a,b) => Number(a.season) - Number(b.season));
    saveState();
    return result;
  };
})();
