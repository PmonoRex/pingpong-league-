// Dummy (ดัมมี่) score keeper — standalone page, data lives only in this browser's localStorage (never in the league row).
(() => {
  const KEY = "pp_dummy_v1";
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // Common Thai Dummy card values: 2-9 = 5, 10/J/Q/K = 10, A = 15, special cards (2♣ / Q♠) = 50.
  const CARD_VALUES = { low: 5, high: 10, ace: 15, special: 50 };
  // Knock styles that double what every loser pays; they stack (มืด + สี = ×4).
  const KNOCK_FLAGS = [["dark", "มืด"], ["dummy", "ดัมมี่"], ["color", "สี"]];
  const MONEY_MODES = { none: "ไม่คิดเงิน", points: "หารแต้ม หักลบกัน", winner: "คนชนะได้คนเดียว" };

  function int(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : 0; }
  function money(v) { const n = Math.round(Number(v) * 100) / 100; return Number.isFinite(n) ? n : 0; }
  function blank() { return { players: [], rounds: [], target: 0, knockBonus: 0, moneyMode: "points", rates: [10, 20, 30], divisor: 10 }; }
  function normalize(raw) {
    const s = blank();
    if (!raw || typeof raw !== "object") return s;
    s.players = (Array.isArray(raw.players) ? raw.players : []).map(p => String(p ?? "").trim().slice(0, 30)).filter(Boolean).slice(0, 4);
    // Scores are entered already counted (knock bonus included), so there is no target or bonus to add.
    s.target = 0;
    s.knockBonus = 0;
    s.moneyMode = Object.hasOwn(MONEY_MODES, raw.moneyMode) ? raw.moneyMode : "points";
    if (raw.divisor !== undefined) s.divisor = Math.max(0, money(raw.divisor)) || 10;
    if (Array.isArray(raw.rates)) s.rates = [0, 1, 2].map(i => Math.max(0, money(raw.rates[i])));
    const n = s.players.length;
    s.rounds = (Array.isArray(raw.rounds) ? raw.rounds : []).filter(r => r && Array.isArray(r.scores)).map(r => ({
      scores: s.players.map((_, i) => int(r.scores[i])),
      knock: Number.isInteger(r.knock) && r.knock >= 0 && r.knock < n ? r.knock : null,
      flags: Object.fromEntries(KNOCK_FLAGS.map(([k]) => [k, !!r.flags?.[k]])),
      dumb: s.players.map((_, i) => !!r.dumb?.[i]),
      money: Array.isArray(r.money) ? s.players.map((_, i) => money(r.money[i])) : null,
      vals: Array.isArray(r.vals) ? s.players.map((_, i) => money(r.vals[i])) : null,
      at: int(r.at)
    }));
    return s;
  }
  function totals(s) { return s.players.map((_, i) => s.rounds.reduce((sum, r) => sum + int(r.scores[i]), 0)); }
  function moneyTotals(s) { return s.players.map((_, i) => money(s.rounds.reduce((sum, r) => sum + (r.money ? r.money[i] : 0), 0))); }
  function hasMoney(s) { return s.rounds.some(r => r.money); }
  // Highest total first; ties keep seat order.
  function standings(s) {
    const t = totals(s), m = moneyTotals(s);
    return s.players.map((name, i) => ({ index: i, name, total: t[i], money: m[i], knocks: s.rounds.filter(r => r.knock === i).length }))
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
  function multiplier(flags) { return KNOCK_FLAGS.reduce((m, [k]) => m * (flags?.[k] ? 2 : 1), 1); }

  // Money mode "winner": the knocker takes everything (no knock → highest score of the hand, split if tied).
  // Everyone else is ranked by this hand's score; a lower score is a lower rank and pays a bigger rate
  // (rates[0] = 2nd place, rates[1] = 3rd, rates[2] = 4th). Equal scores pay the same, at the better rank's rate.
  // Knock styles double every payment and a "โง่" player pays double on top.
  function settleWinner({ scores, knock = null, flags = {}, dumb = [], rates = [] }) {
    const n = scores.length, out = Array(n).fill(0);
    if (n < 2) return out;
    let winners;
    if (knock !== null && knock >= 0 && knock < n) winners = [knock];
    else { const best = Math.max(...scores); winners = scores.map((v, i) => v === best ? i : -1).filter(i => i >= 0); }
    if (winners.length === n) return out;
    const losers = scores.map((v, i) => i).filter(i => !winners.includes(i)).sort((a, b) => scores[b] - scores[a] || a - b);
    const mult = knock !== null ? multiplier(flags) : 1;
    let pot = 0;
    losers.forEach((p, pos) => {
      const rankPos = losers.findIndex(q => scores[q] === scores[p]);
      const rate = money(rates[Math.min(rankPos, rates.length - 1)] ?? 0);
      const pay = money(rate * mult * (dumb[p] ? 2 : 1));
      out[p] = -pay; pot += pay;
    });
    winners.forEach(w => { out[w] = money(pot / winners.length); });
    return out;
  }

  // Money mode "points": each score is worth score ÷ divisor baht and every pair settles the difference
  // (100 vs 40 points at ÷10 → the 40 pays the 100 six baht). `vals` keeps each player's baht value for the
  // pairwise list; `money` is each player's net for the game (their value against everyone else's).
  function settlePoints(scores, divisor) {
    const d = Number(divisor) > 0 ? Number(divisor) : 10;
    // Whole baht, halves rounded away from zero (25 ÷ 10 → 3, −25 ÷ 10 → −3).
    const vals = scores.map(v => { const x = int(v) / d; return Math.sign(x) * Math.round(Math.abs(x)) || 0; }), sum = vals.reduce((a, b) => a + b, 0);
    return { vals, money: vals.map(v => money(v * vals.length - sum)) };
  }

  // Who owes whom, pair by pair: in each game every loser owes the winner(s) what they paid (split evenly
  // if the pot was split). Debts are never passed through a third player; only two players who owe each
  // other are netted, and `owed` / `back` keep both sides so the page can show where the number came from.
  // Works in satang so rounding never leaves a stray 0.01.
  function pairDebts(rounds, n) {
    const owe = Array.from({ length: n }, () => Array(n).fill(0));
    rounds.forEach(r => {
      if (r.vals) {
        const c = r.vals.map(v => Math.round(Number(v) * 100) || 0);
        c.forEach((va, a) => c.forEach((vb, b) => { if (vb > va) owe[a][b] += vb - va; }));
        return;
      }
      if (!r.money) return;
      const cents = r.money.map(v => Math.round(Number(v) * 100) || 0);
      const winners = cents.map((v, i) => v > 0 ? i : -1).filter(i => i >= 0);
      if (!winners.length) return;
      cents.forEach((v, loser) => {
        if (v >= 0) return;
        const share = Math.floor(-v / winners.length);
        winners.forEach((w, k) => { owe[loser][w] += share + (k < -v - share * winners.length ? 1 : 0); });
      });
    });
    const out = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const ab = owe[a][b], ba = owe[b][a]; if (ab === ba) continue;
      const [from, to, owed, back] = ab > ba ? [a, b, ab, ba] : [b, a, ba, ab];
      out.push({ from, to, amount: (owed - back) / 100, owed: owed / 100, back: back / 100 });
    }
    return out.sort((x, y) => x.from - y.from || x.to - y.to);
  }

  window.DummyScore = { normalize, totals, moneyTotals, standings, winner, cardPoints, settleWinner, settlePoints, multiplier, pairDebts, CARD_VALUES };

  const $ = id => document.getElementById(id);
  if (!$("dummyApp")) return;

  const baht = v => `${v > 0 ? "+" : ""}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}฿`;
  let state = load();
  function load() { try { return normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return blank(); } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  function toast(msg) { const el = $("dToast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2200); }
  const moneyOn = () => state.moneyMode !== "none", winnerMode = () => state.moneyMode === "winner";

  // ---- setup ----
  function renderSetup() {
    const names = state.players.length ? state.players : ["", ""];
    $("dNames").innerHTML = names.map((n, i) => `<div class="d-name-row"><input data-name="${i}" maxlength="30" placeholder="ผู้เล่น ${i + 1}" value="${esc(n)}">${names.length > 2 ? `<button type="button" class="secondary d-icon" data-remove="${i}" aria-label="ลบผู้เล่น ${i + 1}">✕</button>` : ""}</div>`).join("");
    $("dAddPlayer").disabled = names.length >= 4;
    $("dTarget").value = state.target || "";
    $("dKnock").value = state.knockBonus;
    $("dMoneyMode").value = state.moneyMode;
    ["dRate2", "dRate3", "dRate4"].forEach((id, i) => $(id).value = state.rates[i]);
    $("dDivisor").value = state.divisor;
    toggleRates();
  }
  function toggleRates() { $("dRates").hidden = $("dMoneyMode").value !== "winner"; $("dPoints").hidden = $("dMoneyMode").value !== "points"; }
  $("dMoneyMode").addEventListener("change", toggleRates);
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
    const next = normalize({
      players: names, target: $("dTarget").value, knockBonus: $("dKnock").value, moneyMode: $("dMoneyMode").value,
      rates: [$("dRate2").value, $("dRate3").value, $("dRate4").value], divisor: $("dDivisor").value, rounds: samePlayers ? state.rounds : []
    });
    if (!samePlayers && state.rounds.length && !confirm("เปลี่ยนผู้เล่นแล้วแต้มเดิมจะถูกล้าง เริ่มเกมใหม่?")) return;
    state = next; save(); render(); toast(samePlayers && state.rounds.length ? "บันทึกการตั้งค่าแล้ว" : "เริ่มเกมแล้ว 🃏");
  });

  // ---- round entry ----
  function renderEntry() {
    $("dEntry").innerHTML = state.players.map((n, i) => `<div class="d-line"><b class="d-line-name">${esc(n)}</b><button type="button" class="secondary d-icon d-sign" data-sign="${i}" aria-pressed="false" aria-label="ติดลบ ${esc(n)}">+</button><input type="number" inputmode="numeric" data-score="${i}" placeholder="แต้ม" aria-label="แต้มของ ${esc(n)}"><span class="d-line-opts">${winnerMode() ? `<label class="d-knock"><input type="radio" name="dKnockWho" value="${i}"> น็อค</label>` : ""}${winnerMode() ? `<label class="d-knock"><input type="checkbox" data-dumb="${i}"> โง่</label>` : ""}</span></div>`).join("");
    $("dDivRow").hidden = state.moneyMode !== "points"; $("dDivQuick").value = state.divisor;
    $("dKnockNone").checked = true; $("dKnockNoneLabel").hidden = !winnerMode();
    $("dFlags").hidden = !winnerMode();
    $("dFlags").innerHTML = `<span class="muted">น็อคแบบพิเศษ (คนเสียจ่ายคูณ 2 ซ้อนกันได้)</span><div class="d-flag-row">${KNOCK_FLAGS.map(([k, label]) => `<label class="d-flag"><input type="checkbox" data-flag="${k}"> ${label} ×2</label>`).join("")}</div>`;
    $("dCalcPlayer").innerHTML = state.players.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join("");
    updatePreview();
  }
  function scoreInput(i) { return document.querySelector(`[data-score="${i}"]`); }
  // iPhone number pads have no minus key, so each row carries a +/− toggle and the box holds the size of the score.
  function signButton(i) { return document.querySelector(`[data-sign="${i}"]`); }
  function setNegative(i, neg) {
    const b = signButton(i); b.setAttribute("aria-pressed", String(neg)); b.textContent = neg ? "−" : "+";
    b.classList.toggle("on", neg); scoreInput(i).classList.toggle("neg", neg);
  }
  function getScore(i) { const v = int(scoreInput(i).value); return signButton(i).getAttribute("aria-pressed") === "true" ? -Math.abs(v) : v; }
  function setScore(i, v) { setNegative(i, v < 0); scoreInput(i).value = v ? Math.abs(v) : ""; }
  function readEntry() {
    const scores = state.players.map((_, i) => getScore(i));
    const k = document.querySelector('input[name="dKnockWho"]:checked');
    const knock = k && k.value !== "" ? int(k.value) : null;
    const flags = Object.fromEntries(KNOCK_FLAGS.map(([f]) => [f, knock !== null && !!document.querySelector(`[data-flag="${f}"]`)?.checked]));
    const dumb = state.players.map((_, i) => !!document.querySelector(`[data-dumb="${i}"]`)?.checked);
    return { scores, knock, flags, dumb };
  }
  // Money is ranked on the hand's own scores (before the knock bonus is added).
  // Points mode counts the score as entered plus the knock bonus.
  function settle(entry) {
    if (state.moneyMode === "winner") return { money: settleWinner({ ...entry, rates: state.rates }), vals: null };
    if (state.moneyMode === "points") return settlePoints(entry.scores.map((v, i) => v + (entry.knock === i ? state.knockBonus : 0)), state.divisor);
    return { money: null, vals: null };
  }
  function updatePreview() {
    const el = $("dPreview"); el.hidden = !moneyOn(); if (!moneyOn()) return;
    const e = readEntry(), { money: m, vals } = settle(e), x = winnerMode() && e.knock !== null ? multiplier(e.flags) : 1;
    const note = vals ? `<small>${state.players.map((n, i) => `${esc(n)} ${baht(vals[i]).replace("+", "")}`).join(" • ")} (แต้ม ÷ ${state.divisor} ปัดเป็นบาทเต็ม)</small>`
      : e.knock === null ? '<small>ยังไม่ได้เลือกคนน็อค — ถ้าไม่มีใครน็อค คนแต้มสูงสุดได้เงิน</small>' : "";
    el.innerHTML = `<b>เงินเกมนี้${x > 1 ? ` (×${x})` : ""}</b>${note}<div class="d-preview-list">${state.players.map((n, i) => `<span class="${m[i] < 0 ? "neg" : m[i] > 0 ? "pos" : ""}">${esc(n)} ${baht(m[i])}</span>`).join("")}</div>`;
  }
  $("dDivQuick").addEventListener("input", () => {
    const d = money($("dDivQuick").value); if (!(d > 0)) return;
    state.divisor = d; save(); renderBoard(); updatePreview();
  });
  $("dEntryCard").addEventListener("input", updatePreview);
  $("dEntryCard").addEventListener("change", updatePreview);
  $("dEntry").addEventListener("click", e => {
    const sign = e.target.closest("[data-sign]");
    if (sign) { const i = int(sign.dataset.sign), el = scoreInput(i); setNegative(i, sign.getAttribute("aria-pressed") !== "true"); el.value = el.value ? Math.abs(int(el.value)) : ""; updatePreview(); }
  });
  $("dSaveRound").addEventListener("click", () => {
    const entry = readEntry(), { money: m, vals } = settle(entry), scores = [...entry.scores];
    if (entry.knock !== null) scores[entry.knock] += state.knockBonus;
    if (scores.every(v => v === 0) && entry.knock === null) return toast("ยังไม่ได้ใส่แต้ม");
    state.rounds.push({ scores, knock: entry.knock, flags: entry.flags, dumb: entry.dumb, money: m, vals, at: Date.now() }); save(); render();
    const w = m ? m.indexOf(Math.max(...m)) : -1;
    toast(`บันทึกเกมที่ ${state.rounds.length} แล้ว${w >= 0 && m[w] > 0 ? ` • ${state.players[w]} ได้ ${baht(m[w])}` : ""}`);
  });

  // ---- card calculator ----
  function calcValues() { return { low: $("cLow").value, high: $("cHigh").value, ace: $("cAce").value, special: $("cSpecial").value }; }
  function updateCalc() { $("cTotal").textContent = cardPoints(calcValues()); }
  ["cLow", "cHigh", "cAce", "cSpecial"].forEach(id => $(id).addEventListener("input", updateCalc));
  document.querySelectorAll("[data-calc]").forEach(b => b.addEventListener("click", () => {
    const pts = cardPoints(calcValues()); if (!pts) return toast("ยังไม่ได้นับไพ่");
    const i = int($("dCalcPlayer").value); if (!scoreInput(i)) return;
    setScore(i, getScore(i) + (b.dataset.calc === "minus" ? -pts : pts));
    ["cLow", "cHigh", "cAce", "cSpecial"].forEach(id => $(id).value = ""); updateCalc(); updatePreview();
    toast(`${b.dataset.calc === "minus" ? "หัก" : "เพิ่ม"} ${pts} แต้มให้ ${state.players[int($("dCalcPlayer").value)]}`);
  }));

  // ---- board + history ----
  function renderBoard() {
    const showMoney = moneyOn() || hasMoney(state), byMoney = moneyOn();
    const rows = byMoney ? standings(state).sort((a, b) => b.money - a.money || a.index - b.index) : standings(state);
    const top = Math.max(...rows.map(r => r.total)), w = winner(state);
    $("dWinner").hidden = !w;
    if (w) $("dWinner").innerHTML = `🏆 <b>${esc(w.name)}</b> ถึง ${state.target.toLocaleString()} แต้มแล้ว — ชนะเกมนี้!`;
    $("dMeta").textContent = `เล่นไปแล้ว ${state.rounds.length} เกม${state.target ? ` • เป้า ${state.target.toLocaleString()} แต้ม` : ""}${winnerMode() ? ` • เงิน: ${MONEY_MODES.winner} (${state.rates.slice(0, state.players.length - 1).join(" / ")}฿)` : state.moneyMode === "points" ? ` • เงิน: แต้ม ÷ ${state.divisor} หักลบกัน` : ""}`;
    $("dBoard").innerHTML = rows.map((r, pos) => {
      const pct = state.target ? Math.max(0, Math.min(100, r.total / state.target * 100)) : 0;
      return `<div class="d-board-row ${pos === 0 && state.rounds.length && (byMoney ? r.money > 0 : r.total === top) ? "lead" : ""}"><span class="d-pos">${pos + 1}</span><div class="d-board-name"><b>${esc(r.name)}</b><small>${[r.knocks ? `น็อค ${r.knocks} ครั้ง` : "", r.total < top ? `ตามแต้มสูงสุด ${(top - r.total).toLocaleString()}` : ""].filter(Boolean).join(" • ") || "&nbsp;"}</small>${state.target ? `<div class="d-bar"><span style="width:${pct}%"></span></div>` : ""}</div><div class="d-board-right"><b class="d-total ${r.total < 0 ? "neg" : ""}">${r.total.toLocaleString()}</b>${showMoney ? `<span class="d-money ${r.money < 0 ? "neg" : r.money > 0 ? "pos" : ""}">${baht(r.money)}</span>` : ""}</div></div>`;
    }).join("");
  }
  function roundTags(r, p) {
    const tags = [];
    if (r.knock === p) tags.push(`น็อค${KNOCK_FLAGS.filter(([k]) => r.flags[k]).map(([, l]) => l).join("")}`);
    if (r.dumb[p]) tags.push("โง่");
    return tags.map(t => ` <span class="d-tag">${t}</span>`).join("");
  }
  function renderHistory() {
    $("dHistHead").innerHTML = `<tr><th>เกม</th>${state.players.map(n => `<th>${esc(n)}</th>`).join("")}<th></th></tr>`;
    const t = totals(state), m = moneyTotals(state), showMoney = hasMoney(state);
    $("dHistBody").innerHTML = state.rounds.length ? state.rounds.map((r, i) => `<tr><td>${i + 1}</td>${r.scores.map((v, p) => `<td><span class="${v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${v}</span>${roundTags(r, p)}${r.money ? `<small class="d-cell-money ${r.money[p] < 0 ? "neg" : r.money[p] > 0 ? "pos" : ""}">${baht(r.money[p])}</small>` : ""}</td>`).join("")}<td><button type="button" class="secondary d-icon" data-del="${i}" aria-label="ลบเกมที่ ${i + 1}">🗑</button></td></tr>`).reverse().join("")
      + `<tr class="d-sum"><td>รวม</td>${t.map((v, p) => `<td>${v.toLocaleString()}${showMoney ? `<small class="d-cell-money ${m[p] < 0 ? "neg" : m[p] > 0 ? "pos" : ""}">${baht(m[p])}</small>` : ""}</td>`).join("")}<td></td></tr>`
      : `<tr><td colspan="${state.players.length + 2}" class="empty">ยังไม่มีเกมที่บันทึก</td></tr>`;
  }
  $("dHistBody").addEventListener("click", e => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const i = int(b.dataset.del);
    if (!confirm(`ลบเกมที่ ${i + 1}?`)) return;
    state.rounds.splice(i, 1); save(); render();
  });
  $("dUndo").addEventListener("click", () => { if (!state.rounds.length || !confirm(`ลบผลเกมที่ ${state.rounds.length}?`)) return; state.rounds.pop(); save(); render(); toast("ลบเกมล่าสุดแล้ว"); });
  $("dRematch").addEventListener("click", () => { if (!confirm("ล้างผลทุกเกม เริ่มนับใหม่ด้วยผู้เล่นชุดเดิม?")) return; state.rounds = []; save(); render(); });
  $("dEdit").addEventListener("click", () => { $("dSetup").hidden = false; renderSetup(); $("dSetup").scrollIntoView({ behavior: "smooth" }); });

  // ---- who pays whom ----
  function paymentLines() {
    return pairDebts(state.rounds, state.players.length).map(t => ({ ...t, fromName: state.players[t.from], toName: state.players[t.to] }));
  }
  function renderPayments() {
    const lines = paymentLines(), show = hasMoney(state);
    $("dPay").hidden = !show; if (!show) return;
    $("dPayList").innerHTML = lines.length
      ? lines.map(l => `<div class="d-pay-row"><b>${esc(l.fromName)}</b><span class="d-pay-arrow">จ่าย ➜</span><b>${esc(l.toName)}</b><b class="d-pay-amt">${baht(l.amount).replace("+", "")}</b>${l.back ? `<small class="d-pay-note">ติด ${baht(l.owed).replace("+", "")} หักที่ ${esc(l.toName)} ติดคืน ${baht(l.back).replace("+", "")}</small>` : ""}</div>`).join("")
      : '<div class="muted">ยังไม่มีใครต้องจ่าย (เจ๊ากันหมด)</div>';
    $("dPayCopy").hidden = !lines.length;
  }
  $("dPayCopy").addEventListener("click", async () => {
    const lines = paymentLines();
    const text = [`🃏 สรุปเงินดัมมี่ (${state.rounds.length} เกม)`, ...lines.map(l => `${l.fromName} จ่าย ${l.toName} ${baht(l.amount).replace("+", "")}`)].join("\n");
    try { await navigator.clipboard.writeText(text); toast("คัดลอกแล้ว วางในไลน์ได้เลย"); }
    catch { prompt("คัดลอกข้อความนี้", text); }
  });

  function render() {
    const playing = state.players.length >= 2;
    $("dSetup").hidden = playing; $("dGame").hidden = !playing;
    if (!playing) return renderSetup();
    renderEntry(); renderBoard(); renderPayments(); renderHistory(); updateCalc();
  }
  render();
})();
