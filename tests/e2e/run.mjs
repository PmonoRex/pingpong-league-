#!/usr/bin/env node
// End-to-end journeys against a stateful fake Supabase (tests/e2e/fake-supabase.mjs). Not part of `npm test`.
//   npm run e2e                      # every journey, RPC (server auth) pass then legacy direct-PATCH pass
//   npm run e2e -- --mode rpc        # one pass only (rpc | legacy | both)
//   npm run e2e -- --only j2,j6      # journeys whose name starts with any of these
//   E2E_SHOTS=/tmp/shots npm run e2e # where screenshots go (default tests/e2e/.shots, git-ignored)
import * as L from "./lib.mjs";
import { journeys } from "./journeys.mjs";

const args = process.argv.slice(2), opt = name => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : null; };
const mode = opt("mode") || "both", only = (opt("only") || "").split(",").filter(Boolean);
const modes = mode === "both" ? ["rpc", "legacy"] : [mode];
const pick = Object.entries(journeys).filter(([name]) => !only.length || only.some(o => name.startsWith(o)));

const server = await L.startServer();
const browser = await L.launch();
const summary = [];
for (const m of modes) {
  for (const [name, run] of pick) {
    const phones = [], bugs = [], fakes = [];
    const ctx = {
      browser, rpc: m === "rpc", tag: m, name,
      useFake(f) { fakes.push(f); return f; },
      track(p) { phones.push(p); return p; },
      async phone(fake, label, o) { return ctx.track(await L.phone(browser, fake, label, o)); },
      bug(msg) { bugs.push(msg); console.log(`   BUG ${msg}`); },
      check(cond, msg) { if (!cond) ctx.bug(`expected: ${msg}`); return cond; }
    };
    const started = Date.now();
    process.stdout.write(`[${m}] ${name} … `);
    let error = null;
    try { await run(ctx); } catch (e) { error = e; }
    for (const p of phones) { p.errors.forEach(e => bugs.push(`console (${p.label}): ${e}`)); }
    for (const f of fakes) f.errors.filter(e => !e.expected).forEach(e => bugs.push(`server refused ${e.path}: ${e.message}`));
    await Promise.all(phones.map(p => p.close().catch(() => {})));
    const ok = !error && !bugs.length;
    console.log(`${ok ? "PASS" : error ? "FAIL" : "BUGS"} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    if (error) console.log(`   ERROR ${String(error.message).replace(/\x1b\[\d+m/g, "").split("\n").filter(Boolean).slice(0, 12).join(" | ")}\n   at ${(error.stack || "").split("\n").find(l => /journeys\.mjs/.test(l))?.trim() || ""}`);
    bugs.forEach(b => console.log(`   - ${b}`));
    summary.push({ mode: m, name, ok, error: error?.message || "", bugs });
  }
}
await browser.close(); server.stop();
const failed = summary.filter(s => !s.ok);
console.log(`\n${summary.length - failed.length}/${summary.length} journeys clean`);
process.exit(failed.length ? 1 : 0);
