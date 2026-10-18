// PIN change dialog. Forced after logging in with the default PIN 1234 (or any account still on the old plaintext PIN),
// and available any time from the "เปลี่ยน PIN" button. Writes go through LeagueShared.changePin.
const PinChange = (() => {
  let open = false;
  const asked = new Set();

  function dialog({ forced, askCurrent, name }) {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "pin-overlay";
      overlay.innerHTML = `<form class="auth-card pin-card" role="dialog" aria-modal="true" aria-labelledby="pinTitle">
        <h2 id="pinTitle">${forced ? "ตั้ง PIN ใหม่ก่อนใช้งาน" : "เปลี่ยน PIN"}</h2>
        <p class="pin-note">${forced ? "บัญชีนี้ยังใช้ PIN เริ่มต้น 1234 ซึ่งทุกคนรู้ ตั้ง PIN ของตัวเอง 4–6 หลักก่อนเข้าใช้งาน" : "PIN ใหม่ 4–6 หลัก ห้ามใช้ 1234, เลขซ้ำ หรือเลขเรียง"}</p>
        <p class="pin-name"></p>
        ${askCurrent ? '<div class="field"><label for="pinCurrent">PIN เดิม</label><input id="pinCurrent" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" required></div>' : ""}
        <div class="field"><label for="pinNew">PIN ใหม่</label><input id="pinNew" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required></div>
        <div class="field"><label for="pinConfirm">ยืนยัน PIN ใหม่</label><input id="pinConfirm" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" required></div>
        <div class="pin-error" role="alert"></div>
        <div class="pin-actions"><button type="button" class="secondary" data-pin-cancel>${forced ? "ออกจากระบบ" : "ยกเลิก"}</button><button type="submit" class="blue">บันทึก PIN</button></div>
      </form>`;
      overlay.querySelector(".pin-name").textContent = name ? `บัญชี: ${name}` : "";
      const form = overlay.querySelector("form"), error = overlay.querySelector(".pin-error");
      const value = id => overlay.querySelector(`#${id}`)?.value || "";
      const close = result => { overlay.remove(); resolve(result); };
      overlay.querySelector("[data-pin-cancel]").onclick = () => close(null);
      form.onsubmit = event => {
        event.preventDefault();
        const next = value("pinNew"), problem = LeagueShared.pinPolicyError(next) || (next !== value("pinConfirm") ? "PIN ใหม่ทั้งสองช่องไม่ตรงกัน" : "");
        if (problem) { error.textContent = problem; return; }
        close({ current: askCurrent ? value("pinCurrent") : null, next });
      };
      document.body.appendChild(overlay);
      overlay.querySelector("input")?.focus();
    });
  }

  // knownPin: the PIN just typed at login (so it is not asked again). onSaved(latestLeague) runs after the cloud write;
  // onCancel runs when a forced change is declined. If the cloud write fails, the user keeps using the site and is asked
  // again next time, so an outage never locks anyone out.
  async function run({ userId, name, knownPin = "", forced = false, onSaved = () => {}, onCancel = () => {} }) {
    if (open || !userId) return false;
    open = true;
    try {
      for (;;) {
        const answer = await dialog({ forced, askCurrent: !knownPin, name });
        if (!answer) { if (forced) { alert("ต้องตั้ง PIN ใหม่ก่อนใช้งาน • ออกจากระบบแล้ว"); onCancel(); } return false; }
        try {
          const latest = await LeagueShared.changePin(userId, knownPin || answer.current, answer.next);
          alert("ตั้ง PIN ใหม่แล้ว • ครั้งหน้าใช้ PIN นี้เข้าสู่ระบบ");
          onSaved(latest);
          return true;
        } catch (error) {
          // A wrong current PIN or a rejected new PIN lets the user try again; anything else is a save failure.
          if (error.pinInput) { alert(error.message); if (error.wrongCurrent) knownPin = ""; continue; }
          alert(`บันทึก PIN ใหม่ไม่ได้: ${error.message}\nใช้งานต่อได้ แต่ระบบจะให้ตั้ง PIN ใหม่อีกครั้งเมื่อเชื่อมต่อได้`);
          return false;
        }
      }
    } finally { open = false; }
  }

  // Call after the page knows who is logged in (login or session restore); asks at most once per page load per account.
  function enforce(league, userId, options = {}) {
    const person = LeagueShared.activeProfile(league, userId);
    if (!person || !LeagueShared.needsPinChange(person) || (asked.has(userId) && !options.knownPin)) return;
    asked.add(userId);
    return run({ ...options, userId, name: person.displayName, forced: true });
  }

  // Phase 2: the server session is missing or expired (shared.js asks before a save). Same card as the PIN dialog;
  // resolves true once pp_login accepted the PIN, false when the user cancels.
  function relogin({ userId, name }) {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "pin-overlay";
      overlay.innerHTML = `<form class="auth-card pin-card" role="dialog" aria-modal="true" aria-labelledby="reloginTitle">
        <h2 id="reloginTitle">ยืนยัน PIN อีกครั้ง</h2>
        <p class="pin-note">ระบบตรวจสิทธิ์ที่เซิร์ฟเวอร์แล้ว ใส่ PIN เพื่อเข้าสู่ระบบอีกครั้งก่อนบันทึก (ครั้งเดียวต่อเครื่อง อยู่ได้ 30 วัน)</p>
        <p class="pin-name"></p>
        <div class="field"><label for="reloginPin">PIN</label><input id="reloginPin" type="password" inputmode="numeric" maxlength="6" autocomplete="current-password" required></div>
        <div class="pin-error" role="alert"></div>
        <div class="pin-actions"><button type="button" class="secondary" data-pin-cancel>ยกเลิก</button><button type="submit" class="blue">เข้าสู่ระบบ</button></div>
      </form>`;
      overlay.querySelector(".pin-name").textContent = name ? `บัญชี: ${name}` : "";
      const form = overlay.querySelector("form"), error = overlay.querySelector(".pin-error"), input = overlay.querySelector("#reloginPin"), submit = overlay.querySelector('button[type="submit"]');
      const close = result => { overlay.remove(); resolve(result); };
      overlay.querySelector("[data-pin-cancel]").onclick = () => close(false);
      form.onsubmit = async event => {
        event.preventDefault();
        submit.disabled = true; error.textContent = "";
        try {
          const result = await LeagueShared.serverLogin(userId, input.value);
          if (result.ok) return close(true);
          error.textContent = result.locked ? `ใส่ PIN ผิดหลายครั้ง • ลองใหม่ใน ${Math.ceil(result.retryAfterMs / 60000)} นาที` : "PIN ไม่ถูกต้อง";
          input.value = ""; input.focus();
        } catch { error.textContent = "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง"; }
        finally { submit.disabled = false; }
      };
      document.body.appendChild(overlay);
      input.focus();
    });
  }

  return Object.freeze({ run, enforce, relogin });
})();
