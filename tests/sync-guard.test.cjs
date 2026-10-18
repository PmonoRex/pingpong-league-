// sync-guard.js: a league save that fails because the network dropped is retried by itself (found by the e2e
// offline journey: scores typed offline never reached the cloud and the next page load replaced them).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "sync-guard.js"), "utf8");

function page({ online }) {
  const timers = [], listeners = {}, patches = [];
  const league = { profiles: { a: { id: "a", role: "admin", displayName: "A" } }, seasonPlayerIds: [], rounds: [], results: {} };
  let row = { league: { uidLeague: JSON.parse(JSON.stringify(league)) }, updated_at: "t1" };
  const ctx = {
    console: { warn() {}, error() {} }, JSON, Object, Set, Error, TypeError,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}, setInterval() {},
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    LeagueShared: { sessionUserId: () => "a", isAdmin: () => true, keepCredentials: next => next, LOCK_TRIES: 3, lockBackoff: async () => {} },
    net: { online },
    cloudRequest: async (method = "GET", body = null) => {
      if (!ctx.net.online) throw new TypeError("Failed to fetch");
      if (method === "PATCH") { patches.push(body); row = { league: body.league, updated_at: `t${patches.length + 1}` }; return [row]; }
      return [row];
    },
    setSync: (text) => { ctx.status = text; }, saveLocal() {}, reconcileSession() {}, renderLogin() {}, render() {}
  };
  vm.createContext(ctx);
  vm.runInContext(`var state=${JSON.stringify(league)},cloudReady=true,cloudSaving=false,dirty=false,changeVersion=0,saveTimer=null,lastCloudUpdate="t1";
    function pullCloud(){} function pushCloud(){}`, ctx);
  vm.runInContext(source, ctx);
  return { ctx, timers, listeners, patches };
}

test("a save that fails offline is retried once the network is back", async () => {
  const { ctx, timers, patches } = page({ online: false });
  vm.runInContext(`state.results.r0m0={a:11,b:5};dirty=true;changeVersion++`, ctx);
  await vm.runInContext("pushCloud()", ctx);
  assert.match(ctx.status, /ออฟไลน์/);
  const retry = timers.find(t => t.ms >= 1000);
  assert.ok(retry, "a retry is scheduled after a network failure");
  ctx.net.online = true;
  await retry.fn();
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].league.uidLeague.results.r0m0, { a: 11, b: 5 });
  assert.equal(vm.runInContext("dirty", ctx), false);
});

test("the online event sends kept scores at once", async () => {
  const { ctx, listeners, patches } = page({ online: false });
  vm.runInContext(`state.results.r0m1={a:3,b:11};dirty=true;changeVersion++`, ctx);
  await vm.runInContext("pushCloud()", ctx);
  ctx.net.online = true;
  assert.ok(listeners.online?.length, "listens for online");
  await listeners.online[0]();
  await new Promise(r => setImmediate(r));
  assert.equal(patches.length, 1);
});
