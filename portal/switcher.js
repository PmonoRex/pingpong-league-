// Admin app switcher: a floating button on every page that opens a sheet of the owner's apps.
// Shown only when the Dopdep admin login (Supabase session "dopdep-trade-auth") is present on this browser,
// so league players never see it. Self-contained: injects its own styles, needs no other script.
(function () {
  const script = document.currentScript;
  const base = new URL("..", script.src).href;   // site root (portal/ sits one level down)
  const APPS = [
    { id: "trade", icon: "📈", title: "Dopdep Trade", desc: "บอทเทรดทองบนบัญชี Demo — ดูผล และเลือกกลยุทธ์ที่จะรัน", match: /\/trade\//,
      links: [{ href: base + "trade/", label: "แดชบอร์ด", primary: true }, { href: base + "trade/admin.html", label: "เลือกกลยุทธ์" }] },
    { id: "pingpong", icon: "🏓", title: "Pingpong League", desc: "ลีกปิงปอง — ตารางแข่ง สถิติ ทายผล และหน้าจัดการลีก",
      match: /\/pingpong-league-\/(?!trade\/|portal\/|automation\/)/,
      links: [{ href: base + "admin.html", label: "จัดการลีก", primary: true }, { href: base + "index.html", label: "หน้าหลัก" },
              { href: base + "stats.html", label: "สถิติ" }, { href: base + "predictions.html", label: "ทายผล" }] },
    { id: "automation", icon: "🤖", title: "Automation", desc: "โพสต์สินค้า Affiliate ลงเพจ Facebook และช่อง YouTube อัตโนมัติ", match: /\/automation\//,
      links: [{ href: base + "automation/", label: "รายงาน", primary: true }, { href: "https://www.facebook.com/376271472246385", label: "เพจ Facebook" }] },
    { id: "finance", icon: "💰", title: "เงินชัด", desc: "เว็บบันทึกการเงินส่วนตัว", match: /\/ngenchad-finance\//,
      links: [{ href: "https://pmonorex.github.io/ngenchad-finance/", label: "เปิด", primary: true }] },
  ];
  window.DopdepApps = APPS;

  function signedIn() {
    try {
      const s = JSON.parse(localStorage.getItem("dopdep-trade-auth") || "null");
      return !!(s && (s.user || (s.currentSession && s.currentSession.user)));
    } catch (_) { return false; }
  }
  if (signedIn()) init();
  else document.addEventListener("dopdep-signed-in", init, { once: true });   // fired by trade/app.js after login

  function init() {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const here = location.href;
  const current = APPS.find((a) => a.match.test(location.pathname));

  const css = `
  .dd-sw-btn{position:fixed;right:max(14px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:2147482000;
    width:54px;height:54px;border-radius:50%;border:1px solid #ff5c66;cursor:pointer;display:grid;place-items:center;padding:0;
    background:linear-gradient(180deg,#dc2530,#b0121a);color:#fff;box-shadow:0 10px 28px rgba(229,36,47,.45),0 4px 14px rgba(0,0,0,.5);
    transition:transform .18s cubic-bezier(.16,1,.3,1),box-shadow .18s;-webkit-tap-highlight-color:transparent}
  .dd-sw-btn:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 14px 34px rgba(229,36,47,.55),0 4px 14px rgba(0,0,0,.5)}
  .dd-sw-btn:active{transform:scale(.94)}
  .dd-sw-btn:focus-visible{outline:2px solid #ff4752;outline-offset:3px}
  .dd-sw-btn svg{width:24px;height:24px;transition:transform .3s cubic-bezier(.16,1,.3,1)}
  .dd-sw-btn[aria-expanded="true"] svg{transform:rotate(45deg)}
  body.sport-redesign .dd-sw-btn{bottom:calc(86px + env(safe-area-inset-bottom))}
  .dd-sw-back{position:fixed;inset:0;z-index:2147481999;background:rgba(5,6,8,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
    opacity:0;transition:opacity .2s}
  .dd-sw-back.open{opacity:1}
  .dd-sw{position:fixed;z-index:2147482001;right:max(14px,env(safe-area-inset-right));bottom:calc(max(16px,env(safe-area-inset-bottom)) + 66px);
    width:min(380px,calc(100vw - 28px));max-height:min(72vh,620px);overflow:auto;padding:16px;border-radius:18px;
    border:1px solid rgba(255,255,255,.16);color:#f4f5f7;font:14px/1.5 Anuphan,system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;
    background:radial-gradient(420px 220px at 100% 0,rgba(229,36,47,.20),transparent 70%),linear-gradient(180deg,rgba(255,255,255,.04),transparent 120px),#15171d;
    box-shadow:0 24px 70px rgba(0,0,0,.6);transform-origin:calc(100% - 27px) calc(100% + 40px);
    opacity:0;transform:translateY(10px) scale(.92);transition:opacity .2s,transform .28s cubic-bezier(.16,1,.3,1)}
  .dd-sw.open{opacity:1;transform:none}
  body.sport-redesign .dd-sw{bottom:calc(86px + env(safe-area-inset-bottom) + 66px)}
  .dd-sw-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px}
  .dd-sw-head b{font:italic 800 22px/1.1 Kanit,Anuphan,system-ui,sans-serif;color:#fff}
  .dd-sw-head a{font-size:12px;font-weight:700;color:#ff4752;text-decoration:none;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,71,82,.4)}
  .dd-sw-app{display:block;padding:12px;margin-top:8px;border-radius:14px;background:#1c1f26;border:1px solid rgba(255,255,255,.08);
    opacity:0;transform:translateY(8px);transition:opacity .25s,transform .35s cubic-bezier(.16,1,.3,1),border-color .15s}
  .dd-sw.open .dd-sw-app{opacity:1;transform:none}
  .dd-sw-app.cur{border-color:rgba(255,71,82,.55);box-shadow:inset 0 0 0 1px rgba(255,71,82,.25)}
  .dd-sw-top{display:flex;gap:12px;align-items:center}
  .dd-sw-ico{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-size:21px;flex:none;
    background:radial-gradient(circle at 30% 25%,#252932,#0e1014);border:1px solid rgba(255,71,82,.45);box-shadow:0 0 14px rgba(229,36,47,.30)}
  .dd-sw-t{font:600 16px/1.2 Kanit,Anuphan,system-ui,sans-serif;color:#fff;display:flex;align-items:center;gap:8px}
  .dd-sw-t small{font:700 10px/1 Anuphan,system-ui,sans-serif;color:#ff4752;border:1px solid rgba(255,71,82,.45);border-radius:999px;padding:3px 7px}
  .dd-sw-d{color:#9ba1ad;font-size:12px}
  .dd-sw-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .dd-sw-links a{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;
    color:#f4f5f7;background:#252932;border:1px solid rgba(255,255,255,.16);transition:transform 90ms,background-color .14s}
  .dd-sw-links a:hover{background:#2d323c}
  .dd-sw-links a:active{transform:scale(.96)}
  .dd-sw-links a.primary{color:#fff;border-color:#ff5c66;background:linear-gradient(180deg,#dc2530,#b0121a)}
  .dd-sw-links a.here{outline:2px solid rgba(255,255,255,.5);outline-offset:1px}
  @media (prefers-reduced-motion:reduce){.dd-sw,.dd-sw-app,.dd-sw-btn,.dd-sw-btn svg{transition:opacity .15s!important;transform:none!important}}`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dd-sw-btn";
  btn.setAttribute("aria-label", "สลับแอป");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "dd-sw");
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${[4, 12, 20].flatMap((y) => [4, 12, 20].map((x) =>
    `<circle cx="${x}" cy="${y}" r="2.3"/>`)).join("")}</svg>`;

  const back = document.createElement("div");
  back.className = "dd-sw-back";
  back.hidden = true;

  const sheet = document.createElement("div");
  sheet.className = "dd-sw";
  sheet.id = "dd-sw";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "สลับแอป");
  sheet.hidden = true;
  const isHere = (href) => { const u = new URL(href, here); return u.pathname.replace(/index\.html$/, "") === location.pathname.replace(/index\.html$/, ""); };
  sheet.innerHTML = `
    <div class="dd-sw-head"><b>สลับแอป</b><a href="${base}portal/">Portal</a></div>
    ${APPS.map((a, i) => `
      <div class="dd-sw-app${a === current ? " cur" : ""}" style="transition-delay:${40 + i * 45}ms">
        <div class="dd-sw-top"><div class="dd-sw-ico">${a.icon}</div>
          <div><div class="dd-sw-t">${esc(a.title)}${a === current ? "<small>อยู่ที่นี่</small>" : ""}</div><div class="dd-sw-d">${esc(a.desc)}</div></div></div>
        <div class="dd-sw-links">${a.links.map((l) => `<a href="${l.href}" class="${l.primary ? "primary" : ""}${isHere(l.href) ? " here" : ""}">${esc(l.label)}</a>`).join("")}</div>
      </div>`).join("")}`;

  function open() {
    back.hidden = sheet.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => requestAnimationFrame(() => { back.classList.add("open"); sheet.classList.add("open"); }));
    setTimeout(() => { back.classList.add("open"); sheet.classList.add("open"); }, 50);   // if frames are paused
    const first = sheet.querySelector("a");
    if (first) first.focus({ preventScroll: true });
  }
  function close() {
    back.classList.remove("open"); sheet.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    setTimeout(() => { if (!sheet.classList.contains("open")) back.hidden = sheet.hidden = true; }, 260);
  }
  btn.addEventListener("click", () => (sheet.hidden ? open() : close()));
  back.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) { close(); btn.focus(); } });

  const mount = () => document.body.append(back, sheet, btn);
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
  }
})();
