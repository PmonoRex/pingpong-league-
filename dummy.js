// Dummy (ดัมมี่) score keeper — standalone page. localStorage is the offline copy; the cloud copy lives in the
// `dummy` column of the shared row (never inside the league data) and syncs when the column exists.
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
  function blank() { return { players: [], rounds: [], target: 0, knockBonus: 0, moneyMode: "points", rates: [10, 20, 30], divisor: 10, dayStart: 0, rev: 0 }; }
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
    // dayStart: games before this moment belong to earlier days (still kept); rev: cloud revision this copy is based on.
    s.dayStart = Math.max(0, int(raw.dayStart));
    s.rev = Math.max(0, int(raw.rev));
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

  // Games of the current day: everything saved since "เริ่มวันใหม่" (all games until it is first pressed).
  function currentRounds(s) { return s.dayStart ? s.rounds.filter(r => r.at >= s.dayStart) : s.rounds; }
  // Local calendar day of a game ("YYYY-MM-DD"); games saved before timestamps existed have no day ("").
  function dayKey(at) {
    const t = int(at); if (!(t > 0)) return "";
    const d = new Date(t), pad = v => String(v).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  // One entry per calendar day, newest first (undated games last): points, money and the pair-by-pair debts of that day only.
  function daySummaries(s, keyOf = dayKey) {
    const groups = new Map();
    s.rounds.forEach((r, i) => { const k = keyOf(r.at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    return [...groups].map(([day, indices]) => {
      const sub = { ...s, rounds: indices.map(i => s.rounds[i]) };
      return { day, indices, games: indices.length, totals: totals(sub), money: moneyTotals(sub), hasMoney: hasMoney(sub), debts: pairDebts(sub.rounds, s.players.length) };
    }).sort((a, b) => a.day < b.day ? 1 : a.day > b.day ? -1 : 0);
  }

  // Two devices edited the same sheet since `base` (the last copy both agreed on). Games are matched by content,
  // so games added on either side are kept and games deleted on either side stay deleted; a setting takes the
  // side that changed it. If the line-ups differ the sheets cannot be combined: the side that changed its
  // line-up wins (the cloud on a tie) and `conflict` says this device's games were not kept.
  function roundKey(r) { return JSON.stringify([r.at, r.scores, r.knock, r.money, r.vals]); }
  function mergeDummy(base, local, remote) {
    base = normalize(base); local = normalize(local); remote = normalize(remote);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(local.players, remote.players)) {
      if (!same(local.players, base.players) && same(remote.players, base.players)) return { state: { ...local, rev: remote.rev }, conflict: false };
      return { state: remote, conflict: !same(local.rounds, base.rounds) && local.rounds.length > 0 };
    }
    const count = list => list.reduce((m, r) => m.set(roundKey(r), (m.get(roundKey(r)) || 0) + 1), new Map());
    const baseN = count(base.rounds), localN = count(local.rounds), take = new Map();
    // deleted here: base copies missing from local; added here: local copies beyond base.
    baseN.forEach((n, k) => { if (n > (localN.get(k) || 0)) take.set(k, n - (localN.get(k) || 0)); });
    const rounds = remote.rounds.filter(r => { const k = roundKey(r), n = take.get(k) || 0; if (n) { take.set(k, n - 1); return false; } return true; });
    const remoteN = count(remote.rounds);
    localN.forEach((n, k) => {
      const extra = n - (baseN.get(k) || 0) - Math.max(0, (remoteN.get(k) || 0) - (baseN.get(k) || 0));
      for (let i = 0; i < extra; i++) rounds.push(local.rounds.find(r => roundKey(r) === k));
    });
    rounds.sort((a, b) => a.at - b.at);
    const pick = key => same(local[key], base[key]) ? remote[key] : local[key];
    return { state: { ...remote, moneyMode: pick("moneyMode"), rates: pick("rates"), divisor: pick("divisor"), target: pick("target"), knockBonus: pick("knockBonus"), dayStart: Math.max(local.dayStart, remote.dayStart), rounds }, conflict: false };
  }

  window.DummyScore = { normalize, totals, moneyTotals, standings, winner, cardPoints, settleWinner, settlePoints, multiplier, pairDebts, currentRounds, dayKey, daySummaries, mergeDummy, CARD_VALUES };

  const $ = id => document.getElementById(id);
  if (!$("dummyApp")) return;

  const baht = v => `${v > 0 ? "+" : ""}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}฿`;
  let state = load();
  function load() { try { return normalize(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return blank(); } }
  function store() { try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(SYNC_KEY, JSON.stringify(meta)); } catch {} }
  function save() { meta.dirty = true; edits++; store(); queueSync(); }

  // ---- cloud sync ----
  // meta.base is the last copy this device and the cloud agreed on; meta.dirty marks local edits not yet in the cloud.
  // A sheet from before sync existed has no meta: treat its games as unsynced so the first sync merges them in.
  const SYNC_KEY = "pp_dummy_sync_v1", CONFLICT_KEY = "pp_dummy_conflict_v1", Cloud = typeof LeagueShared !== "undefined" ? LeagueShared : null;
  let meta = (() => {
    try { const m = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); if (m && typeof m === "object") return { base: normalize(m.base), dirty: !!m.dirty }; } catch {}
    return { base: blank(), dirty: state.players.length > 0 };
  })();
  let edits = 0, syncing = false, syncTimer = 0, cloudOff = !Cloud;
  function setSync(text, status = "") { const el = $("dSync"); el.textContent = text; el.className = `pill sync ${status}`; }
  function queueSync() { if (cloudOff) return; setSync("กำลังบันทึก..."); clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 400); }
  function adopt(remote) {
    const sig = entrySig(); state = remote; meta = { base: normalize(remote), dirty: false }; store();
    render(sig !== entrySig());
  }
  async function syncNow() {
    if (cloudOff || syncing) return;
    syncing = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = normalize(await Cloud.loadDummyCloud());
        if (!meta.dirty) { if (remote.rev !== state.rev) adopt(remote); setSync("ออนไลน์ • ซิงก์แล้ว", "online"); return; }
        if (remote.rev !== meta.base.rev) {
          const sig = entrySig(), merged = mergeDummy(meta.base, state, remote);
          if (merged.conflict) { try { localStorage.setItem(CONFLICT_KEY, JSON.stringify({ savedAt: new Date().toISOString(), dummy: state })); } catch {} toast("อีกเครื่องเปลี่ยนผู้เล่นแล้ว • เก็บแต้มของเครื่องนี้ไว้สำรอง"); }
          state = merged.state; store(); render(sig !== entrySig());
        }
        const started = edits, next = { ...state, rev: remote.rev + 1 };
        const saved = await Cloud.saveDummyCloud(next, remote.rev);
        if (!saved) continue;
        meta.base = normalize(saved);
        if (edits === started) { state = normalize(saved); meta.dirty = false; }
        else state.rev = meta.base.rev;
        store();
        // Edited again while saving: send those edits in a fresh round once this one has finished.
        if (meta.dirty) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 0); }
        else setSync("ออนไลน์ • บันทึกแล้ว", "online");
        return;
      }
      setSync("มีคนแก้พร้อมกัน • จะลองใหม่", "offline");
    } catch (error) {
      // 400 = the `dummy` column is not there yet (migration not run): stay local-only for this visit.
      if (/\b400\b/.test(error?.message || "")) { cloudOff = true; setSync("ยังไม่เปิดซิงก์ • เก็บในเครื่อง", "offline"); }
      else setSync("ออฟไลน์ • เก็บในเครื่อง", "offline");
    } finally { syncing = false; }
  }
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
      rates: [$("dRate2").value, $("dRate3").value, $("dRate4").value], divisor: $("dDivisor").value, rounds: samePlayers ? state.rounds : [],
      dayStart: samePlayers ? state.dayStart : 0, rev: state.rev
    });
    if (!samePlayers && state.rounds.length && !confirm("เปลี่ยนผู้เล่นแล้วแต้มเดิมจะถูกล้าง เริ่มเกมใหม่?")) return;
    state = next; save(); render(); toast(samePlayers && state.rounds.length ? "บันทึกการตั้งค่าแล้ว" : "เริ่มเกมแล้ว");
  });

  // ---- round entry ----
  function entrySig() { return JSON.stringify([state.players, state.moneyMode]); }
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
  // The board and "who pays whom" cover the current day only; earlier days live in the day summary.
  const today = () => ({ ...state, rounds: currentRounds(state) });
  const dayLabel = key => key ? new Date(`${key}T12:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "ไม่ทราบวัน";
  function renderBoard() {
    const view = today(), showMoney = moneyOn() || hasMoney(view), byMoney = moneyOn();
    const rows = byMoney ? standings(view).sort((a, b) => b.money - a.money || a.index - b.index) : standings(view);
    const top = Math.max(...rows.map(r => r.total)), w = winner(view);
    $("dBoardTitle").textContent = state.dayStart ? `สรุปวันนี้ (เริ่ม ${new Date(state.dayStart).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : "สรุปรวมทุกเกม";
    $("dWinner").hidden = !w;
    if (w) $("dWinner").innerHTML = `<b>${esc(w.name)}</b> ถึง ${state.target.toLocaleString()} แต้มแล้ว — ชนะเกมนี้!`;
    $("dMeta").textContent = `เล่นไปแล้ว ${view.rounds.length} เกม${state.target ? ` • เป้า ${state.target.toLocaleString()} แต้ม` : ""}${winnerMode() ? ` • เงิน: ${MONEY_MODES.winner} (${state.rates.slice(0, state.players.length - 1).join(" / ")}฿)` : state.moneyMode === "points" ? ` • เงิน: แต้ม ÷ ${state.divisor} หักลบกัน` : ""}`;
    // With money on, each row leads with the baht result; points step down to a detail line.
    if (byMoney) {
      $("dBoard").innerHTML = rows.map((r, pos) => {
        const tone = r.money < 0 ? "neg" : r.money > 0 ? "pos" : "";
        const detail = [`รวม ${r.total.toLocaleString()} แต้ม`, r.knocks ? `น็อค ${r.knocks} ครั้ง` : ""].filter(Boolean).join(" • ");
        return `<div class="d-board-row d-cash ${pos === 0 && view.rounds.length && r.money > 0 ? "lead" : ""}"><span class="d-pos">${pos + 1}</span><div class="d-board-name"><b>${esc(r.name)}</b><small>${detail}</small></div><b class="d-cash-amt ${tone}">${baht(r.money)}</b></div>`;
      }).join("");
      return;
    }
    $("dBoard").innerHTML = rows.map((r, pos) => {
      const pct = state.target ? Math.max(0, Math.min(100, r.total / state.target * 100)) : 0;
      return `<div class="d-board-row ${pos === 0 && view.rounds.length && (byMoney ? r.money > 0 : r.total === top) ? "lead" : ""}"><span class="d-pos">${pos + 1}</span><div class="d-board-name"><b>${esc(r.name)}</b><small>${[r.knocks ? `น็อค ${r.knocks} ครั้ง` : "", r.total < top ? `ตามแต้มสูงสุด ${(top - r.total).toLocaleString()}` : ""].filter(Boolean).join(" • ") || "&nbsp;"}</small>${state.target ? `<div class="d-bar"><span style="width:${pct}%"></span></div>` : ""}</div><div class="d-board-right"><b class="d-total ${r.total < 0 ? "neg" : ""}">${r.total.toLocaleString()}</b>${showMoney ? `<span class="d-money ${r.money < 0 ? "neg" : r.money > 0 ? "pos" : ""}">${baht(r.money)}</span>` : ""}</div></div>`;
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
    $("dHistBody").innerHTML = state.rounds.length ? state.rounds.map((r, i) => `<tr><td>${i + 1}</td>${r.scores.map((v, p) => `<td><span class="${v < 0 ? "neg" : ""}">${v > 0 ? "+" : ""}${v}</span>${roundTags(r, p)}${r.money ? `<small class="d-cell-money ${r.money[p] < 0 ? "neg" : r.money[p] > 0 ? "pos" : ""}">${baht(r.money[p])}</small>` : ""}</td>`).join("")}<td><button type="button" class="secondary d-icon" data-del="${i}" aria-label="ลบเกมที่ ${i + 1}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5"/></svg></button></td></tr>`).reverse().join("")
      + `<tr class="d-sum"><td>รวม</td>${t.map((v, p) => `<td>${v.toLocaleString()}${showMoney ? `<small class="d-cell-money ${m[p] < 0 ? "neg" : m[p] > 0 ? "pos" : ""}">${baht(m[p])}</small>` : ""}</td>`).join("")}<td></td></tr>`
      : `<tr><td colspan="${state.players.length + 2}" class="empty">ยังไม่มีเกมที่บันทึก</td></tr>`;
  }
  $("dHistBody").addEventListener("click", e => {
    const b = e.target.closest("[data-del]"); if (!b) return;
    const i = int(b.dataset.del);
    if (!confirm(`ลบเกมที่ ${i + 1}?`)) return;
    state.rounds.splice(i, 1); save(); render();
  });
  $("dUndo").addEventListener("click", () => { if (!currentRounds(state).length) return toast("วันนี้ยังไม่มีเกม"); if (!confirm(`ลบผลเกมที่ ${state.rounds.length}?`)) return; state.rounds.pop(); save(); render(); toast("ลบเกมล่าสุดแล้ว"); });
  $("dRematch").addEventListener("click", () => { if (!confirm("ล้างผลทุกเกม (รวมสรุปทุกวัน) เริ่มนับใหม่ด้วยผู้เล่นชุดเดิม?")) return; state.rounds = []; state.dayStart = 0; save(); render(); });
  $("dNewDay").addEventListener("click", () => {
    if (!currentRounds(state).length) return toast("วันนี้ยังไม่มีเกม");
    if (!confirm("เริ่มวันใหม่? แต้มและยอดเงินบนกระดานจะเริ่มนับใหม่ เกมเก่ายังอยู่ในสรุปรายวัน")) return;
    state.dayStart = Date.now(); save(); render(); toast("เริ่มวันใหม่แล้ว");
  });
  $("dEdit").addEventListener("click", () => { $("dSetup").hidden = false; renderSetup(); $("dSetup").scrollIntoView({ behavior: "smooth" }); });

  // ---- who pays whom ----
  function paymentLines(rounds) {
    return pairDebts(rounds, state.players.length).map(t => ({ ...t, fromName: state.players[t.from], toName: state.players[t.to] }));
  }
  function payRows(lines) {
    return lines.length
      ? lines.map(l => `<div class="d-pay-row"><b>${esc(l.fromName)}</b><span class="d-pay-arrow">จ่าย ➜</span><b>${esc(l.toName)}</b><b class="d-pay-amt">${baht(l.amount).replace("+", "")}</b>${l.back ? `<small class="d-pay-note">ติด ${baht(l.owed).replace("+", "")} หักที่ ${esc(l.toName)} ติดคืน ${baht(l.back).replace("+", "")}</small>` : ""}</div>`).join("")
      : '<div class="muted">ยังไม่มีใครต้องจ่าย (เจ๊ากันหมด)</div>';
  }
  function renderPayments() {
    const view = today(), lines = paymentLines(view.rounds), show = hasMoney(view);
    $("dPay").hidden = !show; if (!show) return;
    $("dPayList").innerHTML = payRows(lines);
    $("dPayCopy").hidden = !lines.length;
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast("คัดลอกแล้ว วางในไลน์ได้เลย"); }
    catch { prompt("คัดลอกข้อความนี้", text); }
  }
  const payText = (title, rounds) => [`🃏 ${title} (${rounds.length} เกม)`, ...paymentLines(rounds).map(l => `${l.fromName} จ่าย ${l.toName} ${baht(l.amount).replace("+", "")}`)].join("\n");
  $("dPayCopy").addEventListener("click", () => copyText(payText("สรุปเงินดัมมี่", currentRounds(state))));

  // ---- per-day summary ----
  function renderDays() {
    const days = daySummaries(state);
    $("dDaysCard").hidden = !days.length;
    $("dDays").innerHTML = days.map((d, n) => {
      const cells = state.players.map((name, i) => d.hasMoney
        ? `<span class="${d.money[i] < 0 ? "neg" : d.money[i] > 0 ? "pos" : ""}">${esc(name)} ${baht(d.money[i])}</span>`
        : `<span>${esc(name)} ${d.totals[i].toLocaleString()} แต้ม</span>`).join("");
      const lines = d.hasMoney ? paymentLines(d.indices.map(i => state.rounds[i])) : [];
      return `<details class="d-day"${n === 0 ? " open" : ""}><summary><b>${esc(dayLabel(d.day))}</b><span class="muted">${d.games} เกม</span></summary><div class="d-preview-list">${cells}</div>${d.hasMoney ? `<div class="d-pay-list">${payRows(lines)}</div>${lines.length ? `<button type="button" class="secondary" data-copy-day="${esc(d.day)}">คัดลอกไปส่งในไลน์</button>` : ""}` : ""}</details>`;
    }).join("");
  }
  $("dDays").addEventListener("click", e => {
    const b = e.target.closest("[data-copy-day]"); if (!b) return;
    const d = daySummaries(state).find(x => x.day === b.dataset.copyDay); if (!d) return;
    copyText(payText(`สรุปเงินดัมมี่ ${dayLabel(d.day)}`, d.indices.map(i => state.rounds[i])));
  });

  // full = false (a cloud update) keeps the score entry the user may be typing into.
  let shownSig = "";
  function render(full = true) {
    const playing = state.players.length >= 2;
    $("dSetup").hidden = playing; $("dGame").hidden = !playing;
    if (!playing) { shownSig = ""; return renderSetup(); }
    if (full || shownSig !== entrySig()) { renderEntry(); shownSig = entrySig(); } else { $("dDivQuick").value = state.divisor; updatePreview(); }
    renderBoard(); renderPayments(); renderDays(); renderHistory(); updateCalc();
  }
  render();
  if (cloudOff) setSync("ออฟไลน์ • เก็บในเครื่อง", "offline");
  else {
    syncNow();
    setInterval(() => { if (!document.hidden) syncNow(); }, 4000);
    addEventListener("online", syncNow);
  }
})();
