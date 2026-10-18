const test = require('node:test');
const assert = require('node:assert');
const nodeCrypto = require('node:crypto');
const E = require('../supabase/functions/push-notify/events.js');
const W = require('../supabase/functions/push-notify/webpush.js');

const profiles = { p: { displayName: 'Pim' }, q: { displayName: 'Quin' }, r: { displayName: 'Rex' }, s: { displayName: 'Sam' }, d: { displayName: 'Dealer' }, x: { displayName: 'Gone', active: false } };
const league = o => ({ profiles, currentSeason: 4, rounds: [{ m: [['p', 'q'], ['r', 's']] }, { m: [['p', 'r'], ['q', 's']] }], results: {}, ...o });
const main = (l, pred) => ({ id: 'main', league: { uidLeague: l }, predictions: { uidPredictions: pred || { dealerId: 'd', markets: {}, bets: [] } }, dummy: {} });
const club = c => ({ id: 'club', league: { club: { v: 1, matches: [], challenges: [], social: { reactions: {}, comments: [] }, ...c } } });
const ctx = { league: { currentSeason: 4, rounds: league().rounds, profiles } };
const keys = list => list.map(e => `${e.to}:${e.key}`).sort();

test('result entered: both players, from their own side, once', () => {
  const ev = E.rowEvents(main(league({ results: { r0m0: { a: 11, b: 7 } } })), main(league()));
  const res = ev.filter(e => e.key.startsWith('res:'));
  assert.deepStrictEqual(keys(res), ['p:res:4:r0m0:11-7', 'q:res:4:r0m0:11-7']);
  const p = res.find(e => e.to === 'p'), q = res.find(e => e.to === 'q');
  assert.strictEqual(p.title, 'ชนะแล้ว!'); assert.strictEqual(p.body, 'คุณ 11–7 Quin');
  assert.strictEqual(q.title, 'ผลออกแล้ว'); assert.strictEqual(q.body, 'คุณ 7–11 Pim');
  assert.strictEqual(p.tag, 'pp-res-r0m0'); assert.strictEqual(p.url, 'index.html');
});

test('half-typed or unchanged scores send nothing; a correction sends again', () => {
  const before = main(league({ results: { r0m0: { a: 11, b: 7 } } }));
  assert.deepStrictEqual(E.rowEvents(main(league({ results: { r0m0: { a: 11, b: null } } })), main(league())), []);
  assert.deepStrictEqual(E.rowEvents(before, before), []);
  const fixed = E.rowEvents(main(league({ results: { r0m0: { a: 11, b: 9 } } })), before);
  assert.deepStrictEqual(keys(fixed), ['p:res:4:r0m0:11-9', 'q:res:4:r0m0:11-9']);
});

test('next round: players of matches that just came up', () => {
  const r0done = { r0m0: { a: 11, b: 7 }, r0m1: { a: 11, b: 3 } };
  const old = main(league({ results: { r0m0: { a: 11, b: 7 } } }));
  const ev = E.rowEvents(main(league({ results: r0done })), old);
  const next = ev.filter(e => e.key.startsWith('next:'));
  assert.deepStrictEqual(keys(next), ['p:next:4:r1m0', 'q:next:4:r1m1', 'r:next:4:r1m0', 's:next:4:r1m1']);
  assert.strictEqual(next[0].title, 'ถึงคิวคุณแล้ว');
  assert.match(next.find(e => e.to === 'p').body, /^รอบ 2 • Pim vs Rex$/);
  // r and s also get their round-1 result; nobody gets "next" again on the next unrelated write
  assert.deepStrictEqual(keys(ev.filter(e => e.key.startsWith('res:'))), ['r:res:4:r0m1:11-3', 's:res:4:r0m1:11-3']);
  const again = main(league({ results: r0done, note: 'x' }));
  assert.deepStrictEqual(E.rowEvents(again, main(league({ results: r0done }))), []);
});

test('new season: round 1 players are up, old results are not re-sent', () => {
  const old = main(league({ currentSeason: 3, results: { r0m0: { a: 1, b: 11 } } }));
  const ev = E.rowEvents(main(league()), old);
  assert.deepStrictEqual(keys(ev), ['p:next:4:r0m0', 'q:next:4:r0m0', 'r:next:4:r0m1', 's:next:4:r0m1']);
});

test('market opened: everyone but the dealer, the two players and inactive accounts', () => {
  const mk = open => ({ dealerId: 'd', bets: [], markets: { 's4:r0m1': { favoriteId: 'r', handicap: 0.5, open } } });
  const ev = E.rowEvents(main(league(), mk(true)), main(league(), mk(false)));
  assert.deepStrictEqual(keys(ev), ['p:mkt:s4:r0m1', 'q:mkt:s4:r0m1']);
  assert.strictEqual(ev[0].url, 'predictions.html'); assert.strictEqual(ev[0].body, 'Rex vs Sam • เข้าไปทายได้เลย');
  // already open, other season, or match already has a result: nothing
  assert.deepStrictEqual(E.rowEvents(main(league(), mk(true)), main(league(), mk(true))), []);
  const old = { dealerId: 'd', markets: {} };
  assert.deepStrictEqual(E.rowEvents(main(league(), { dealerId: 'd', markets: { 's3:r0m1': { open: true } } }), main(league(), old)), []);
  const played = league({ results: { r0m1: { a: 2, b: 11 } } });
  assert.deepStrictEqual(E.rowEvents(main(played, mk(true)), main(played, old)).filter(e => e.key.startsWith('mkt')), []);
});

test('challenge: new one to the challenged player, acceptance to the challenger', () => {
  const ch = status => ({ id: 'c1', from: 'p', to: 'q', format: 'singles', note: 'บ่ายนี้ว่างไหม', status, at: '2026-10-19T10:00:00Z' });
  const made = E.rowEvents(club({ challenges: [ch('open')] }), club({}), ctx);
  assert.deepStrictEqual(keys(made), ['q:ch:c1']);
  assert.strictEqual(made[0].title, 'มีคนท้าดวลคุณ!'); assert.strictEqual(made[0].body, 'Pim ท้าคุณ • บ่ายนี้ว่างไหม');
  const ok = E.rowEvents(club({ challenges: [ch('accepted')] }), club({ challenges: [ch('open')] }), ctx);
  assert.deepStrictEqual(keys(ok), ['p:cha:c1']); assert.match(ok[0].body, /^Quin รับคำท้าของคุณ/);
  assert.deepStrictEqual(E.rowEvents(club({ challenges: [ch('declined')] }), club({ challenges: [ch('open')] }), ctx), []);
  assert.deepStrictEqual(E.rowEvents(club({ challenges: [ch('accepted')] }), club({ challenges: [ch('accepted')] }), ctx), []);
  // doubles: both players of the challenged team, both of the challenging team
  const dbl = s => ({ ...ch(s), format: 'doubles', teamA: ['p', 'r'], teamB: ['q', 's'] });
  assert.deepStrictEqual(keys(E.rowEvents(club({ challenges: [dbl('open')] }), club({}), ctx)), ['q:ch:c1', 's:ch:c1']);
  assert.deepStrictEqual(keys(E.rowEvents(club({ challenges: [dbl('accepted')] }), club({ challenges: [dbl('open')] }), ctx)), ['p:cha:c1', 'r:cha:c1']);
});

test('comment on my match: league and club matches, not to the writer', () => {
  const c1 = { id: 'k1', target: 's4:r0m0', by: 'p', text: 'ตบสวยมาก', at: '' };
  const ev = E.rowEvents(club({ social: { reactions: {}, comments: [c1] } }), club({}), ctx);
  assert.deepStrictEqual(keys(ev), ['q:cm:k1']);
  assert.strictEqual(ev[0].title, 'Pim คอมเมนต์แมตช์คุณ'); assert.strictEqual(ev[0].body, 'Pim vs Quin • ตบสวยมาก');
  const m = { id: 'm9', kind: 'challenge', format: 'doubles', a: ['p', 'r'], b: ['q', 's'], s: { a: 11, b: 9 } };
  const c2 = { id: 'k2', target: 'c:m9', by: 'd', text: 'gg' };
  const ev2 = E.rowEvents(club({ matches: [m], social: { comments: [c1, c2] } }), club({ matches: [m], social: { comments: [c1] } }), ctx);
  assert.deepStrictEqual(keys(ev2), ['p:cm:k2', 'q:cm:k2', 'r:cm:k2', 's:cm:k2']);
  // old season or unknown target: nobody
  const c3 = { id: 'k3', target: 's3:r0m0', by: 'd', text: 'x' };
  assert.deepStrictEqual(E.rowEvents(club({ social: { comments: [c3] } }), club({}), ctx), []);
});

test('club events work without the league (ids for names) and needsLeague only for club changes', () => {
  const ch = { id: 'c1', from: 'p', to: 'q', status: 'open' };
  const ev = E.rowEvents(club({ challenges: [ch] }), club({}));
  assert.deepStrictEqual(keys(ev), ['q:ch:c1']); assert.strictEqual(ev[0].body, 'p ท้าคุณ');
  assert.strictEqual(E.needsLeague(club({ challenges: [ch] }), club({})), true);
  assert.strictEqual(E.needsLeague(club({}), club({})), false);
  assert.strictEqual(E.needsLeague(main(league()), main(league())), false);
});

test('no duplicates, per-person cap, junk rows ignored', () => {
  const ch = i => ({ id: `c${i}`, from: 'p', to: 'q', status: 'open' });
  const dup = [ch(1), ch(1), ch(2), ch(3), ch(4), ch(5)];
  const ev = E.rowEvents(club({ challenges: dup }), club({}), ctx);
  assert.deepStrictEqual(keys(ev), ['q:ch:c1', 'q:ch:c2', 'q:ch:c3']);
  assert.strictEqual(E.MAX_PER_USER, 3);
  assert.deepStrictEqual(E.rowEvents({ id: 'live', league: {} }, { id: 'live', league: {} }), []);
  assert.deepStrictEqual(E.rowEvents(main(league()), { id: 'club' }), []);
  assert.deepStrictEqual(E.rowEvents({ id: 'main', league: 'junk' }, { id: 'main' }), []);
  const bad = league({ rounds: [{ m: [['p', '<img>'], null, 'x'] }], results: { r0m0: { a: 11, b: 1 } } });
  assert.doesNotThrow(() => E.rowEvents(main(bad), main(league({ rounds: [] }))));
  // payload is small and only has the four fields the service worker reads
  const pl = JSON.parse(E.payloadOf({ ...ev[0], to: 'q', key: 'k' }));
  assert.deepStrictEqual(Object.keys(pl).sort(), ['body', 'tag', 'title', 'url']);
});

// ---------- webpush.js against an independent receiver written with node:crypto ----------
function receiverDecrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const ecdh = uaEcdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(nodeCrypto.hkdfSync('sha256', ecdh, authSecret, info, 32));
  const cek = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(nodeCrypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.strictEqual(plain[plain.length - 1], 2, 'last-record delimiter');
  return { rs, text: plain.subarray(0, -1).toString('utf8') };
}
const b64u = b => Buffer.from(b).toString('base64url');

test('aes128gcm payload decrypts with an independent RFC 8291 receiver', async () => {
  const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const msg = JSON.stringify({ title: 'ผลออกแล้ว', body: 'คุณ 7–11 Pim', tag: 'pp-res-r0m0', url: 'index.html' });
  const body = Buffer.from(await W.encrypt(msg, b64u(ua.getPublicKey()), b64u(auth)));
  const out = receiverDecrypt(body, ua, auth);
  assert.strictEqual(out.text, msg); assert.strictEqual(out.rs, 4096);
  await assert.rejects(W.encrypt(msg, 'AAAA', b64u(auth)));
});

test('VAPID header is a valid ES256 JWT for the push service origin', async () => {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pubRaw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const vapid = await W.importVapid(b64u(pubRaw), jwk.d);
  const h = await W.vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 'mailto:a@b.c', 1000);
  const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(h);
  assert.strictEqual(k, b64u(pubRaw));
  const [head, claims, sig] = t.split('.');
  assert.deepStrictEqual(JSON.parse(Buffer.from(claims, 'base64url')), { aud: 'https://fcm.googleapis.com', exp: 1000 + 43200, sub: 'mailto:a@b.c' });
  assert.ok(nodeCrypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
});

test('send: headers, 410 means gone, foreign endpoints are never contacted', async () => {
  const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const { privateKey } = nodeCrypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  const vapid = await W.importVapid(b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')])), jwk.d);
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return { ok: false, status: 410, text: async () => 'expired' }; };
  const sub = { endpoint: 'https://web.push.apple.com/QGabc', p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) };
  const r = await W.send(sub, '{"title":"x"}', { vapid, subject: 'mailto:a@b.c', topic: 'pp-mkt-s4:r0m1', fetch });
  assert.deepStrictEqual([r.status, r.gone], [410, true]);
  assert.strictEqual(calls[0].init.headers['Content-Encoding'], 'aes128gcm');
  assert.strictEqual(calls[0].init.headers.Topic, 'pp-mkt-s4_r0m1');
  assert.strictEqual(receiverDecrypt(Buffer.from(calls[0].init.body), ua, auth).text, '{"title":"x"}');
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://localhost/x']) {
    const res = await W.send({ ...sub, endpoint }, 'x', { vapid, subject: 's', fetch });
    assert.strictEqual(res.gone, true, endpoint);
  }
  assert.strictEqual(calls.length, 1);
  assert.ok(W.endpointOk('https://fcm.googleapis.com/fcm/send/dX:APA91b-x_y'));
  assert.ok(W.endpointOk('https://wns2-par02p.notify.windows.com/w/?token=AbC%2B'));
});

test('push-config.js holds a public VAPID key (65-byte uncompressed P-256, base64url), every page loads push-config.js before pwa.js, sw.js handles push', () => {
  const fs = require('node:fs'), path = require('node:path'), root = path.join(__dirname, '..');
  const ctx = { window: {} };
  require('node:vm').runInNewContext(fs.readFileSync(path.join(root, 'push-config.js'), 'utf8'), ctx);
  const key = ctx.window.PUSH_VAPID_PUBLIC_KEY;
  assert.match(key, /^[A-Za-z0-9_-]+$/);
  assert.strictEqual(Buffer.from(key, 'base64url').length, 65);
  for (const page of ['index.html', 'predictions.html', 'dashboard.html', 'stats.html', 'archive.html', 'backup.html', 'admin.html', 'dummy.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8'), cfg = html.indexOf('src="push-config.js'), pwa = html.indexOf('src="pwa.js');
    assert.ok(cfg > 0 && cfg < pwa, page);
  }
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /safePage\(event\.notification\.data\?\.url\)/);
});

// ---------- pwa.js: registers this device only with a server session token ----------
function loadPwa({ token = '', userId = 'alice', subscribeStatus = 200 } = {}) {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const values = new Map([['pp_notify', 'true']]);
  const localStorage = { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const calls = [];
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', options: {}, toJSON: () => ({ keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) } }), unsubscribe: async () => true };
  const state = { token, userId };
  const LeagueShared = {
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'pk', LEAGUE_KEY: 'L', PRED_KEY: 'P', CLUB_KEY: 'C', SESSION_KEY: 'pp_user_id', TOKEN_KEY: 'pp_session_v2',
    readLocalLeague: () => ({ profiles: {} }), sessionUserId: () => state.userId, sessionToken: () => state.token
  };
  const fetch = async (url, init) => {
    const name = url.split('/rpc/')[1]; calls.push({ name, args: JSON.parse(init.body) });
    const status = name === 'pp_push_subscribe' ? subscribeStatus : 200;
    return { ok: status < 300, status };
  };
  const window = {
    LeagueShared, localStorage, fetch, PUSH_VAPID_PUBLIC_KEY: Buffer.alloc(65, 4).toString('base64url'), Notification: { permission: 'granted' }, PushManager: function () {},
    navigator: { userAgent: 'x', serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription: async () => null, subscribe: async () => sub } }) } },
    document: { readyState: 'loading', hidden: true, querySelector: () => null, body: null },
    matchMedia: () => ({ matches: false }), addEventListener: () => {}, setInterval: () => 0, setTimeout: () => 0,
    requestAnimationFrame: () => 0, atob: s => Buffer.from(s, 'base64').toString('binary')
  };
  window.window = window;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'pwa.js'), 'utf8'), window);
  return { pwa: window.LeaguePWA, calls, state, stored: () => JSON.parse(values.get('pp_push_sub') || 'null') };
}

test('pwa.js: subscribes with the session token, never with a user id', async () => {
  const { pwa, calls, stored } = loadPwa({ token: 'a'.repeat(64) });
  assert.strictEqual(await pwa.syncPush(true), true);
  assert.deepStrictEqual(calls.map(c => c.name), ['pp_push_subscribe']);
  assert.deepStrictEqual(Object.keys(calls[0].args).sort(), ['p_auth', 'p_endpoint', 'p_p256dh', 'p_token']);
  assert.strictEqual(calls[0].args.p_token, 'a'.repeat(64));
  assert.deepStrictEqual(stored(), { endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', userId: 'alice', tok: 'a'.repeat(12) });
  assert.strictEqual(await pwa.syncPush(true), true); assert.strictEqual(calls.length, 1, 'same token: no new call');
});

test('pwa.js: no token means no registration; a later sign-in registers', async () => {
  const { pwa, calls, state, stored } = loadPwa({ token: '' });
  assert.strictEqual(await pwa.syncPush(true), false);
  assert.deepStrictEqual(calls, []); assert.strictEqual(pwa.pushActive(), false);
  state.token = 'b'.repeat(64);
  assert.strictEqual(await pwa.syncPush(true), true);
  assert.strictEqual(calls[0].args.p_token, 'b'.repeat(64));
  // the token changes (new sign-in): registered again with the new one
  state.token = 'c'.repeat(64);
  assert.strictEqual(await pwa.syncPush(true), true);
  assert.strictEqual(calls.length, 2); assert.strictEqual(calls[1].args.p_token, 'c'.repeat(64));
  // session expired locally: the registration made with a valid token for this player stays, nothing is sent
  state.token = '';
  assert.strictEqual(await pwa.syncPush(true), true); assert.strictEqual(calls.length, 2);
  // another player signs in without a token: the old registration is removed, no new one
  state.userId = 'bob';
  assert.strictEqual(await pwa.syncPush(true), false);
  assert.deepStrictEqual(calls.map(c => c.name), ['pp_push_subscribe', 'pp_push_subscribe', 'pp_push_unsubscribe']);
  assert.strictEqual(stored(), null);
});

test('pwa.js: server without the token function (404) stays on in-app notifications, no fallback call', async () => {
  const { pwa, calls, stored } = loadPwa({ token: 'd'.repeat(64), subscribeStatus: 404 });
  assert.strictEqual(await pwa.syncPush(true), false);
  assert.deepStrictEqual(calls.map(c => c.name), ['pp_push_subscribe']);
  assert.ok(!('p_user_id' in calls[0].args));
  assert.strictEqual(stored(), null); assert.strictEqual(pwa.pushActive(), false);
  assert.doesNotMatch(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'pwa.js'), 'utf8'), /p_user_id/);
});
