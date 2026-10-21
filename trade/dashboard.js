// Dashboard: reads the summary the PC agent writes to trade_state and renders it.
(function () {
  const { sb, esc, money, plain, cls, requireAdmin, signOut } = window.Trade;
  const root = document.getElementById("root");

  function minutesAgo(iso) {
    return Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  }

  function statusPill(s) {
    if (!s.enabled) return `<span class="pill off">ปิดอยู่</span>`;
    if (!s.alive) return `<span class="pill bad">ไม่ตอบสนอง</span>`;
    if (s.algo === false) return `<span class="pill warn">Algo ปิด</span>`;
    return `<span class="pill ok">ทำงาน</span>`;
  }

  function calendar(trades) {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const byDay = {};
    for (const t of trades) {
      const [d] = t.close.split(" ");              // "2026.10.21"
      const [yy, mm, dd] = d.split(".").map(Number);
      if (yy === y && mm === m + 1) {
        byDay[dd] = byDay[dd] || { p: 0, n: 0 };
        byDay[dd].p += t.profit; byDay[dd].n += 1;
      }
    }
    const first = new Date(y, m, 1).getDay();      // 0 = Sun
    const days = new Date(y, m + 1, 0).getDate();
    let html = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"].map((h) => `<div class="hd">${h}</div>`).join("");
    for (let i = 0; i < first; i++) html += "<div class='hd'></div>";
    for (let d = 1; d <= days; d++) {
      const v = byDay[d];
      const c = v ? (v.p >= 0 ? "win" : "loss") : "";
      // compact amount (e.g. −7.9k) so it fits narrow day cells; full value in the tooltip
      const short = v ? (v.p >= 0 ? "+" : "−") + (Math.abs(v.p) >= 1000 ? (Math.abs(v.p) / 1000).toFixed(1) + "k" : Math.abs(v.p).toFixed(0)) : "";
      html += `<div class="${c}" ${v ? `title="${money(v.p)} · ${v.n} ไม้"` : ""}><span class="d">${d}</span>${v ? `<div class="p ${cls(v.p)}">${short}</div><span class="d">${v.n} ไม้</span>` : ""}</div>`;
    }
    return `<div class="cal">${html}</div>`;
  }

  function equityChart(trades, start) {
    const pts = [start];
    for (const t of trades) pts.push(pts[pts.length - 1] + t.profit);
    if (pts.length < 2) return `<p class="muted">ยังไม่มีไม้ที่ปิด</p>`;
    const w = 600, h = 220, pad = 24;
    const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
    const x = (i) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
    const yv = (v) => h - pad - ((v - lo) / span) * (h - 2 * pad);
    const line = pts.map((v, i) => `${x(i).toFixed(1)},${yv(v).toFixed(1)}`).join(" ");
    const base = yv(start);
    const col = pts[pts.length - 1] >= start ? "var(--win)" : "var(--lose)";
    const area = `${x(0).toFixed(1)},${h - pad} ${line} ${x(pts.length - 1).toFixed(1)},${h - pad}`;
    return `<svg class="eq" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Equity curve">
      <defs><linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style="stop-color:${col};stop-opacity:.28"/><stop offset="1" style="stop-color:${col};stop-opacity:0"/></linearGradient></defs>
      <polygon points="${area}" fill="url(#eqfill)"/>
      <line x1="${pad}" x2="${w - pad}" y1="${base}" y2="${base}" style="stroke:rgba(255,255,255,.16)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>
      <polyline points="${line}" fill="none" style="stroke:${col}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <text x="${pad}" y="14" style="fill:var(--muted)" font-size="11">${plain(hi)}</text>
      <text x="${pad}" y="${h - 6}" style="fill:var(--muted)" font-size="11">${plain(lo)}</text>
    </svg>`;
  }

  function render(sum, updatedAt) {
    const acc = sum.account || {};
    const start = sum.start_balance || 100000;
    const trades = sum.trades || [];
    const net = (acc.balance ?? start) - start;
    const wins = trades.filter((t) => t.profit > 0).length;
    const today = (acc.server_time || "").slice(0, 10);   // trade times are broker server time ("2026.10.21")
    const todayPl = trades.filter((t) => t.close.startsWith(today)).reduce((a, t) => a + t.profit, 0);
    const alive = sum.strategies.filter((s) => s.enabled && s.alive).length;
    const enabled = sum.strategies.filter((s) => s.enabled).length;
    const age = minutesAgo(updatedAt);
    const open = sum.strategies.filter((s) => s.position);
    const totalR = trades.reduce((a, t) => a + t.r, 0);

    const rows = sum.strategies.map((s) => `
      <tr>
        <td><b>${esc(s.name)}</b><div class="muted" style="font-size:11px">${esc(s.symbol)} · ${esc(s.period)}</div></td>
        <td>${statusPill(s)}</td>
        <td>${s.position ? `<span class="${s.position.dir === "BUY" ? "pos" : "neg"}">${s.position.dir}</span> ${s.position.lots} · <span class="${cls(s.position.profit)}">${money(s.position.profit)}</span>` : "—"}</td>
        <td class="num">${s.trades}</td>
        <td class="num">${s.trades ? Math.round((s.wins / s.trades) * 100) + "%" : "—"}</td>
        <td class="num ${cls(s.total_r)}">${s.trades ? (s.total_r >= 0 ? "+" : "") + s.total_r.toFixed(2) + "R" : "—"}</td>
        <td class="num ${cls(s.net)}">${s.trades ? money(s.net) : "—"}</td>
        <td class="sig">${esc(s.enabled ? (s.signal || "") : "")}</td>
      </tr>`).join("");

    const recent = trades.slice(-15).reverse().map((t) => `
      <tr><td>${esc(t.close.slice(5, 16))}</td><td>${esc(t.strategy)}</td><td>${esc(t.symbol)}</td>
      <td class="${t.dir === "BUY" ? "pos" : "neg"}">${esc(t.dir)}</td><td>${esc(t.reason)}</td>
      <td class="num ${cls(t.r)}">${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}R</td><td class="num ${cls(t.profit)}">${money(t.profit)}</td></tr>`).join("");

    root.innerHTML = `
      <header class="top">
        <div><h1>Dopdep · Demo</h1>
          <div class="meta">
            <span>บอททำงาน <b>${alive}/${enabled}</b></span>
            <span>MT5 ${sum.terminal_running ? '<span class="pill ok">เปิดอยู่</span>' : '<span class="pill bad">ปิด</span>'}</span>
            <span>อัปเดตล่าสุด <b>${age} นาทีที่แล้ว</b> ${age > 15 ? '<span class="pill warn">ข้อมูลเก่า</span>' : ""}</span>
            <span>เวลา server <b>${esc(acc.server_time || "—")}</b></span>
          </div></div>
        <nav><a href="../portal/">Portal</a><a href="admin.html">แอดมิน</a><a href="#" id="out">ออกจากระบบ</a></nav>
      </header>

      <section class="grid kpis">
        <div class="card kpi"><h2>Balance</h2><div class="v">${plain(acc.balance)}</div><div class="s">เริ่ม ${plain(start)}</div></div>
        <div class="card kpi"><h2>Equity</h2><div class="v">${plain(acc.equity)}</div><div class="s">floating ${money((acc.equity ?? 0) - (acc.balance ?? 0))}</div></div>
        <div class="card kpi"><h2>กำไร/ขาดทุนรวม</h2><div class="v ${cls(net)}">${money(net)}</div><div class="s">${((net / start) * 100).toFixed(2)}%</div></div>
        <div class="card kpi"><h2>วันนี้</h2><div class="v ${cls(todayPl)}">${money(todayPl)}</div><div class="s">วันตาม server</div></div>
        <div class="card kpi"><h2>ไม้ที่ปิด</h2><div class="v">${trades.length}</div><div class="s">ชนะ ${trades.length ? Math.round((wins / trades.length) * 100) : 0}% · ${totalR >= 0 ? "+" : ""}${totalR.toFixed(2)}R</div></div>
        <div class="card kpi"><h2>เปิดอยู่</h2><div class="v">${open.length}</div><div class="s">${open.map((s) => esc(s.name)).join(", ") || "—"}</div></div>
      </section>

      <section class="grid two">
        <div class="card"><h2>กราฟพอร์ต (ไม้ที่ปิดแล้ว)</h2>${equityChart(trades, start)}</div>
        <div class="card"><h2>ปฏิทินกำไร/ขาดทุน · ${new Date().toLocaleDateString("th-TH", { month: "long", year: "numeric" })}</h2>${calendar(trades)}</div>
      </section>

      <section class="grid">
        <div class="card"><h2>กลยุทธ์ทั้งหมด</h2><div class="tablewrap"><table>
          <thead><tr><th>กลยุทธ์</th><th>สถานะ</th><th>ไม้ที่เปิด</th><th class="num">ไม้</th><th class="num">ชนะ</th><th class="num">Total R</th><th class="num">กำไร</th><th>กำลังรอ</th></tr></thead>
          <tbody>${rows}</tbody></table></div></div>
      </section>

      <section class="grid">
        <div class="card"><h2>ไม้ล่าสุด</h2><div class="tablewrap"><table>
          <thead><tr><th>ปิดเมื่อ</th><th>กลยุทธ์</th><th>Symbol</th><th>ทิศ</th><th>เหตุผล</th><th class="num">R</th><th class="num">กำไร</th></tr></thead>
          <tbody>${recent || '<tr><td colspan="7" class="muted">ยังไม่มี</td></tr>'}</tbody></table></div></div>
      </section>
      <p class="muted" style="font-size:12px">บัญชี Demo · ข้อมูลอัปเดตจากคอมทุก ~5 นาที · R = กำไรเทียบความเสี่ยงต่อไม้</p>`;
    root.querySelector("#out").addEventListener("click", (e) => { e.preventDefault(); signOut(); });
  }

  async function load() {
    const { data, error } = await sb.from("trade_state").select("summary, updated_at").eq("id", "demo").single();
    if (error) { root.innerHTML = `<div class="card err">โหลดข้อมูลไม่สำเร็จ: ${esc(error.message)}</div>`; return; }
    if (!data.summary || !data.summary.strategies) { root.innerHTML = `<div class="card muted">ยังไม่มีข้อมูลจากคอม (รอสคริปต์ส่งข้อมูลรอบแรก)</div>`; return; }
    render(data.summary, data.updated_at);
  }

  (async () => {
    await requireAdmin(root);
    await load();
    setInterval(load, 60000);
  })();
})();
