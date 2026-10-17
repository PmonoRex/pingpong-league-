const KEY = LeagueShared.LEAGUE_KEY;
const esc = LeagueShared.escapeHtml;
let state = LeagueShared.readLocalLeague();
let currentUserId = state ? LeagueShared.sessionUserId(state) : "";
let saving = false;

const profile = id => LeagueShared.profile(state, id);
const isAdmin = () => LeagueShared.isAdmin(state, currentUserId);
const cloudRequest = (method = "GET", body = null, extraQuery = "") => LeagueShared.cloudRequest("league,updated_at", method, body, extraQuery);
const statusElement = document.getElementById("adminStatus");
function setStatus(message) { statusElement.textContent = message; }
function leaveIfNotAdmin() { if (isAdmin()) return false; location.replace("index.html"); return true; }

async function loadCloud() {
  try {
    const row = (await cloudRequest())[0], latest = row?.league?.uidLeague;
    if (!latest?.profiles) throw new Error("ไม่พบข้อมูลบัญชีในระบบ");
    state = latest; LeagueShared.saveLocalLeague(state); currentUserId = LeagueShared.sessionUserId(state);
    if (leaveIfNotAdmin()) return; render(); setStatus("ออนไลน์ • ข้อมูลบัญชีล่าสุด");
  } catch (error) { if (leaveIfNotAdmin()) return; render(); setStatus("เชื่อมต่อไม่ได้ • ดูข้อมูลในเครื่องได้ แต่ยังแก้บัญชีไม่ได้"); }
}

async function mutate(change) {
  if (saving) return false; saving = true; setStatus("กำลังตรวจข้อมูลล่าสุด...");
  try {
    const row = (await cloudRequest())[0], latest = row?.league?.uidLeague;
    if (!latest?.profiles) throw new Error("ไม่พบข้อมูลบัญชีในระบบ");
    currentUserId = LeagueShared.sessionUserId(latest);
    if (!LeagueShared.isAdmin(latest, currentUserId)) { state = latest; LeagueShared.saveLocalLeague(state); leaveIfNotAdmin(); return false; }
    const updated = structuredClone(latest);
    if (change(updated) === false) { setStatus("ออนไลน์ • ไม่มีการเปลี่ยนแปลง"); return false; }
    setStatus("กำลังบันทึก...");
    const now = new Date().toISOString();
    const expected = row?.updated_at || "";
    const filter = expected ? `updated_at=eq.${encodeURIComponent(expected)}` : "";
    const saved = await cloudRequest("PATCH", { league: { ...(row.league || {}), uidLeague: updated }, updated_at: now }, filter);
    if (!saved?.length) throw new Error("ข้อมูลถูกแก้จากอีกเครื่อง กรุณาลองใหม่");
    state = updated; LeagueShared.saveLocalLeague(state); render(); setStatus("ออนไลน์ • บันทึกแล้ว"); return true;
  } catch (error) { setStatus(`บันทึกไม่ได้: ${error.message}`); await loadCloud(); return false; }
  finally { saving = false; }
}

function render() {
  document.getElementById("accounts").innerHTML = Object.values(state?.profiles || {})
    .sort((a, b) => (b.role === "admin") - (a.role === "admin") || a.displayName.localeCompare(b.displayName, "th"))
    .map(person => `<div class="account ${person.active === false ? "off" : ""}"><div><strong>${esc(person.displayName)} ${person.role === "admin" ? '<span class="badge">ADMIN</span>' : ""}</strong><small>${person.active === false ? "ปิดใช้งาน" : "เปิดใช้งาน"}</small></div><div class="account-actions"><button class="secondary" data-rename="${esc(person.id)}">เปลี่ยนชื่อ</button><button class="blue" data-reset="${esc(person.id)}">รีเซ็ต PIN</button><button class="${person.active === false ? "primary" : "danger"}" data-toggle="${esc(person.id)}">${person.active === false ? "เปิดใช้งาน" : "ปิดใช้งาน"}</button></div></div>`).join("");

  document.querySelectorAll("[data-reset]").forEach(button => button.onclick = async () => {
    const id = button.dataset.reset; if (!confirm(`รีเซ็ต PIN ของ ${profile(id)?.displayName || id} เป็น 1234?`)) return;
    await mutate(latest => { if (!latest.profiles[id]) return false; LeagueShared.resetPin(latest.profiles[id]); LeagueShared.audit(latest,"pin_reset",currentUserId,{target:id}); });
  });
  document.querySelectorAll("[data-toggle]").forEach(button => button.onclick = async () => {
    const id = button.dataset.toggle;
    await mutate(latest => { const person = latest.profiles[id]; if (!person) return false; if (id === currentUserId && person.active !== false) { alert("ปิดบัญชี Admin ที่กำลังใช้งานไม่ได้"); return false; } person.active = person.active === false; LeagueShared.audit(latest,"account_toggle",currentUserId,{target:id,active:person.active}); });
  });
  document.querySelectorAll("[data-rename]").forEach(button => button.onclick = async () => {
    const id = button.dataset.rename, oldName=profile(id)?.displayName||"", name = prompt("ชื่อใหม่", oldName)?.trim(); if (!name) return;
    await mutate(latest => { if (!latest.profiles[id]) return false; if (Object.values(latest.profiles).some(person => person.id !== id && person.displayName.toLowerCase() === name.toLowerCase())) { alert("มีชื่อนี้แล้ว"); return false; } latest.profiles[id].displayName = name; LeagueShared.audit(latest,"account_rename",currentUserId,{target:id,from:oldName,to:name}); });
  });
}

document.getElementById("create").onclick = async () => {
  const input = document.getElementById("newName"), name = input.value.trim(), role = document.getElementById("newRole").value;
  if (!name) return alert("กรอกชื่อก่อน"); if (!["player", "admin"].includes(role)) return;
  const saved = await mutate(latest => { if (Object.values(latest.profiles).some(person => person.displayName.toLowerCase() === name.toLowerCase())) { alert("มีชื่อนี้แล้ว"); return false; } const id = LeagueShared.newAccountId(); latest.profiles[id] = { id, displayName: name, pin: LeagueShared.DEFAULT_PIN, mustChangePin: true, role, active: true, createdAt: new Date().toISOString() }; LeagueShared.audit(latest,"account_create",currentUserId,{target:id,name,role}); });
  if (saved) { input.value = ""; alert(`สร้าง ${name} แล้ว • PIN เริ่มต้น 1234 (ต้องตั้งใหม่ตอนเข้าสู่ระบบครั้งแรก)`); }
};
window.addEventListener("storage", event => { if ([KEY, LeagueShared.SESSION_KEY].includes(event.key)) loadCloud(); });
setStatus("กำลังโหลดข้อมูลบัญชี..."); loadCloud();