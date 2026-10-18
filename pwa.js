// App-like extras: "ติดตั้งเป็นแอป" (the browser's install prompt, or Add to Home Screen steps on iPhone) and
// แจ้งเตือน (a system notification when your match comes up, when your result is entered, and when a prediction
// market opens). With a VAPID key in push-config.js and the push server set up (docs/push-notifications.md), this
// device is registered for Web Push and the server sends them even when the app is closed; otherwise they come from
// this app while it is open or in the background, from the league copy the pages keep in localStorage.
// Nothing here writes league data.
(() => {
  if (typeof document === "undefined") return;
  const LS = () => typeof LeagueShared !== "undefined" ? LeagueShared : null;
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } };
  const store = (key, v) => { try { localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v)); } catch {} };
  const toast = (m, t) => window.LeagueToast ? window.LeagueToast(m, t) : alert(m);

  // ---------- Install ----------
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let deferred = null;
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; offerInstall(); });
  addEventListener("appinstalled", () => { deferred = null; document.querySelector(".pwa-offer")?.remove(); toast("ติดตั้งแอปแล้ว เปิดจากหน้าจอโฮมได้เลย", "good"); });
  const canInstall = () => !standalone() && (!!deferred || ios());
  function sheet(html) {
    const wrap = document.createElement("div"); wrap.className = "pwa-sheet-wrap";
    wrap.innerHTML = `<div class="pwa-sheet" role="dialog" aria-modal="true" aria-labelledby="pwaTitle" tabindex="-1">${html}<button type="button" class="primary pwa-done">เข้าใจแล้ว</button></div>`;
    const close = () => { wrap.classList.remove("on"); setTimeout(() => wrap.remove(), 250); };
    wrap.addEventListener("click", e => { if (e.target === wrap || e.target.closest(".pwa-done")) close(); });
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); } });
    document.body.appendChild(wrap); requestAnimationFrame(() => { wrap.classList.add("on"); wrap.firstElementChild.focus(); });
  }
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>';
  async function install() {
    if (standalone()) return toast("เปิดเป็นแอปอยู่แล้ว", "good");
    if (deferred) { const d = deferred; deferred = null; d.prompt(); try { await d.userChoice; } catch {} document.querySelector(".pwa-offer")?.remove(); return; }
    sheet(`<h2 id="pwaTitle">ติดตั้งเป็นแอป</h2><ol class="pwa-steps">
      <li>เปิดเว็บนี้ใน <b>Safari</b></li>
      <li>แตะปุ่ม <b>แชร์</b> <span class="pwa-ico">${SHARE_ICON}</span> ที่แถบล่าง</li>
      <li>เลื่อนลงแล้วเลือก <b>เพิ่มไปยังหน้าจอโฮม</b></li>
      <li>แตะ <b>เพิ่ม</b> แอปจะอยู่บนหน้าจอเหมือนแอปทั่วไป</li></ol>
      <p class="pwa-note">ติดตั้งแล้วเปิดเต็มจอ โหลดเร็วขึ้น และรับแจ้งเตือนได้บน iPhone</p>`);
  }
  // A one-time pill on the home page for phones that are not using the installed app yet.
  const INSTALL_SEEN = "pp_install_offer";
  function offerInstall() {
    if (!canInstall() || !document.body?.classList.contains("sport-page-index-html") || read(INSTALL_SEEN) || document.querySelector(".pwa-offer,.wr-offer,.share-offer")) return;
    if (!matchMedia("(max-width: 820px)").matches) return;
    const pill = document.createElement("div"); pill.className = "pwa-offer";
    pill.innerHTML = '<button type="button" class="pwa-offer-go"><span>ติดตั้งเป็นแอปบนมือถือ</span><b>ติดตั้ง</b></button><button type="button" class="pwa-offer-x" aria-label="ไม่ใช่ตอนนี้">×</button>';
    const done = () => { store(INSTALL_SEEN, "1"); pill.remove(); };
    pill.querySelector(".pwa-offer-go").onclick = () => { done(); install(); };
    pill.querySelector(".pwa-offer-x").onclick = done;
    document.body.appendChild(pill);
  }

  // ---------- Notifications ----------
  const NOTIFY = "pp_notify", SEEN = "pp_notify_seen";
  const supported = () => "Notification" in window && "serviceWorker" in navigator;
  const enabled = () => supported() && Notification.permission === "granted" && read(NOTIFY) === true;
  // When this device is registered for Web Push, the server (supabase/functions/push-notify) sends the system
  // notification, even with the app closed; here we then only show the in-page toast, so nothing arrives twice.
  async function show(title, body, tag, force = false) {
    if (!document.hidden) toast(`${title} • ${body}`, "good");
    if (!enabled() || (pushActive() && !force)) return;
    try { const reg = await navigator.serviceWorker.ready; await reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: "index.html" } }); } catch {}
  }
  async function toggleNotify() {
    if (!supported()) return toast(ios() && !standalone() ? "บน iPhone ต้องติดตั้งเป็นแอปก่อน ถึงจะรับแจ้งเตือนได้" : "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน", "bad");
    if (enabled()) { store(NOTIFY, false); pushOff(); return toast("ปิดแจ้งเตือนแล้ว", "good"); }
    if (Notification.permission === "denied") return toast("แจ้งเตือนถูกบล็อกไว้ เปิดได้ในการตั้งค่าของเบราว์เซอร์", "bad");
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (p !== "granted") return toast("ยังไม่ได้อนุญาตการแจ้งเตือน", "bad");
    store(NOTIFY, true); baseline();
    const viaPush = pushCapable() && await syncPush(true);
    show("เปิดแจ้งเตือนแล้ว", viaPush ? "จะเตือนเมื่อถึงคิวแข่ง ผลออก และเปิดทายผลคู่ใหม่ แม้ปิดแอปอยู่" : "จะเตือนเมื่อถึงคิวแข่ง ผลออก และเปิดทายผลคู่ใหม่", "pp-on", true);
  }

  // ---------- Web Push ----------
  // Needs a VAPID public key in push-config.js and a browser with PushManager (Android Chrome; iPhone only as an
  // installed app, iOS 16.4+). Without either, the in-app notifications above are all there is.
  const PUSH = "pp_push_sub";   // { endpoint, userId } as last registered with pp_push_subscribe
  const vapidKey = () => typeof window.PUSH_VAPID_PUBLIC_KEY === "string" ? window.PUSH_VAPID_PUBLIC_KEY.trim() : "";
  const pushCapable = () => supported() && "PushManager" in window && !!vapidKey() && !!LS()?.SUPABASE_URL;
  const pushActive = () => enabled() && pushCapable() && !!read(PUSH)?.endpoint;
  const keyBytes = s => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), c => c.charCodeAt(0)); };
  const sameKey = sub => {
    const have = sub.options?.applicationServerKey; if (!have) return true;
    const a = new Uint8Array(have), b = keyBytes(vapidKey());
    return a.length === b.length && a.every((v, i) => v === b[i]);
  };
  const signedIn = () => { const S = LS(); try { return S?.sessionUserId(S.readLocalLeague()) || ""; } catch { return ""; } };
  async function rpc(name, args) {
    const S = LS();
    const res = await fetch(`${S.SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args),
      headers: { apikey: S.SUPABASE_KEY, Authorization: `Bearer ${S.SUPABASE_KEY}`, "Content-Type": "application/json" } });
    if (!res.ok) throw new Error(`${name} ${res.status}`);
  }
  // Keeps the server's record of this device in step with the signed-in player. Resolves true when push is set up.
  let syncing = null, retryAt = 0, lastSync = 0;
  function syncPush(force = false) {
    if (syncing) return syncing;
    if (!enabled() || !pushCapable() || (!force && Date.now() < retryAt)) return Promise.resolve(false);
    lastSync = Date.now();
    syncing = (async () => {
      const stored = read(PUSH), me = signedIn();
      try {
        if (!me) { if (stored?.endpoint) { await rpc("pp_push_unsubscribe", { p_endpoint: stored.endpoint }); store(PUSH, null); } return false; }
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (sub && !sameKey(sub)) { await sub.unsubscribe().catch(() => {}); sub = null; }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey()) });
        if (stored?.endpoint === sub.endpoint && stored.userId === me) return true;
        if (stored?.endpoint && stored.endpoint !== sub.endpoint) await rpc("pp_push_unsubscribe", { p_endpoint: stored.endpoint }).catch(() => {});
        const keys = sub.toJSON().keys || {};
        await rpc("pp_push_subscribe", { p_endpoint: sub.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth, p_user_id: me });
        store(PUSH, { endpoint: sub.endpoint, userId: me }); retryAt = 0;
        return true;
      } catch {
        // Server not set up yet (SQL not run), offline, or the browser refused: stay on in-app notifications, retry later.
        store(PUSH, null); retryAt = Date.now() + 60000;
        return false;
      } finally { syncing = null; }
    })();
    return syncing;
  }
  async function pushOff() {
    const stored = read(PUSH); store(PUSH, null);
    try { if (stored?.endpoint) await rpc("pp_push_unsubscribe", { p_endpoint: stored.endpoint }); } catch {}
    try { const sub = await (await navigator.serviceWorker.ready).pushManager?.getSubscription(); await sub?.unsubscribe(); } catch {}
  }

  // What is worth telling the signed-in player right now, each item keyed so it is told once.
  function events() {
    const S = LS(), l = S?.readLocalLeague?.(); if (!l?.profiles) return [];
    let me = ""; try { me = S.sessionUserId(l) || ""; } catch {}
    const nm = id => l.profiles?.[id]?.displayName || id, season = Number(l.currentSeason) || 1, out = [];
    const valid = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
    if (me) {
      const ri = (l.rounds || []).findIndex((r, i) => (r?.m || []).some((p, mi) => !valid(l.results?.[`r${i}m${mi}`])));
      (l.rounds?.[ri]?.m || []).forEach((p, mi) => { if (p?.includes(me) && !valid(l.results?.[`r${ri}m${mi}`])) out.push({ key: `next:${season}:r${ri}m${mi}`, title: "ถึงคิวคุณแล้ว", body: `รอบ ${ri + 1} • ${nm(p[0])} vs ${nm(p[1])}`, tag: "pp-next" }); });
      (l.rounds || []).forEach((r, i) => (r?.m || []).forEach((p, mi) => {
        const x = l.results?.[`r${i}m${mi}`]; if (!p?.includes(me) || !valid(x)) return;
        const mine = p[0] === me ? [x.a, x.b] : [x.b, x.a], o = nm(p[0] === me ? p[1] : p[0]);
        out.push({ key: `res:${season}:r${i}m${mi}:${x.a}-${x.b}`, title: mine[0] > mine[1] ? "ชนะแล้ว!" : mine[0] < mine[1] ? "ผลออกแล้ว" : "เสมอ", body: `คุณ ${mine[0]}–${mine[1]} ${o}`, tag: `pp-res-r${i}m${mi}` });
      }));
    }
    const pred = read(S.PRED_KEY);
    Object.entries(pred?.markets || {}).forEach(([key, m]) => {
      if (!m?.open || !key.startsWith(`s${season}:`)) return;
      const [, ri, mi] = /r(\d+)m(\d+)/.exec(key) || [], p = l.rounds?.[ri]?.m?.[mi];
      if (p && !valid(l.results?.[`r${ri}m${mi}`])) out.push({ key: `mkt:${key}`, title: "เปิดทายผลแล้ว", body: `${nm(p[0])} vs ${nm(p[1])} • เข้าไปทายได้เลย`, tag: `pp-mkt-${key}` });
    });
    // ท้าดวล (challenge.js): an open challenge waiting for my answer, from the club copy in localStorage.
    try { if (me) (S.readLocalClub?.()?.challenges || []).forEach(c => { if (c?.status === "open" && (c.format === "doubles" ? (c.teamB || []).includes(me) : c.to === me)) out.push({ key: `ch:${c.id}`, title: "มีคนท้าดวล!", body: `${nm(c.from)} ท้าคุณ${c.note ? ` • ${String(c.note).slice(0, 60)}` : ""}`, tag: `pp-ch-${c.id}` }); }); } catch {}
    try { out.push(...(window.LeagueSocial?.events?.(l, me) || [])); } catch {} // comments/reactions on my matches (social.js)
    return out;
  }
  function baseline() { store(SEEN, events().map(e => e.key)); }
  function check() {
    if (!enabled()) return;
    // Re-register when the signed-in player changed (or signed out), and once a minute in case the browser rotated it.
    if (pushCapable() && ((read(PUSH)?.userId || "") !== signedIn() || Date.now() - lastSync > 60000)) syncPush();
    const seenList = read(SEEN); if (!Array.isArray(seenList)) return baseline();
    const seen = new Set(seenList), now = events(), fresh = now.filter(e => !seen.has(e.key));
    if (!fresh.length) return;
    store(SEEN, [...new Set([...seenList, ...now.map(e => e.key)])].slice(-400));
    fresh.slice(0, 3).forEach(e => show(e.title, e.body, e.tag));
  }
  // The pages refresh the league copy in localStorage as the cloud row changes; look at it every few seconds.
  setInterval(check, 5000);
  addEventListener("storage", e => { if (e.key && (e.key === LS()?.LEAGUE_KEY || e.key === LS()?.PRED_KEY || e.key === LS()?.CLUB_KEY || e.key === LS()?.SESSION_KEY)) check(); });

  if (document.readyState === "complete") setTimeout(offerInstall, 2500); else addEventListener("load", () => setTimeout(offerInstall, 2500), { once: true });
  window.LeaguePWA = Object.freeze({ canInstall, install, standalone, supported, enabled, toggleNotify, events, pushActive, syncPush });
})();
