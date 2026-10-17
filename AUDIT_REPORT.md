# Site Audit — ตีให้สุด หยุดที่เบ้าตา

Date: 2026-10-17 · Branch: `site-audit` · Method: `/impeccable audit` (technical audit: a11y, performance, theming, responsive, implementation integrity)

Pages: `index`, `dashboard`, `stats`, `predictions`, `archive`, `backup`, `admin`, `dummy`.

**How it was measured**
- Playwright 1.56 + Chromium (`/opt/pw-browsers/chromium`), served by `python3 -m http.server`, at **390×844** (mobile, `isMobile` + `hasTouch`) and **1280×800**.
- Seeded localStorage: `pp_league_v7_uid` (7 players, 7-round round-robin, 13 results, 1 finished season in `rankHistory` and `seasonArchives`), `pp_predictions_v3_uid` (a dealer, 1 open market, 1 pending bet), session `pp_user_id` = admin (มอส). **Every request to `*.supabase.co` was aborted**, so pages run in "offline • local data" mode. Pages that need the cloud to load (sync, polling) were checked by reading the code.
- Per page and viewport, the script checked: rendered text contrast (alpha blended over the nearest solid background), visible inputs and buttons with no accessible name, interactive boxes smaller than 44×44, horizontal overflow, headings and landmarks, CLS (PerformanceObserver `layout-shift`), bytes transferred, request count, and render-blocking `<head>` resources. It also took full-page screenshots before and after the fixes.
- Also ran the bundled detector, `impeccable detect`, on the static files. Its findings are verified below; several were false positives.
- Untested: real-device touch gestures (only an emulated touch viewport was used), VoiceOver/TalkBack announcements (accessible names were checked in the DOM, not with a screen reader), and the online path against a live Supabase.

---

## Audit Health Score

| # | Dimension | Before | After | Key finding |
|---|-----------|:-----:|:-----:|-------------|
| 1 | Accessibility | 2 | 3 | Was: 42 unlabeled score inputs, avatar initials at 2.8:1, masthead subtitles at 3.9:1. All fixed. Left: login labels (PIN area, excluded), focus order in the sheets is untested. |
| 2 | Performance | 2 | 3 | The 3 s full-row poll kept running in background tabs; now skipped while the tab is hidden. Left: the poll still downloads the whole league JSON every tick, 6–8 blocking stylesheets per page, desktop CLS 0.10–0.15 on index. |
| 3 | Theming | 3 | 3 | Tokens are used almost everywhere. A few dark-theme colours were left over (`backup.css` meta/badge/empty; fixed). `predictions.css` and `suite.js` PNG export still have some (see P3). No dark mode, by design (poster world). |
| 4 | Responsive Design | 3 | 3 | No horizontal scroll at 390 or 1280 on any page. Masthead and header buttons were 34–36 px tall; now 44. Score steppers stay 36×44 on purpose (see P2). |
| 5 | Implementation Integrity | 3 | 3 | Coherent, product-specific poster system. Detector warnings are mostly false positives (verified below). |
| **Total** | | **13/20** | **15/20** | **Good**: address performance (polling payload, CLS) next |

## Implementation Integrity Verdict

**Pass.** Every page uses the same "fight bill" vocabulary from DESIGN.md: poster-yellow ground, paper panels on 2 px ink rules, magenta masthead, red/blue corners, Chonburi for names, scores and money. This is a product-specific system, not a generic template.

What the detector flagged, verified in context:
- `low-contrast` on `stats.html #sRing` (ink on magenta, 4.1:1): **false positive.** The win-rate number sits on the ring's paper `:before` disc, not on the magenta gradient. Rendered contrast is ink on paper.
- `low-contrast` on `predictions.html` (#000 on #2b2914, 1.4:1): **false positive.** That colour pair is not in the source, and the rendered pass found no contrast failures on predictions.
- `flat-type-hierarchy` on predictions (h1 = h2 = body 16 px): **false positive** from the static scan. The rendered h1/h2 use the Chonburi headline and title scales.
- `marquee` (`.skeleton:after` shimmer, infinite): **real but acceptable.** It runs only while a skeleton is visible, and `motion.css` turns it off under `prefers-reduced-motion`. P3.
- `side-tab` / `border-accent-on-rounded` in `banter.css` (season poster podium divider, masthead band rule): **intentional.** These are ink rules from the poster world, not accent stripes.
- ~190 advisory `design-system-*` findings (font sizes, colours, radii not on the DESIGN.md scale): mostly older page CSS (`backup.css`, `admin.css`, `archive.css`) that `poster.css` overrides at runtime. Cleanup candidates, not user-facing.

## Executive Summary

- Score: **13/20 → 15/20** (Good).
- Issues found: **P0: 0 · P1: 7 · P2: 7 · P3: 5**. All 7 P1s are fixed, plus 1 P2 (the `backup.css` leftovers).
- Top issues found:
  1. Score inputs on the league home (42 per season) and the bet controls on predictions had no accessible name. A screen reader announced "edit text, number", with no player.
  2. Avatar initials (decorative, but visible text) as low as 2.0:1 for the yellow, green and cyan hues.
  3. Masthead subtitle, sync status and page intros at 3.9:1 (white at 90% on magenta).
  4. Masthead and account-bar buttons were 34–36 px tall, and the "เปิด" link in League Assistant was a 19×19 target.
  5. The 3-second cloud poll on index and predictions kept downloading the full league row in background tabs.

---

## Detailed Findings

Legend: ✅ fixed in this PR · ⏭ left for later

### P1 Major

**✅ [P1] Score inputs and steppers have no accessible name**
- Location: `index.js` `renderSchedule` match row (`#r{n}m{n}a/b`, `.minus`, `.plus`)
- Category: Accessibility (WCAG 1.3.1, 4.1.2)
- Impact: 42 unnamed number fields per 7-player season. Screen readers can't say whose score a field holds, and the − / + buttons are read as "minus" / "plus" with no player.
- Fix: `aria-label="คะแนน {name}"`, `"ลดคะแนน {name}"`, `"เพิ่มคะแนน {name}"`. Attributes only; the template didn't change otherwise.

**✅ [P1] Form fields with visible but unassociated labels, or no label**
- Location: `stats.html` (`#playerA`, `#playerB`), `predictions.html` (`#dealerSelect`), `predictions.js` (dealer `fav-*`, `hcp-*`, `open-*`; the old bet `side-*` / `stake-*` controls were replaced by #31's labelled slip), `admin.html` (`#newName`, `#newRole`), `dummy.js` (player-name inputs)
- Category: Accessibility (WCAG 1.3.1, 3.3.2, 4.1.2)
- Impact: labels sat next to the fields but weren't linked (`<label>` without `for`). Placeholder-only inputs lose their name once text is typed.
- Fix: added `for=` to the existing labels; added `aria-label` where there is no visible label. No visual change.

**✅ [P1] Avatar initials fail contrast (2.0–3.8:1)**
- Location: `player-ui.js` `color()`
- Category: Accessibility (WCAG 1.4.3)
- Impact: white initials on yellow-green, green, teal and cyan avatars (e.g. `rgb(111,172,42)`, 2.76:1) are hard to read at the table and in dim light.
- Fix: a per-hue lightness cap (`LMAX`). Each player keeps the same hue and saturation, and only those hues get darker. Every hue/saturation/lightness combination now reaches ≥ 4.6:1. Red, blue and purple avatars don't change.

**✅ [P1] Masthead secondary text at 3.93:1**
- Location: `poster.css` `.hero :is(.muted,.sub,p,small)` (`rgba(255,255,255,.9)` on magenta `#e0147a`)
- Category: Accessibility (WCAG 1.4.3)
- Impact: season line, sync status and page intros on every page at 12–14 px.
- Fix: solid `#fff` (4.61:1). The look doesn't change visibly.

**✅ [P1] Season poster league name below the large-text threshold**
- Location: `banter.css` `.poster-league` (`clamp(20px,6vw,30px)`, yellow on magenta = 3.18:1)
- Category: Accessibility (WCAG 1.4.3)
- Impact: at 390 px the name renders at 23.4 px, just under the 24 px large-text size, so it needs 4.5:1 and gets 3.18:1.
- Fix: the minimum is now 24 px (`clamp(24px,6vw,30px)`), so the 3:1 large-text rule applies. The brand colours are unchanged.

**✅ [P1] Small touch targets in the masthead and on secondary actions**
- Location: `poster.css` `.hero>.actions` (36 px), `theme.css` `.hero-compact .account-bar` (34 px), `.sport-tools-toggle` (40 px), `share-poster.css` match share button (38×38), League Assistant "เปิด" link (19×19), `#archiveCsv` (42 wide), backup "ดู" (38 wide), `#logout` (42 wide)
- Category: Responsive / Accessibility (PRODUCT.md: "large touch targets for one-handed use"; WCAG 2.5.5)
- Fix: all of these are now at least 44×44. The "เปิด" link got a larger hit area through padding and negative margin, so the layout doesn't move. The screenshots look the same apart from slightly taller header buttons.

**✅ [P1] 3-second polling continues in background tabs**
- Location: `index.js` `pullCloud`, `predictions.js` `pull`
- Category: Performance
- Impact: each tick GETs the full `league` JSON (plus `predictions` on that page) from Supabase. A phone with the site open in a background tab kept downloading every 3 s: about 1,200 requests an hour per open tab, using battery and data. `dummy.js` already skipped hidden tabs.
- Fix: return early when `document.hidden`. The next tick after the tab becomes visible again (≤ 3 s) catches up. Saving, conflict handling and the visible-tab sync work as before.

### P2 Minor

**⏭ [P2] Poll downloads the whole row every tick**
- Location: `index.js` `pullCloud`, `predictions.js` `pull` (`select=league,updated_at` / `league,predictions,updated_at`)
- Category: Performance
- Impact: the payload grows with every season (`rankHistory`, `seasonArchives`, `auditLog`). On mobile data it's the biggest recurring cost.
- Recommendation: poll `select=updated_at` first and fetch the full row only when it changed. This changes the data flow, so it was left for its own PR. → `/impeccable optimize`

**⏭ [P2] Layout shift on the desktop league home (CLS 0.10–0.15 across runs)**
- Location: `suite.js` `addWorkflowCard` (runs `setTimeout(boot,100)` after DOMContentLoaded) and `sport-ui.js` `boot` (+40 ms) insert the League Assistant card and the tools toggle after first paint. `#competition` moves down about 196 px.
- Also: `stats.html` 0.074 (rival skeleton → content), `archive` 0.05, `admin` 0.049 at 1280. Mobile CLS is 0 on every page, because the shift happens below the fold.
- Recommendation: put a static `#workflowCard` placeholder with a reserved height in `index.html` and let `suite.js` fill it, or build the card synchronously. That means editing `index.html` / `suite.js` structure, so it was left. → `/impeccable optimize`

**⏭ [P2] Render-blocking CSS: 6–8 stylesheets per page**
- Location: every page `<head>`: `fonts.css`, page CSS, `theme.css`, `motion.css`, `poster.css`, `banter.css`, `share-poster.css`, `recovery.css` (index ≈ 62 KB of CSS before compression)
- Impact: a separate request for each before first paint on a cold 4G load. The service worker covers repeat visits.
- Recommendation: concatenate the shared layers (`theme` + `motion` + `poster`) into one file. Without a build step, that's a manual merge, so it was left. Scripts are already all `defer`, and fonts are preloaded with `font-display:swap` (good).

**⏭ [P2] Score steppers 36×44**
- Location: `poster.css` `.pair>.score-control` (`36px minmax(0,1fr) 36px`)
- Impact: meets WCAG 2.2 AA (24 px), but not 44 px. Tried 44 px in this PR: at 390 px the score input shrank to 31 px wide, too narrow for two-digit scores in 22 px Chonburi. Reverted.
- Recommendation: rework the match bill so the steppers can sit above or below the input on narrow screens (a layout change). → `/impeccable adapt`

**⏭ [P2] Login form labels not associated**
- Location: `index.html`, `predictions.html` auth overlay (`<label>บัญชี</label><select id="loginUser">`, `<label>PIN</label><input id="loginPin">`)
- Impact: the same issue as the fixed fields above.
- Why left: this is the PIN/login area, which PR #27 (security) is changing. Add `for="loginUser"` / `for="loginPin"` there or right after it merges.

**✅ [P2] Leftover dark-theme colours in Backup Center**
- Location: `backup.css` `.meta` (`#91a4be` on paper, 2.5:1), `.badge` (`#cfe1fb` text), `.empty`
- Fix: switched to the `--ink-soft` / `--ink` tokens.

**⏭ [P2] `.workflow-item` and other small links rely on colour only**
- The "เปิด" link in League Assistant is magenta-deep bold text with no underline. It's recognisable in context. Its hit area is fixed (see P1). Consider an underline. → `/impeccable polish`

### P3 Polish

- **⏭ Skeleton shimmer is an infinite loop.** It's fine as it is: it runs only while loading and is off under reduced motion.
- **⏭ The PNG export in `suite.js` (`downloadPng`) still draws in the old dark navy palette** (`#07111f`, `#91a4be`), so it doesn't match the poster world. → `/impeccable colorize`
- **⏭ `predictions.css` `.quick button` keeps dark-theme colours** that `poster.css` overrides, so nothing shows. Dead CSS.
- **⏭ `sport-ui.js` watches the whole document** with a `MutationObserver` (subtree + characterData) to mark empty stats. It's debounced (60 ms) and cheap at this scale, but runs on every poll re-render.
- **⏭ Rendered layout shows no focus traps,** but focus return after closing the recovery and profile sheets wasn't tested with a keyboard.

---

## Patterns & Systemic Issues

- **Templates rendered from JS skip labels.** Every unlabeled control was built in a JS template string (`index.js`, `predictions.js`, `dummy.js`) or used a `<label>` without `for`. New templates should carry `aria-label` or `for`/`id` from the start.
- **Old page CSS lingers under `poster.css`.** The per-page CSS (`backup.css`, `admin.css`, `archive.css`, `predictions.css`) still has dark-theme colours and sizes that `poster.css` overrides with `!important`. Whatever isn't overridden leaks through (that's how the backup meta text ended up at 2.5:1).
- **Late DOM injection.** `suite.js` and `sport-ui.js` add UI on timers after DOMContentLoaded. That's the main source of layout shift.

## Positive Findings

- `lang="th"`, one `<h1>` per page, a logical h2/h3 order, `<main>` and a labelled `<nav>` on every page.
- All scripts are `defer`. Fonts are self-hosted, subset, preloaded, `font-display:swap`.
- No horizontal overflow at 390 px or 1280 px on any page. Inputs are ≥ 48 px tall, and `inputmode="numeric"` is set for the iPhone number pad.
- A visible magenta focus ring (3 px) on every interactive element.
- The `prefers-reduced-motion` handling preserves state changes (fades instead of strikes) rather than killing all motion.
- Page weight is modest: 190–270 KB uncompressed per page, including ~75 KB of fonts that every page shares and caches.
- The Dummy page already pauses its sync while hidden. Its pattern was copied for index and predictions.

## Recommended Actions

1. **[P2] `/impeccable optimize`**: poll `updated_at` before fetching the full row, reserve space for the League Assistant card (CLS), merge the shared CSS layers.
2. **[P2] `/impeccable adapt`**: give the match bill a narrow-screen layout that lets the score steppers reach 44 px.
3. **[P2] (after PR #27)**: add `for=` to the login labels.
4. **[P3] `/impeccable colorize`**: bring the PNG standings export into the poster palette.
5. **[P3] `/impeccable polish`**: remove dead dark-theme CSS from the per-page stylesheets, and underline in-row links.

You can ask me to run these one at a time, all at once, or in any order you prefer. Re-run `/impeccable audit` after fixes to see your score improve.

---

## Changes in this PR (all low-risk, local)

| File | Change |
|---|---|
| `index.js` | `aria-label` on score inputs and −/+ steppers; `pullCloud` skips while `document.hidden` |
| `predictions.js` | `for=` on dealer market labels; `pull` skips while hidden (the bet slip from #31 is already labelled) |
| `dummy.js` | `aria-label` on player-name inputs |
| `player-ui.js` | per-hue lightness cap so avatar initials reach ≥ 4.5:1 |
| `poster.css` | masthead secondary text `#fff`; masthead buttons min-height 44; League Assistant link hit area |
| `theme.css` | compact account-bar buttons and tools toggle min-height 44; min-width 44 for CSV / backup "ดู" / logout |
| `share-poster.css` | match share button 44×44 |
| `banter.css` | `.poster-league` minimum 24 px |
| `backup.css` | dark-theme leftovers → ink tokens |
| `stats.html`, `predictions.html`, `admin.html` | `for=` / `aria-label` on form fields |
| all 8 HTML files | `?v=20261017-audit` bump for each changed JS/CSS |

Not touched: PIN/login/security code, data flow and sync logic (apart from the hidden-tab early return), the layout of the predictions and dummy pages.

Re-measured after the fixes and after merging main (PRs #30–#32: stamp sound, predictions fight bill, Dummy fast entry), with the same seed and both viewports: **0 contrast failures, 0 unnamed fields, and no overflow on any page.** The only targets under 44 px left are the 36×44 score steppers (see P2). `npm test`: 76/76 pass on the merged branch. The new predictions bet slip from #31 wraps the stake input in a `<label>`, so it no longer needs the `aria-label` this PR first added; the merge drops it.
