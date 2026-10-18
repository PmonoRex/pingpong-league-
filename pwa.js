// App-like extras: "ติดตั้งเป็นแอป" (the browser's install prompt, or Add to Home Screen steps on iPhone) and
// แจ้งเตือน (a system notification when your match comes up, when your result is entered, and when a prediction
// market opens). There is no push server: notifications come from this app while it is open or in the background,
// from the league copy the pages keep in localStorage. Read-only; nothing here writes league data.
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
  async function show(title, body, tag) {
    if (!document.hidden) toast(`${title} • ${body}`, "good");
    if (!enabled()) return;
    try { const reg = await navigator.serviceWorker.ready; await reg.showNotification(title, { body, tag, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: { url: "index.html" } }); } catch {}
  }
  async function toggleNotify() {
    if (!supported()) return toast(ios() && !standalone() ? "บน iPhone ต้องติดตั้งเป็นแอปก่อน ถึงจะรับแจ้งเตือนได้" : "เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน", "bad");
    if (enabled()) { store(NOTIFY, false); return toast("ปิดแจ้งเตือนแล้ว", "good"); }
    if (Notification.permission === "denied") return toast("แจ้งเตือนถูกบล็อกไว้ เปิดได้ในการตั้งค่าของเบราว์เซอร์", "bad");
    const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (p !== "granted") return toast("ยังไม่ได้อนุญาตการแจ้งเตือน", "bad");
    store(NOTIFY, true); baseline(); show("เปิดแจ้งเตือนแล้ว", "จะเตือนเมื่อถึงคิวแข่ง ผลออก และเปิดทายผลคู่ใหม่", "pp-on");
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
    return out;
  }
  function baseline() { store(SEEN, events().map(e => e.key)); }
  function check() {
    if (!enabled()) return;
    const seenList = read(SEEN); if (!Array.isArray(seenList)) return baseline();
    const seen = new Set(seenList), now = events(), fresh = now.filter(e => !seen.has(e.key));
    if (!fresh.length) return;
    store(SEEN, [...new Set([...seenList, ...now.map(e => e.key)])].slice(-400));
    fresh.slice(0, 3).forEach(e => show(e.title, e.body, e.tag));
  }
  // The pages refresh the league copy in localStorage as the cloud row changes; look at it every few seconds.
  setInterval(check, 5000);
  addEventListener("storage", e => { if (e.key && (e.key === LS()?.LEAGUE_KEY || e.key === LS()?.PRED_KEY)) check(); });

  if (document.readyState === "complete") setTimeout(offerInstall, 2500); else addEventListener("load", () => setTimeout(offerInstall, 2500), { once: true });
  window.LeaguePWA = Object.freeze({ canInstall, install, standalone, supported, enabled, toggleNotify, events });
})();
