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

  window.Trade = { sb, esc, money, plain, cls, requireAdmin, signOut };
})();
