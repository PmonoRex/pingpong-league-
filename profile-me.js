// "โปรไฟล์ของฉัน": the signed-in player edits their own nickname, catchphrase, picture and how they get paid,
// and the "โอน" sheet shows a payee's QR for an exact amount. Saved into the player's own profile in the shared
// league row under the same updated_at lock as every other league write. Needs shared.js, player-ui.js and promptpay.js;
// the QR encoder (vendor/qrcode-generator) is only needed to draw PromptPay codes.
const LeagueProfile = (() => {
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const UI = () => (typeof window !== "undefined" && window.LeagueUI) || null;
  const PP = () => (typeof window !== "undefined" && window.PromptPay) || (typeof PromptPay !== "undefined" ? PromptPay : null);
  const LIMITS = Object.freeze({ name: 30, tagline: 40, avatarSide: 96, ...(UI()?.LIMITS || { avatar: 12 * 1024, payQr: 20 * 1024 }) });
  const imageOk = (url, max) => UI()?.imageOk ? UI().imageOk(url, max) : false;

  // ---- pure rules (tests/profile.test.cjs) ----
  const cleanText = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  // Same rename rules as the Admin page: trimmed, not empty, not already used by another account (case-insensitive).
  function checkEdit(league, id, edit) {
    const person = league?.profiles?.[id];
    if (!person || person.active === false) return { error: "กรุณาเข้าสู่ระบบด้วยบัญชีที่เปิดใช้งาน" };
    const name = String(edit.displayName ?? "").trim();
    if (!name) return { error: "กรอกชื่อเล่นก่อน" };
    if (name.length > LIMITS.name) return { error: `ชื่อเล่นยาวได้ไม่เกิน ${LIMITS.name} ตัวอักษร` };
    if (Object.values(league.profiles).some(p => p && p.id !== id && String(p.displayName || "").toLowerCase() === name.toLowerCase())) return { error: "มีชื่อนี้แล้ว" };
    const clean = { displayName: name, tagline: cleanText(edit.tagline, LIMITS.tagline), avatar: "", promptpay: "", payQr: "" };
    if (edit.avatar) { if (!imageOk(edit.avatar, LIMITS.avatar)) return { error: "รูปโปรไฟล์ใหญ่เกินไป ลองเลือกรูปใหม่" }; clean.avatar = edit.avatar; }
    if (edit.payMethod === "promptpay") {
      const problem = PP().problem(edit.promptpay);
      if (problem) return { error: problem };
      clean.promptpay = PP().digits(edit.promptpay);
    } else if (edit.payMethod === "qr") {
      if (!imageOk(edit.payQr, LIMITS.payQr)) return { error: "ยังไม่ได้เลือกรูป QR หรือรูปใหญ่เกินไป" };
      clean.payQr = edit.payQr;
    }
    return { clean };
  }
  // Writes only what is needed: empty fields are removed rather than stored as "". Returns the changed field names.
  function applyEdit(person, clean) {
    const changed = [];
    ["displayName", "tagline", "avatar", "promptpay", "payQr"].forEach(key => {
      const before = person[key] || "", after = clean[key] || "";
      if (before === after) return;
      changed.push(key);
      if (after) person[key] = after; else delete person[key];
    });
    return changed;
  }
  // Source rectangle for a centred square crop.
  function coverRect(w, h) { const s = Math.min(w, h); return { sx: Math.round((w - s) / 2), sy: Math.round((h - s) / 2), sw: s, sh: s }; }
  function fitWithin(w, h, max) { const k = Math.min(1, max / Math.max(w, h)); return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }; }
  // Tries each [size, quality] step in order and keeps the first data URL that fits; "" when none does.
  function compress(encode, plan, max) {
    for (const [size, quality] of plan) { const url = encode(size, quality); if (imageOk(url, max)) return url; }
    return "";
  }
  const AVATAR_PLAN = [.82, .72, .62, .5, .38, .26].map(q => [LIMITS.avatarSide, q]);
  const QR_PLAN = [480, 400, 340, 280, 240].flatMap(s => [.8, .62, .45].map(q => [s, q]));
  function payeeByName(league, name) {
    const key = String(name ?? "").trim().toLowerCase();
    return key ? Object.values(league?.profiles || {}).find(p => p && p.active !== false && String(p.displayName || "").trim().toLowerCase() === key) || null : null;
  }
  function payMethod(person) {
    if (person?.promptpay && PP()?.kind(person.promptpay)) return { type: "promptpay", id: PP().digits(person.promptpay) };
    if (imageOk(person?.payQr, LIMITS.payQr)) return { type: "qr", url: person.payQr };
    return null;
  }
  const baht = amount => { const n = Math.round(Math.abs(Number(amount) || 0) * 100) / 100; return `฿${n.toLocaleString("th-TH", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`; };
  // PromptPay payload drawn as an SVG path (one 1x1 square per dark module, 4-module quiet zone).
  function qrSvg(text, label = "QR") {
    const make = typeof qrcode === "function" ? qrcode : (typeof window !== "undefined" ? window.qrcode : null);
    if (!text || !make) return "";
    const qr = make(0, "M"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), q = 4, size = n + q * 2;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
    return `<svg class="pay-qr-code" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  // ---- markup (escaped; tests/escape.test.cjs) ----
  const CLOSE = '<button type="button" class="me-close" data-me-close aria-label="ปิด"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
  const avatarOf = (person, size = "lg") => UI()?.avatar ? UI().avatar(person.id, person.displayName, size) : "";
  function payHtml({ payee, fromName = "", amount = 0 }) {
    const method = payMethod(payee), name = payee.displayName || payee.id, tagline = cleanText(payee.tagline, LIMITS.tagline);
    const sum = Number(amount) > 0 ? `<div class="pay-amount"><small>ยอดที่ต้องโอน</small><b>${esc(baht(amount))}</b></div>` : "";
    let body;
    if (method?.type === "promptpay") {
      const svg = qrSvg(PP().payload(method.id, amount), `QR PromptPay ของ ${name}`);
      body = `<figure class="pay-qr">${svg}<figcaption>PromptPay ${esc(PP().format(method.id))}${Number(amount) > 0 ? " • ใส่ยอดไว้ใน QR แล้ว" : ""}</figcaption></figure><div class="me-actions"><button type="button" class="secondary" data-pay-copy="${esc(method.id)}">คัดลอกเลข PromptPay</button>${Number(amount) > 0 ? `<button type="button" class="secondary" data-pay-copy="${esc(PP().amountText(amount))}">คัดลอกยอด</button>` : ""}</div>`;
    } else if (method?.type === "qr") {
      body = `<figure class="pay-qr"><img src="${esc(method.url)}" alt="QR รับเงินของ ${esc(name)}"><figcaption>${Number(amount) > 0 ? `QR นี้ไม่มียอดในตัว • พิมพ์ ${esc(baht(amount))} เองตอนสแกน` : "QR รับเงิน"}</figcaption></figure>`;
    } else {
      body = `<div class="pay-none"><b>${esc(name)} ยังไม่ได้ใส่ช่องทางรับเงิน</b><small>ให้ ${esc(name)} เปิด เครื่องมือ → โปรไฟล์ของฉัน แล้วใส่ PromptPay หรือรูป QR</small></div>`;
    }
    return `<div class="me-head"><div class="me-who">${avatarOf(payee)}<div><h2 id="payTitle">โอนให้ ${esc(name)}</h2>${tagline ? `<div class="me-tagline">“${esc(tagline)}”</div>` : ""}</div></div>${CLOSE}</div>${fromName ? `<div class="pay-from">${esc(fromName)} <span class="pay-arrow">จ่าย ➜</span> ${esc(name)}</div>` : ""}${sum}${body}<div class="pay-check">เว็บนี้ไม่ได้รับหรือโอนเงินเอง • ดูชื่อบัญชีในแอปธนาคารให้ตรงกับ ${esc(name)} ก่อนกดยืนยัน</div>`;
  }
  const RADIO = (value, label, on) => `<label class="me-seg-opt"><input type="radio" name="mePayMethod" value="${value}"${on ? " checked" : ""}><span>${label}</span></label>`;
  function sheetHtml(person, draft) {
    const preview = draft.avatar ? `<img src="${esc(draft.avatar)}" alt="">` : esc(UI()?.initials ? UI().initials(draft.displayName || person.displayName) : "?");
    return `<div class="me-head"><h2 id="meTitle">โปรไฟล์ของฉัน</h2>${CLOSE}</div>
<div class="me-pic"><span class="me-pic-preview" id="mePicPreview" style="--pa:${esc(UI()?.color ? UI().color(person.id) : "#3b322c")};--pa-fg:${esc(UI()?.inkOn ? UI().inkOn(person.id) : "#fff")}">${preview}</span><div class="me-pic-actions"><button type="button" class="secondary" data-me-pick="avatar">เลือกรูป</button><button type="button" class="secondary" id="meAvatarClear"${draft.avatar ? "" : " hidden"}>ลบรูป</button><small id="mePicInfo">ย่อเป็นรูปสี่เหลี่ยม 96×96 ก่อนบันทึก</small></div></div>
<div class="field"><label for="meName">ชื่อเล่น</label><input id="meName" maxlength="${LIMITS.name}" autocomplete="nickname" value="${esc(draft.displayName)}"></div>
<div class="field"><label for="meTagline">คำท้า <small id="meTagCount">${draft.tagline.length}/${LIMITS.tagline}</small></label><input id="meTagline" maxlength="${LIMITS.tagline}" placeholder="เช่น ตบไม่เลือกหน้า" value="${esc(draft.tagline)}"></div>
<fieldset class="me-pay"><legend>ช่องทางรับเงิน</legend><div class="me-seg">${RADIO("promptpay", "PromptPay", draft.payMethod === "promptpay")}${RADIO("qr", "รูป QR ธนาคาร", draft.payMethod === "qr")}${RADIO("", "ไม่ใส่", !draft.payMethod)}</div>
<div class="me-pay-box" id="mePromptPayBox"${draft.payMethod === "promptpay" ? "" : " hidden"}><label for="mePromptPay">เบอร์มือถือ หรือ เลขบัตรประชาชน 13 หลัก</label><input id="mePromptPay" inputmode="numeric" autocomplete="off" maxlength="20" placeholder="08x-xxx-xxxx" value="${esc(draft.promptpay)}" aria-describedby="mePromptPayWarn"><div class="me-warn" id="mePromptPayWarn">ใครเปิดเว็บก็เห็นเลขนี้</div><div class="me-err" id="mePromptPayErr" role="alert"></div></div>
<div class="me-pay-box" id="meQrBox"${draft.payMethod === "qr" ? "" : " hidden"}><div class="me-qr-row"><button type="button" class="secondary" data-me-pick="qr">${draft.payQr ? "เปลี่ยนรูป QR" : "เลือกรูป QR"}</button>${draft.payQr ? `<img class="me-qr-thumb" src="${esc(draft.payQr)}" alt="รูป QR ที่เลือก">` : ""}</div><div class="me-warn">ใครเปิดเว็บก็เห็นรูปนี้</div></div></fieldset>
<input type="file" accept="image/*" id="meFile" hidden>
<div class="me-status" id="meStatus" role="status"></div>
<div class="me-actions"><button type="button" class="primary" id="meSave">บันทึกโปรไฟล์</button><button type="button" class="secondary" data-me-close>ยกเลิก</button></div>`;
  }

  const api = { LIMITS, cleanText, checkEdit, applyEdit, coverRect, fitWithin, compress, AVATAR_PLAN, QR_PLAN, payeeByName, payMethod, baht, qrSvg, payHtml, sheetHtml };
  if (typeof document === "undefined" || !document.body || typeof LeagueShared === "undefined") return Object.freeze(api);

  // ---- page wiring ----
  const $ = id => document.getElementById(id);
  let sheet = null, lastFocus = null, draft = null, picking = "avatar", saving = false;
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement("div"); sheet.className = "me-backdrop"; sheet.hidden = true;
    sheet.innerHTML = '<div class="me-sheet" role="dialog" aria-modal="true" tabindex="-1"></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener("click", onClick); sheet.addEventListener("input", onInput); sheet.addEventListener("change", onChange);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !sheet.hidden) close(); });
    return sheet;
  }
  function show(html, labelId) {
    ensureSheet(); const box = sheet.firstElementChild;
    if (sheet.hidden) lastFocus = document.activeElement;
    box.innerHTML = html; box.setAttribute("aria-labelledby", labelId);
    sheet.hidden = false; document.body.classList.add("me-open"); box.focus({ preventScroll: true });
  }
  function close() { if (!sheet || sheet.hidden) return; sheet.hidden = true; draft = null; document.body.classList.remove("me-open"); lastFocus?.focus?.({ preventScroll: true }); }
  function toast(msg, tone = "") { if (window.LeagueToast) window.LeagueToast(msg, tone); else { const s = $("meStatus"); if (s) s.textContent = msg; } }
  async function freshLeague() {
    try { const row = (await LeagueShared.cloudRequest("league"))[0], latest = row?.league?.uidLeague; if (latest?.profiles) { LeagueShared.saveLocalLeague(latest); return latest; } } catch {}
    return LeagueShared.readLocalLeague();
  }
  // Other pages keep their own copy of the league; ask them to pull the new one now instead of on their next poll.
  function refreshPage() { ["pullCloud", "pull"].forEach(fn => { try { if (typeof window[fn] === "function") window[fn](); } catch {} }); try { UI()?.decorate?.(); } catch {} }

  async function openMine() {
    let league = LeagueShared.readLocalLeague(), id = league ? LeagueShared.sessionUserId(league) : "";
    if (!id) return alert("เข้าสู่ระบบก่อน แล้วค่อยแก้โปรไฟล์");
    const draw = person => {
      const method = payMethod(person);
      draft = { displayName: person.displayName || "", tagline: person.tagline || "", avatar: imageOk(person.avatar, LIMITS.avatar) ? person.avatar : "", payMethod: method?.type || "", promptpay: method?.type === "promptpay" ? PP().format(method.id) : "", payQr: method?.type === "qr" ? method.url : "" };
      show(sheetHtml(person, draft), "meTitle");
    };
    draw(league.profiles[id]);
    league = await freshLeague(); id = league ? LeagueShared.sessionUserId(league) : "";
    if (!id) return close();
    // Refill with the cloud copy unless the player already started typing.
    if (draft && !draft.touched) draw(league.profiles[id]);
  }
  function readForm() {
    draft.displayName = $("meName").value; draft.tagline = $("meTagline").value;
    draft.payMethod = sheet.querySelector('input[name="mePayMethod"]:checked')?.value || "";
    if ($("mePromptPay")) draft.promptpay = $("mePromptPay").value;
    return draft;
  }
  async function save() {
    if (saving) return; readForm();
    const local = LeagueShared.readLocalLeague(), id = local ? LeagueShared.sessionUserId(local) : "";
    const first = checkEdit(local, id, draft); if (first.error) return status(first.error, "bad");
    saving = true; $("meSave").disabled = true; status("กำลังบันทึก…");
    try {
      for (let attempt = 0; attempt < LeagueShared.LOCK_TRIES; attempt++) {
        if (attempt) await LeagueShared.lockBackoff(attempt - 1);
        const row = (await LeagueShared.cloudRequest("league,updated_at"))[0], latest = row?.league?.uidLeague;
        if (!latest?.profiles) throw new Error("ไม่พบข้อมูลลีก");
        const me = LeagueShared.sessionUserId(latest); if (!me) throw new Error("กรุณาเข้าสู่ระบบใหม่");
        const check = checkEdit(latest, me, draft); if (check.error) throw new Error(check.error);
        const oldName = latest.profiles[me].displayName, changed = applyEdit(latest.profiles[me], check.clean);
        if (!changed.length) { close(); return toast("ไม่มีอะไรเปลี่ยน"); }
        // The audit trail records which fields changed, never the number or the pictures.
        LeagueShared.audit(latest, "profile_update", me, { target: me, fields: changed, ...(changed.includes("displayName") ? { from: oldName, to: check.clean.displayName } : {}) });
        const now = new Date().toISOString(), expected = row.updated_at || "";
        const saved = await LeagueShared.cloudRequest("league,updated_at", "PATCH", { league: { ...(row.league || {}), uidLeague: latest }, updated_at: now }, expected ? `updated_at=eq.${encodeURIComponent(expected)}` : "");
        if (saved?.length) { LeagueShared.saveLocalLeague(latest); close(); refreshPage(); return toast("บันทึกโปรไฟล์แล้ว", "good"); }
      }
      throw new Error("มีคนบันทึกพร้อมกัน ลองกดบันทึกอีกครั้ง");
    } catch (error) { status(`บันทึกไม่ได้: ${error.message}`, "bad"); }
    finally { saving = false; const b = $("meSave"); if (b) b.disabled = false; }
  }
  function status(text, tone = "") { const s = $("meStatus"); if (s) { s.textContent = text; s.className = `me-status ${tone}`; } }

  async function decode(file) {
    if (!/^image\//.test(file.type || "image/")) throw new Error("ไฟล์นี้ไม่ใช่รูป");
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch {} }
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
  }
  // Draws the picture onto a white canvas at the requested size and encodes it (WebP where supported, else JPEG).
  function encoder(source, square) {
    const w0 = source.width, h0 = source.height, crop = square ? coverRect(w0, h0) : { sx: 0, sy: 0, sw: w0, sh: h0 };
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d");
    return (size, quality) => {
      const { w, h } = square ? { w: size, h: size } : fitWithin(w0, h0, size);
      canvas.width = w; canvas.height = h; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
      const webp = canvas.toDataURL("image/webp", quality);
      return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
    };
  }
  async function pick(file) {
    const kind = picking; status("กำลังย่อรูป…");
    try {
      const source = await decode(file), url = kind === "avatar" ? compress(encoder(source, true), AVATAR_PLAN, LIMITS.avatar) : compress(encoder(source, false), QR_PLAN, LIMITS.payQr);
      source.close?.();
      if (!url || !draft) return status("ย่อรูปให้เล็กพอไม่ได้ ลองรูปอื่น", "bad");
      readForm(); draft.touched = true;
      if (kind === "avatar") draft.avatar = url; else { draft.payQr = url; draft.payMethod = "qr"; }
      const person = LeagueShared.readLocalLeague()?.profiles?.[LeagueShared.sessionUserId(LeagueShared.readLocalLeague())];
      if (!person) return;
      show(sheetHtml(person, draft), "meTitle");
      status(`ย่อรูปแล้ว (${Math.ceil(url.length / 1024)} KB) • กดบันทึกเพื่อใช้รูปนี้`);
    } catch (error) { status(error.message || "เปิดรูปนี้ไม่ได้", "bad"); }
  }
  function onClick(e) {
    if (e.target === sheet || e.target.closest("[data-me-close]")) return close();
    const p = e.target.closest("[data-me-pick]"); if (p) { picking = p.dataset.mePick; const f = $("meFile"); f.value = ""; return f.click(); }
    if (e.target.closest("#meAvatarClear")) { readForm(); draft.touched = true; draft.avatar = ""; const person = LeagueShared.readLocalLeague()?.profiles?.[LeagueShared.sessionUserId(LeagueShared.readLocalLeague())]; if (person) show(sheetHtml(person, draft), "meTitle"); return; }
    if (e.target.closest("#meSave")) return save();
    const c = e.target.closest("[data-pay-copy]"); if (c) copy(c.dataset.payCopy);
  }
  function onInput(e) {
    if (!draft) return; draft.touched = true;
    if (e.target.id === "meTagline") $("meTagCount").textContent = `${e.target.value.length}/${LIMITS.tagline}`;
    if (e.target.id === "mePromptPay") { const d = PP().digits(e.target.value); $("mePromptPayErr").textContent = d.length >= 10 ? PP().problem(d) : ""; }
  }
  function onChange(e) {
    if (e.target.id === "meFile" && e.target.files?.[0]) return pick(e.target.files[0]);
    if (e.target.name === "mePayMethod") { $("mePromptPayBox").hidden = e.target.value !== "promptpay"; $("meQrBox").hidden = e.target.value !== "qr"; if (draft) draft.touched = true; }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("คัดลอกแล้ว", "good"); } catch { prompt("คัดลอกข้อความนี้", text); }
  }

  // "โอน" buttons anywhere on the page: data-pay-to-id or data-pay-to-name, plus data-pay-amount and data-pay-from.
  async function openPay({ toId = "", toName = "", fromName = "", amount = 0 }) {
    const find = league => (toId ? LeagueShared.activeProfile(league, toId) : payeeByName(league, toName));
    let payee = find(LeagueShared.readLocalLeague());
    if (payee) show(payHtml({ payee, fromName, amount }), "payTitle");
    const league = await freshLeague(), fresh = find(league);
    if (fresh) show(payHtml({ payee: fresh, fromName, amount }), "payTitle");
    else if (!payee) show(`<div class="me-head"><h2 id="payTitle">โอนให้ ${esc(toName || toId)}</h2>${CLOSE}</div><div class="pay-none"><b>ไม่พบบัญชีชื่อนี้ในลีก</b><small>ชื่อในหน้านี้ต้องตรงกับชื่อเล่นในลีก ถึงจะดึง QR รับเงินมาให้ได้</small></div>`, "payTitle");
  }
  document.addEventListener("click", e => {
    const b = e.target.closest?.("[data-pay-to-id],[data-pay-to-name]"); if (!b) return;
    e.preventDefault(); openPay({ toId: b.dataset.payToId || "", toName: b.dataset.payToName || "", fromName: b.dataset.payFrom || "", amount: Number(b.dataset.payAmount) || 0 });
  });
  // Entry points: the ☰ เครื่องมือ menu button and the signed-in player's name in the account strip.
  function bindEntry() {
    $("openMyProfile")?.addEventListener("click", openMine);
    const who = $("whoami");
    if (who && !who.dataset.meBound) {
      who.dataset.meBound = "1"; who.classList.add("me-entry"); who.setAttribute("role", "button"); who.tabIndex = 0; who.title = "แก้โปรไฟล์ของฉัน";
      who.addEventListener("click", openMine); who.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMine(); } });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindEntry); else bindEntry();
  return Object.freeze({ ...api, openMine, openPay, close });
})();
if (typeof window !== "undefined") window.LeagueProfile = LeagueProfile;
