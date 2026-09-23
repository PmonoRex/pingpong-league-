const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadShared() {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const requests = [];
  const context = { localStorage, fetch: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => [{ updated_at: '2026-09-24T00:00:00Z' }] };
  } };
  vm.runInNewContext(fs.readFileSync('shared.js', 'utf8') + '\nglobalThis.shared = LeagueShared;', context);
  return { shared: context.shared, localStorage, requests };
}

const profiles = {
  mos: { id: 'mos', displayName: 'มอส', pin: '1234', role: 'admin', active: true },
  gift: { id: 'gift', displayName: 'พี่กิฟท์', pin: '1234', role: 'player', active: true },
  alice: { id: 'alice', displayName: 'Alice', pin: '1234', role: 'player', active: true },
  bob: { id: 'bob', displayName: 'Bob', pin: '1234', role: 'player', active: true },
  eve: { id: 'eve', displayName: 'Eve', pin: '1234', role: 'admin', active: false }
};
const league = { profiles };
const match = { id: 'r0m0', pair: ['alice', 'bob'], hasResult: false };
const predictions = { dealerId: 'gift', markets: { r0m0: { open: true } }, bets: [] };

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
  const duplicate = { ...predictions, bets: [{ matchId: match.id, userId: 'mos' }] };
  assert.equal(shared.betEligibility(league, duplicate, 'mos', match).allowed, false);
  assert.equal(shared.betEligibility(league, { ...predictions, markets: {} }, 'mos', match).allowed, false);
  assert.equal(shared.betEligibility(league, predictions, 'mos', { ...match, hasResult: true }).allowed, false);
});

test('One login persists across pages and a deactivated account loses its session', () => {
  const { shared, localStorage } = loadShared();
  assert.equal(shared.login(league, 'mos', 'wrong'), false);
  assert.equal(shared.login(league, 'eve', '1234'), false);
  assert.equal(shared.login(league, 'mos', '1234'), true);
  assert.equal(localStorage.getItem(shared.SESSION_KEY), 'mos');
  assert.equal(shared.sessionUserId(league), 'mos');
  const changed = { profiles: { ...profiles, mos: { ...profiles.mos, active: false } } };
  assert.equal(shared.sessionUserId(changed), '');
  assert.equal(localStorage.getItem(shared.SESSION_KEY), null);
});

test('Cloud request keeps the same shared endpoint and JSON payload', async () => {
  const { shared, requests } = loadShared();
  await shared.cloudRequest('league,updated_at', 'PATCH', { league: { uidLeague: league } });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /app_state\?id=eq\.main&select=league,updated_at$/);
  assert.equal(requests[0].options.method, 'PATCH');
  assert.equal(JSON.parse(requests[0].options.body).league.uidLeague.profiles.mos.role, 'admin');
});
