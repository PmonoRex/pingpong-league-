const test = require('node:test');
const assert = require('node:assert');
const S = require('../social.js');

test('dateKey uses the Bangkok calendar day (UTC+7)', () => {
  assert.strictEqual(S.dateKey(new Date('2026-10-18T16:59:59Z')), '2026-10-18');
  assert.strictEqual(S.dateKey(new Date('2026-10-18T17:00:00Z')), '2026-10-19'); // midnight in Bangkok
  assert.strictEqual(S.dateKey(new Date('2026-12-31T17:30:00Z')), '2027-01-01');
});

test('weekKey is the ISO week of the Bangkok date', () => {
  assert.strictEqual(S.weekKey(new Date('2026-10-12T00:00:00+07:00')), '2026-W42'); // Monday
  assert.strictEqual(S.weekKey(new Date('2026-10-18T23:59:00+07:00')), '2026-W42'); // Sunday night
  assert.strictEqual(S.weekKey(new Date('2026-10-18T17:00:00Z')), '2026-W43'); // Monday 00:00 Bangkok, still Sunday in UTC
  assert.strictEqual(S.weekKey(new Date('2021-01-03T12:00:00+07:00')), '2020-W53'); // belongs to the previous ISO year
  assert.strictEqual(S.weekKey(new Date('2024-12-30T12:00:00+07:00')), '2025-W01'); // belongs to the next ISO year
  assert.strictEqual(S.prevWeekKey(new Date('2026-10-14T12:00:00+07:00')), '2026-W41');
});

test('tally counts votes, ignores self-votes, and winners keep ties', () => {
  const votes = { a: 'b', b: 'c', c: 'b', d: 'c', e: 'e' };
  assert.deepStrictEqual(S.tally(votes), [{ id: 'b', n: 2 }, { id: 'c', n: 2 }]);
  assert.deepStrictEqual(S.winners(votes).sort(), ['b', 'c']);
  assert.deepStrictEqual(S.winners({ a: 'b', c: 'b', b: 'a' }), ['b']);
  assert.deepStrictEqual(S.winners({}), []);
  assert.deepStrictEqual(S.tally({ a: 'gone', b: 'c' }, new Set(['c'])), [{ id: 'c', n: 1 }]);
});

test('mvpWins counts finished weeks only, ties for everyone tied', () => {
  const mvp = { '2026-W40': { a: 'b', c: 'b' }, '2026-W41': { a: 'b', b: 'a' }, '2026-W42': { a: 'b', c: 'b', d: 'b' }, junk: { a: 'b' } };
  assert.strictEqual(S.mvpWins(mvp, 'b', '2026-W42'), 2); // W40 outright + W41 tie; W42 is still running
  assert.strictEqual(S.mvpWins(mvp, 'a', '2026-W42'), 1);
  assert.strictEqual(S.mvpWins(mvp, 'b', '2026-W43'), 3);
  assert.strictEqual(S.mvpWins(null, 'b'), 0);
});

test('setVote changes or removes a vote and never stores a self-vote', () => {
  const mvp = {};
  S.setVote(mvp, 'W', 'a', 'b'); assert.deepStrictEqual(mvp, { W: { a: 'b' } });
  S.setVote(mvp, 'W', 'a', 'c'); assert.deepStrictEqual(mvp, { W: { a: 'c' } });
  S.setVote(mvp, 'W', 'a', 'a'); assert.deepStrictEqual(mvp, {});
});

test('reaction toggle: one per user, same emoji again removes it, only the five count', () => {
  const r = {};
  assert.strictEqual(S.nextReaction(null, '🔥'), '🔥');
  assert.strictEqual(S.nextReaction('🔥', '🔥'), null);
  assert.strictEqual(S.nextReaction('🔥', '😂'), '😂');
  S.setReaction(r, 's1:r0m0', 'a', '🔥'); S.setReaction(r, 's1:r0m0', 'b', '🔥'); S.setReaction(r, 's1:r0m0', 'a', '😂');
  let s = S.reactionSummary(r, 's1:r0m0', 'a');
  assert.strictEqual(s.counts['🔥'], 1); assert.strictEqual(s.counts['😂'], 1); assert.strictEqual(s.mine, '😂'); assert.strictEqual(s.total, 2);
  S.setReaction(r, 's1:r0m0', 'a', null); S.setReaction(r, 's1:r0m0', 'b', null);
  assert.deepStrictEqual(r, {});
  S.setReaction(r, 't', 'a', '💩'); assert.deepStrictEqual(r, {});
  s = S.reactionSummary({ t: { a: '<b>', b: '👏' } }, 't', 'a');
  assert.strictEqual(s.total, 1); assert.strictEqual(s.mine, null);
});

test('comment validation: trimmed, not empty, max 140 characters', () => {
  assert.strictEqual(S.checkComment('   ').ok, false);
  assert.deepStrictEqual(S.checkComment('  ตีดีมาก   เลย \r\n\r\n\r\n555 '), { ok: true, text: 'ตีดีมาก เลย\n\n555', error: '' });
  assert.strictEqual(S.checkComment('ก'.repeat(140)).ok, true);
  assert.strictEqual(S.checkComment('ก'.repeat(141)).ok, false);
  assert.strictEqual(S.checkComment('🔥'.repeat(140)).ok, true); // counted by character, not UTF-16 unit
  assert.strictEqual(S.checkComment('a\u0000b').text, 'ab');
});

test('comments: add is idempotent, ordered oldest first, delete rights', () => {
  const social = { reactions: {}, comments: [] };
  const c1 = { id: 'c1', target: 't', by: 'a', text: 'hi', at: '2026-10-18T10:00:00Z' };
  const c0 = { id: 'c0', target: 't', by: 'b', text: 'yo', at: '2026-10-18T09:00:00Z' };
  S.addComment(social, c1); S.addComment(social, c1); S.addComment(social, c0);
  S.addComment(social, { id: 'c2', target: 'other', by: 'a', text: 'x', at: '2026-10-18T11:00:00Z' });
  assert.strictEqual(social.comments.length, 3);
  assert.deepStrictEqual(S.commentsFor(social, 't').map(c => c.id), ['c0', 'c1']);
  assert.strictEqual(S.canDelete(c1, 'a', false), true);
  assert.strictEqual(S.canDelete(c1, 'b', false), false);
  assert.strictEqual(S.canDelete(c1, 'b', true), true);
  assert.strictEqual(S.canDelete(c1, '', true), false);
  S.removeComment(social, 'c1');
  assert.deepStrictEqual(social.comments.map(c => c.id), ['c0', 'c2']);
});

test('check-in toggles per day, keeps the first time, and prunes old days', () => {
  const ci = { '2026-08-01': { x: '2026-08-01T10:00:00Z' } };
  S.setCheckin(ci, '2026-10-18', 'a', true, '2026-10-18T10:00:00Z');
  S.setCheckin(ci, '2026-10-18', 'b', true, '2026-10-18T09:00:00Z');
  S.setCheckin(ci, '2026-10-18', 'a', true, '2026-10-18T11:00:00Z');
  assert.deepStrictEqual(S.present(ci, '2026-10-18'), ['b', 'a']);
  assert.strictEqual(ci['2026-08-01'], undefined);
  S.setCheckin(ci, '2026-10-18', 'b', false);
  assert.deepStrictEqual(S.present(ci, '2026-10-18'), ['a']);
  S.setCheckin(ci, '2026-10-18', 'a', false);
  assert.deepStrictEqual(ci, {});
});

test('timeAgo speaks Thai', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  assert.strictEqual(S.timeAgo('2026-10-18T11:59:30Z', now), 'เมื่อกี้');
  assert.strictEqual(S.timeAgo('2026-10-18T11:55:00Z', now), '5 นาทีที่แล้ว');
  assert.strictEqual(S.timeAgo('2026-10-18T09:00:00Z', now), '3 ชม.ที่แล้ว');
  assert.strictEqual(S.timeAgo('2026-10-16T12:00:00Z', now), '2 วันที่แล้ว');
});
