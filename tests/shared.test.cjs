const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// respond(name, body) fakes the Supabase RPC endpoint: return { status, data } or plain data (status 200).
function loadShared(respond = () => [{ updated_at: '2026-09-24T00:00:00Z' }], prompts = []) {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const requests = [], alerts = [];
  const context = { localStorage, alert: message => alerts.push(message), prompt: () => prompts.length ? prompts.shift() : null, fetch: async (url, options) => {
    requests.push({ url, options });
    const rpc = url.match(/\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    const result = rpc ? respond(rpc, JSON.parse(options.body)) : [{ updated_at: '2026-09-24T00:00:00Z' }];
    const status = result?.status || 200, data = result?.status ? result.data : result;
    return { ok: status < 300, status, json: async () => data };
  } };
  vm.runInNewContext(fs.readFileSync('shared.js', 'utf8') + '\nglobalThis.shared = LeagueShared;', context);
  return { shared: context.shared, localStorage, requests, alerts, context };
}
const rpcCalls = requests => requests.filter(r => r.url.includes('/rpc/')).map(r => ({ name: r.url.split('/rpc/')[1], body: JSON.parse(r.options.body) }));

const profiles = {
  mos: { id: 'mos', displayName: 'มอส', role: 'admin', active: true },
  gift: { id: 'gift', displayName: 'พี่กิฟท์', role: 'player', active: true },
  alice: { id: 'alice', displayName: 'Alice', role: 'player', active: true },
  bob: { id: 'bob', displayName: 'Bob', role: 'player', active: true },
  eve: { id: 'eve', displayName: 'Eve', role: 'admin', active: false }
};
const league = { profiles };
const match = { id: 'r0m0', season: 2, pair: ['alice', 'bob'], hasResult: false };
const predictions = { dealerId: 'gift', markets: { 's2:r0m0': { open: true } }, bets: [] };

test('Admin can appoint dealer while only the active dealer manages markets', () => {
  const { shared } = loadShared();
  assert.equal(shared.isAdmin(league, 'mos'), true);
  assert.equal(shared.isDealer(league, predictions, 'mos'), false);
  assert.equal(shared.canManageMarket(league, predictions, 'mos'), false);
  assert.equal(shared.canManageMarket(league, predictions, 'gift'), true);
  assert.equal(shared.canManageMarket(league, predictions, 'alice'), false);
  assert.equal(shared.canManageMarket(league, predictions, 'eve'), false);
});

test('Admin can bet when not dealer; dealer, match player, disabled account and duplicate cannot', () => {
  const { shared } = loadShared();
  assert.equal(shared.betEligibility(league, predictions, 'mos', match).allowed, true);
  assert.equal(shared.betEligibility(league, predictions, 'gift', match).allowed, false);
  assert.equal(shared.betEligibility(league, predictions, 'alice', match).allowed, false);
  assert.equal(shared.betEligibility(league, predictions, 'eve', match).allowed, false);
  const duplicate = { ...predictions, bets: [{ season: 2, matchId: match.id, userId: 'mos' }] };
  assert.equal(shared.betEligibility(league, duplicate, 'mos', match).allowed, false);
  assert.equal(shared.betEligibility(league, { ...predictions, markets: {} }, 'mos', match).allowed, false);
  assert.equal(shared.betEligibility(league, predictions, 'mos', { ...match, hasResult: true }).allowed, false);
});

test('Markets and duplicate bets are isolated by season', () => {
  const { shared } = loadShared();
  assert.equal(shared.marketKey(2, 'r0m0'), 's2:r0m0');
  const previousSeason = { ...predictions, markets: { 's1:r0m0': { open: true } } };
  assert.equal(shared.betEligibility(league, previousSeason, 'mos', match).allowed, false);
  const oldBet = { ...predictions, bets: [{ season: 1, matchId: match.id, userId: 'mos' }] };
  assert.equal(shared.betEligibility(league, oldBet, 'mos', match).allowed, true);
});

test('A placed bet keeps its original handicap for settlement', () => {
  const { shared } = loadShared();
  const score = { a: 11, b: 10 };
  const originalTerms = { favoriteId: 'alice', handicap: 0.5 };
  const laterMarket = { favoriteId: 'alice', handicap: 2 };
  assert.equal(shared.predictionOutcome(match.pair, score, originalTerms).winnerId, 'alice');
  assert.equal(shared.predictionOutcome(match.pair, score, laterMarket).winnerId, 'bob');
  assert.equal(shared.predictionOutcome(match.pair, { a: 11, b: 10 }, { favoriteId: 'alice', handicap: 1 }).type, 'push');
  const bet = { season: 2, matchId: match.id, pair: [...match.pair], favoriteId: 'alice', handicap: 0.5, status: 'pending' };
  const scoredMatch = { ...match, score };
  assert.equal(shared.settlementOutcome(2, bet, scoredMatch).winnerId, 'alice');
  assert.equal(shared.settlementOutcome(3, bet, { ...scoredMatch, season: 3 }), null);
  assert.equal(shared.settlementOutcome(2, bet, { ...scoredMatch, pair: ['bob', 'alice'] }), null);
});

const serverLogin = (name, body) => name === 'login'
  ? (body.p_profile_id === 'mos' && body.p_pin === '482913' ? { ok: true, token: 'tok-mos', profile_id: 'mos', must_change: false } : { ok: false })
  : [{ updated_at: '2026-09-24T00:00:00Z' }];

test('PIN is checked by the login RPC and one session token persists across pages', async () => {
  const { shared, localStorage, requests } = loadShared(serverLogin);
  assert.equal((await shared.login('mos', 'wrong')).ok, false);
  assert.equal(localStorage.getItem(shared.SESSION_KEY), null);
  assert.deepEqual(rpcCalls(requests)[0], { name: 'login', body: { p_profile_id: 'mos', p_pin: 'wrong' } });
  assert.equal((await shared.login('mos', '482913')).ok, true);
  assert.equal(localStorage.getItem(shared.SESSION_KEY), 'mos');
  assert.equal(localStorage.getItem(shared.TOKEN_KEY), 'tok-mos');
  assert.equal(shared.sessionUserId(league), 'mos');
  const changed = { profiles: { ...profiles, mos: { ...profiles.mos, active: false } } };
  assert.equal(shared.sessionUserId(changed), '');
  assert.equal(localStorage.getItem(shared.SESSION_KEY), null);
  assert.equal(localStorage.getItem(shared.TOKEN_KEY), null);
});

test('A stored user id without a server token is not a session (old client-side logins are dropped)', () => {
  const { shared, localStorage } = loadShared();
  localStorage.setItem(shared.SESSION_KEY, 'mos');
  assert.equal(shared.sessionUserId(league), '');
  assert.equal(localStorage.getItem(shared.SESSION_KEY), null);
});

test('Server-side lockout is reported to the user', async () => {
  const { shared } = loadShared(() => ({ ok: false, locked: true, retry_after_ms: 42000 }));
  const result = await shared.login('mos', '0000');
  assert.equal(result.ok, false);
  assert.equal(result.locked, true);
  assert.match(result.reason, /42 วินาที/);
});

test('Default or reset PIN must be changed before the session is kept', async () => {
  const mustChange = (name, body) => name === 'login' ? { ok: true, token: 'tok-gift', must_change: true } : name === 'change_pin' ? body.p_new_pin === '905172' : null;
  const cancelled = loadShared(mustChange, [null]);
  assert.equal((await cancelled.shared.login('gift', '1234')).ok, false);
  assert.equal(cancelled.localStorage.getItem(cancelled.shared.TOKEN_KEY), null);
  assert.deepEqual(rpcCalls(cancelled.requests).map(c => c.name), ['login', 'logout']);

  const changed = loadShared(mustChange, ['1234', '905172', '905172']);
  assert.equal((await changed.shared.login('gift', '1234')).ok, true);
  assert.equal(changed.alerts.length, 1, '1234 is rejected client-side before calling the server');
  assert.deepEqual(rpcCalls(changed.requests)[1], { name: 'change_pin', body: { p_token: 'tok-gift', p_old_pin: '1234', p_new_pin: '905172' } });
  assert.equal(changed.shared.sessionUserId(league), 'gift');
});

test('League and prediction writes go through RPCs with the session token and expected updated_at', async () => {
  const { shared, requests } = loadShared(serverLogin);
  await shared.login('mos', '482913');
  const legacy = { profiles: { mos: { ...profiles.mos, pin: '1234' } }, seasonPlayerIds: [], rounds: [], results: {} };
  const rows = await shared.saveLeague(legacy, '2026-09-23T00:00:00.123456+00:00');
  assert.equal(rows[0].updated_at, '2026-09-24T00:00:00Z');
  const save = rpcCalls(requests).find(c => c.name === 'save_league').body;
  assert.equal(save.p_token, 'tok-mos');
  assert.equal(save.p_expected_updated_at, '2026-09-23T00:00:00.123456+00:00');
  assert.equal(save.p_league.profiles.mos.role, 'admin');
  assert.equal('pin' in save.p_league.profiles.mos, false, 'pin is never sent in league JSON');
  assert.equal(legacy.profiles.mos.pin, '1234', 'caller object is not mutated');
  await shared.savePredictions(predictions, '');
  assert.deepEqual(rpcCalls(requests).find(c => c.name === 'save_predictions').body, { p_token: 'tok-mos', p_predictions: predictions, p_expected_updated_at: null });
  assert.equal(requests.some(r => r.options.method === 'PATCH'), false);
});

test('An invalid session from the server clears the local login', async () => {
  const { shared, localStorage } = loadShared((name, body) => name === 'login' ? serverLogin(name, body) : { status: 403, data: { code: '28000', message: 'เซสชันหมดอายุ' } });
  await shared.login('mos', '482913');
  await assert.rejects(shared.saveLeague(league, ''), error => error.code === '28000' && error.message === 'เซสชันหมดอายุ');
  assert.equal(localStorage.getItem(shared.TOKEN_KEY), null);
  assert.equal(shared.sessionUserId(league), '');
});

test('Local league storage strips legacy pin fields', () => {
  const { shared, localStorage } = loadShared();
  shared.saveLocalLeague({ profiles: { mos: { ...profiles.mos, pin: '1234' } }, seasonPlayerIds: [], rounds: [], results: {} });
  assert.equal(localStorage.getItem(shared.LEAGUE_KEY).includes('"pin"'), false);
});

test('Cloud reads keep the same shared endpoint', async () => {
  const { shared, requests } = loadShared();
  await shared.cloudRequest('league,updated_at');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /app_state\?id=eq\.main&select=league,updated_at$/);
  assert.equal(requests[0].options.method, 'GET');
});

test('Migration locks app_state to SELECT and keeps every privileged function pinned', () => {
  const dir = 'supabase/migrations', sql = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => fs.readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
  const last = sql.slice(sql.lastIndexOf('revoke all on table public.app_state'));
  assert.match(last, /grant select on table public\.app_state to anon, authenticated;/);
  assert.doesNotMatch(last, /grant[^;]*(insert|update)[^;]*app_state/i);
  assert.match(sql, /drop policy if exists "shared state can be updated"/);
  const definers = [...sql.matchAll(/create or replace function ([\w.]+)\([^)]*\)[\s\S]*?\$\$/g)].filter(m => /security definer/.test(m[0]));
  assert.ok(definers.length >= 7);
  definers.forEach(m => assert.match(m[0], /set search_path = ''/, `${m[1]} pins search_path`));
  ['login', 'logout', 'change_pin', 'reset_pin', 'save_league', 'save_predictions'].forEach(name => assert.match(sql, new RegExp(`function public\\.${name}\\(`)));
  assert.match(sql, /gen_salt\('bf'/);
  assert.match(sql, /interval '60 seconds'/);
});

test('Section navigation moves through intermediate positions before reaching target', () => {
  const { shared, context } = loadShared();
  const frames = [];
  const viewport = { scrollY: 0, innerHeight: 600, scrollTo(_x, y) { this.scrollY = y; } };
  context.window = viewport;
  context.document = { documentElement: { scrollHeight: 3000 } };
  context.performance = { now: () => 0 };
  context.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  context.cancelAnimationFrame = () => {};
  shared.smoothScrollTo({ getBoundingClientRect: () => ({ top: 1200 }) });
  frames.shift()(100);
  assert.ok(viewport.scrollY > 0 && viewport.scrollY < 1186);
  frames.shift()(700);
  assert.equal(viewport.scrollY, 1186);
});
