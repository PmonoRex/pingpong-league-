---
name: ตีให้สุด หยุดที่เบ้าตา
description: A friends' ping pong league run like a match night in a dark arena under one red spotlight.
colors:
  bg: "#0a0b0e"
  bg-2: "#101217"
  panel: "#15171d"
  panel-2: "#1c1f26"
  panel-3: "#252932"
  field: "#0e1014"
  dock: "rgba(12,13,17,.94)"
  line: "rgba(255,255,255,.08)"
  line-2: "rgba(255,255,255,.16)"
  white: "#ffffff"
  text: "#f4f5f7"
  text-2: "#c9cdd5"
  text-soft: "#9ba1ad"
  red: "#d81e29"
  red-hi: "#ff4752"
  red-deep: "#9e111a"
  red-glow: "rgba(229,36,47,.38)"
  corner-red: "#ff5560"
  blue: "#5b8cff"
  red-field: "rgba(229,36,47,.16)"
  blue-field: "rgba(91,140,255,.12)"
  win: "#34d27c"
  lose: "#ff5c68"
  gold: "#f5b80b"
  silver: "#c3cad5"
  bronze: "#d68a4c"
typography:
  display:
    fontFamily: "Kanit, Anuphan, system-ui, sans-serif"
    fontSize: "clamp(32px, 9vw, 48px)"
    fontWeight: 800
    lineHeight: 1.04
    letterSpacing: "0"
  headline:
    fontFamily: "Kanit, Anuphan, system-ui, sans-serif"
    fontSize: "clamp(26px, 7.4vw, 38px)"
    fontWeight: 800
    lineHeight: 1.08
    letterSpacing: "0"
  title:
    fontFamily: "Kanit, Anuphan, system-ui, sans-serif"
    fontSize: "clamp(20px, 5.4vw, 25px)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0"
  fighter:
    fontFamily: "Kanit, Anuphan, system-ui, sans-serif"
    fontSize: "clamp(18px, 5vw, 23px)"
    fontWeight: 600
    lineHeight: 1.2
  figure:
    fontFamily: "Kanit, Anuphan, system-ui, sans-serif"
    fontSize: "clamp(22px, 6vw, 28px)"
    fontWeight: 800
    lineHeight: 1.1
    fontFeature: "\"tnum\", \"lnum\""
  score:
    fontFamily: "Kanit, Anuphan, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "\"tnum\", \"lnum\""
  body:
    fontFamily: "Anuphan, system-ui, -apple-system, Segoe UI, Tahoma, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Anuphan, system-ui, -apple-system, Segoe UI, Tahoma, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.2
  table-head:
    fontFamily: "Anuphan, system-ui, -apple-system, Segoe UI, Tahoma, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.06em"
rounded:
  badge: "6px"
  r-sm: "10px"
  r: "14px"
  dock: "18px"
  pill: "999px"
  disc: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
components:
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.r-sm}"
  button-secondary:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.r-sm}"
  button-secondary-hover:
    backgroundColor: "{colors.panel-3}"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.lose}"
    typography: "{typography.label}"
    rounded: "{rounded.r-sm}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    rounded: "{rounded.r-sm}"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.r}"
  panel-row:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.r-sm}"
  masthead:
    backgroundColor: "{colors.bg-2}"
    textColor: "{colors.white}"
    typography: "{typography.display}"
    rounded: "{rounded.r}"
    padding: "16px 16px 14px"
  masthead-compact:
    backgroundColor: "{colors.bg-2}"
    textColor: "{colors.white}"
    typography: "{typography.headline}"
    rounded: "{rounded.r}"
    padding: "14px 16px 12px"
  vs-disc:
    backgroundColor: "{colors.field}"
    textColor: "{colors.red-hi}"
    rounded: "{rounded.disc}"
    size: "46px"
  tab-bar:
    backgroundColor: "{colors.dock}"
    textColor: "{colors.text-soft}"
    rounded: "{rounded.dock}"
  tab-bar-active:
    backgroundColor: "transparent"
    textColor: "{colors.red-hi}"
  table-header:
    backgroundColor: "{colors.bg-2}"
    textColor: "{colors.text-soft}"
    typography: "{typography.table-head}"
  tag:
    backgroundColor: "{colors.panel-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
  tag-closed:
    backgroundColor: "{colors.red}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
---

# Design System: ตีให้สุด หยุดที่เบ้าตา

## Overview

**Creative North Star: "Match Night Under the Red Light"**

The league reads as a dark esports-style sports app on match night. The ground is a near-black arena (bg) lit by one red spotlight: a soft red radial bloom in the top-right corner of the page and a fainter one on the left. Content sits on smoked-glass panels (panel with a faint white sheen across the top 120px, a hairline white border, 14px corners, a deep soft shadow). Red is the only loud colour; it carries the primary action, the active tab, section markers, the VS disc and the winner's tag, and it glows. Every pairing is still a face-off, red corner left and blue corner right, with a glowing VS disc between.

Density is phone-first and operational. Big sporty words (the league name, page titles, scores, figures, stamps) are set in Kanit 800 italic; names and section titles in Kanit 600 upright; everything you read or operate stays in Anuphan. Desktop widens the league home into two columns (matches on the left, sticky standings on the right) without changing the vocabulary. This world replaces the yellow fight-poster world (Chonburi, magenta masthead, paper panels on poster yellow) that the site had before.

**Key Characteristics:**
- Near-black arena ground with a red radial bloom; smoked-glass panels with hairline white borders and 14px corners.
- Two Kanit cuts only: 800 italic for the big sporty words and numbers, 600 upright for names and section titles; Anuphan for everything else.
- Red is the one accent and the interaction colour (primary button, focus, caret, selection, active tab, progress); it glows.
- Red corner / blue corner for every match-up; green and coral-red only for won/lost money and W/L.
- Gold, silver and bronze for ranks 1-3, the leader row and champions.
- Lifted surfaces: panels, the masthead, the tab dock and sheets cast deep, soft black shadows; red elements add a red glow.

## Colors

A dark arena palette: three steps of near-black panel, white text at three strengths, one red with a hot highlight and a glow, a cool blue for the second corner, and medal metals.

### Primary
- **Arena Red** (red): the primary-button gradient (#dc2530 to #b0121a with a #ff5c66 hairline), the "+" score stepper, the section-head square marker, the brand mark, the closed tag, badges, the profile avatar, the Dummy leader position, progress and win-rate fill, selection, checkbox/radio accent. **Red Deep** (red-deep) is the bottom of the brand-mark and progress gradients.
- **Hot Red** (red-hi): red as text and light on dark: focus outlines, input focus border, caret, active tab label and its 3px top bar, VS letters, points and RP, payment amounts, handicaps, the first "next up" tag, links in workflow items, the toast's edge.
- **Red Glow** (red-glow): the halo under red things (VS disc, brand mark, progress fill, section marker, active tab bar and icon, the winner tag).

### Secondary
- **Corner Red** (corner-red): the lighter red the page sheets use for the left corner; red-corner score inputs border at 55% of it, and a red-corner result line reads #ff8a92.
- **Corner Blue** (blue): the right corner: blue score-input border (55%), blue winner tag (#6f9bff to #2f5fd6), blue result line (#9dbaff). Blue never appears outside a pairing.
- **Red Field / Blue Field** (red-field, blue-field): the two ends of a match card's 100deg gradient, red bleeding in from the left, blue from the right, meeting dark in the middle.

### Tertiary
- **Win Green / Lose Coral** (win, lose): money won and lost, W/L form dots (dark text on the fill), rank deltas, the danger button, the negative-sign toggle, sync-online and "all done" states. Never decoration.
- **Gold / Silver / Bronze** (gold, silver, bronze): rank discs 1-3, podium rings and steps, the gold leader row in standings, the gold แชมป์ stamp and champion counts, the Dummy day winner.

### Neutral
- **Arena Black** (bg): the page ground under the red bloom; `color-scheme: dark`.
- **Stage** (bg-2): table header rows, the poster foot, the masthead's tone.
- **Panel** (panel): top-level cards, sheets, table wraps, poster bills.
- **Panel 2** (panel-2): rows and boxes inside a panel, match cards, secondary buttons, notices.
- **Panel 3** (panel-3): the third step up: score steppers, rank discs, tags, toasts, draw dots, secondary-button hover.
- **Field** (field): input, progress-track and bar fills, darker than the panel so entry fields read as recessed.
- **Text / Text 2 / Text Soft** (text, text-2, text-soft): body and headings; labels and stat captions; hints, muted lines, status and table-header text. Names in match cards and on red fills are pure white.
- **Line / Line 2** (line, line-2): hairline borders: line (8% white) for panels and row dividers, line-2 (16% white) for controls, the masthead, sheets and the rule that opens a group.
- Overlays are rgba(5,6,8,.72) with a 6px backdrop blur.

### Named Rules
**The One Light Rule.** Red is the only accent colour in the arena. Gold, silver and bronze mean rank; green and coral mean won and lost; blue means the right corner. Nothing else gets a hue.
**The Two Corners Rule.** Any head-to-head pairing is red on the left, blue on the right, every time. Red/blue never encode good/bad.
**The Money Is Green and Coral Rule.** Win green and lose coral are reserved for won/lost amounts, W/L results and rank movement.

## Typography

**Display Font:** Kanit (with Anuphan, system-ui, sans-serif)
**Body Font:** Anuphan (with system-ui, -apple-system, Segoe UI, Tahoma, sans-serif)

**Character:** Kanit is a squared Thai/Latin sans with a sports-broadcast feel; the site ships exactly two cuts of it, 800 italic for the loud words and 600 upright for names and titles. Anuphan is a clean Thai UI sans that keeps controls, labels and tables ordinary and legible.

### Hierarchy
- **Display** (Kanit 800 italic, clamp(32px,9vw,48px), 1.04): the league name in the league-home masthead only, white with a soft red glow.
- **Headline** (Kanit 800 italic, clamp(26px,7.4vw,38px), 1.08): page titles in the compact masthead on every other page; the auth sheet title.
- **Title** (Kanit 600, clamp(20px,5.4vw,25px), 1.25): panel headings and section heads, each led by a small red square marker; workflow titles; Dummy day and pay heads; quick-tile names.
- **Fighter** (Kanit 600, clamp(18px,5vw,23px), 1.2): player names in a match card, white, balanced, wrapping rather than truncating; "next up" names at clamp(16px,4.4vw,19px).
- **Figures** (Kanit 800 italic, tabular lining numerals): stat-line values (clamp(22px,6vw,28px)), score inputs (22px), RP/points, rank and Dummy position discs, money totals, form-dot letters, the result line (18px), the ชนะ tag and VS (17px).
- **Body** (Anuphan 400, 14px, 1.55): running UI text, lists, tables; paragraphs and hints use pretty wrapping.
- **Label** (Anuphan 700, 14px): buttons, names in table rows, stat-line captions (14px, text-2). Table headers are Anuphan 600 12px with 0.06em tracking in text-soft on stage.

### Named Rules
**The Two Cuts Rule.** Kanit exists on the site only as 600 upright and 800 italic. Italic means loud (titles in the masthead, numbers, stamps); upright 600 means names and section titles. Never ask for another weight or an upright 800; `font-synthesis:none` means the browser will not fake one.
**The Arena Voice Rule.** Kanit is for what the scoreboard would show: titles, names, scores, money, stamps. Controls, labels and explanations stay in Anuphan.

## Layout

Single column on phones: masthead card, then stacked panels on the dark ground (main padded 16px 14px with 112px at the bottom for the dock), and a floating dark tab dock at the bottom. Panels inset 14-18px depending on width and sit 16px apart; match cards stack 12px apart, and a finished match takes 22px top margin so its winner tag can overhang. The league home opens with a short masthead and a "next up" queue (คิวต่อไป) of mini face-off rows with a go button, ruled apart by hairlines; the season roster folds away in a disclosure under it.

Inside a panel, nested boxes are flattened into rows: rosters, payment lists and stat lists are full-width rows separated by line hairlines, with a line-2 hairline opening the group. Stat values sit as lines (caption left, italic Kanit figure right) rather than a grid of big-number tiles; a stat with no value is dropped, not printed as a dash.

At 900px and up the league home becomes two columns (1.55fr / minmax(320px,1fr)): matches in the wide column, standings sticky at 12px beside them, the workflow card in the second column; the bottom tab dock hides there. Below 600px the champion and streak stamps drop under the name. Spacing runs 4 / 8 / 12 / 18px.

## Elevation & Depth

Lifted. Depth comes from three things together: tone steps (bg, then panel, panel-2, panel-3), hairline white borders, and deep soft black shadows under the large surfaces. Red elements add a coloured glow on top of that. Translucent chrome (masthead pills, the account strip, the tab dock, overlays) uses backdrop blur; panels themselves do not.

### Shadow Vocabulary
- **Panel** (`box-shadow: 0 14px 34px rgba(0,0,0,.38)`): top-level cards and workflow cards.
- **Stage** (`box-shadow: 0 18px 40px rgba(0,0,0,.45)`): the masthead and the season poster bill.
- **Dock** (`box-shadow: 0 12px 30px rgba(0,0,0,.55)`): the tab dock; toasts use `0 12px 30px rgba(0,0,0,.5)`.
- **Sheet** (`box-shadow: 0 24px 60px rgba(0,0,0,.6)`): profile, recovery and auth sheets over the blurred overlay.
- **Red action** (`box-shadow: 0 8px 20px rgba(229,36,47,.28)`): the primary button only.
- **Red glow** (`box-shadow: 0 0 12px var(--red-glow)`): the section marker, the progress fill, the active tab bar, the next-up VS disc; the match VS disc spreads to 18px and the winner tag and brand mark use `0 6px 16px var(--red-glow)`.
- **Medal glow** (`0 0 14px rgba(245,184,11,.45)` on rank 1, `0 0 12px rgba(245,184,11,.4)` on the แชมป์ stamp): gold only. Podium avatars get a panel ring, a 2px medal ring and a 22px medal haze.
- Rows inside panels, inputs, secondary buttons and tags are flat (`box-shadow: none`).

### Named Rules
**The Glow Means Red or Gold Rule.** Coloured light comes only from red (action, live, winner) and gold (rank 1, champion). Everything else lifts with neutral black shadow or not at all.
**The Flat Inside Rule.** Only top-level things lift: panels, masthead, dock, sheets, toasts, the primary button. Rows and controls inside a panel stay flat on tone and hairlines.

## Shapes

Soft, generous corners: 14px on panels, the masthead, match cards, sheets and the poster bill; 10px on inner rows, buttons, inputs, notices, table wraps and the account strip; 18px on the tab dock with 12px tab hit areas. Badges and the admin badge use 6px; the winner tag 8px, the gold แชมป์ stamp 5px and streak stamps 3px. Pills (999px) are kept for masthead status pills, the bye/rest chip, tags and the progress track. Discs (50%) are the VS disc, rank and Dummy position markers, the brand mark and avatars.

Borders are hairlines, never heavy rules: 1px line for panels and row dividers, 1px line-2 for controls and chrome, 1px translucent hot red (rgba(255,71,82,.45-.6)) for red-tinted notices, the active season, the VS disc and the Dummy leader row. Section heads carry a 0.42em red square (2px corners) before the text. Stamps are a short italic Kanit word, rotated a few degrees (winner tag ±4deg, gold แชมป์ stamp -4deg, streak stamps -4/+3deg), the one place geometry tilts.

## Components

### Buttons
Glossy and lit.
- **Shape:** 10px corners, 1px border, Anuphan 700, 44px minimum on touch targets.
- **Primary:** red vertical gradient (#dc2530 to #b0121a), white text, a 1px #ff5c66 edge and the red action shadow. Disabled at 45% opacity.
- **Secondary:** panel-2 fill, text colour, line-2 border; hover lifts to panel-3 with a 26%-white border.
- **Danger:** transparent, lose text, 1px lose border at 60%.
- **On the masthead:** translucent white (4-5%) with a line-2 border; the danger variant there is #ffb0b5.
- **Press:** sinks 2px (90ms); see Motion.

### Inputs / Fields
- **Style:** field fill, 1px line-2 border, 10px corners, text colour, placeholder at 38% white.
- **Focus:** border turns hot red with a 3px red halo at 22%; every focus-visible element gets a 2px hot-red outline offset 2px.
- **Score input:** italic Kanit 800 22px, white, 44px min height, border in its corner colour at 55%.

### Cards / Containers
- **Corner Style:** 14px (panels), 10px (rows inside).
- **Background:** panel with a 3.5%-white sheen fading out over the top 120px; inner rows panel-2.
- **Shadow Strategy:** the Panel shadow on top-level cards; inner rows flat (see Elevation).
- **Border:** 1px line.
- **Headings:** Kanit 600 title led by the red square marker.
- **Notices:** panel-2 with a line border; inside a panel a notice turns red-tinted (12% red fill, 45% hot-red border).

### Navigation
- **Tab dock:** a floating dark bar (dock colour, 1px line, 18px corners, dock shadow, 12px backdrop blur), labels at 62% white, drawn SVG icons (24px grid, 1.8 stroke, round caps). The active tab has no fill: its label and icon turn hot red, the icon glows, and a 3px glowing hot-red bar sits on its top edge across the middle 40%. Every tab bar ends with the Dummy tab.

### Chips and Tags
- **Tag:** panel-3 fill, 1px line-2 border, text colour, pill; a closed tag turns solid red with white text.
- **Form dots:** borderless, italic Kanit letter; W win green and L lose coral with dark text, D panel-3.
- **Delta:** panel-2 with a 1px border in win or lose colour at 60%.
- **Rest chip:** red-tinted pill (14% red, #ffc2c6 text).

### Masthead (signature)
A dark stage card: a #17191f to #0d0e12 gradient lit from the top-right by a red radial bloom, with a diagonal red light streak (118deg) and a white ping-pong ball in flight near the top-right corner; behind the content an outlined "PING PONG" word runs vertically at 8% white. 1px line-2 border, 14px corners, the stage shadow. The brand mark is a 40px red glossy disc (34px on compact pages) printing the mark in white italic Kanit, with a faint white ring and a red glow; the brand name sits beside it in Kanit 600. The league name or page title is white italic Kanit 800 with a soft red glow; sub-lines in text-2. Status pills are translucent white with a 6px blur (online green-tinted, offline red-tinted); the account strip is a 72%-black blurred bar with 10px corners and a solid red admin badge. No photo.

### Match Face-off Card (signature)
Each match is a face-off: a panel-2 card with 14px corners and a 100deg gradient bleeding red in from the left and blue in from the right. A three-column grid puts the red-corner name (right-aligned, white Kanit 600) and blue-corner name (left-aligned) over their score steppers (36px − / input / 36px +, the + stepper solid red), with a 46px dark VS disc in the centre column: hot-red italic Kanit "VS", a 60% hot-red hairline and a red glow. A darkened status strip (18% black, line hairline) closes the card. When finished, the result line goes to 18px italic Kanit in the winner's corner tint (#ff8a92 or #9dbaff), the loser's name drops to 42% opacity, and a ชนะ tag (italic Kanit 800 17px, white on a red or blue gradient, 8px corners, coloured glow) overhangs the winner's top corner at ∓4deg. Draws get the result line with no tag. A finished card shows a 44px share button in its bottom-right corner (panel-3, turns red on hover).

### Stat Lines and Standings
Stat groups open with a line-2 hairline and run as rows: caption in Anuphan 14px text-2 on the left, value in italic Kanit on the right, line hairline beneath. Standings rows carry a 1px line-2 rank disc in italic Kanit (ranks 1-3 filled gold, silver, bronze with dark numerals, rank 1 glowing) and RP in hot-red italic Kanit. On the league home the leader's row is tinted gold at 9%. Tables sit in a panel wrap with stage header rows, a 2%-white even-row tint and line hairlines. Champions get a gold แชมป์ stamp after the name (block-level under 600px).

### Banter Stamps and the Season Poster
Facts from the scores, stamped like the ชนะ / แชมป์ stamps (italic Kanit 800 11px, 1.5px currentColor border, 3px corners, panel fill, -4deg) after a name in standings, the dashboard and the stats head: ไฟลุก (3+ wins in a row) in win green, ฟอร์มตก (3+ losses) in lose coral at +3deg, คืนชีพ (first win after 3+ losses) light text on solid red. A match card between players who have met gets a hairline rivalry strip above the status strip ("เจอกัน 4 ครั้ง กิฟท์ ชนะ 3"), and while this Season's meeting is unplayed the last loser gets a larger red ศึกล้างตา stamp. The archive's Season poster is a panel bill with 14px corners and the stage shadow: a dark band lit red from the top-right with the league name in italic Kanit, the champion in display-size italic Kanit with a gold haze under a gold แชมป์ stamp, runner-up and 3rd on panel with a 5px silver/bronze top rule, then fact rows (biggest win, longest win streak), and a stage foot in hot red. A fact the saved scores cannot back is dropped. Print shows only the poster.

### Toast
Panel-3 fill, text colour, 1px line-2 border, 10px corners, the dock shadow; a 3px time-left bar runs along the bottom in red (green for good, coral for bad).

### Motion
Operate surface: motion is feedback, continuity and one authored moment (motion.css, unchanged by the arena world). Arrivals use `cubic-bezier(.16,1,.3,1)`, exits `cubic-bezier(.4,0,1,1)`; no bounce or overshoot. Durations: press 90ms, fast 140ms, base 200ms, slow 300ms.
- **The strike (focal moment):** when a match's result changes while the page is open, the ชนะ tag is struck onto the card (drops from 1.9× scale to rest in 420ms at the card's ∓4deg tilt, the card jolts 2px, the result line inks in from 0.06em tracking). index.js adds `.stamp-in` only on a change, never for results already there at load.
- **Page to page:** cross-document View Transitions. The masthead morphs into the next masthead (300ms); the content swaps (out 120ms, in 220ms with an 8px rise); the tab dock stays put and crossfades its active tab (160ms).
- **Press:** buttons and tiles sink 2px (90ms); tabs sink 1px; score steppers also shrink to 94%; score digits tick down into place (260ms). Quick tiles and season buttons rise 1px on hover where hover exists. The loser's name fades over 200ms.
- **Overlays:** sheets rise 18px from the bottom edge (300ms); toasts drop in 8px (220ms) and leave in 180ms; the "next up" go button outlines its target match in hot red, fading out over 1.8s.
- **Not used:** entrance animations on cards or lists at page load; content is visible by default.
- **Sound and haptics:** the strike alone has a voice. At 55% of it (231ms, the tag landing) stamp-sound.js plays a ~120ms Web Audio thunk (a sine dropping 150→52Hz plus a 30ms low-passed noise slap, modest volume, no audio files) and `navigator.vibrate(18)` where it exists (Android; iOS gets nothing faked). Audio unlocks on the first gesture; nothing plays on load or for results synced while the page is hidden, and a batch synced together gets one hit. The เครื่องมือ menu's "เสียงตีตรา" toggle covers both and is remembered per device; it defaults off under reduced motion.
- **Reduced motion:** no travel and no strike; page swaps and state changes become 120-160ms fades; the skeleton sweep and toast timer bar stop.

### Fonts
Kanit and Anuphan are self-hosted (`fonts.css`, `fonts/`, SIL OFL 1.1). Kanit ships two static cuts, 600 upright and 800 italic, each as Thai and Latin subsets. Anuphan is one variable file per subset (Thai, Latin, Latin-ext; 400-700). Kanit 800 italic Thai, Anuphan Thai and Anuphan Latin are preloaded on every page; all faces use `font-display: swap`. `font-synthesis:none` is set on the body so Kanit is never faux-bolded or faux-slanted.

## Do's and Don'ts

### Do:
- **Do** put every page on the arena-black ground with the red bloom, and every content block on a smoked-glass panel with a 1px line border, 14px corners and the panel shadow.
- **Do** bill every pairing red corner left, blue corner right, with the glowing VS disc between.
- **Do** set the loud words (masthead titles, scores, figures, money, stamps) in Kanit 800 italic and names and section titles in Kanit 600 upright; keep controls and labels in Anuphan.
- **Do** mark a winner with the tilted ชนะ tag in their corner colour, and fade the loser, rather than adding an icon.
- **Do** flatten lists inside a panel into rows divided by line hairlines.
- **Do** use drawn SVG icons (24px grid, 1.8 stroke, round caps) where an icon is needed.
- **Do** keep red as the single accent, with hot red for focus, caret, selection, the active tab and red text on dark.
- **Do** keep numbers in tabular lining figures.

### Don't:
- **Don't** bring back the yellow fight-poster world: poster-yellow ground, paper panels, 2px ink rules, the magenta masthead or Chonburi.
- **Don't** add a second accent hue; blue belongs to the right corner, gold/silver/bronze to rank, green and coral to won/lost.
- **Don't** use red or blue corner colours to mean good or bad; won/lost is green and coral.
- **Don't** request Kanit weights or styles other than 600 upright and 800 italic.
- **Don't** put shadows or glow on rows, inputs or tags inside a panel; only top-level surfaces lift, and only red and gold glow.
- **Don't** use emoji or text glyphs as icons.
- **Don't** nest boxed cards inside panels, or lay stats out as a wall of big-number tiles.
- **Don't** print an empty stat as a headline-size dash; drop it.
