// Dummy (ดัมมี่) score keeper — standalone page, data lives only in this browser's localStorage (never in the league row).
(() => {
  const KEY = "pp_dummy_v1";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // Common Thai Dummy card values: 2-9 = 5, 10/J/Q/K = 10, A = 15, special cards (2♣ / Q♠) = 50.
  const CARD_VALUES = { low: 5, high: 10, ace: 15, special: 50 };

  function int(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; }
  function blank() { return { players: [], rounds: [], target: 0, knockBonus: 50 }; }
  function normalize(raw) {
    const s = blank();
    if (!raw || typeof raw !== "object") return s;
    s.players = (Array.isArray(raw.players) ? raw.players : []).map(p => String(p ?? "").trim().slice(0, 30)).filter(Boolean).slice(0, 4);
    s.target = Math.max(0, int(raw.target));
    s.knockBonus = Math.max(0, int(raw.knockBonus ?? 50));
    s.rounds = (Array.isArray(raw.rounds) ? raw.rounds : []).filter(r => r && Array.isArray(r.scores)).map(r => ({
      scores: s.players.map((_, i) => int(r.scores[i])),
      knock: Number.isInteger(r.knock) && r.knock >= 0 && r.knock < s.players.length ? r.knock : null,
      at: int(r.at)
    }));
    return s;
  }
  function totals(s) { return s.players.map((_, i) => s.rounds.reduce((sum, r) => sum + int(r.scores[i]), 0)); }
  // Highest total first; ties keep seat order.
  function standings(s) {
    const t = totals(s);
    return s.players.map((name, i) => ({ index: i, name, total: t[i], knocks: s.rounds.filter(r => r.knock === i).length }))
      .sort((a, b) => b.total - a.total || a.index - b.index);
  }
  function winner(s) {
    if (!s.target || !s.players.length) return null;
    const top = standings(s)[0];
    return top && top.total >= s.target ? top : null;
  }
  function cardPoints(c) {
    return int(c.low) * CARD_VALUES.low + int(c.high) * CARD_VALUES.high + int(c.ace) * CARD_VALUES.ace + int(c.special) * CARD_VALUES.special;
  }

  window.DummyScore = { normalize, totals, standings, winner, cardPoints, CARD_VALUES };

  const $ = id => document.getElementById(id);
  if (!$("dummyApp")) return;

  let state = load();
  function load() { try { return normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return blank(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function toast(msg) { const el = $("dToast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 1800); }

  // ---- setup ----
  function renderSetup() {
    const names = state.players.length ? state.players : ["", ""];
    $("dNames").innerHTML = names.map((n, i) => `<div class="d-name-row"><input data-name="${i}" maxlength="30" placeholder="ผู้เล่น ${i + 1}" value="${esc(n)}">${names.length > 2 ? `<button type="button" class="secondary d-icon" data-remove="${i}" aria-label="ลบผู้เล่น ${i + 1}">✕</button>` : ""}</div>`).join("");
    $("dAddPlayer").disabled = names.length >= 4;
    $("dTarget").value = state.target || "";
    $("dKnock").value = state.knockBonus;
  }
  function setupNames() { return [...document.querySelectorAll("[data-name]")].map(i => i.value); }
  $("dNames").addEventListener("click", e => {
    const b = e.target.closest("[data-remove]"); if (!b) return;
    const names = setupNames(); names.splice(int(b.dataset.remove), 1);
    state.players = names; renderSetup();
  });
  $("dAddPlayer").addEventListener("click", () => { const names = setupNames(); if (names.length < 4) { names.push(""); state.players = names; renderSetup(); } });
  $("dStart").addEventListener("click", () => {
    const names = setupNames().map(n => n.trim());
    if (names.some(n => !n)) return toast("กรอกชื่อผู้เล่นให้ครบ");
    if (new Set(names).size !== names.length) return toast("ชื่อผู้เล่นซ้ำกัน");
    // Same players → only settings change and the score sheet is kept; a different line-up starts a fresh sheet.
    const samePlayers = names.join("\n") === state.players.join("\n");
    const next = normalize({ players: names, target: $("dTarget").value, knockBonus: $("dKnock").value, rounds: samePlayers ? state.rounds : [] });
    if (!samePlayers && state.rounds.length && !confirm("เปลี่ยนผู้เล่นแล้วแต้มเดิมจะถูกล้าง เริ่มเกมใหม่?")) return;
    state = next; save(); render(); toast(samePlayers && state.rounds.length ? "บันทึกการตั้งค่าแล้ว" : "เริ่มเกมแล้ว 🃏");
  });

  // ---- round entry ----
  function renderEntry() {
    $("dEntry").innerHTML = state.players.map((n, i) => `<div class="d-entry-row"><div class="d-entry-head"><b>${esc(n)}</b><label class="d-knock"><input type="radio" name="dKnockWho" value="${i}"> น็อค</label></div><div class="d-entry-input"><button type="button" class="secondary d-icon" data-sign="${i}" aria-label="สลับบวกลบ">±</button><input type="number" inputmode="numeric" data-score="${i}" placeholder="0"></div><div class="d-chips">${[5, 10, 15, 50, -5, -10, -15, -50].map(v => `<button type="button" class="d-chip ${v < 0 ? "neg" : ""}" data-add="${i}" data-v="${v}">${v > 0 ? "+" : ""}${v}</button>`).join("")}</div></div>`).join("");
    $("dKnockNone").checked = true;
    $("dCalcPlayer").innerHTML = state.players.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join("");
  }
  function scoreInput(i) { return document.querySelector(`[data-score="${i}"]`); }
  $("dEntry").addEventListener("click", e => {
    const add = e.target.closest("[data-add]"), sign = e.target.closest("[data-sign]");
    if (add) { const el = scoreInput(add.dataset.add); el.value = int(el.value) + int(add.dataset.v); }
    if (sign) { const el = scoreInput(sign.dataset.sign); el.value = -int(el.value); }
  });
  $("dSaveRound").addEventListener("click", () => {
    const scores = state.players.map((_, i) => int(scoreInput(i).value));
    const k = document.querySelector('input[name="dKnockWho"]:checked');
    const knock = k && k.value !== "" ? int(k.value) : null;
    if (knock !== null) scores[knock] += state.knockBonus;
    if (scores.every(v => v === 0) && knock === null) return toast("ยังไม่ได้ใส่แต้ม");
    state.rounds.push({ scores, knock, at: Date.now() }); save(); render();
    toast(`บันทึกตาที่ ${state.rounds.length} แล้ว`);
  });

  // ---- card calculator ----
  function calcValues() { return { low: $("cLow").value, high: $("cHigh").value, ace: $("cAce").value, special: $("cSpecial").value }; }
  function updateCalc() { $("cTotal").textContent = cardPoints(calcValues()); }
  ["cLow", "cHigh", "cAce", "cSpecial"].forEach(id => $(id).addEventListener("input", updateCalc));
  document.querySelectorAll("[data-calc]").forEach(b => b.addEventListener("click", () => {
    const pts = cardPoints(calcValues()); if (!pts) return toast("ยังไม่ได้นับไพ่");
    const el = scoreInput($("dCalcPlayer").value); if (!el) return;
    el.value = int(el.value) + (b.dataset.calc === "minus" ? -pts : pts);
    ["cLow", "cHigh", "cAce", "cSpecial"].forEach(id => $(id).value = ""); updateCalc();
    toast(`${b.dataset.calc === "minus" ? "หัก" : "เพิ่ม"} ${pts} แต้มให้ ${state.players[int($("dCalcPlayer").value)]}`);
  }));

  // ---- board + history ----
  function renderBoard() {
    const rows = standings(state), top = rows[0]?.total ?? 0, w = winner(state);
    $("dWinner").hidden = !w;
    if (w) $("dWinner").innerHTML = `🏆 <b>${esc(w.name)}</b> ถึง ${state.target.toLocaleString()} แต้มแล้ว — ชนะเกมนี้!`;
    $("dMeta").textContent = `ตาที่เล่นแล้ว ${state.rounds.length}${state.target ? ` • เป้า ${state.target.toLocaleString()} แต้ม` : ""} • น็อค +${state.knockBonus}`;
    $("dBoard").innerHTML = rows.map((r, pos) => {
      const pct = state.target ? Math.max(0, Math.min(100, r.total / state.target * 100)) : 0;
      return `<div class="d-board-row ${pos === 0 && r.total === top && state.rounds.length ? "lead" : ""}"><span class="d-pos">${pos + 1}</span><div class="d-board-name"><b>${esc(r.name)}</b><small>${[r.knocks ? `น็อค ${r.knocks} ครั้ง` : "", pos ? `ตามผู้นำ ${(top - r.total).toLocaleString()}` : ""].filter(Boolean).join(" • ") || "&nbsp;"}</small>${state.target ? `<div class="d-bar"><span style="width:${pct}%"></span></div>` : ""}</div><b class="d-total ${r.total < 0 ? "neg" : ""}">${r.total.toLocaleString()}</b></div>`;
    }).join("");
  }
  function renderHistory() {
    $("dHistHead").innerHTML = `<tr><th>ตา</th>${state.players.map(n => `<th>${esc(n)}</th>`).join("")}<th></th></tr>`;
    const t = totals(state);
    $("dHistBody").innerHTML = state.rounds.length ? state.rounds.map((r, i) => `<tr><td>${i + 1}</td>${r.scores.map((v, p) => `<td class="${v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${v}${r.knock === p ? ' <span class="d-tag">น็อค</span>' : ""}</td>`).join("")}<td><button type="button" class="secondary d-icon" data-del="${i}" aria-label="ลบตาที่ ${i + 1}">🗑</button></td></tr>`).reverse().join("") + `<tr class="d-sum"><td>รวม</td>${t.map(v => `<td>${v.toLocaleString()}</td>`).join("")}<td></td></tr>`
      : `<tr><td colspan="${state.players.length + 2}" class="empty">ยังไม่มีตาที่บันทึก</td></tr>`;
  }
  $("dHistBody").addEventListener("click", e => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const i = int(b.dataset.del);
    if (!confirm(`ลบตาที่ ${i + 1}?`)) return;
    state.rounds.splice(i, 1); save(); render();
  });
  $("dUndo").addEventListener("click", () => { if (!state.rounds.length) return; state.rounds.pop(); save(); render(); toast("ย้อนตาล่าสุดแล้ว"); });
  $("dRematch").addEventListener("click", () => { if (!confirm("เริ่มเกมใหม่ด้วยผู้เล่นชุดเดิม?")) return; state.rounds = []; save(); render(); });
  $("dEdit").addEventListener("click", () => { $("dSetup").hidden = false; renderSetup(); $("dSetup").scrollIntoView({ behavior: "smooth" }); });

  function render() {
    const playing = state.players.length >= 2;
    $("dSetup").hidden = playing; $("dGame").hidden = !playing;
    if (!playing) return renderSetup();
    renderEntry(); renderBoard(); renderHistory(); updateCalc();
  }
  render();
})();
