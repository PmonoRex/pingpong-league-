# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single group of Thai friends who play ping pong together (and Dummy cards on the side). They open the site on their phones while they are playing: entering a match score next to the table, checking the standings between games, placing a prediction, or settling up after a card game. Roles inside the group: one or more admins (currently มอส) who manage accounts and close seasons, and a dealer (เจ้ามือ) who runs the prediction markets.

## Product Purpose

Run the group's private ping pong league end to end: round-robin schedule per season, score entry, standings, ranking points (RP) carried across seasons, player stats and head-to-head, a season archive, and a prediction game with a dealer. A separate Dummy page tallies card-game results and works out who owes whom. Success: anyone in the group can pull it up mid-session, do the thing in a few taps, and the result is something the group talks (and trash-talks) about.

## Positioning

It is the group's own league, not a generic tournament app: their names, their seasons, their running rivalries and RP history, their inside-joke league name.

## Operating Context

- Used on phones, standing at the table or around a card game, often one-handed, sometimes in bad light.
- Scores are typed on the iPhone number pad (no minus key), so negative entry needs its own control.
- Several people can have the site open at once; admin writes are guarded against overwriting each other.
- Settling money is done between pairs of players; the Dummy page shows the pair-by-pair list and copies it to LINE.

## Capabilities and Constraints

- Static site, no build step (HTML/CSS/vanilla JS), hosted on GitHub Pages from `main`.
- League data lives in one Supabase row (`public.app_state`, id `main`) with a localStorage copy; Dummy data has its own `dummy` column in the same row (own revision lock, localStorage as the offline copy).
- Login is a player account + PIN; roles: admin, dealer, player.
- Predictions only record amounts; the site never takes or pays real money.
- Dummy money modes: (1) points ÷ divisor, rounded to whole baht, pairs settle the difference; (2) knocker takes all, losers pay by rank with ×2 modifiers (มืด/ดัมมี่/สี, โง่).
- All UI copy is Thai; player names are Thai nicknames.

## Brand Commitments

- League name: **ตีให้สุด หยุดที่เบ้าตา** must stay.
- Tone: fun, teasing, friends ribbing each other; celebrate the winner, rib the loser.
- Nothing else is binding (the current red/black look, hero photo and layout may all change).

## Evidence on Hand

- Real league data in Supabase (players, seasons, results, RP history, predictions).
- `hero-player.jpg`, `hero-art.svg` exist but are not required.
- No logo file, no photos of the actual group, no testimonials; do not invent any.

## Product Principles

1. Fast at the table: the common action on each page is reachable in one or two taps on a phone.
2. The group is the content: names, rivalries, streaks and standings carry the page, not decoration.
3. Banter is a feature: winners get a moment, losers get ribbed, without hiding the facts.
4. Never lose a score: saving, syncing and conflicts are always visible and recoverable.

## Accessibility & Inclusion

Phone-first; readable at arm's length and in dim rooms; large touch targets for one-handed use.
