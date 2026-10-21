// Admin: choose which demo strategies run. Saves trade_config.enabled; the PC agent picks it up
// within ~5 minutes, restarts MT5 with the new chart set and reports the applied version back.
(function () {
  const { sb, esc, money, cls, requireAdmin, signOut } = window.Trade;
  const root = document.getElementById("root");
  let summary = null, config = null;

  async function load() {
    const [st, cf] = await Promise.all([
      sb.from("trade_state").select("summary, updated_at").eq("id", "demo").single(),
      sb.from("trade_config").select("enabled, version, updated_at").eq("id", "demo").single(),
    ]);
    if (st.error || cf.error) {
      root.innerHTML = `<div class="card err">โหลดข้อมูลไม่สำเร็จ: ${esc((st.error || cf.error).message)}</div>`;
      return false;
    }
    summary = st.data.summary; config = cf.data;
    return true;
  }

  function render() {
    if (!summary || !summary.strategies) {
      root.innerHTML = `<div class="card muted">ยังไม่มีข้อมูลจากคอม (รอสคริปต์ส่งข้อมูลรอบแรก)</div>`;
      return;
    }
    const applied = summary.config_version_applied;
    const pending = config.version > 1 && applied !== config.version;
    const groups = { gold: "ทองคำ (XAUUSD)", other: "ตลาดอื่น" };
    const byGroup = {};
    for (const s of summary.strategies) (byGroup[s.group || "other"] ||= []).push(s);

    const section = (g) => `
      <div class="card"><h2>${esc(groups[g] || g)}</h2>
      ${byGroup[g].map((s) => `
        <div class="srow">
          <label class="switch"><input type="checkbox" data-name="${esc(s.name)}" ${s.enabled ? "checked" : ""}><span></span></label>
          <div class="info">
            <div class="name">${esc(s.name)} <span class="muted" style="font-weight:400">· ${esc(s.symbol)} ${esc(s.period)}</span>
              ${s.position ? `<span class="pill warn">มีไม้เปิด ${esc(s.position.dir)} ${money(s.position.profit)}</span>` : ""}</div>
            <div class="lbl">${esc(s.label)}</div>
            <div class="tested">Backtest: ${esc(s.tested)} · Demo: ${s.trades} ไม้, <span class="${cls(s.total_r)}">${s.total_r >= 0 ? "+" : ""}${s.total_r.toFixed(2)}R</span></div>
          </div>
        </div>`).join("")}
      </div>`;

    root.innerHTML = `
      <header class="top">
        <div><h1>Dopdep · แอดมิน</h1>
          <div class="meta"><span>เลือกกลยุทธ์ที่จะให้บอทรันบนบัญชี Demo</span></div></div>
        <nav><a href="../portal/">Portal</a><a href="index.html">แดชบอร์ด</a><a href="#" id="out">ออกจากระบบ</a></nav>
      </header>
      <div class="bar card">
        <div>
          ${pending ? `<span class="pill warn">รอคอมนำไปใช้ (config v${config.version}, คอมใช้อยู่ v${applied ?? "—"})</span>`
                    : `<span class="pill ok">คอมใช้ค่าล่าสุดแล้ว (v${applied ?? config.version})</span>`}
          <div class="muted" style="font-size:12px;margin-top:6px">บันทึกแล้วคอมจะนำไปใช้ภายใน ~5 นาที: ปิด MT5 → สร้างกราฟใหม่ตามที่เลือก → เปิด MT5 ใหม่ · ไม้ที่เปิดอยู่ของกลยุทธ์ที่ถูกปิดจะยังคงมี SL/TP ที่ server</div>
        </div>
        <div><button id="save" class="primary">บันทึก</button></div>
      </div>
      <div class="err" id="msg"></div>
      <section class="grid two">${Object.keys(byGroup).map(section).join("")}</section>`;

    root.querySelector("#out").addEventListener("click", (e) => { e.preventDefault(); signOut(); });
    root.querySelector("#save").addEventListener("click", save);
    root.querySelectorAll("input[data-name]").forEach((el) => el.addEventListener("change", () => { dirty = true; }));
  }
  let dirty = false;   // unsaved toggles: don't let the auto-refresh wipe them

  async function save() {
    const btn = root.querySelector("#save"), msg = root.querySelector("#msg");
    const enabled = {};
    root.querySelectorAll("input[data-name]").forEach((el) => { enabled[el.dataset.name] = el.checked; });
    if (!Object.values(enabled).some(Boolean)) { msg.textContent = "ต้องเปิดอย่างน้อย 1 กลยุทธ์"; return; }
    btn.disabled = true; msg.textContent = "";
    const { error } = await sb.from("trade_config").update({ enabled }).eq("id", "demo");
    btn.disabled = false;
    if (error) { msg.textContent = "บันทึกไม่สำเร็จ: " + error.message; return; }
    dirty = false;
    if (await load()) render();
  }

  (async () => {
    await requireAdmin(root);
    if (await load()) render();
    setInterval(async () => { if (!dirty && !document.querySelector("#save:disabled") && await load()) render(); }, 60000);
  })();
})();
