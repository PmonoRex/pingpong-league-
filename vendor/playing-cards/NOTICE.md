# Playing card images

**Vectorized Playing Cards 1.3**, Copyright 2011 Chris Aguilar
(http://code.google.com/p/vectorized-playing-cards/), licensed under the
GNU Lesser General Public License v3 or later. See `COPYING.LESSER.txt`,
`COPYING.txt`, `readme.txt` and `AUTHORS.txt` in this folder.

Taken from the `cards/` folder of the npm package **cardsJS 1.1.1**
(https://github.com/richardschneider/cardsJS), which resized the originals
to fit their own size.

Changes made here, for the poker page (`poker-cards.js`):
- Inkscape/Sodipodi editor metadata, comments and the XML prolog were
  removed with svgo, and numbers were rounded to 3 decimals. Rendered
  output is pixel-identical to the cardsJS files.
- A `viewBox` matching each file's width and height was added, so the
  cards scale with the element that shows them.
- Only the 52 faces (`AS.svg`, `10H.svg`, …) and the two backs are kept;
  the duplicate `T*.svg` ten files were left out.

You may replace these files with any other build of the library, as the
LGPL allows.
