const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../stamp-sound.js');

const base = { enabled: true, hidden: false, unlocked: true, canVibrate: true, now: 1000, lastAt: NaN };

test('sound defaults on, off under reduced motion, and a stored choice wins', () => {
  assert.equal(S.initialEnabled(null, false), true);
  assert.equal(S.initialEnabled(null, true), false);
  assert.equal(S.initialEnabled('1', true), true);
  assert.equal(S.initialEnabled('0', false), false);
  assert.equal(S.initialEnabled('junk', false), true);
});

test('a strike on a visible, unlocked page plays the thunk and the buzz', () => {
  assert.deepEqual(S.decide(base), { sound: true, haptic: true });
});

test('nothing plays when muted or when the result synced while the page was hidden', () => {
  assert.deepEqual(S.decide({ ...base, enabled: false }), { sound: false, haptic: false });
  assert.deepEqual(S.decide({ ...base, hidden: true }), { sound: false, haptic: false });
});

test('no sound before the first gesture unlocks audio; haptics only where vibrate exists (not faked on iOS)', () => {
  assert.deepEqual(S.decide({ ...base, unlocked: false }), { sound: false, haptic: true });
  assert.deepEqual(S.decide({ ...base, canVibrate: false }), { sound: true, haptic: false });
});

test('a batch of results in one sync gets one hit', () => {
  assert.deepEqual(S.decide({ ...base, lastAt: base.now - 40 }), { sound: false, haptic: false });
  assert.deepEqual(S.decide({ ...base, lastAt: base.now - S.BATCH_MS }), { sound: true, haptic: true });
});

test('the thunk is short, modest and lands with the stamp', () => {
  assert.ok(S.THUNK.duration < 0.15);
  assert.ok(S.THUNK.body.decay <= S.THUNK.duration && S.THUNK.slap.decay <= S.THUNK.duration);
  assert.ok(S.THUNK.master * (S.THUNK.body.gain + S.THUNK.slap.gain) <= 0.5);
  assert.equal(S.HIT_DELAY_MS, Math.round(420 * 0.55));
  assert.equal(S.VIBRATE_MS, 18);
});
