// Checks across files: how the pages load the scripts and how the scripts find each other.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
const scripts = fs.readdirSync(root).filter(f => f.endsWith('.js') && f !== 'sw.js');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const srcs = html => [...html.matchAll(/<script[^>]*\ssrc="([^"?]+)(?:\?v=([^"]*))?"/g)].map(m => ({ file: m[1], v: m[2] || '' }));

test('no page loads a script twice', () => {
  for (const page of pages) {
    const files = srcs(read(page)).map(s => s.file);
    assert.deepEqual(files.filter((f, i) => files.indexOf(f) !== i), [], page);
  }
});

test('scripts load after the ones they use', () => {
  const before = [['shared.js', ['index.js', 'predictions.js', 'admin.js', 'dummy.js', 'live.js', 'social.js', 'challenge.js', 'tournament.js', 'hall.js', 'awards.js', 'pwa.js', 'sync-guard.js']],
    ['league-stats.js', ['elo.js']], ['elo.js', ['hall.js', 'tournament.js']], ['index.js', ['sync-guard.js']], ['push-config.js', ['pwa.js']]];
  for (const page of pages) {
    const files = srcs(read(page)).map(s => s.file);
    for (const [first, later] of before) later.forEach(f => { if (files.includes(f)) assert.ok(files.includes(first) && files.indexOf(first) < files.indexOf(f), `${page}: ${first} before ${f}`); });
  }
});

test('every page asks for the same version of a shared script, and dynamic loads match it', () => {
  const seen = {};
  for (const page of pages) srcs(read(page)).forEach(({ file, v }) => { (seen[file] ||= new Set()).add(v); });
  Object.entries(seen).forEach(([file, set]) => assert.equal(set.size, 1, `${file}: ${[...set].join(', ')}`));
  const dynamic = /s\.src = "live\.js\?v=([^"]+)"/.exec(read('challenge.js'));
  assert.ok(dynamic && seen['live.js'].has(dynamic[1]), 'challenge.js loads live.js at the version the pages use');
});

// `const X = ...` at the top of a classic script is a global binding but not a property of window: window.X is undefined.
test('window.X is only used for globals that are put on window', () => {
  const consts = new Set(scripts.flatMap(f => [...read(f).matchAll(/^const ([A-Z][A-Za-z]+)\s*=/gm)].map(m => m[1])));
  const onWindow = new Set(scripts.flatMap(f => [...read(f).matchAll(/window\.([A-Z][A-Za-z]+)\s*=(?!=)/g)].map(m => m[1])));
  const bad = [];
  for (const f of scripts) for (const line of read(f).split('\n')) for (const m of line.matchAll(/(?:window|globalThis)\.([A-Z][A-Za-z]+)\b(?!\s*=[^=])/g)) {
    // `typeof X !== "undefined" ? X : window.X` reads the binding first; the window fallback is harmless.
    if (consts.has(m[1]) && !onWindow.has(m[1]) && !line.includes(`typeof ${m[1]}`)) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
  assert.doesNotMatch(read('tournament.js'), /ratingSource\(league, club, window\)/);
});
