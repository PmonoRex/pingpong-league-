// pwa.js in-app notifications: each event key is told once, even when more than 400 events are current at the same
// time (a busy season: every reaction on every one of my matches is an event).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(events) {
  const values = new Map([['pp_notify', 'true']]);
  const localStorage = { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const toasts = [], ticks = [];
  const ctx = {
    localStorage, console, JSON, Date, Math, Set, Map, Array, Object, String, Number, Boolean, RegExp, Promise, Uint8Array,
    document: { hidden: false, readyState: 'loading', querySelector: () => null, addEventListener() {}, body: null },
    navigator: { serviceWorker: {}, userAgent: 'node' },
    Notification: { permission: 'granted' },
    matchMedia: () => ({ matches: false }),
    addEventListener() {}, setTimeout() {}, setInterval: fn => ticks.push(fn),
    LeagueShared: { readLocalLeague: () => ({ profiles: { me: { id: 'me', displayName: 'Me' } }, rounds: [], results: {} }), sessionUserId: () => 'me', PRED_KEY: 'pp_pred', readLocalClub: () => null },
    LeagueToast: m => toasts.push(m),
    LeagueSocial: { events: () => events.map(key => ({ key, title: key, body: '', tag: key })) }
  };
  ctx.window = ctx;
  vm.runInNewContext(fs.readFileSync('pwa.js', 'utf8'), ctx);
  return { check: ticks[0], toasts, localStorage, events };
}

test('more current events than the list holds: none of them is told again on the next checks', () => {
  const keys = Array.from({ length: 1100 }, (_, i) => `rx:s1:r${i}m0:p:🔥`);
  const { check, toasts, events } = load(keys);
  check(); // first run: baseline, nothing told
  assert.equal(toasts.length, 0);
  events.push('rx:new:1', 'rx:new:2'); check();
  assert.equal(toasts.length, 2);
  check(); check(); check();
  assert.equal(toasts.length, 2, 'the same events must not come back every 5 seconds');
});
