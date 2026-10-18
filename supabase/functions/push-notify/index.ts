// push-notify: sends Web Push notifications when the league changes (docs/push-notifications.md).
//
// Called by a Supabase Database Webhook on UPDATE of public.app_state. The webhook body is
// { type: "UPDATE", table: "app_state", schema: "public", record, old_record }.
// 1. Checks the shared secret header x-push-secret (secret PUSH_WEBHOOK_SECRET), so nobody else can make it send.
// 2. Works out who to tell what from the old and new row (events.js, same rules as pwa.js).
// 3. Looks up those players' devices in public.push_subscriptions with the service key and sends each one a small
//    encrypted payload { title, body, tag, url } signed with the VAPID key (webpush.js).
// 4. Reports back: devices the push service says are gone (404/410) are deleted.
//
// Secrets (Edge Functions -> Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com),
// PUSH_WEBHOOK_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase; PUSH_SERVICE_KEY (an
// sb_secret_... key) may be set instead when the project's legacy service_role key is turned off.
// "Verify JWT" must be OFF for this function: the webhook proves itself with x-push-secret instead.
import "./events.js";
import "./webpush.js";

type Sub = { endpoint: string; user_id: string; p256dh: string; auth: string };
type Ev = { to: string; key: string; title: string; body: string; tag: string; url: string };
type Env = { get(name: string): string | undefined };
type Deps = { env: Env; fetch: typeof fetch; waitUntil?: (p: Promise<unknown>) => void; log?: (...a: unknown[]) => void };

// deno-lint-ignore no-explicit-any
const G = globalThis as any;
const PushEvents = G.PushEvents as {
  rowEvents(record: unknown, old: unknown, ctx?: unknown): Ev[];
  needsLeague(record: unknown, old: unknown): boolean;
  payloadOf(e: Ev): string;
};
const WebPush = G.WebPush as {
  importVapid(pub: string, priv: string): Promise<{ key: CryptoKey; publicKey: string }>;
  send(sub: Sub, payload: string, opts: Record<string, unknown>): Promise<{ status: number; gone: boolean; error?: string }>;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function createHandler(deps: Deps) {
  const { env, log = console.log } = deps;
  let vapidCache: Promise<{ key: CryptoKey; publicKey: string }> | null = null;

  async function db(path: string, init: RequestInit = {}) {
    const base = (env.get("SUPABASE_URL") || "").replace(/\/$/, "");
    const key = env.get("PUSH_SERVICE_KEY") || env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
    if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`;   // legacy JWT keys; sb_secret_ keys go in apikey only
    const res = await deps.fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`database ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function deliver(events: Ev[], ctxNote: string) {
    const users = [...new Set(events.map(e => e.to))];
    const subs: Sub[] = await db(`push_subscriptions?select=endpoint,user_id,p256dh,auth&user_id=in.(${users.map(encodeURIComponent).join(",")})`);
    if (!subs?.length) { log(`push-notify ${ctxNote}: ${events.length} event(s), no subscribed devices`); return { sent: 0 }; }
    vapidCache ||= WebPush.importVapid(env.get("VAPID_PUBLIC_KEY") || "", env.get("VAPID_PRIVATE_KEY") || "");
    const vapid = await vapidCache, subject = env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
    const jobs: Array<() => Promise<{ endpoint: string; status: number; gone: boolean; error?: string }>> = [];
    for (const e of events) for (const s of subs) if (s.user_id === e.to) {
      jobs.push(async () => ({ endpoint: s.endpoint, ...(await WebPush.send(s, PushEvents.payloadOf(e), { vapid, subject, topic: e.tag, fetch: deps.fetch })) }));
    }
    const results: Array<{ endpoint: string; status: number; gone: boolean; error?: string }> = [];
    for (let i = 0; i < jobs.length; i += 10) results.push(...await Promise.all(jobs.slice(i, i + 10).map(j => j())));
    const ok = new Set<string>(), gone = new Set<string>(), failed = new Set<string>();
    for (const r of results) {
      if (r.gone) gone.add(r.endpoint);
      else if (r.status >= 200 && r.status < 300) ok.add(r.endpoint);
      else failed.add(r.endpoint);
    }
    for (const e of gone) { ok.delete(e); failed.delete(e); }
    for (const e of failed) ok.delete(e);
    await db("rpc/pp_push_report", { method: "POST", body: JSON.stringify({ p_ok: [...ok], p_gone: [...gone], p_failed: [...failed] }) });
    const errors = results.filter(r => !r.gone && !(r.status >= 200 && r.status < 300)).map(r => `${r.status} ${r.error || ""}`.trim());
    log(`push-notify ${ctxNote}: ${events.length} event(s), ${results.length} push(es): ${ok.size} ok, ${gone.size} gone, ${failed.size} failed${errors.length ? ` [${errors.slice(0, 3).join("; ")}]` : ""}`);
    return { sent: results.length, ok: ok.size, gone: gone.size, failed: failed.size };
  }

  return async function handler(req: Request): Promise<Response> {
    if (req.method !== "POST") return json(405, { error: "POST only" });
    const secret = env.get("PUSH_WEBHOOK_SECRET") || "";
    if (!secret) return json(500, { error: "PUSH_WEBHOOK_SECRET is not set" });
    if (!sameSecret(req.headers.get("x-push-secret") || "", secret)) return json(401, { error: "bad secret" });
    if (!env.get("VAPID_PUBLIC_KEY") || !env.get("VAPID_PRIVATE_KEY")) return json(500, { error: "VAPID keys are not set" });

    let body: { type?: string; table?: string; record?: { id?: string }; old_record?: unknown };
    try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
    if (body?.type !== "UPDATE" || body.table !== "app_state" || !body.record || !body.old_record) return json(200, { skipped: "not an app_state UPDATE" });
    const id = body.record.id;
    if (id !== "main" && id !== "club") return json(200, { skipped: `row ${id}` });

    try {
      const ctx = PushEvents.needsLeague(body.record, body.old_record) ? { league: await db("rpc/pp_push_league_brief", { method: "POST", body: "{}" }) } : undefined;
      const events = PushEvents.rowEvents(body.record, body.old_record, ctx);
      if (!events.length) return json(200, { events: 0 });
      const work = deliver(events, `row ${id}`).catch(e => { log(`push-notify error: ${e?.message || e}`); return { error: String(e?.message || e) }; });
      // Answer the webhook at once and keep sending in the background where the runtime allows it.
      if (deps.waitUntil) { deps.waitUntil(work); return json(202, { events: events.length }); }
      return json(200, { events: events.length, ...(await work) });
    } catch (e) {
      log(`push-notify error: ${(e as Error)?.message || e}`);
      return json(500, { error: String((e as Error)?.message || e) });
    }
  };
}

if (!Deno.env.get("PUSH_NOTIFY_NO_SERVE")) {
  const waitUntil = typeof G.EdgeRuntime?.waitUntil === "function" ? (p: Promise<unknown>) => G.EdgeRuntime.waitUntil(p) : undefined;
  Deno.serve(createHandler({ env: Deno.env, fetch: globalThis.fetch.bind(globalThis), waitUntil }));
}
