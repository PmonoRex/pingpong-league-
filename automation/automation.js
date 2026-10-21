// Automation page: the D:\AFFI project's report (affiliate auto-post to the Facebook Page + YouTube uploads),
// pushed by the PC agent (tools/trade_sync.py) to trade_state row 'automation'.
(function () {
  const { sb, esc, requireAdmin, signOut, intro, countUp } = window.Trade;
  const root = document.getElementById("root");

  const FB_PAGE = "https://www.facebook.com/376271472246385";
  const CHANNELS = [
    { key: "sleep", icon: "🌙", title: "Deep Sleep Haven", url: "https://www.youtube.com/channel/UCk1SprHveCLj6pnuPuCdUuQ", what: "เสียงธรรมชาติช่วยนอน 10 ชม." },
    { key: "freq", icon: "🎵", title: "Solfeggio Haven", url: "https://www.youtube.com/channel/UCXa9r-jEp0NPVC-CtgA6CvQ", what: "เพลงคลื่นความถี่ Solfeggio 10 ชม." },
  ];

  const baht = (v) => (v == null ? "—" : "฿" + Number(v).toLocaleString("th-TH", { maximumFractionDigits: 0 }));
  const when = (sec) => (sec ? new Date(sec * 1000).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const whenIso = (s) => (s ? new Date(s).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const minutesAgo = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

  function perDayChart(days) {
    if (!days || !days.length) return `<p class="muted">ยังไม่มีข้อมูล</p>`;
    const max = Math.max(1, ...days.map((d) => d.count));
    return `<div class="bars">${days.map((d, i) => {
      const dt = new Date(d.date + "T00:00:00");
      return `<div class="b${d.count ? "" : " zero"}" style="--i:${i}" title="${esc(d.date)}: ${d.count} โพสต์">
        <span>${d.count || ""}</span><i style="height:${Math.max(2, (d.count / max) * 100)}%"></i>
        <small>${dt.getDate()}/${dt.getMonth() + 1}</small></div>`;
    }).join("")}</div>`;
  }

  function categoryBars(rows) {
    if (!rows || !rows.length) return `<p class="muted">—</p>`;
    const max = Math.max(...rows.map((r) => r.count));
    return rows.map((r) => `<div class="hbar"><span class="n">${esc(r.name)}</span>
      <span class="track"><span class="fill" style="display:block;width:${(r.count / max) * 100}%"></span></span><span class="c">${r.count}</span></div>`).join("");
  }

  function channels(yt) {
    const fb = `<a class="chan" href="${FB_PAGE}" target="_blank" rel="noopener"><span class="ico">🛍️</span>
      <span><span class="t">เรดาร์ของเด็ด</span><br><span class="d">เพจ Facebook · โพสต์สินค้า Shopee อัตโนมัติ</span></span><span class="go">เปิด ↗</span></a>`;
    return fb + CHANNELS.map((c) => {
      const list = (yt && yt[c.key]) || [];
      const last = list[list.length - 1];
      return `<a class="chan" href="${c.url}" target="_blank" rel="noopener"><span class="ico">${c.icon}</span>
        <span><span class="t">${esc(c.title)}</span><br><span class="d">YouTube · ${esc(c.what)} · อัปแล้ว ${list.length} คลิป${last ? ` · ล่าสุด ${whenIso(last.at)}` : ""}</span></span>
        <span class="go">เปิด ↗</span></a>`;
    }).join("");
  }

  function warnings(s) {
    const w = [];
    const st = s.status || {};
    if (st.token && st.token.valid === false) w.push("Token เพจ Facebook ใช้ไม่ได้แล้ว: ต้องขอ token ใหม่");
    if (st.facebook_error) w.push("Facebook: " + st.facebook_error);
    if (st.catalog_error) w.push("คลังสินค้า: " + st.catalog_error);
    if (st.publishing === false) w.push("ตอนนี้เป็นโหมดทดสอบ: โพสต์ไม่ขึ้นหน้าเพจ");
    if (s.failed_attempts) w.push(`มีสินค้าที่โพสต์ไม่สำเร็จ ${s.failed_attempts} รายการ`);
    return w.length ? `<section class="grid"><div class="card warn-card"><h2>ต้องดู</h2>${w.map((x) => `<div>⚠️ ${esc(x)}</div>`).join("")}</div></section>` : "";
  }

  function render(s, updatedAt) {
    const t = s.totals || {}, st = s.status || {}, cat = s.catalog || {};
    const age = minutesAgo(updatedAt);
    const yt = s.youtube || {};
    const ytCount = (yt.sleep || []).length + (yt.freq || []).length;
    const posts = (s.posts || []).slice(0, 25).map((p) => `<tr>
        <td>${when(p.posted_at)}</td>
        <td class="prod">${p.post_url ? `<a href="${esc(p.post_url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td>
        <td>${esc(p.category || "")}</td>
        <td class="num">${baht(p.discount_price)}</td>
        <td class="num">${p.discount_percent ? `-${p.discount_percent}%` : "—"}</td>
        <td class="num">${p.reactions ?? 0}</td><td class="num">${p.comments ?? 0}</td>
        <td>${p.published ? '<span class="pill ok">ขึ้นเพจ</span>' : '<span class="pill off">ทดสอบ</span>'}</td></tr>`).join("");

    root.innerHTML = `
      <header class="top">
        <div><h1>Automation</h1>
          <div class="meta">
            <span>เพจ <b>${esc(s.page_name || "เรดาร์ของเด็ด")}</b></span>
            <span>${st.publishing ? '<span class="pill ok">เผยแพร่จริง</span>' : '<span class="pill warn">โหมดทดสอบ</span>'}</span>
            <span>Token ${st.token && st.token.valid ? '<span class="pill ok">ใช้ได้</span>' : '<span class="pill bad">ใช้ไม่ได้</span>'}</span>
            <span>โพสต์รอบถัดไป <b>${when(st.next_run)}</b></span>
            <span>อัปเดต <b>${age} นาทีที่แล้ว</b> ${age > 15 ? '<span class="pill warn">ข้อมูลเก่า</span>' : ""}</span>
          </div></div>
        <nav><a href="../portal/">Portal</a><a href="#" id="out">ออกจากระบบ</a></nav>
      </header>
      ${warnings(s)}
      <section class="grid kpis">
        <div class="card kpi"><h2>โพสต์ทั้งหมด</h2><div class="v" data-key="posts" data-count="${t.posts ?? 0}">${t.posts ?? 0}</div><div class="s">กันโพสต์ซ้ำ ${st.dedup_days ?? "—"} วัน</div></div>
        <div class="card kpi"><h2>7 วันล่าสุด</h2><div class="v" data-key="p7" data-count="${t.posts_7d ?? 0}">${t.posts_7d ?? 0}</div><div class="s">วันนี้ ${t.posts_today ?? 0} โพสต์</div></div>
        <div class="card kpi"><h2>Reactions</h2><div class="v pos" data-key="re" data-count="${t.reactions ?? 0}">${t.reactions ?? 0}</div><div class="s">แชร์ ${t.shares ?? 0}</div></div>
        <div class="card kpi"><h2>Comments</h2><div class="v" data-key="co" data-count="${t.comments ?? 0}">${t.comments ?? 0}</div><div class="s">ทุกโพสต์รวมกัน</div></div>
        <div class="card kpi"><h2>สินค้าในคิว</h2><div class="v" data-key="cat" data-count="${cat.remaining ?? 0}">${cat.remaining ?? 0}</div><div class="s">จากคลัง ${cat.size ?? "—"} ชิ้น</div></div>
        <div class="card kpi"><h2>คลิป YouTube</h2><div class="v" data-key="yt" data-count="${ytCount}">${ytCount}</div><div class="s">2 ช่อง · คลิปละ 10 ชม.</div></div>
      </section>

      <section class="grid two">
        <div class="card"><h2>โพสต์ต่อวัน (14 วัน)</h2>${perDayChart(s.posts_per_day)}
          <p class="muted" style="font-size:12px;margin:10px 0 0">โพสต์เวลา ${(st.post_hours || []).map((h) => `${h}:00`).join(", ") || "—"} น.</p></div>
        <div class="card"><h2>ช่องทาง</h2>${channels(yt)}</div>
      </section>

      <section class="grid two">
        <div class="card"><h2>หมวดสินค้าในคลัง</h2>${categoryBars(cat.by_category)}
          <p class="muted" style="font-size:12px;margin:10px 0 0">${esc(cat.source || "")} · อัปเดต ${when(cat.updated_at)} · ไม่โพสต์หมวด ${esc(cat.excluded_categories || "—")}</p></div>
        <div class="card"><h2>คิวโพสต์ถัดไป</h2>${(cat.queue || []).length ? `<ol class="queue">${cat.queue.map((q) =>
          `<li>${esc(q.name)} <span class="muted">· ${baht(q.discount_price)}${q.discount_percent ? ` · -${q.discount_percent}%` : ""}</span></li>`).join("")}</ol>` : '<p class="muted">—</p>'}
          <p class="muted" style="font-size:12px;margin:10px 0 0">ลิงก์สั้นพร้อมใช้ ${cat.short_links_ready ?? 0} ลิงก์</p></div>
      </section>

      <section class="grid">
        <div class="card"><h2>โพสต์ล่าสุด</h2><div class="tablewrap"><table>
          <thead><tr><th>เวลา</th><th>สินค้า</th><th>หมวด</th><th class="num">ราคา</th><th class="num">ลด</th><th class="num">❤</th><th class="num">💬</th><th>สถานะ</th></tr></thead>
          <tbody>${posts || '<tr><td colspan="8" class="muted">ยังไม่มี</td></tr>'}</tbody></table></div></div>
      </section>
      <p class="muted" style="font-size:12px">ข้อมูลจากคอม (โปรเจกต์ D:\\AFFI) อัปเดตทุก ~5 นาที · ยอด reactions/comments ดึงจาก Facebook เป็นระยะ</p>`;
    root.querySelector("#out").addEventListener("click", (e) => { e.preventDefault(); signOut(); });
    intro(root);
    countUp(root);
  }

  async function load() {
    const { data, error } = await sb.from("trade_state").select("summary, updated_at").eq("id", "automation").single();
    if (error || !data || !data.summary || !data.summary.totals) {
      root.innerHTML = `<div class="card muted">ยังไม่มีข้อมูลจากคอม${error ? `: ${esc(error.message)}` : ""}</div>`;
      return;
    }
    render(data.summary, data.updated_at);
  }

  (async () => {
    await requireAdmin(root);
    await load();
    setInterval(load, 60000);
  })();
})();
