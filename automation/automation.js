// Automation page: the D:\AFFI project's report (affiliate auto-post to the Facebook Page + YouTube uploads),
// pushed by the PC agent (tools/trade_sync.py) to trade_state row 'automation'.
(function () {
  const { sb, esc, requireAdmin, signOut, intro, countUp } = window.Trade;
  const root = document.getElementById("root");

  const FB_PAGE = "https://www.facebook.com/376271472246385";
  const CHANNELS = [
    { key: "sleep", icon: "🌙", title: "Deep Sleep Haven", url: "https://www.youtube.com/channel/UCk1SprHveCLj6pnuPuCdUuQ", what: "เสียงธรรมชาติช่วยนอน",
      days: [0, 1, 3, 5], hour: 1, minute: 30, schedule: "อา. จ. พ. ศ. 01:30" },
    { key: "freq", icon: "🎵", title: "Solfeggio Haven", url: "https://www.youtube.com/channel/UCXa9r-jEp0NPVC-CtgA6CvQ", what: "เพลงคลื่นความถี่ Solfeggio",
      days: [2, 4, 6], hour: 3, minute: 0, schedule: "อ. พฤ. ส. 03:00" },
  ];
  const TABS = [["fb", "🛍️ Facebook"], ["yt", "▶️ YouTube"]];
  let tab = (location.hash || "").slice(1) === "yt" ? "yt" : "fb";
  let last = null;

  // รอบอัปถัดไปของช่อง (ตามตารางงานอัตโนมัติในคอม)
  function nextUpload(c) {
    const d = new Date();
    for (let i = 0; i < 8; i++) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, c.hour, c.minute);
      if (t > d && c.days.includes(t.getDay())) return t.toISOString();
    }
    return null;
  }

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

  function ytChannel(c, list) {
    const hours = list.reduce((a, u) => a + (Number(u.hours) || 0), 0);
    const latest = list[list.length - 1];
    const rows = list.slice().reverse().map((u) => `<tr>
        <td>${whenIso(u.at)}</td>
        <td class="prod">${u.url ? `<a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title || u.url)}</a>` : esc(u.title || "—")}</td>
        <td class="num">${u.hours ?? "—"}</td></tr>`).join("");
    return `<div class="card">
      <a class="chan" href="${c.url}" target="_blank" rel="noopener"><span class="ico">${c.icon}</span>
        <span><span class="t">${esc(c.title)}</span><br><span class="d">${esc(c.what)} · ลง ${esc(c.schedule)}</span></span><span class="go">เปิดช่อง ↗</span></a>
      <div class="ytstats">
        <div><b data-count="${list.length}">${list.length}</b><span>คลิป</span></div>
        <div><b>${hours}</b><span>ชั่วโมงรวม</span></div>
        <div><b class="sm">${latest ? whenIso(latest.at) : "—"}</b><span>อัปล่าสุด</span></div>
        <div><b class="sm">${whenIso(nextUpload(c))}</b><span>รอบถัดไป</span></div>
      </div>
      <div class="tablewrap"><table><thead><tr><th>อัปเมื่อ</th><th>คลิป</th><th class="num">ชม.</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">ยังไม่มีคลิป</td></tr>'}</tbody></table></div>
    </div>`;
  }

  function youtube(yt) {
    const total = CHANNELS.reduce((a, c) => a + ((yt[c.key] || []).length), 0);
    return `
      <section class="grid kpis">
        <div class="card kpi"><h2>คลิปทั้งหมด</h2><div class="v" data-count="${total}">${total}</div><div class="s">${CHANNELS.length} ช่อง</div></div>
        ${CHANNELS.map((c) => `<div class="card kpi"><h2>${c.icon} ${esc(c.title)}</h2><div class="v">${(yt[c.key] || []).length}</div><div class="s">ลง ${esc(c.schedule)}</div></div>`).join("")}
      </section>
      <section class="grid two">${CHANNELS.map((c) => ytChannel(c, yt[c.key] || [])).join("")}</section>
      <p class="muted" style="font-size:12px">คลิปละ 7–11 ชม. · ชื่อ/คำอธิบาย 12 ภาษา · ยอดวิวดูได้ใน YouTube Studio ของแต่ละช่อง</p>`;
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
    last = [s, updatedAt];
    const t = s.totals || {}, st = s.status || {}, cat = s.catalog || {};
    const age = minutesAgo(updatedAt);
    const yt = s.youtube || {};
    const posts = (s.posts || []).slice(0, 25).map((p) => `<tr>
        <td>${when(p.posted_at)}</td>
        <td class="prod">${p.post_url ? `<a href="${esc(p.post_url)}" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}</td>
        <td>${esc(p.category || "")}</td>
        <td class="num">${baht(p.discount_price)}</td>
        <td class="num">${p.discount_percent ? `-${p.discount_percent}%` : "—"}</td>
        <td class="num">${p.reactions ?? 0}</td><td class="num">${p.comments ?? 0}</td>
        <td>${p.published ? '<span class="pill ok">ขึ้นเพจ</span>' : '<span class="pill off">ทดสอบ</span>'}</td></tr>`).join("");

    const fbSection = `
      ${warnings(s)}
      <section class="grid kpis">
        <div class="card kpi"><h2>โพสต์ทั้งหมด</h2><div class="v" data-key="posts" data-count="${t.posts ?? 0}">${t.posts ?? 0}</div><div class="s">กันโพสต์ซ้ำ ${st.dedup_days ?? "—"} วัน</div></div>
        <div class="card kpi"><h2>7 วันล่าสุด</h2><div class="v" data-key="p7" data-count="${t.posts_7d ?? 0}">${t.posts_7d ?? 0}</div><div class="s">วันนี้ ${t.posts_today ?? 0} โพสต์</div></div>
        <div class="card kpi"><h2>Reactions</h2><div class="v pos" data-key="re" data-count="${t.reactions ?? 0}">${t.reactions ?? 0}</div><div class="s">แชร์ ${t.shares ?? 0}</div></div>
        <div class="card kpi"><h2>Comments</h2><div class="v" data-key="co" data-count="${t.comments ?? 0}">${t.comments ?? 0}</div><div class="s">ทุกโพสต์รวมกัน</div></div>
        <div class="card kpi"><h2>สินค้าในคิว</h2><div class="v" data-key="cat" data-count="${cat.remaining ?? 0}">${cat.remaining ?? 0}</div><div class="s">จากคลัง ${cat.size ?? "—"} ชิ้น</div></div>
        <div class="card kpi"><h2>โพสต์รอบถัดไป</h2><div class="v sm">${when(st.next_run)}</div><div class="s">${st.publishing ? "เผยแพร่จริง" : "โหมดทดสอบ"} · Token ${st.token && st.token.valid ? "ใช้ได้" : "ใช้ไม่ได้"}</div></div>
      </section>

      <section class="grid two">
        <div class="card"><h2>โพสต์ต่อวัน (14 วัน)</h2>${perDayChart(s.posts_per_day)}
          <p class="muted" style="font-size:12px;margin:10px 0 0">โพสต์เวลา ${(st.post_hours || []).map((h) => `${h}:00`).join(", ") || "—"} น.</p></div>
        <div class="card"><h2>เพจ</h2><a class="chan" href="${FB_PAGE}" target="_blank" rel="noopener"><span class="ico">🛍️</span>
          <span><span class="t">${esc(s.page_name || "เรดาร์ของเด็ด")}</span><br><span class="d">เพจ Facebook · โพสต์สินค้า Shopee อัตโนมัติ</span></span><span class="go">เปิด ↗</span></a></div>
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
      <p class="muted" style="font-size:12px">ยอด reactions/comments ดึงจาก Facebook เป็นระยะ</p>`;

    root.innerHTML = `
      <header class="top">
        <div><h1>Automation</h1>
          <div class="meta">
            <span>ข้อมูลจากคอม (D:\\AFFI) อัปเดต <b>${age} นาทีที่แล้ว</b> ${age > 15 ? '<span class="pill warn">ข้อมูลเก่า</span>' : ""}</span>
          </div></div>
        <nav><a href="../portal/">Portal</a><a href="#" id="out">ออกจากระบบ</a></nav>
      </header>
      <div class="tabs" role="tablist">${TABS.map(([k, label]) =>
        `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}" class="${tab === k ? "on" : ""}">${label}${k === "fb" && s.failed_attempts ? " ⚠️" : ""}</button>`).join("")}</div>
      ${tab === "fb" ? fbSection : youtube(yt)}`;
    root.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
      tab = b.dataset.tab;
      history.replaceState(null, "", "#" + tab);
      render(...last);
    }));
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
