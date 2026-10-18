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
  return { shared: context.shared, localStorage, requests, context };
}

const profiles = {
  mos: { id: 'mos', displayName: 'มอส', pin: '1234', role: 'admin', active: true },
  gift: { id: 'gift', displayName: 'พี่กิฟท์', pin: '1234', role: 'player', active: true },
  alice: { id: 'alice', displayName: 'Alice', pin: '1234', role: 'player', active: true },
  bob: { id: 'bob', displayName: 'Bob', pin: '1234', role: 'player', active: true },
  eve: { id: 'eve', displayName: 'Eve', pin: '1234', role: 'admin', active: false }
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

test('Next up picks the first unplayed matches round by round', () => {
  const { shared } = loadShared();
  const rounds = [{ rest: 'c', m: [['a', 'b'], ['d', 'e']] }, { rest: 'a', m: [['b', 'c'], ['e', 'd']] }];
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(shared.nextUpMatches(rounds, {})).map(x => x.id), ['r0m0', 'r0m1']);
  const results = { r0m0: { a: 11, b: 5 }, r0m1: { a: 3, b: null }, r1m0: { a: 0, b: 0 } };
  assert.deepEqual(plain(shared.nextUpMatches(rounds, results)), [
    { id: 'r0m1', round: 1, pair: ['d', 'e'], rest: 'c' },
    { id: 'r1m1', round: 2, pair: ['e', 'd'], rest: 'a' }
  ]);
  assert.deepEqual(plain(shared.nextUpMatches(rounds, results, 1)).map(x => x.id), ['r0m1']);
});

test('Next up is empty once every match has a result, and tolerates missing data', () => {
  const { shared } = loadShared();
  const rounds = [{ rest: null, m: [['a', 'b']] }];
  assert.equal(shared.nextUpMatches(rounds, { r0m0: { a: 11, b: 9 } }).length, 0);
  assert.equal(shared.nextUpMatches(undefined, undefined).length, 0);
  assert.equal(shared.nextUpMatches([{ rest: 'x' }, null], {}).length, 0);
  assert.equal(shared.nextUpMatches(rounds, { r0m0: { a: -1, b: 2 } }).length, 1);
});

test('media URLs: only plain files in the public media bucket are accepted as pictures', () => {
  const { shared } = loadShared();
  const base = shared.MEDIA_BASE;
  assert.match(base, /\/storage\/v1\/object\/public\/media\/$/);
  assert.ok(shared.mediaUrlOk(base + 'banners/u0-1760000000000.webp'));
  for (const bad of [base + 'banners/../x.webp', base + 'x.webp', 'https://evil.example/storage/v1/object/public/media/banners/a.webp', base + 'banners/a b.webp', base + 'banners/a.webp"),url(x', 42, ''])
    assert.ok(!shared.mediaUrlOk(bad), String(bad));
});

test('uploadMedia posts the file to the media bucket and returns its public URL', async () => {
  const { shared, requests } = loadShared();
  const url = await shared.uploadMedia('banners/u0-1.webp', { type: 'image/webp' });
  assert.equal(url, shared.MEDIA_BASE + 'banners/u0-1.webp');
  assert.match(requests[0].url, /\/storage\/v1\/object\/media\/banners\/u0-1\.webp$/);
  assert.equal(requests[0].options.method, 'POST');
});
