// Fixtures: a league "mid-season" built directly in the fake backend (players with their own PINs, a schedule, some
// results), and phones already signed in as a player, so each journey starts where it needs to without replaying the
// whole season through the UI. Journeys 1 and 2 do the real first-login and season-setup flows.
import crypto from "node:crypto";
import { FakeSupabase, seedLeague } from "./fake-supabase.mjs";
import { BASE, phone } from "./lib.mjs";

export const PINS = { u_admin: "2580", u_gift: "1357", u_golf: "8642", u_dragon: "9753", u_fern: "4826", u_pruek: "3971" };
export const NAMES = { u_admin: "มอส", u_gift: "กิฟท์", u_golf: "กอล์ฟ", u_dragon: "มังกร", u_fern: "เฟิร์น", u_pruek: "พฤษ" };

// Same circle method as index.js makeRoundRobin, without the shuffle (so journeys know who plays whom).
export function roundRobin(ids) {
  const a = [...ids]; if (a.length % 2) a.push(null);
  const out = [], size = a.length;
  for (let r = 0; r < size - 1; r++) {
    let rest = null; const m = [];
    for (let i = 0; i < size / 2; i++) { const x = a[i], y = a[size - 1 - i]; if (x && y) m.push(r % 2 ? [y, x] : [x, y]); else rest = x || y; }
    out.push({ rest, m }); a.splice(1, 0, a.pop());
  }
  return out;
}
const pbkdf2 = pin => { const salt = crypto.randomBytes(16); return `pbkdf2-sha256$10000$${salt.toString("hex")}$${crypto.pbkdf2Sync(pin, salt, 10000, 32, "sha256").toString("hex")}`; };

// A league where everyone already chose their own PIN. seasonPlayers: ids in this season (default: first 4).
export function makeWorld({ rpc = true, season = ["u_admin", "u_gift", "u_golf", "u_dragon"], results = {}, predictions = null, club } = {}) {
  const { ids, ...league } = seedLeague();
  Object.values(league.profiles).forEach(p => { delete p.pin; delete p.mustChangePin; p.pinHash = pbkdf2(PINS[p.id]); p.pinChangedAt = "2026-10-02T00:00:00.000Z"; });
  league.seasonPlayerIds = season;
  league.rounds = season.length >= 2 ? roundRobin(season) : [];
  league.results = results;
  const fake = new FakeSupabase({ rpc, league, predictions: predictions || { dealerId: null, markets: {}, bets: [], nextBetId: 1 }, club });
  Object.entries(PINS).forEach(([id, pin]) => fake.creds.set(id, { pin, mustChange: false, fails: 0, lockedUntil: 0 }));
  return fake;
}

// A phone already signed in as userId (as if they logged in earlier: pp_user_id plus, with RPCs, a server session).
export async function signedPhone(browser, fake, userId, label = NAMES[userId] || userId, opts) {
  const p = await phone(browser, fake, label, opts);
  const seed = await p.context.newPage();
  await seed.goto(`${BASE}/icons/icon.svg`);
  const session = fake.rpcEnabled ? fake.newToken(userId) : null;
  // A signed-in phone always has the league copy too (sessionUserId drops an id the local league does not know).
  await seed.evaluate(([id, s, league]) => {
    localStorage.setItem("pp_league_v7_uid", JSON.stringify(league));
    localStorage.setItem("pp_user_id", id);
    if (s) localStorage.setItem("pp_session_v2", JSON.stringify({ token: s.token, userId: id, mustChange: false, expiresAt: new Date(s.expiresAt).toISOString() }));
    localStorage.setItem("pp_install_offer", "1");
  }, [userId, session, fake.league]);
  await seed.close();
  p.userId = userId;
  return p;
}
