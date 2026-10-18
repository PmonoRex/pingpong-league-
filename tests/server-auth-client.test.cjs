// Client routing for phase 2 (shared.js): with the pp_* functions present every write becomes the matching RPC with the
// session token and keeps the old optimistic-lock contract ([] on conflict); without them nothing changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const plain = value => JSON.parse(JSON.stringify(value));
const pbkdf2 = (pin, iterations = 10000) => {
  const salt = crypto.randomBytes(16);
  return `pbkdf2-sha256$${iterations}$${salt.toString('hex')}$${crypto.pbkdf2Sync(pin, salt, iterations, 32, 'sha256').toString('hex')}`;
};

// A fake Supabase: the three app_state rows plus, when rpc = true, the phase 2 functions with a tiny model of their rules.
function setup({ rpc = true, pinChange = null } = {}) {
  const values = new Map();
  const localStorage = { getItem: k => values.has(k) ? values.get(k) : null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const rows = {
    main: { league: { uidLeague: { profiles: {
      mos: { id: 'mos', displayName: 'มอส', role: 'admin', active: true, pinHash: pbkdf2('2580') },
      gift: { id: 'gift', displayName: 'กิฟท์', role: 'player', active: true, pin: '1234', mustChangePin: true }
    }, seasonPlayerIds: [], rounds: [], results: {} } }, predictions: { uidPredictions: { bets: [] } }, dummy: { rev: 4 }, updated_at: 't1' },
    live: { league: { matches: {} }, updated_at: 'l1' },
    club: { league: { club: { v: 1, matches: [] } }, updated_at: 'c1' }
  };
  const server = { pins: { mos: '2580', gift: '1234' }, sessions: new Map(), calls: [], patches: [], conflictOnce: new Set(), deny: false, fail: null };
  let seq = 0;
  const reply = (status, body) => ({ ok: status < 300, status, text: async () => body === undefined ? '' : JSON.stringify(body), json: async () => body });
  const fetch = async (url, options = {}) => {
    const u = String(url);
    const rpcName = /\/rpc\/(\w+)$/.exec(u)?.[1];
    if (rpcName) {
      const args = JSON.parse(options.body || '{}');
      server.calls.push({ name: rpcName, args });
      if (!rpc) return reply(404, { code: 'PGRST202', message: 'Could not find the function' });
      if (server.fail === rpcName) throw new TypeError('Failed to fetch');
      const who = () => server.sessions.get(args.p_token);
      const needSession = () => { if (!who()) return reply(403, { code: '28000', message: 'session expired' }); };
      const stampOf = id => `${id}-${++seq}`;
      const lock = (id, apply) => {
        const bad = needSession(); if (bad) return bad;
        if (server.deny) return reply(401, { code: '42501', message: 'players can only edit their own profile' });
        if (server.conflictOnce.delete(rpcName) || (args.p_expected && args.p_expected !== rows[id].updated_at)) return reply(200, null);
        apply(); rows[id].updated_at = stampOf(id); return reply(200, rows[id].updated_at);
      };
      switch (rpcName) {
        case 'pp_auth_version': return reply(200, { version: 1, enforce: false });
        case 'pp_login': {
          if (server.pins[args.p_user_id] !== args.p_pin) return reply(200, args.p_pin === 'locked' ? { error: 'locked', retry_after_seconds: 120 } : { error: 'wrong account or PIN' });
          const token = `tok${++seq}`; server.sessions.set(token, args.p_user_id);
          return reply(200, { token, user_id: args.p_user_id, must_change: args.p_user_id === 'gift', expires_at: '2099-01-01T00:00:00Z' });
        }
        case 'pp_logout': server.sessions.delete(args.p_token); return reply(204);
        case 'pp_change_pin': {
          const bad = needSession(); if (bad) return bad;
          if (server.pins[who()] !== args.p_current_pin) return reply(200, { error: 'wrong current PIN' });
          server.pins[who()] = args.p_new_pin; return reply(200, { ok: true });
        }
        case 'pp_save_league': return lock('main', () => { rows.main.league.uidLeague = args.p_league; });
        case 'pp_save_predictions': return lock('main', () => { rows.main.predictions.uidPredictions = args.p_predictions; });
        case 'pp_save_live': return lock('live', () => { rows.live.league = args.p_live; });
        case 'pp_save_club': return lock('club', () => { rows.club.league = { ...rows.club.league, club: args.p_club }; });
        case 'pp_save_dummy': {
          const bad = needSession(); if (bad) return bad;
          if (String(rows.main.dummy.rev ?? 0) !== String(args.p_expected_rev)) return reply(200, null);
          rows.main.dummy = args.p_dummy; return reply(200, args.p_dummy);
        }
      }
      return reply(404, { code: 'PGRST202' });
    }
    const id = /id=eq\.(\w+)/.exec(u)[1];
    if (options.method === 'PATCH') {
      server.patches.push({ id, url: u, body: JSON.parse(options.body) });
      const expected = /updated_at=eq\.([^&]+)/.exec(u)?.[1];
      if (expected && decodeURIComponent(expected) !== rows[id].updated_at) return reply(200, []);
      Object.assign(rows[id], JSON.parse(options.body));
    }
    return reply(200, [plain(rows[id])]);
  };
  const context = { localStorage, fetch, crypto: globalThis.crypto, TextEncoder, setTimeout: fn => setTimeout(fn, 0), structuredClone };
  if (pinChange) context.PinChange = pinChange;
  vm.runInNewContext(fs.readFileSync('shared.js', 'utf8') + '\nglobalThis.shared = LeagueShared;', context);
  return { shared: context.shared, localStorage, rows, server, context };
}
const leagueOf = rows => rows.main.league.uidLeague;
const savePatch = (shared, rows, change) => {
  const league = plain(leagueOf(rows)); change(league);
  return shared.cloudRequest('league,updated_at', 'PATCH', { league: { ...rows.main.league, uidLeague: league }, updated_at: 'now' }, `updated_at=eq.${encodeURIComponent(rows.main.updated_at)}`);
};

test('without the phase 2 functions everything stays a direct PATCH, probed once', async () => {
  const { shared, rows, server, localStorage } = setup({ rpc: false });
  assert.equal(await shared.login(leagueOf(rows), 'mos', '2580'), true);
  assert.equal(localStorage.getItem(shared.TOKEN_KEY), null);
  const saved = await savePatch(shared, rows, l => { l.results.r0m0 = { a: 11, b: 4 }; });
  assert.equal(saved.length, 1);
  assert.equal(server.patches.length, 1);
  assert.equal(plain(await shared.saveDummyCloud({ rev: 5 }, 4)).rev, 5);
  assert.equal(server.patches.length, 2);
  assert.equal(server.calls.filter(c => c.name === 'pp_auth_version').length, 1, 'cached');
  assert.equal((await shared.serverAuth()).available, false);
  assert.equal(shared.needsPinChange(leagueOf(rows).profiles.gift), true, 'old rule from the row');
});

test('login goes through pp_login and keeps only the token; server lockout shows locally', async () => {
  const { shared, rows, server, localStorage } = setup();
  assert.equal(await shared.login(leagueOf(rows), 'mos', '0000'), false);
  assert.equal(await shared.login(leagueOf(rows), 'mos', 'locked'), false);
  assert.equal(shared.loginGuardStatus('mos').locked, true);
  localStorage.removeItem('pp_login_guard_v1');
  assert.equal(await shared.login(leagueOf(rows), 'mos', '2580'), true);
  assert.equal(localStorage.getItem(shared.SESSION_KEY), 'mos');
  const session = JSON.parse(localStorage.getItem(shared.TOKEN_KEY));
  assert.equal(session.userId, 'mos'); assert.match(session.token, /^tok/);
  assert.equal(JSON.stringify([...server.calls.map(c => c.args)]).includes('2580'), true, 'PIN only sent to pp_login');
  assert.equal(localStorage.getItem(shared.TOKEN_KEY).includes('2580'), false);
  assert.equal(shared.hasServerSession(), true);
  shared.logout();
  await new Promise(r => setTimeout(r, 5));
  assert.equal(localStorage.getItem(shared.TOKEN_KEY), null);
  assert.equal(server.calls.at(-1).name, 'pp_logout');
});

test('a server that cannot be reached falls back to the in-browser PIN check', async () => {
  const { shared, rows, server, localStorage } = setup();
  server.fail = 'pp_login';
  assert.equal(await shared.login(leagueOf(rows), 'mos', '2580'), true);
  assert.equal(localStorage.getItem(shared.TOKEN_KEY), null, 'local session only');
});

test('league, predictions, dummy, live and club saves become RPCs with the same lock contract', async () => {
  const { shared, rows, server } = setup();
  await shared.login(leagueOf(rows), 'mos', '2580');
  const before = rows.main.updated_at;
  const saved = await savePatch(shared, rows, l => { l.results.r0m0 = { a: 11, b: 4 }; });
  assert.equal(server.patches.length, 0);
  const call = server.calls.find(c => c.name === 'pp_save_league');
  assert.equal(call.args.p_expected, before);
  assert.match(call.args.p_token, /^tok/);
  assert.equal('pinHash' in call.args.p_league.profiles.mos, false, 'secrets never sent');
  assert.equal('pin' in call.args.p_league.profiles.gift, false);
  assert.equal(saved[0].updated_at, rows.main.updated_at);
  // conflict -> [] (callers retry)
  server.conflictOnce.add('pp_save_league');
  assert.deepEqual(plain(await savePatch(shared, rows, l => { l.results.r0m1 = { a: 1, b: 11 }; })), []);
  // predictions
  const p = await shared.cloudRequest('league,predictions,updated_at', 'PATCH', { predictions: { uidPredictions: { bets: [{ id: 1 }] } }, updated_at: 'x' }, `updated_at=eq.${encodeURIComponent(rows.main.updated_at)}`);
  assert.equal(p.length, 1); assert.equal(rows.main.predictions.uidPredictions.bets.length, 1);
  // dummy (rev lock)
  assert.equal(plain(await shared.saveDummyCloud({ rev: 5 }, 4)).rev, 5);
  assert.equal(await shared.saveDummyCloud({ rev: 5 }, 4), null);
  assert.equal(server.calls.filter(c => c.name === 'pp_save_dummy')[0].args.p_expected_rev, 4);
  // live
  const live = await shared.liveRequest('PATCH', { league: { matches: { k: { pair: ['mos', 'gift'] } } }, updated_at: 'x' }, `updated_at=eq.${rows.live.updated_at}`);
  assert.equal(live[0].updated_at, rows.live.updated_at); assert.ok(rows.live.league.matches.k);
  // club, with a lost race in between
  server.conflictOnce.add('pp_save_club');
  const club = await shared.clubMutate(c => { c.matches.push({ id: 'm1', by: 'mos' }); });
  assert.deepEqual(plain(club.matches.map(m => m.id)), ['m1']);
  assert.equal(server.calls.filter(c => c.name === 'pp_save_club').length, 2);
  assert.equal(server.patches.length, 0, 'no direct PATCH at all');
});

test('expired session asks for the PIN again and retries; cancelling fails the save cleanly', async () => {
  let asked = 0, answer = '2580', setupResult;
  const pinChange = { relogin: async ({ userId }) => { asked++; if (!answer) return false; return (await setupResult.shared.serverLogin(userId, answer)).ok; } };
  setupResult = setup({ pinChange });
  const { shared, rows, server } = setupResult;
  await shared.login(leagueOf(rows), 'mos', '2580');
  server.sessions.clear();
  const saved = await savePatch(shared, rows, l => { l.results.r0m0 = { a: 2, b: 11 }; });
  assert.equal(saved.length, 1); assert.equal(asked, 1);
  server.sessions.clear(); answer = '';
  await assert.rejects(savePatch(shared, rows, l => { l.results.r0m0 = { a: 3, b: 11 }; }), e => e.authRequired === true);
  assert.equal(asked, 2);
});

test('an old pp_user_id session without a token cannot save silently; refused writes say so', async () => {
  const { shared, rows, server, localStorage } = setup();
  localStorage.setItem(shared.SESSION_KEY, 'mos');
  await assert.rejects(savePatch(shared, rows, l => { l.results.r0m0 = { a: 1, b: 11 }; }), e => e.authRequired === true);
  await shared.login(leagueOf(rows), 'mos', '2580');
  server.deny = true;
  await assert.rejects(savePatch(shared, rows, l => { l.results.r0m0 = { a: 1, b: 11 }; }), e => e.denied && /ไม่มีสิทธิ์/.test(e.message));
  assert.equal(server.patches.length, 0);
});

test('functions removed (rollback) while cached: the save falls back to the direct PATCH', async () => {
  const s = setup();
  await s.shared.login(leagueOf(s.rows), 'mos', '2580');
  const fetch = s.context.fetch;
  s.context.fetch = async (url, options) => /\/rpc\//.test(url) ? { ok: false, status: 404, text: async () => '{"code":"PGRST202"}' } : fetch(url, options);
  const saved = await savePatch(s.shared, s.rows, l => { l.results.r0m0 = { a: 11, b: 0 }; });
  assert.equal(saved.length, 1); assert.equal(s.server.patches.length, 1);
  assert.equal((await s.shared.serverAuth()).available, false);
});

test('changePin and the forced first change use the server; resetPin marks the reset', async () => {
  const { shared, rows, server, localStorage } = setup();
  assert.equal(await shared.login(leagueOf(rows), 'gift', '1234'), true);
  const gift = leagueOf(rows).profiles.gift;
  assert.equal(shared.needsPinChange(gift), true, 'server must_change');
  assert.equal(shared.needsPinChange(leagueOf(rows).profiles.mos), false, 'not this browser\'s account');
  await assert.rejects(shared.changePin('gift', '9999', '2580'), e => e.pinInput && e.wrongCurrent);
  await assert.rejects(shared.changePin('gift', '1234', '1111'), e => e.pinInput);
  const before = JSON.stringify(rows.main.league);
  await shared.changePin('gift', '1234', '2580');
  assert.equal(server.pins.gift, '2580');
  assert.equal(JSON.stringify(rows.main.league), before, 'the row is not touched');
  assert.equal(shared.needsPinChange(gift), false);
  // no session for the account yet: signs in with the current PIN first
  localStorage.removeItem(shared.TOKEN_KEY);
  await shared.changePin('gift', '2580', '3691');
  assert.equal(server.pins.gift, '3691');
  const person = { id: 'x', pinHash: 'h' };
  shared.resetPin(person);
  assert.equal(person.pin, '1234'); assert.ok(person.pinResetAt);
  // keepCredentials carries pinResetAt from the cloud, so a restore never re-triggers a reset
  const next = { profiles: { x: { id: 'x', pinResetAt: 'old' } } };
  shared.keepCredentials(next, { profiles: { x: person } });
  assert.equal(next.profiles.x.pinResetAt, person.pinResetAt);
});

test('a stripped row (after enforce) never forces a PIN change without a server flag', () => {
  const { shared } = setup({ rpc: false });
  assert.equal(shared.needsPinChange({ id: 'a', displayName: 'A' }), false);
  assert.equal(shared.needsPinChange({ id: 'a', pin: '1234' }), true);
});
