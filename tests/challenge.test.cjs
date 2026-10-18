const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../challenge.js');

const profiles = Object.fromEntries(['a', 'b', 'c', 'd', 'x'].map(id => [id, { id, displayName: id, active: id !== 'x' }]));
const league = { profiles };
const fresh = () => ({ v: 1, matches: [], challenges: [] });

test('validate singles and doubles input', () => {
  const club = fresh();
  assert.equal(C.validate({ from: 'a', to: 'b' }, league, club), '');
  assert.match(C.validate({ from: '', to: 'b' }, league, club), /เข้าสู่ระบบ/);
  assert.match(C.validate({ from: 'a', to: 'a' }, league, club), /ตัวเอง/);
  assert.match(C.validate({ from: 'a', to: 'x' }, league, club), /คู่ต่อสู้/);
  assert.equal(C.validate({ from: 'a', format: 'doubles', teamA: ['a', 'b'], teamB: ['c', 'd'] }, league, club), '');
  assert.match(C.validate({ from: 'a', format: 'doubles', teamA: ['a', 'c'], teamB: ['c', 'd'] }, league, club), /ไม่ซ้ำ/);
  assert.match(C.validate({ from: 'a', format: 'doubles', teamA: ['b', 'a'], teamB: ['c', 'd'] }, league, club), /ฝั่งผู้ท้า/);
  assert.match(C.validate({ from: 'a', format: 'doubles', teamA: ['a', 'b'], teamB: ['c', ''] }, league, club), /ครบ/);
});

test('create stores a clean challenge once and blocks duplicates', () => {
  const club = fresh();
  const ch = C.create(club, { from: 'a', to: 'b', note: '  แพ้\nเลี้ยง   ชานม ' + 'x'.repeat(200) }, { id: 'ch_1', at: '2026-10-19T00:00:00Z' });
  assert.equal(ch.status, 'open'); assert.equal(ch.format, 'singles');
  assert.ok(ch.note.startsWith('แพ้ เลี้ยง ชานม')); assert.equal(ch.note.length, C.NOTE_MAX);
  C.create(club, { from: 'a', to: 'b' }, { id: 'ch_1' });
  assert.equal(club.challenges.length, 1, 'same id is not added twice (safe to re-run)');
  assert.match(C.validate({ from: 'b', to: 'a' }, league, club), /ค้างอยู่/);
  const d = C.create(club, { from: 'a', format: 'doubles', teamA: ['a', 'b'], teamB: ['c', 'd'] }, { id: 'ch_2' });
  assert.equal(d.to, 'c'); assert.deepEqual(C.sides(d), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(C.openForMe(club, 'd').map(c => c.id), ['ch_2']);
  assert.equal(C.badge(club, 'b'), 1); assert.equal(C.badge(club, 'a'), 0);
});

test('accept / decline / cancel permissions and idempotence', () => {
  const club = fresh();
  C.create(club, { from: 'a', to: 'b' }, { id: 'ch_1' });
  assert.match(C.respond(club, 'ch_1', 'a', 'accept'), /ไม่ได้/);
  assert.match(C.respond(club, 'ch_1', 'c', 'decline'), /ไม่ได้/);
  assert.equal(C.respond(club, 'ch_1', 'b', 'accept'), '');
  assert.equal(club.challenges[0].status, 'accepted');
  assert.equal(C.respond(club, 'ch_1', 'b', 'accept'), 'same');
  assert.equal(C.can(club.challenges[0], 'a', 'score'), true);
  assert.equal(C.can(club.challenges[0], 'c', 'score'), false);
  assert.equal(C.can(club.challenges[0], 'c', 'score', true), true, 'admin may score');
  assert.deepEqual(C.ready(club, 'a').map(c => c.id), ['ch_1']);
  C.create(club, { from: 'c', to: 'd' }, { id: 'ch_2' });
  assert.match(C.respond(club, 'ch_2', 'd', 'cancel'), /ไม่ได้/);
  assert.equal(C.respond(club, 'ch_2', 'c', 'cancel'), '');
  assert.match(C.respond(club, 'ch_2', 'd', 'accept'), /ปิดไปแล้ว/);
  assert.equal(C.respond(club, 'nope', 'a', 'accept'), 'ไม่พบคำท้านี้');
});

test('finish writes one challenge match and closes the challenge', () => {
  const club = fresh();
  C.create(club, { from: 'a', to: 'b' }, { id: 'ch_1' });
  assert.match(C.finish(club, 'ch_1', 'a', { a: 11, b: 5 }), /ยังไม่ได้รับ/);
  C.respond(club, 'ch_1', 'b', 'accept');
  assert.match(C.finish(club, 'ch_1', 'a', { a: 0, b: 0 }), /ใส่คะแนน/);
  assert.match(C.finish(club, 'ch_1', 'a', { a: 1.5, b: 0 }), /0–99/);
  assert.match(C.finish(club, 'ch_1', 'c', { a: 11, b: 5 }), /เฉพาะคน/);
  assert.equal(C.finish(club, 'ch_1', 'b', { a: 11, b: 5 }, { at: '2026-10-19T02:00:00Z', liveKey: 'c:cm_1' }), '');
  assert.deepEqual(club.matches, [{ id: 'cm_1', kind: 'challenge', format: 'singles', a: 'a', b: 'b', s: { a: 11, b: 5 }, at: '2026-10-19T02:00:00Z', by: 'b', challengeId: 'ch_1', liveKey: 'c:cm_1' }]);
  assert.equal(club.challenges[0].status, 'done'); assert.equal(club.challenges[0].matchId, 'cm_1');
  assert.equal(C.finish(club, 'ch_1', 'a', { a: 11, b: 5 }), 'same');
  assert.equal(club.matches.length, 1);
  assert.deepEqual(C.history(club).map(m => m.id), ['cm_1']);
});

test('doubles finish stores team arrays; history is latest first and challenge-only', () => {
  const club = fresh();
  C.create(club, { from: 'a', format: 'doubles', teamA: ['a', 'b'], teamB: ['c', 'd'] }, { id: 'ch_9' });
  assert.equal(C.respond(club, 'ch_9', 'd', 'accept'), '');
  assert.equal(C.finish(club, 'ch_9', 'c', { a: 2, b: 3 }, { at: '2026-10-19T05:00:00Z' }), '');
  club.matches.push({ id: 'old', kind: 'challenge', a: 'a', b: 'c', s: { a: 1, b: 0 }, at: '2026-10-01T00:00:00Z' }, { id: 't', kind: 'tournament', a: 'a', b: 'c', s: { a: 1, b: 0 }, at: '2026-10-30T00:00:00Z' });
  assert.deepEqual(club.matches[0].a, ['a', 'b']); assert.deepEqual(club.matches[0].b, ['c', 'd']);
  assert.deepEqual(C.history(club).map(m => m.id), ['cm_9', 'old']);
});

test('helpers survive a missing or malformed club', () => {
  assert.deepEqual(C.openForMe(null, 'a'), []);
  assert.deepEqual(C.history({ matches: 'x' }), []);
  assert.equal(C.badge({ challenges: [null, 1, { status: 'open', to: 'a' }] }, 'a'), 1);
  assert.equal(C.validate({ from: 'a', to: 'b' }, league, null), '');
});
