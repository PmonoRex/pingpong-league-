---
name: ตีให้สุด หยุดที่เบ้าตา
description: A friends' ping pong league billed like a Thai boxing fight poster pasted up at the hall.
colors:
  poster: "#ffd21f"
  poster-deep: "#f2bd00"
  paper: "#fffdf6"
  paper-2: "#f6f1e3"
  ink: "#17110f"
  ink-2: "#3b322c"
  ink-soft: "rgba(23,17,15,.66)"
  magenta: "#e0147a"
  magenta-deep: "#b40d61"
  corner-red: "#d4252e"
  corner-red-hover: "#b81e26"
  corner-blue: "#1c4fc0"
  red-field: "#fde4e3"
  blue-field: "#e2e9fb"
  win: "#0b7a40"
  lose: "#c21f2a"
  medal-gold: "#e7a900"
  medal-silver: "#9aa3ad"
  medal-bronze: "#b8763c"
typography:
  display:
    fontFamily: "Chonburi, Anuphan, serif"
    fontSize: "clamp(46px, 14vw, 92px)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "0"
  headline:
    fontFamily: "Chonburi, Anuphan, serif"
    fontSize: "clamp(26px, 7.4vw, 38px)"
    fontWeight: 400
    lineHeight: 1.12
    letterSpacing: "0"
  title:
    fontFamily: "Chonburi, Anuphan, serif"
    fontSize: "clamp(21px, 5.6vw, 27px)"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0"
  fighter:
    fontFamily: "Chonburi, Anuphan, serif"
    fontSize: "clamp(20px, 5.6vw, 26px)"
    fontWeight: 400
    lineHeight: 1.15
  score:
    fontFamily: "Chonburi, Anuphan, serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1
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
rounded:
  stamp: "4px"
  r: "6px"
  pill: "999px"
  disc: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
components:
  button-primary:
    backgroundColor: "{colors.corner-red}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.r}"
  button-primary-hover:
    backgroundColor: "{colors.corner-red-hover}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.r}"
  button-secondary-hover:
    backgroundColor: "{colors.poster}"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.lose}"
    rounded: "{rounded.r}"
  input:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.r}"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r}"
  masthead:
    backgroundColor: "{colors.magenta}"
    textColor: "{colors.poster}"
    typography: "{typography.display}"
    rounded: "{rounded.r}"
    padding: "20px 18px 18px"
  masthead-compact:
    backgroundColor: "{colors.magenta}"
    textColor: "{colors.poster}"
    typography: "{typography.headline}"
    padding: "14px 16px 12px"
  vs-stamp:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.poster}"
    rounded: "{rounded.disc}"
    size: "46px"
  tab-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.r}"
  tab-bar-active:
    backgroundColor: "{colors.poster}"
    textColor: "{colors.ink}"
    rounded: "{rounded.stamp}"
  table-header:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.poster}"
  tag:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
---

# Design System: ตีให้สุด หยุดที่เบ้าตา

## Overview

**Creative North Star: "The Fight Bill at the Hall"**

The league reads as a Thai boxing poster (โปสเตอร์มวย) pasted up next to the table. The ground is poster yellow; content sits on newsprint-white paper panels held by 2px ink rules; the masthead is a บานเย็น magenta band with the league name in looped yellow Chonburi. Every pairing is billed red corner versus blue corner with a VS stamp between, and a finished match gets a rotated ชนะ stamp on the winner while the loser fades back. It is loud the way a poster is loud: flat inks, heavy display type, no glow.

Density is phone-first and operational. Panels are tight (6px corners, 12-18px insets), numbers and names carry the page in display type, and everything else stays standard Anuphan UI text on standard controls. Desktop widens the league home into two columns (bill on the left, sticky standings on the right) without changing the vocabulary. This world replaces the dark glass sports-app card grid with a neon accent that the site had before.

**Key Characteristics:**
- Poster-yellow page ground, paper panels, 2px ink rules, 6px corners.
- Two-faced type: Chonburi for titles, names, scores, money and stamps; Anuphan for everything else.
- Red corner / blue corner as the colour pair for every match-up; green and red only for won/lost money and W/L.
- Magenta is the masthead and the interaction colour (focus, caret, selection, progress).
- Stamps, not glyphs: winners and champions get a bordered, slightly rotated Chonburi word.
- Flat surfaces; depth only for the floating tab bar and toast.

## Colors

Flat poster inks on a yellow ground: one hot magenta band, a red/blue corner pair, ink black, and newsprint paper.

### Primary
- **Poster Yellow** (poster): the page ground on every screen, the masthead title colour, the active tab, the leader row (rank 1, Dummy lead row, draw dots), secondary-button hover, highlight notices. **Poster Deep** is its pressed/shade partner.
- **บานเย็น Magenta** (magenta): the masthead band, focus outlines, input focus border, caret, text selection, checkbox/radio accent, progress fill, win-rate ring. **Magenta Deep** carries magenta as text on paper (links in the assistant strip, handicaps, champion stamps, champion counts).

### Secondary
- **Red Corner** (corner-red): the left fighter's name, score-input border, red-corner win stamp and result line; the primary button fill; points and RP numbers; payment amounts. Hover deepens to corner-red-hover.
- **Blue Corner** (corner-blue): the right fighter's name, score-input border, blue-corner win stamp and result line. Blue never appears outside a pairing.
- **Red Field / Blue Field** (red-field, blue-field): the two halves of a match bill, split hard at 50%.

### Tertiary
- **Win Green / Lose Red** (win, lose): money won and lost, W/L form dots, rank deltas, the danger button, the negative-sign toggle, sync-online text. Never decoration.
- **Medal Gold / Silver / Bronze**: podium rings and steps only (steps mix 55% medal into paper).

### Neutral
- **Ink** (ink): all text, every 2px rule, table headers, the tab bar, the VS stamp, toasts, the "+" score stepper, the account strip.
- **Ink 2** (ink-2): form labels and stat-line captions.
- **Ink Soft** (ink-soft): muted text, hints, status lines, secondary small text.
- **Paper** (paper): panels, sheets, tables, match status strip, secondary buttons. Inputs sit on pure white (#ffffff) so the entry field reads brighter than the panel.
- **Paper 2** (paper-2): recessed fills (workflow items, notices, tags, rank discs, progress track, skeletons).
- Thin rule: 1px ink at 22% alpha divides rows inside a panel; overlays are ink at 55%.

### Named Rules
**The Two Corners Rule.** Any head-to-head pairing is red on the left, blue on the right, every time. Red/blue never encode good/bad.
**The Money Is Green and Red Rule.** Win green and lose red are reserved for won/lost amounts, W/L results and rank movement.
**The Magenta Means Here Rule.** Outside the masthead, magenta marks where the user is acting: focus, caret, selection, progress.

## Typography

**Display Font:** Chonburi (with Anuphan, serif)
**Body Font:** Anuphan (with system-ui, -apple-system, Segoe UI, Tahoma, sans-serif)

**Character:** Chonburi is a looped Thai poster display face, used only at weight 400 and never letter-spaced; it is the voice of the bill. Anuphan is a clean Thai UI sans that keeps controls, labels and tables ordinary and legible.

### Hierarchy
- **Display** (Chonburi 400, clamp(46px,14vw,92px), 1.05): the league name in the league-home masthead only, in poster yellow on magenta.
- **Headline** (Chonburi 400, clamp(26px,7.4vw,38px), 1.12): page titles in the compact masthead on every other page.
- **Title** (Chonburi 400, clamp(21px,5.6vw,27px), 1.2): panel headings, section heads, auth sheet title.
- **Fighter** (Chonburi 400, clamp(20px,5.6vw,26px), 1.15): player names in the match bill, wrapping rather than truncating.
- **Numbers** (Chonburi 400): score inputs (22px), stat-line values (clamp(22px,6vw,28px)), RP/points, rank discs, money totals, result line (19px), win stamp (24px), VS (16px).
- **Body** (Anuphan 400, 14px, 1.55; base size inherited from theme.css): running UI text, lists, tables.
- **Label** (Anuphan 700, 14px): buttons, stat-line captions (14px, ink-2), names in table rows. Table headers are Anuphan 600 with 0.04em tracking, poster yellow on ink.

### Named Rules
**The Bill Voice Rule.** Chonburi is for what the poster would print: titles, names, scores, money, stamps. Controls, labels and explanations stay in Anuphan.
**The No Tracking Rule.** Display type is set at letter-spacing 0 and never in faux bold; Chonburi ships one weight.

## Layout

Single column on phones: masthead band, then stacked paper panels on the yellow ground, with a fixed ink tab bar at the bottom (hidden while an input has focus on touch screens). Panels inset 12-18px; match bills stack with 12px gaps, and a stamped (finished) bill takes 26px top margin so the stamp can overhang.

Inside a panel, nested boxes are flattened into ruled rows: rosters, payment lists and stat lists are full-width rows separated by thin rules, with a 2px ink rule opening the group. Stat values sit as lines (caption left, Chonburi value right) rather than a grid of big-number tiles; a stat with no value is dropped, not printed as a dash.

At 900px and up the league home becomes two columns (1.55fr / minmax(320px,1fr)): matches in the wide column, standings sticky at 12px beside them, the assistant strip spanning both; the bottom tab bar hides there. Spacing runs 4 / 8 / 12 / 18px.

## Elevation & Depth

Flat. Surfaces are separated by ink rules and fill changes (paper on yellow, paper-2 inside paper), never by shadow. The only shadows belong to things that float over the page.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 6px 18px rgba(23,17,15,.28)`): the fixed tab bar and the toast only.
- **Stamp ring** (`box-shadow: 0 0 0 2px var(--ink)` around a 3px paper border): the VS disc's double ring. Podium avatars use the same ring idea in their medal colour. These are outlines, not depth.

### Named Rules
**The Pasted-Up Rule.** Panels, cards, buttons and sheets have no shadow and no blur; overlays are flat ink at 55% with no backdrop filter.

## Shapes

Small, firm corners (6px) on every panel, button, input, table wrap, sheet and the tab bar. Stamps and badges use a tighter 3-4px. Pills (999px) are kept for status pills, the bye/rest chip, tags, and the progress track. Discs (50%) are the VS stamp, rank and Dummy position markers, the brand mark and avatars.

Borders are the structure: 2px solid ink for panels, controls and primary emphasis; 1.5px ink for small chips, steppers and discs; 1px ink at 22% for row dividers. Stamps are a word in a currentColor border, rotated a few degrees (win stamp ±7deg, champion stamp -4deg), the one place geometry tilts.

## Components

### Buttons
Blunt and printed.
- **Shape:** 6px corners, 2px ink border, Anuphan 700, no shadow or filter.
- **Primary:** red-corner fill, white text; hover deepens to corner-red-hover. Disabled at 45% opacity.
- **Secondary:** paper fill, ink text; hover turns poster yellow.
- **Danger:** paper fill, lose-red text and 2px lose-red border.
- **On the masthead account strip:** transparent with a 1.5px 55%-white border; the danger variant there is pink (#ffb3b8 on #ff8a92).

### Inputs / Fields
- **Style:** white fill, 2px ink border, 6px corners, ink text, placeholder at 45% ink.
- **Focus:** border turns magenta with a 3px magenta halo at 18%; every focus-visible element gets a 3px magenta outline offset 2px.
- **Score input:** Chonburi 22px, 44px min height, border in its corner colour.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** paper; recessed items paper-2.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 2px ink for top-level panels and sheets; 1px thin rule for items inside them.
- **Notices:** paper-2 with thin rule; inside a panel a notice turns poster yellow with a 2px ink rule.

### Navigation
- **Tab bar:** an ink strip with 6px corners, 72%-white labels, drawn SVG icons (24px grid, 1.8 stroke, round caps). The active tab is a poster-yellow block with ink text and 4px corners. Every tab bar ends with the Dummy tab.

### Chips and Tags
- **Tag:** paper-2 fill, 1.5px ink border, ink text, pill; a closed tag inverts to ink with yellow text.
- **Form dots:** 1.5px ink ring, Chonburi letter; W green, L red, D poster yellow.
- **Delta:** paper with 1.5px border in win or lose colour.

### Masthead (signature)
A magenta band with a 2px ink rule and 6px corners. The brand mark is a 40px ink disc with a 2px yellow ring printing ศึก in Chonburi (34px on compact pages). The league name sits in poster-yellow Chonburi; sub-lines in 90% white. Status pills are paper with ink rules; the account strip is an ink bar with an admin badge in poster yellow. No photo.

### Match Fight Bill (signature)
Each match is a bill: the panel fill splits hard into red field and blue field at 50%, bordered by a 2px ink rule. A three-column grid puts the red-corner name (right-aligned) and blue-corner name (left-aligned) over their score steppers (36px − / input / 36px +, the + stepper inverted ink-on-yellow), with a 46px ink VS disc in the centre column. A paper status strip closes the bill. When finished, the result line goes to 19px Chonburi in the winner's corner colour, the loser's name drops to 42% opacity, and a ชนะ stamp (Chonburi 24px, 3px currentColor border, paper fill) overhangs the winner's top corner at ±7deg. Draws get the Chonburi result line with no stamp.

### Stat Lines and Standings
Stat groups open with a 2px ink rule and run as rows: caption in Anuphan 14px ink-2 on the left, value in Chonburi on the right, thin rule beneath. Standings rows carry a 1.5px ink rank disc (rank 1 in poster yellow) and RP in red-corner Chonburi. Tables sit in a paper wrap with ink header rows in yellow type, faint even-row tint and thin row rules. Champions get a magenta-deep แชมป์ stamp after the name (block-level under 600px).

### Banter Stamps and the Season Poster
Facts from the scores, stamped like the ชนะ / แชมป์ stamps (Chonburi 11px, 1.5px currentColor border, paper fill, ±3-4deg) after a name in standings, the dashboard and the stats head: ไฟลุก (3+ wins in a row) in win green, ฟอร์มตก (3+ losses) in lose red, คืนชีพ (first win after 3+ losses) ink on poster yellow. A match bill between players who have met gets a thin-ruled rivalry strip above the status strip ("เจอกัน 4 ครั้ง กิฟท์ ชนะ 3"), and while this Season's meeting is unplayed the last loser gets an ink-on-yellow ศึกล้างตา stamp. The archive's Season poster is a 3px ink-ruled bill: magenta band with the league name, the champion in display Chonburi on poster yellow under a magenta-deep แชมป์ stamp, runner-up and 3rd on paper with a 5px silver/bronze top rule, then fact rows (biggest win, longest win streak); a fact the saved scores cannot back is dropped. Print shows only the poster.

### Toast
Ink fill, poster-yellow text, 6px corners, the floating shadow.

## Do's and Don'ts

### Do:
- **Do** put every page on the poster-yellow ground and every content block on paper with a 2px ink rule and 6px corners.
- **Do** bill every pairing red corner left, blue corner right, with the ink VS disc between.
- **Do** set names, scores, money, titles and stamps in Chonburi 400 at letter-spacing 0; keep controls and labels in Anuphan.
- **Do** mark a winner with a rotated Chonburi word stamp in their colour, and fade the loser, rather than adding an icon.
- **Do** flatten lists inside a panel into rows divided by thin ink rules.
- **Do** use drawn SVG icons (24px grid, 1.8 stroke, round caps) where an icon is needed.
- **Do** keep magenta for the masthead and for focus, caret, selection and progress.

### Don't:
- **Don't** bring back the dark glass card grid with a neon accent, backdrop blur or glow.
- **Don't** put shadows on panels, buttons or sheets; only the floating tab bar and toast lift.
- **Don't** use red or blue corner colours to mean good or bad; won/lost is green and red.
- **Don't** use emoji or text glyphs as icons.
- **Don't** nest boxed cards inside paper panels, or lay stats out as a wall of big-number tiles.
- **Don't** print an empty stat as a headline-size dash; drop it.
