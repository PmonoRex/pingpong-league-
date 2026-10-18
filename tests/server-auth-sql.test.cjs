// Phase 2 SQL (supabase/migrations/20261019140000_server_auth.sql) on a scratch Postgres with Supabase-like roles.
// Runs only where Postgres server binaries are installed (initdb / pg_ctl); skipped otherwise, e.g. a bare CI image.
// API calls connect as `authenticator` and switch to `anon` with request.jwt.claims, as PostgREST does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function findBin() {
  const candidates = [process.env.PG_BIN, ...(() => { try { return fs.readdirSync('/usr/lib/postgresql').sort().reverse().map(v => `/usr/lib/postgresql/${v}/bin`); } catch { return []; } })()];
  return candidates.find(dir => dir && fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));
}
const BIN = findBin();
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
let asUser = [];
if (BIN && isRoot) { try { execFileSync('id', ['postgres'], { stdio: 'ignore' }); asUser = ['runuser', '-u', 'postgres', '--']; } catch { asUser = null; } }
const skip = !BIN || asUser === null ? 'Postgres server binaries not available' : false;

const MIGRATIONS = ['20260919163000_create_shared_state.sql', '20261017120000_add_dummy_state.sql',
  '20261018130000_harden_shared_state.sql', '20261019120000_club_row.sql', '20261019130000_push.sql', '20261019140000_server_auth.sql',
  '20261020120000_push_session.sql']
  .map(f => path.join(__dirname, '..', 'supabase', 'migrations', f));

const BOOTSTRAP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role authenticator login noinherit; grant anon, authenticated, service_role to authenticator;
create schema extensions; create extension pgcrypto with schema extensions;
grant usage on schema public, extensions to anon, authenticated, service_role;
create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
`;

const pbkdf2 = (pin, iterations = 10000) => {
  const salt = crypto.randomBytes(16);
  return `pbkdf2-sha256$${iterations}$${salt.toString('hex')}$${crypto.pbkdf2Sync(pin, salt, iterations, 32, 'sha256').toString('hex')}`;
};

let dir, port, sock;
const run = (cmd, args, opts = {}) => execFileSync(asUser.length ? asUser[0] : cmd, asUser.length ? [...asUser.slice(1), cmd, ...args] : args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
// psql -c ignores stdin; feed everything through stdin instead.
function q(sql, opts = {}) {
  const prefix = opts.api ? `set role anon;\nselect set_config('request.jwt.claims', '{"role":"anon"}', false) \\g /dev/null\nselect set_config('request.headers', '{"x-forwarded-for":"${opts.ip || '10.0.0.1'}"}', false) \\g /dev/null\n` : '';
  const args = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', String(port), '-U', opts.api ? 'authenticator' : 'postgres', '-d', 'postgres'];
  try { return run(path.join(BIN, 'psql'), args, { input: prefix + sql + '\n' }).trim(); }
  catch (error) { throw new Error((error.stderr || error.message).trim()); }
}
const api = (sql, ip) => q(sql, { api: true, ip });
const lit = value => `'${JSON.stringify(value).replace(/'/g, "''")}'`;
const rpc = (name, args, ip) => {
  const out = api(`select public.${name}(${args.map(a => a === null ? 'null' : typeof a === 'object' ? `${lit(a)}::jsonb` : `'${String(a).replace(/'/g, "''")}'`).join(', ')});`, ip);
  try { return JSON.parse(out); } catch { return out; }
};
const row = (id = 'main') => JSON.parse(q(`select row_to_json(s) from public.app_state s where id = '${id}';`));
const league = () => row().league.uidLeague;
const pred = () => row().predictions.uidPredictions;
const stamp = (id = 'main') => q(`select to_json(updated_at) #>> '{}' from public.app_state where id = '${id}';`);
let ipSeq = 0;
const tok = (id, pin, ip = `10.1.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`) => { const r = rpc('pp_login', [id, pin], ip); assert.ok(r.token, JSON.stringify(r)); return r.token; };

function fixture() {
  return {
    profiles: {
      mos: { id: 'mos', displayName: 'มอส', role: 'admin', active: true, pinHash: pbkdf2('2580') },
      gift: { id: 'gift', displayName: 'กิฟท์', role: 'player', active: true, pin: '1234', mustChangePin: true },
      alice: { id: 'alice', displayName: 'Alice', role: 'player', active: true, pinHash: pbkdf2('4826', 150000) },
      bob: { id: 'bob', displayName: 'Bob', role: 'player', active: true, pinHash: pbkdf2('7391') },
      off: { id: 'off', displayName: 'Off', role: 'player', active: false, pin: '1234' }
    },
    seasonPlayerIds: ['mos', 'gift', 'alice', 'bob'], currentSeason: 1,
    rounds: [{ rest: null, m: [['alice', 'bob'], ['mos', 'gift']] }], results: {}, rankHistory: [], seasonArchives: [], auditLog: [], schemaVersion: 2
  };
}
const predFixture = () => ({ dealerId: 'gift', markets: { 's1:r0m0': { favoriteId: 'alice', handicap: 1, open: true } }, bets: [], nextBetId: 1 });

test('phase 2 server auth on Postgres', { skip, timeout: 240000 }, async t => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sec2-'));
  fs.chmodSync(dir, 0o777);
  sock = dir; port = 54000 + Math.floor(Math.random() * 900);
  const data = path.join(dir, 'data');
  fs.mkdirSync(data); if (isRoot) execFileSync('chown', ['postgres', data]);
  try {
    run(path.join(BIN, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres']);
    run(path.join(BIN, 'pg_ctl'), ['-D', data, '-w', '-l', path.join(dir, 'log'), '-o', `-k ${dir} -p ${port} -c listen_addresses=''`, 'start']);
  } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); t.skip(`could not start a scratch Postgres: ${String(error.message).slice(0, 120)}`); return; }
  t.after(() => { try { run(path.join(BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']); } catch {} fs.rmSync(dir, { recursive: true, force: true }); });

  q(BOOTSTRAP);
  for (const file of MIGRATIONS.slice(0, 5)) q(fs.readFileSync(file, 'utf8'));
  q(`update public.app_state set league = jsonb_build_object('uidLeague', ${lit(fixture())}::jsonb), predictions = jsonb_build_object('uidPredictions', ${lit(predFixture())}::jsonb) where id = 'main';`);
  q(fs.readFileSync(MIGRATIONS[5], 'utf8'));
  q(fs.readFileSync(MIGRATIONS[5], 'utf8')); // idempotent
  q(fs.readFileSync(MIGRATIONS[6], 'utf8'));
  q(fs.readFileSync(MIGRATIONS[6], 'utf8')); // idempotent
  q(fs.readFileSync(MIGRATIONS[4], 'utf8')); // re-running push.sql keeps the token version

  await t.test('probe, import and login', () => {
    assert.deepEqual(rpc('pp_auth_version', []), { version: 1, enforce: false });
    assert.equal(q('select count(*) from private.credentials;'), '5');
    assert.throws(() => api('select * from private.credentials;'), /permission denied/);
    assert.deepEqual(rpc('pp_login', ['alice', '0000']), { error: 'wrong account or PIN' });
    assert.deepEqual(rpc('pp_login', ['nobody', '1234']), { error: 'wrong account or PIN' });
    assert.deepEqual(rpc('pp_login', ['off', '1234']), { error: 'wrong account or PIN' });
    const r = rpc('pp_login', ['alice', '4826']);
    assert.match(r.token, /^[0-9a-f]{64}$/); assert.equal(r.must_change, false); assert.equal(r.role, 'player');
    assert.equal(q(`select legacy_pbkdf2 is null and pin_bcrypt like '$2%' from private.credentials where user_id = 'alice';`), 't', 'upgraded to bcrypt');
    assert.equal(tok('alice', '4826') !== r.token, true, 'bcrypt login works too');
    assert.equal(rpc('pp_login', ['gift', '1234']).must_change, true);
    assert.equal(rpc('pp_whoami', [r.token]).user_id, 'alice');
    assert.equal(rpc('pp_whoami', ['bogus']), '');
    assert.equal(q(`select count(*) from private.sessions where token_hash = '${r.token}';`), '0', 'only the hash is stored');
  });

  await t.test('push: subscribe takes the player from a valid session token', () => {
    const P256 = 'B'.repeat(87), AUTH = 'A'.repeat(22), ep = n => `https://fcm.googleapis.com/fcm/send/dev${n}`;
    const owner = ep => q(`select user_id from public.push_subscriptions where endpoint = '${ep}';`);
    const alice = tok('alice', '4826');
    assert.equal(rpc('pp_push_subscribe', [alice, ep(1), P256, AUTH]), 't');
    assert.equal(owner(ep(1)), 'alice');
    // only one pp_push_subscribe exists, and it has no user id argument
    assert.equal(q(`select string_agg(pg_get_function_identity_arguments(p.oid), ' | ') from pg_proc p where p.proname = 'pp_push_subscribe';`),
      'p_token text, p_endpoint text, p_p256dh text, p_auth text');
    assert.equal(q(`select has_function_privilege('anon', 'public.pp_push_subscribe(text, text, text, text)', 'execute');`), 't');
    // the old call shape (named p_user_id, as PostgREST sends it) does not resolve any more
    assert.throws(() => api(`select public.pp_push_subscribe(p_endpoint => '${ep(2)}', p_p256dh => '${P256}', p_auth => '${AUTH}', p_user_id => 'bob');`), /does not exist/);
    // positional old order: the endpoint is now read as the token -> refused
    assert.throws(() => rpc('pp_push_subscribe', [ep(2), P256, AUTH, 'bob']), /endpoint not allowed|session expired/);
    // invalid, missing, logged-out and expired tokens are refused; nothing is stored
    assert.throws(() => rpc('pp_push_subscribe', ['bogus', ep(3), P256, AUTH]), /session expired/);
    assert.throws(() => rpc('pp_push_subscribe', [null, ep(3), P256, AUTH]), /session expired/);
    const gone = tok('bob', '7391'); rpc('pp_logout', [gone]);
    assert.throws(() => rpc('pp_push_subscribe', [gone, ep(3), P256, AUTH]), /session expired/);
    const old = tok('bob', '7391');
    q(`update private.sessions set expires_at = now() - interval '1 second' where token_hash = encode(extensions.digest('${old}', 'sha256'), 'hex');`);
    assert.throws(() => rpc('pp_push_subscribe', [old, ep(3), P256, AUTH]), /session expired/);
    assert.equal(owner(ep(3)), '');
    // allowlist and key checks still apply
    assert.throws(() => rpc('pp_push_subscribe', [alice, 'https://evil.example/x', P256, AUTH]), /endpoint not allowed/);
    assert.throws(() => rpc('pp_push_subscribe', [alice, ep(4), 'short', AUTH]), /bad keys/);
    // the same device signing in as someone else moves to that account
    const bob = tok('bob', '7391');
    assert.equal(rpc('pp_push_subscribe', [bob, ep(1), P256, AUTH]), 't');
    assert.equal(owner(ep(1)), 'bob');
    // at most 10 devices per player
    for (let i = 10; i < 22; i++) rpc('pp_push_subscribe', [alice, ep(i), P256, AUTH]);
    assert.equal(q(`select count(*) from public.push_subscriptions where user_id = 'alice';`), '10');
    // unsubscribe by endpoint (the endpoint is the capability)
    assert.equal(rpc('pp_push_unsubscribe', [ep(1)]), 't');
    assert.equal(rpc('pp_push_unsubscribe', [ep(1)]), 'f');
    assert.throws(() => api('select * from public.push_subscriptions;'), /permission denied/);
    q('delete from public.push_subscriptions;');
  });

  await t.test('server-side lockout', () => {
    for (let i = 0; i < 4; i++) assert.equal(rpc('pp_login', ['bob', '1111'], '10.0.0.2').error, 'wrong account or PIN');
    assert.equal(rpc('pp_login', ['bob', '1111'], '10.0.0.2').error, 'locked');
    const locked = rpc('pp_login', ['bob', '7391'], '10.0.0.2');
    assert.equal(locked.error, 'locked'); assert.ok(locked.retry_after_seconds > 800);
    q(`update private.credentials set locked_until = now() - interval '1 second' where user_id = 'bob';`);
    assert.ok(tok('bob', '7391', '10.0.0.2'));
    // per-IP throttle: 30 attempts / 10 min
    for (let i = 0; i < 24; i++) rpc('pp_login', ['nobody', '1'], '10.0.0.2');
    assert.equal(rpc('pp_login', ['bob', '7391'], '10.0.0.2').error, 'locked');
  });

  await t.test('league: admin anything, player own profile only, optimistic lock', () => {
    const admin = tok('mos', '2580'), alice = tok('alice', '4826');
    let l = league(), at = stamp();
    l.results.r0m0 = { a: 11, b: 7 }; l.profiles.mos.pinHash = 'pbkdf2-sha256$10000$' + '0'.repeat(32) + '$' + '1'.repeat(64);
    const saved = rpc('pp_save_league', [admin, l, at]);
    assert.ok(saved && saved !== at);
    assert.deepEqual(league().results.r0m0, { a: 11, b: 7 });
    assert.notEqual(league().profiles.mos.pinHash, l.profiles.mos.pinHash, 'client credential fields are ignored');
    assert.ok(league().profiles.mos.pinHash, 'row keeps its pin fields while enforce is off');
    assert.equal(rpc('pp_save_league', [admin, l, at]), '', 'stale expected -> null');

    l = league(); at = stamp();
    l.profiles.alice.tagline = 'ตบไม่เลือกหน้า'; l.profiles.alice.displayName = 'Alice A';
    l.auditLog.unshift({ at: new Date().toISOString(), action: 'profile_update', actorId: 'alice', meta: { target: 'alice' } });
    assert.ok(rpc('pp_save_league', [alice, l, at]));
    assert.equal(league().profiles.alice.tagline, 'ตบไม่เลือกหน้า');
    const deny = (change, re) => { const x = league(); change(x); assert.throws(() => rpc('pp_save_league', [alice, x, stamp()]), re); };
    deny(x => { x.profiles.bob.tagline = 'hacked'; }, /own profile/);
    deny(x => { x.profiles.alice.role = 'admin'; }, /their name, picture/);
    deny(x => { x.results.r0m0 = { a: 0, b: 11 }; }, /only an admin/);
    deny(x => { x.profiles.alice.displayName = 'bob'; }, /already used/);
    deny(x => { x.auditLog = []; }, /audit log/);
    deny(x => { x.auditLog.unshift({ action: 'x', actorId: 'mos' }); }, /audit log/);
    deny(x => { x.profiles.alice.pinResetAt = 'now'; }, /their name, picture/);
    // normalizeLeague() additions on a league that lacked them are fine
    q(`update public.app_state set league = league #- '{uidLeague,rankHistory}' where id = 'main';`);
    const x = league(); x.rankHistory = []; x.profiles.alice.tagline = 'again';
    assert.ok(rpc('pp_save_league', [alice, x, stamp()]));
  });

  await t.test('admin reset and new accounts reach private.credentials', () => {
    const admin = tok('mos', '2580'), giftOld = tok('gift', '1234');
    assert.deepEqual(rpc('pp_change_pin', [giftOld, '1234', '9157']), { ok: true });
    const l = league();
    l.profiles.gift.pinResetAt = new Date().toISOString();
    l.profiles.newbie = { id: 'newbie', displayName: 'Newbie', role: 'player', active: true };
    assert.ok(rpc('pp_save_league', [admin, l, stamp()]));
    assert.equal(rpc('pp_login', ['gift', '9157']).error, 'wrong account or PIN');
    assert.equal(rpc('pp_login', ['gift', '1234']).must_change, true);
    assert.equal(rpc('pp_login', ['newbie', '1234']).must_change, true);
    assert.throws(() => rpc('pp_reset_pin', [tok('alice', '4826'), 'mos']), /admin only/);
    rpc('pp_reset_pin', [admin, 'alice']);
    assert.equal(rpc('pp_login', ['alice', '4826']).error, 'wrong account or PIN');
    assert.ok(tok('alice', '1234'));
    // a save that only carries the same pinResetAt again does not reset again
    const g = tok('gift', '1234'); assert.deepEqual(rpc('pp_change_pin', [g, '1234', '9157']), { ok: true });
    assert.ok(rpc('pp_save_league', [admin, league(), stamp()]));
    assert.ok(tok('gift', '9157'));
  });

  await t.test('change PIN, logout, expired session', () => {
    const a1 = tok('alice', '1234'), a2 = tok('alice', '1234');
    assert.deepEqual(rpc('pp_change_pin', [a1, '0000', '4826']), { error: 'wrong current PIN' });
    assert.deepEqual(rpc('pp_change_pin', [a1, '1234', '1234']), { error: 'PIN not allowed' });
    assert.deepEqual(rpc('pp_change_pin', [a1, '1234', '123456']), { error: 'PIN not allowed' });
    assert.deepEqual(rpc('pp_change_pin', [a1, '1234', '4826']), { ok: true });
    assert.equal(rpc('pp_whoami', [a2]), '', 'other devices are signed out');
    assert.equal(rpc('pp_whoami', [a1]).must_change, false);
    rpc('pp_logout', [a1]);
    assert.throws(() => rpc('pp_save_dummy', [a1, { rev: 1 }, 0]), /session expired/);
    const a3 = tok('alice', '4826');
    q(`update private.sessions set expires_at = now() - interval '1 second';`);
    assert.throws(() => rpc('pp_save_dummy', [a3, { rev: 1 }, 0]), /session expired/);
  });

  await t.test('predictions: players bet for themselves, dealer settles, admin appoints', () => {
    const alice = tok('alice', '4826'), gift = tok('gift', '9157'), mos = tok('mos', '2580'), bob = tok('bob', '7391', '10.0.0.3');
    const bet = (userId, extra = {}) => ({ id: 1, season: 1, matchId: 'r0m0', pair: ['alice', 'bob'], favoriteId: 'alice', handicap: 1, userId, sideId: 'alice', stake: 50, status: 'pending', net: 0, createdAt: 'x', ...extra });
    const withBet = (b, base = pred()) => ({ ...base, bets: [...base.bets, b], nextBetId: base.nextBetId + 1 });
    assert.throws(() => rpc('pp_save_predictions', [alice, withBet(bet('alice')), stamp()]), /bet rejected/, 'own match');
    assert.throws(() => rpc('pp_save_predictions', [mos, { ...pred(), dealerId: 'alice', bets: 5 }, stamp()]), /shape/);
    // mos is admin: anything goes; use a plain player for the rules
    q(`update public.app_state set league = jsonb_set(league, '{uidLeague,rounds}', '[{"rest":null,"m":[["alice","bob"],["mos","newbie"]]}]') where id = 'main';`);
    const newbie = tok('newbie', '1234');
    assert.throws(() => rpc('pp_save_predictions', [newbie, withBet(bet('bob')), stamp()]), /own name/);
    assert.throws(() => rpc('pp_save_predictions', [newbie, withBet(bet('newbie', { stake: -5 })), stamp()]), /bet rejected/);
    assert.throws(() => rpc('pp_save_predictions', [newbie, withBet(bet('newbie', { status: 'won' })), stamp()]), /bet rejected/);
    assert.throws(() => rpc('pp_save_predictions', [newbie, withBet(bet('newbie', { handicap: 0 })), stamp()]), /not open/);
    assert.throws(() => rpc('pp_save_predictions', [newbie, { ...pred(), markets: {} }, stamp()]), /dealer/);
    assert.throws(() => rpc('pp_save_predictions', [newbie, { ...pred(), dealerId: 'newbie' }, stamp()]), /admin/);
    assert.ok(rpc('pp_save_predictions', [newbie, withBet(bet('newbie')), stamp()]));
    assert.throws(() => rpc('pp_save_predictions', [newbie, withBet(bet('newbie', { id: 2 })), stamp()]), /already bet/);
    assert.throws(() => rpc('pp_save_predictions', [gift, withBet(bet('gift', { id: 2 })), stamp()]), /dealer cannot bet/);
    let p = pred(); p.bets[0].stake = 1;
    assert.throws(() => rpc('pp_save_predictions', [gift, p, stamp()]), /only settle/);
    assert.throws(() => rpc('pp_save_predictions', [newbie, { ...pred(), bets: [{ ...pred().bets[0], status: 'won' }] }, stamp()]), /existing bets/);
    p = pred(); p.bets[0].status = 'won'; p.bets[0].net = 50; p.markets['s1:r0m0'].open = false; p.settleLog = [{ action: 'x' }];
    assert.ok(rpc('pp_save_predictions', [gift, p, stamp()]), 'dealer settles and closes markets');
    assert.throws(() => rpc('pp_save_predictions', [gift, { ...pred(), bets: [] }, stamp()]), /removed/);
    assert.ok(rpc('pp_save_predictions', [mos, { ...pred(), dealerId: 'bob' }, stamp()]), 'admin appoints the dealer');
    assert.equal(rpc('pp_save_predictions', [bob, pred(), '2000-01-01T00:00:00Z']), '', 'stale lock');
  });

  await t.test('dummy: any signed-in account, rev lock, updated_at untouched', () => {
    const newbie = tok('newbie', '1234'), before = stamp();
    assert.deepEqual(rpc('pp_save_dummy', [newbie, { rev: 1, players: ['x'] }, 0]), { rev: 1, players: ['x'] });
    assert.equal(rpc('pp_save_dummy', [newbie, { rev: 1 }, 0]), '', 'stale rev');
    assert.deepEqual(rpc('pp_save_dummy', [newbie, { rev: 2 }, 1]), { rev: 2 });
    assert.equal(stamp(), before);
  });

  await t.test('live: players of the match (or admin); stale entries may be cleared', () => {
    const alice = tok('alice', '4826'), newbie = tok('newbie', '1234'), mos = tok('mos', '2580');
    const m = (pair, by, at = new Date().toISOString()) => ({ key: 's1:r0m0', pair, by, cur: [1, 0], games: [], at });
    assert.ok(rpc('pp_save_live', [alice, { matches: { 's1:r0m0': m(['alice', 'bob'], 'alice') } }, stamp('live')]));
    assert.throws(() => rpc('pp_save_live', [newbie, { matches: {} }, stamp('live')]), /players of a match/);
    assert.throws(() => rpc('pp_save_live', [newbie, { matches: { ...row('live').league.matches, 's1:r0m1': m(['mos', 'gift'], 'mos') } }, stamp('live')]), /players of a match/);
    assert.throws(() => rpc('pp_save_live', [newbie, { other: 1 }, stamp('live')]), /shape/);
    assert.ok(rpc('pp_save_live', [mos, { matches: { 's1:r0m0': m(['alice', 'bob'], 'alice', '2020-01-01T00:00:00Z') } }, stamp('live')]));
    assert.ok(rpc('pp_save_live', [newbie, { matches: { 's1:r0m1': m(['mos', 'newbie'], 'newbie') } }, stamp('live')]), 'stale entry dropped, own match added');
    assert.equal(rpc('pp_save_live', [newbie, { matches: {} }, '2000-01-01T00:00:00Z']), '');
  });

  await t.test('club: own items, own keys', () => {
    const alice = tok('alice', '4826'), bob = tok('bob', '7391', '10.0.0.3'), newbie = tok('newbie', '1234'), mos = tok('mos', '2580');
    const club = () => row('club').league.club || { v: 1, matches: [], challenges: [], tournaments: [], social: { reactions: {}, comments: [] }, mvp: {}, checkin: {} };
    const save = (token, c) => rpc('pp_save_club', [token, c, stamp('club')]);
    let c = club(); c.challenges = [{ id: 'c1', from: 'alice', to: 'bob', format: 'singles', status: 'open', at: 'x' }];
    assert.ok(save(alice, c));
    c = club(); c.challenges.push({ id: 'c2', from: 'bob', to: 'alice', status: 'open' });
    assert.throws(() => save(alice, c), /your own/);
    c = club(); c.challenges[0].status = 'accepted';
    assert.throws(() => save(newbie, c), /own or play in/);
    assert.ok(save(bob, c), 'the challenged player accepts');
    c = club(); c.challenges[0].from = 'bob';
    assert.throws(() => save(bob, c), /owner/);
    c = club(); c.social.reactions['s1:r0m0'] = { alice: '🔥' };
    assert.ok(save(alice, c));
    c = club(); c.social.reactions['s1:r0m0'].alice = '😂';
    assert.throws(() => save(bob, c), /own entry/);
    c = club(); c.social.reactions['s1:r0m0'].bob = '😂'; c.mvp['2026-W42'] = { bob: 'alice' }; c.checkin['2026-10-19'] = { bob: 'x' };
    assert.ok(save(bob, c));
    c = club(); c.mvp['2026-W42'].alice = 'alice'; c.mvp['2026-W42'].bob = 'mos';
    assert.throws(() => save(alice, c), /own entry/);
    c = club(); c.social.comments.push({ id: 'k1', target: 'c:1', by: 'alice', text: 'hi', at: 'x' });
    assert.ok(save(alice, c));
    c = club(); c.social.comments[0].text = 'edited';
    assert.throws(() => save(bob, c), /own or play in/);
    c = club(); c.matches.push({ id: 'm1', kind: 'challenge', format: 'doubles', a: ['alice', 'newbie'], b: ['bob', 'mos'], s: null, by: 'alice' });
    assert.ok(save(alice, c));
    c = club(); c.matches[0].s = { a: 11, b: 3 };
    assert.ok(save(newbie, c), 'a doubles partner records the score');
    c = club(); c.matches = [];
    assert.throws(() => save(tok('gift', '9157'), c), /own or play in/);
    // tournament.js: an entrant records a result (rewrites club.matches[].by) and a reset prunes downstream entries
    c = club(); c.tournaments.push({ id: 't1', name: 'Cup', by: 'mos', entrants: ['alice', 'bob', 'newbie', 'gift'], bracket: {}, status: 'running' });
    c.matches.push({ id: 't1_m1', kind: 'tournament', a: 'alice', b: 'bob', s: { a: 11, b: 2 }, tournamentId: 't1', by: 'mos' },
      { id: 't1_m3', kind: 'tournament', a: 'alice', b: 'gift', s: { a: 11, b: 9 }, tournamentId: 't1', by: 'mos' });
    assert.ok(save(mos, c));
    c = club(); c.tournaments[0].bracket = { r: 1 }; Object.assign(c.matches.find(m => m.id === 't1_m1'), { s: { a: 5, b: 11 }, by: 'bob' });
    c.matches = c.matches.filter(m => m.id !== 't1_m3');
    assert.ok(save(bob, c), 'entrant records, last-recorded-by changes, downstream entry dropped');
    c = club(); c.matches.push({ id: 'x9', kind: 'challenge', a: 'gift', b: 'bob', by: 'bob' });
    assert.throws(() => save(tok('gift', '9157'), c), /your own/);
    c = club(); c.tournaments[0].entrants = ['alice', 'bob']; assert.ok(save(mos, c));
    c = club(); c.matches.find(m => m.id === 't1_m1').s = { a: 0, b: 11 };
    assert.throws(() => save(newbie, c), /own or play in/, 'not an entrant of that tournament');
    // social.js check-in prunes old days of everyone; recent days of others stay protected
    c = club(); c.checkin['2020-01-01'] = { bob: 'x' }; assert.ok(save(mos, c));
    c = club(); delete c.checkin['2020-01-01']; c.checkin[new Date().toISOString().slice(0, 10)] = { alice: 'now' };
    assert.ok(save(alice, c), 'old day pruned');
    c = club(); delete c.checkin['2026-10-19'];
    if (new Date().toISOString().slice(0, 10) < '2026-11-15') assert.throws(() => save(alice, c), /own entry/);
    // own comment removal ok
    c = club(); c.social.comments = c.social.comments.filter(x => x.id !== 'k1'); assert.ok(save(alice, c));
    c = club(); c.matches = []; c.anything = 'admin';
    assert.ok(save(mos, c));
    c = club(); c.blob = 'x'.repeat(1100000);
    assert.throws(() => save(mos, c), /too large/);
  });

  await t.test('enforce off: direct PATCH still works and old-site PIN changes are followed', () => {
    api(`update public.app_state set league = jsonb_set(league, '{uidLeague,profiles,bob,pinHash}', to_jsonb('${pbkdf2('6159')}'::text)), updated_at = now() where id = 'main';`);
    assert.ok(tok('bob', '6159', '10.0.0.4'));
    assert.equal(rpc('pp_login', ['bob', '7391'], '10.0.0.4').error, 'wrong account or PIN');
  });

  await t.test('enforce on: row stripped, direct writes refused, RPCs keep working', () => {
    const alice = tok('alice', '4826');
    q('update private.settings set enforce = true;');
    assert.equal(rpc('pp_auth_version', []).enforce, true);
    const profiles = league().profiles;
    for (const p of Object.values(profiles)) for (const f of ['pin', 'pinHash', 'mustChangePin', 'pinChangedAt']) assert.equal(f in p, false, `${p.id}.${f}`);
    assert.ok(tok('mos', '2580'), 'logins survive the strip');
    assert.ok(rpc('pp_whoami', [alice]).user_id, 'sessions survive the switch');
    assert.throws(() => api(`update public.app_state set league = league where id = 'main';`), /permission denied/);
    assert.throws(() => api(`update public.app_state set league = league where id = 'live';`), /permission denied/);
    assert.ok(api(`select count(*) from public.app_state;`) === '3', 'reads still work');
    const admin = tok('mos', '2580'), l = league();
    l.profiles.mos.pinHash = 'x'; l.profiles.alice.pin = '1234';
    assert.ok(rpc('pp_save_league', [admin, l, stamp()]));
    assert.equal('pinHash' in league().profiles.mos, false, 'credentials never land in the row');
    const x = league(); x.profiles.alice.tagline = 'enforced';
    assert.ok(rpc('pp_save_league', [alice, x, stamp()]));
    // Re-running phase 1 grants UPDATE again; the auth guard still refuses direct writes.
    q(fs.readFileSync(MIGRATIONS[2], 'utf8'));
    assert.throws(() => api(`update public.app_state set league = league where id = 'main';`), /direct writes are disabled/);
    q(fs.readFileSync(MIGRATIONS[5], 'utf8'));
    assert.throws(() => api(`update public.app_state set league = league where id = 'main';`), /permission denied/);
    // Web Push (20261019130000_push.sql + 20261020120000_push_session.sql) does not write app_state and keeps working.
    const ep = 'https://fcm.googleapis.com/fcm/send/abc123';
    rpc('pp_push_subscribe', [alice, ep, 'B'.repeat(87), 'A'.repeat(22)]);
    assert.equal(q(`select user_id from public.push_subscriptions where endpoint = '${ep}';`), 'alice');
    rpc('pp_push_unsubscribe', [ep]);
    assert.equal(q(`select count(*) from public.push_subscriptions;`), '0');
  });

  await t.test('roll back: enforce off restores direct PATCH', () => {
    q('update private.settings set enforce = false;');
    assert.equal(api(`update public.app_state set dummy = '{"rev":9}' where id = 'main' returning dummy ->> 'rev';`), '9');
    assert.ok(tok('mos', '2580'));
  });
});
