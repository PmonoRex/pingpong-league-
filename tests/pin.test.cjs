const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Loads shared.js against an in-memory localStorage and a fake Supabase row that records PATCHes.
function loadShared(row, { beforePatch = () => {} } = {}) {
  const values = new Map();
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
  const requests = [];
  const fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === 'PATCH') {
      beforePatch(row);
      const expected = /updated_at=eq\.([^&]+)/.exec(url)?.[1];
      if (expected && decodeURIComponent(expected) !== row.updated_at) return { ok: true, json: async () => [] };
      Object.assign(row, JSON.parse(options.body));
    }
    return { ok: true, json: async () => [JSON.parse(JSON.stringify(row))] };
  };
  const context = { localStorage, fetch, crypto: globalThis.crypto, TextEncoder };
  vm.runInNewContext(fs.readFileSync('shared.js', 'utf8') + '\nglobalThis.shared = LeagueShared;', context);
  return { shared: context.shared, localStorage, requests };
}
const freshRow = () => ({
  updated_at: '2026-10-17T00:00:00.000Z',
  league: { other: 'kept', uidLeague: { profiles: {
    mos: { id: 'mos', displayName: 'มอส', pin: '1234', role: 'admin', active: true },
    gift: { id: 'gift', displayName: 'กิฟท์', pin: '1234', role: 'player', active: true },
    off: { id: 'off', displayName: 'ปิด', pin: '1234', role: 'player', active: false }
  }, seasonPlayerIds: [], rounds: [], results: {} } }
});

test('PIN policy rejects the default, repeated digits, sequences and non-digits', () => {
  const { shared } = loadShared(freshRow());
  for (const bad of ['1234', '0000', '111111', '123456', '9876', '7890', '12', '1234567', '12a4', '', null]) assert.notEqual(shared.pinPolicyError(bad), '', String(bad));
  for (const good of ['2580', '4719', '135790', '0815']) assert.equal(shared.pinPolicyError(good), '', good);
});

test('Hashed PIN uses a random salt and verifies only the right PIN', async () => {
  const { shared } = loadShared(freshRow());
  const a = await shared.hashPin('2580'), b = await shared.hashPin('2580');
  assert.match(a, /^pbkdf2-sha256\$150000\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(await shared.verifyPin({ pinHash: a }, '2580'), true);
  assert.equal(await shared.verifyPin({ pinHash: a }, '2581'), false);
  assert.equal(await shared.verifyPin({ pinHash: a }, ''), false);
  assert.equal(await shared.verifyPin({ pin: '1234' }, '1234'), true);
  assert.equal(await shared.verifyPin(null, '1234'), false);
});

test('A tampered hash with a huge iteration count or bad salt is refused without hashing', async () => {
  const { shared } = loadShared(freshRow());
  const [, , salt, hash] = (await shared.hashPin('2580')).split('$');
  assert.equal(await shared.verifyPin({ pinHash: `pbkdf2-sha256$900000000$${salt}$${hash}` }, '2580'), false);
  assert.equal(await shared.verifyPin({ pinHash: `pbkdf2-sha256$150000$zz$${hash}` }, '2580'), false);
  assert.equal(await shared.verifyPin({ pinHash: 'plain-2580' }, '2580'), false);
});

test('setPin stores only a hash; resetPin goes back to the public default and forces a change', async () => {
  const { shared } = loadShared(freshRow());
  const person = { id: 'x', pin: '1234', mustChangePin: true };
  assert.equal(shared.needsPinChange(person), true);
  await shared.setPin(person, '2580');
  assert.equal('pin' in person, false);
  assert.equal(person.mustChangePin, undefined);
  assert.equal(JSON.stringify(person).includes('2580'), false);
  assert.equal(shared.needsPinChange(person), false);
  await assert.rejects(shared.setPin(person, '1234'), /1234/);
  shared.resetPin(person);
  assert.equal(person.pin, '1234');
  assert.equal(person.pinHash, undefined);
  assert.equal(shared.needsPinChange(person), true);
});

test('Login works with a hashed PIN, never stores the PIN, and locks after 5 failures', async () => {
  const row = freshRow(), { shared, localStorage } = loadShared(row);
  const league = row.league.uidLeague;
  await shared.setPin(league.profiles.gift, '2580');
  assert.equal(await shared.login(league, 'gift', '1234'), false);
  assert.equal(await shared.login(league, 'gift', '2580'), true);
  assert.equal(localStorage.getItem(shared.SESSION_KEY), 'gift');
  for (const [key, value] of [[shared.SESSION_KEY, localStorage.getItem(shared.SESSION_KEY)], ['pp_login_guard_v1', localStorage.getItem('pp_login_guard_v1')]]) assert.equal(String(value).includes('2580'), false, key);
  for (let i = 0; i < 5; i++) assert.equal(await shared.login(league, 'gift', '0000'), false);
  assert.equal(shared.loginGuardStatus('gift').locked, true);
  assert.equal(await shared.login(league, 'gift', '2580'), false);
  assert.equal(await shared.login(league, 'off', '1234'), false);
});

test('changePin checks the current PIN against the cloud and writes only that account with the optimistic lock', async () => {
  const row = freshRow(), { shared, requests } = loadShared(row);
  await assert.rejects(shared.changePin('gift', '9999', '2580'), error => error.pinInput && error.wrongCurrent);
  await assert.rejects(shared.changePin('gift', '1234', '1234'), error => error.pinInput && !error.wrongCurrent);
  await assert.rejects(shared.changePin('gift', '1234', '1111'), error => error.pinInput);
  await assert.rejects(shared.changePin('off', '1234', '2580'), /ปิดใช้งาน/);
  assert.equal(requests.filter(r => r.options.method === 'PATCH').length, 0);
  const latest = await shared.changePin('gift', '1234', '2580');
  const patch = requests.find(r => r.options.method === 'PATCH');
  assert.match(patch.url, /updated_at=eq\.2026-10-17T00%3A00%3A00\.000Z/);
  const saved = row.league.uidLeague;
  assert.equal(row.league.other, 'kept');
  assert.equal(saved.profiles.gift.pin, undefined);
  assert.equal(await shared.verifyPin(saved.profiles.gift, '2580'), true);
  assert.equal(saved.profiles.mos.pin, '1234');
  assert.equal(saved.auditLog[0].action, 'pin_change');
  assert.equal(patch.options.body.includes('2580'), false);
  assert.equal(latest.profiles.gift.pinHash, saved.profiles.gift.pinHash);
});

test('changePin fails cleanly when another device saved first', async () => {
  const row = freshRow();
  const { shared } = loadShared(row, { beforePatch: r => { r.updated_at = '2026-10-17T00:00:05.000Z'; } });
  const before = JSON.stringify(row.league);
  await assert.rejects(shared.changePin('gift', '1234', '2580'), error => /อีกเครื่อง/.test(error.message) && !error.pinInput);
  assert.equal(JSON.stringify(row.league), before);
});

test('keepCredentials stops a backup restore from rolling PINs back', async () => {
  const { shared } = loadShared(freshRow());
  const remote = freshRow().league.uidLeague;
  await shared.setPin(remote.profiles.gift, '2580');
  shared.resetPin(remote.profiles.mos);
  const backup = freshRow().league.uidLeague;
  backup.profiles.gift.displayName = 'กิฟท์ (เก่า)';
  backup.profiles.old = { id: 'old', displayName: 'คนเก่า', pin: '1234', role: 'player', active: true };
  shared.keepCredentials(backup, remote);
  assert.equal(backup.profiles.gift.pinHash, remote.profiles.gift.pinHash);
  assert.equal('pin' in backup.profiles.gift, false);
  assert.equal(backup.profiles.gift.displayName, 'กิฟท์ (เก่า)');
  assert.equal(backup.profiles.mos.mustChangePin, true);
  assert.equal(backup.profiles.old.pin, '1234');
});
