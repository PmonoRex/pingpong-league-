// Admin portal: one login (Supabase Auth, trade_admins), then pick which program to open.
// Pingpong and เงินชัด keep their own sign-in inside their pages; this portal only links to them.
(function () {
  const { sb, esc, plain, money, cls, requireAdmin, signOut } = window.Trade;
  const root = document.getElementById("root");

  const APPS = [
    {
      id: "trade", icon: "📈", color: "#1f6feb33", title: "Dopdep Trade",
      desc: "บอทเทรดทองบนบัญชี Demo — ดูผล และเลือกกลยุทธ์ที่จะรัน",
      links: [{ href: "../trade/", label: "แดชบอร์ด", primary: true }, { href: "../trade/admin.html", label: "เลือกกลยุทธ์" }],
    },
    {
      id: "pingpong", icon: "🏓", color: "#2ea04333", title: "Pingpong League",
      desc: "ลีกปิงปอง — ตารางแข่ง สถิติ ทายผล และหน้าจัดการลีก",
      links: [{ href: "../admin.html", label: "จัดการลีก", primary: true }, { href: "../index.html", label: "หน้าหลัก" },
              { href: "../stats.html", label: "สถิติ" }, { href: "../predictions.html", label: "ทายผล" }],
    },
    {
      id: "finance", icon: "💰", color: "#d2992233", title: "เงินชัด",
      desc: "เว็บบันทึกการเงินส่วนตัว",
      links: [{ href: "https://pmonorex.github.io/ngenchad-finance/", label: "เปิด", primary: true }],
    },
  ];

  async function tradeLine() {
    const { data, error } = await sb.from("trade_state").select("summary, updated_at").eq("id", "demo").single();
    if (error || !data || !data.summary || !data.summary.strategies) return "ยังไม่มีข้อมูลจากคอม";
    const s = data.summary, acc = s.account || {};
    const alive = s.strategies.filter((x) => x.enabled && x.alive).length;
    const enabled = s.strategies.filter((x) => x.enabled).length;
    const start = s.start_balance || 100000;
    const net = (acc.balance ?? start) - start;
    const age = Math.round((Date.now() - new Date(data.updated_at).getTime()) / 60000);
    return `บอท ${alive}/${enabled} · Balance ${plain(acc.balance)} · <span class="${cls(net)}">${money(net)}</span> · อัปเดต ${age} นาทีที่แล้ว`;
  }

  function render(user, live) {
    root.innerHTML = `
      <header class="top">
        <div><h1>Admin Portal</h1><div class="meta"><span>${esc(user.email)}</span></div></div>
        <nav><a href="#" id="out">ออกจากระบบ</a></nav>
      </header>
      <section class="apps">
        ${APPS.map((a) => `
          <div class="card app">
            <div class="head"><div class="icon" style="background:${a.color}">${a.icon}</div>
              <div><h3>${esc(a.title)}</h3><p>${esc(a.desc)}</p></div></div>
            ${a.id === "trade" ? `<div class="live">${live}</div>` : ""}
            <div class="links">${a.links.map((l) => `<a href="${l.href}" class="${l.primary ? "primary" : ""}">${esc(l.label)}</a>`).join("")}</div>
          </div>`).join("")}
      </section>
      <p class="muted" style="font-size:12px;margin-top:14px">Pingpong และ เงินชัด ใช้ระบบเข้าสู่ระบบของตัวเองภายในหน้านั้น</p>`;
    root.querySelector("#out").addEventListener("click", (e) => { e.preventDefault(); signOut(); });
  }

  (async () => {
    const user = await requireAdmin(root);
    render(user, "กำลังโหลด…");
    render(user, await tradeLine());
  })();
})();
