// Shared helpers for the Dopdep trade pages: Supabase client, login gate, formatting.
(function () {
  const cfg = window.TRADE_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    auth: { persistSession: true, storageKey: "dopdep-trade-auth" },
  });

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const plain = (v) => (v == null ? "—" : "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");

  function loginScreen(root, onDone) {
    root.innerHTML = `
      <div class="center"><form class="login card">
        <h2>Dopdep · เข้าสู่ระบบ</h2>
        <input type="email" name="email" placeholder="อีเมล" autocomplete="username" required>
        <input type="password" name="password" placeholder="รหัสผ่าน" autocomplete="current-password" required>
        <button class="primary" type="submit">เข้าสู่ระบบ</button>
        <div class="err"></div>
      </form></div>`;
    const form = root.querySelector("form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = form.querySelector(".err");
      err.textContent = "";
      const { error } = await sb.auth.signInWithPassword({ email: form.email.value, password: form.password.value });
      if (error) { err.textContent = "เข้าสู่ระบบไม่สำเร็จ: " + error.message; return; }
      document.dispatchEvent(new Event("dopdep-signed-in"));
      onDone();
    });
  }

  // Resolves once a signed-in admin is present; shows login / no-access screens otherwise.
  async function requireAdmin(root) {
    for (;;) {
      const { data } = await sb.auth.getSession();
      if (!data.session) { await new Promise((ok) => loginScreen(root, ok)); continue; }
      const { data: rows, error } = await sb.from("trade_admins").select("user_id").eq("user_id", data.session.user.id);
      if (!error && rows && rows.length) return data.session.user;
      root.innerHTML = `<div class="center"><div class="card">
        <h2>ไม่มีสิทธิ์เข้าถึง</h2><p class="muted">บัญชี ${esc(data.session.user.email)} ยังไม่ได้อยู่ในรายชื่อแอดมิน (trade_admins)</p>
        <button id="out">ออกจากระบบ</button></div></div>`;
      await new Promise((ok) => root.querySelector("#out").addEventListener("click", async () => { await sb.auth.signOut(); ok(); }));
    }
  }

  async function signOut() { await sb.auth.signOut(); location.reload(); }

  // ---------------------------------------------------------------- motion
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let introDone = false;

  // First render only: panels rise in one after another, table rows and calendar cells follow.
  function intro(root) {
    if (introDone) return;   // with reduced motion the CSS turns this into plain fades
    introDone = true;
    root.querySelectorAll("header.top, .card").forEach((el, i) => el.style.setProperty("--i", i));
    root.querySelectorAll("tbody tr, .srow").forEach((el, i) => el.style.setProperty("--i", Math.min(i, 18)));
    root.querySelectorAll(".cal > div").forEach((el, i) => el.style.setProperty("--i", i));
    root.classList.add("intro");
    setTimeout(() => root.classList.remove("intro"), 2400);
  }

  // Figures tick from their previous value (0 on first load) to the new one; a changed figure flashes once.
  const lastValue = new Map();
  const formats = { plain, money, int: (v) => String(Math.round(v)) };
  function countUp(root) {
    root.querySelectorAll("[data-count]").forEach((el) => {
      const key = el.dataset.key, to = Number(el.dataset.count), fmt = formats[el.dataset.fmt] || formats.int;
      const had = lastValue.has(key), from = had ? lastValue.get(key) : 0;
      lastValue.set(key, to);
      if (from === to || !isFinite(to)) { el.textContent = fmt(to); return; }
      if (had) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
      const t0 = performance.now(), dur = 900;
      let finished = false;
      const step = (t) => {
        if (finished) return;
        const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(step); else finished = true;
      };
      requestAnimationFrame(step);
      // background tabs may never run animation frames: always land on the real value
      setTimeout(() => { if (!finished) { finished = true; el.textContent = fmt(to); } }, dur + 150);
    });
  }

  // Page to page: a red blade sweeps across (same idea as the league's wipe); the next page opens under it.
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (calm || !a || a.target || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || a.getAttribute("href").startsWith("#")) return;
    e.preventDefault();
    try { sessionStorage.setItem("dopdep-pt", String(Date.now())); } catch (_) {}
    document.documentElement.classList.add("pt-out");
    setTimeout(() => { location.href = url.href; }, 300);
  });
  addEventListener("pageshow", () => document.documentElement.classList.remove("pt-out"));

  window.Trade = { sb, esc, money, plain, cls, requireAdmin, signOut, intro, countUp };
})();
