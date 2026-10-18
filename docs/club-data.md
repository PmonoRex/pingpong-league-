# Club row (`app_state` id `club`)

Created by `supabase/migrations/20261019120000_club_row.sql`. The site keeps everything in the `league` column as
`{ club: { ... } }` and writes it only through `LeagueShared.clubMutate(change)` (shared.js): read the row, run
`change(club)` on the fresh copy, PATCH with an optimistic lock on `updated_at`, retry on a lost race. A `change`
function must therefore be safe to run more than once on a newer copy (add or update by id; never rebuild lists).
`LeagueShared.clubRead()` returns `{ club, updatedAt }` (or `null` when the row does not exist yet: show a short
"ต้องรัน SQL" note and keep the feature read-only). `club.v` is the format version (1).

All ids are short random strings (`LeagueShared.newAccountId()` style). Player ids are league profile ids.
Times are ISO strings.

```js
club = {
  v: 1,
  // Friendly matches outside the league table: challenges, tournament games. Feed Elo, head-to-head and badges,
  // never the league standings. Singles: a/b are player ids. Doubles: a/b are arrays of two player ids.
  matches: [{ id, kind: "challenge" | "tournament", format: "singles" | "doubles", a, b, s: { a, b } | null,
              at, by, tournamentId?, liveKey? }],
  challenges: [{ id, from, to, format, teamA?, teamB?, note, status: "open" | "accepted" | "declined" | "done" | "cancelled",
                 at, matchId? }],
  tournaments: [{ id, name, kind: "knockout" | "groups" | "playoff", format: "singles" | "doubles", season?,
                  entrants: [playerId | [id, id]], bracket: {...}, status: "draft" | "running" | "done", champion?, at, by }],
  social: {
    reactions: { [targetKey]: { [userId]: "🔥" } },   // targetKey: "s4:r2m1" (league match) or "c:<matchId>"
    comments: [{ id, target, by, text, at }]          // newest last, capped at 300
  },
  mvp: { [weekKey /* "2026-W42" */]: { [voterId]: playerId } },
  checkin: { [dateKey /* "2026-10-19" Asia/Bangkok */]: { [userId]: at } }
}
```

Elo is not stored: `elo.js` computes it from league matches plus `club.matches`.
