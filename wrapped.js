// Season Wrapped: a full-screen story of one player's season (LeagueStats.wrapped), opened from เมนู → สรุปซีซั่นของฉัน.
// Tap the right side (or →) for the next slide, the left side (or ←) to go back; slides also move on by themselves.
// The last slide shares a 1080x1920 story image (canvas, names drawn with fillText). Reads only; never writes league data.
(() => {
  if (typeof document === "undefined") return;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const LS = () => typeof LeagueShared !== "undefined" ? LeagueShared : null;
  const league = () => { try { return LS()?.readLocalLeague() || null; } catch { return null; } };
  const pred = () => { try { return JSON.parse(localStorage.getItem(LS()?.PRED_KEY) || "null"); } catch { return null; } };
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SLIDE_MS = 5200;

  // The season to look back on: the latest finished one (in rankHistory) the player took part in, else the current one.
  function pickSeason(l, id) {
    const done = (l?.rankHistory || []).filter(h => (h.standings || []).some(r => r.userId === id)).map(h => Number(h.season)).sort((a, b) => b - a);
    return done[0] || Number(l?.currentSeason) || 1;
  }

  function slides(l, id, season) {
    const S = LeagueStats, w = S.wrapped(l, id, season, pred()), nm = x => l.profiles?.[x]?.displayName || x, me = nm(id);
    const UI = window.LeagueUI, av = (x, size = "xl") => UI?.avatar ? UI.avatar(x, nm(x), size) : "";
    const finished = !!w.rank, out = [];
    out.push({ tone: "red", html: `<p class="wr-kicker">ซีซั่น ${season}</p>${av(id)}<h2 class="wr-big">${esc(me)}</h2><p class="wr-sub">ย้อนดูซีซั่นของคุณ</p><p class="wr-hint">แตะเพื่อไปต่อ</p>` });
    if (!w.n) { out.push({ tone: "dark", html: `<p class="wr-kicker">ซีซั่น ${season}</p><h2 class="wr-big">ยังไม่มีผล</h2><p class="wr-sub">ลงแข่งสักนัดแล้วกลับมาดูใหม่</p>` }); return { w, out }; }
    out.push({ tone: "dark", html: `<p class="wr-kicker">ซีซั่นนี้คุณลงแข่ง</p><div class="wr-num" data-n="${w.n}">${w.n}</div><p class="wr-sub">นัด</p><div class="wr-wdl"><span class="w">ชนะ ${w.w}</span><span>เสมอ ${w.d}</span><span class="l">แพ้ ${w.l}</span></div>` });
    out.push({ tone: "red", html: `<p class="wr-kicker">อัตราชนะ</p><div class="wr-num">${w.rate}%</div><div class="wr-meter"><i style="width:${w.rate}%"></i></div><p class="wr-sub">${w.rate >= 70 ? "โหดเกินไปแล้ว" : w.rate >= 50 ? "ชนะมากกว่าแพ้ เก่งเลย" : w.rate >= 30 ? "สู้ได้ทุกนัด" : "ซีซั่นหน้าเอาใหม่"}</p>` });
    out.push({ tone: "dark", html: `<p class="wr-kicker">แต้มที่ตีได้ทั้งซีซั่น</p><div class="wr-num">${w.pf}</div><p class="wr-sub">เสียไป ${w.pa} แต้ม</p>${w.streak >= 2 ? `<div class="wr-pill">🔥 ชนะรวดสูงสุด ${w.streak} นัด</div>` : ""}` });
    if (w.best) out.push({ tone: "red", html: `<p class="wr-kicker">ชัยชนะที่ขาดที่สุด</p>${av(w.best.o, "lg")}<p class="wr-sub">ต่อ ${esc(nm(w.best.o))}</p><div class="wr-num">${w.best.f}–${w.best.a}</div>` });
    if (w.victim || w.nemesis) out.push({ tone: "dark", html: `<p class="wr-kicker">คู่ปรับประจำซีซั่น</p><div class="wr-duo">${w.victim ? `<div>${av(w.victim.o, "lg")}<b>${esc(nm(w.victim.o))}</b><small>เหยื่อประจำ • ชนะ ${w.victim.w} แพ้ ${w.victim.l}</small></div>` : ""}${w.nemesis ? `<div class="nem">${av(w.nemesis.o, "lg")}<b>${esc(nm(w.nemesis.o))}</b><small>ศัตรูคู่แค้น • ชนะ ${w.nemesis.w} แพ้ ${w.nemesis.l}</small></div>` : ""}</div>` });
    if (w.bets) out.push({ tone: "red", html: `<p class="wr-kicker">ทายผลไป ${w.bets} ครั้ง</p><div class="wr-num">${w.betHits}</div><p class="wr-sub">ครั้งที่ทายถูก</p><div class="wr-pill">${w.net >= 0 ? "กำไร" : "ขาดทุน"} ${Math.abs(w.net)} เครดิต</div>` });
    const move = finished && w.prevRank ? w.prevRank - w.rank : 0;
    out.push({ tone: "gold", html: finished
      ? `<p class="wr-kicker">จบซีซั่นที่อันดับ</p><div class="wr-num">#${w.rank}</div>${move ? `<div class="wr-pill">${move > 0 ? `ขึ้นมา ${move} อันดับ` : `ตกไป ${-move} อันดับ`} จากซีซั่นก่อน</div>` : ""}${w.rp ? `<p class="wr-sub">ได้ +${w.rp} RP</p>` : ""}`
      : `<p class="wr-kicker">ซีซั่นยังไม่จบ</p><div class="wr-num">${w.w}</div><p class="wr-sub">ชัยชนะจนถึงตอนนี้</p>` });
    const got = S.badges(l, id, pred()).filter(b => b.have);
    out.push({ tone: "end", html: `<p class="wr-kicker">ซีซั่น ${season} ของ ${esc(me)}</p>${av(id)}<div class="wr-sum"><div><b>${w.n}</b><small>แข่ง</small></div><div><b>${w.w}</b><small>ชนะ</small></div><div><b>${w.rate}%</b><small>อัตราชนะ</small></div><div><b>${finished ? `#${w.rank}` : "–"}</b><small>อันดับ</small></div></div>${got.length ? `<div class="wr-badges">${got.map(b => `<span title="${esc(b.name)}">${b.icon} ${esc(b.name)}</span>`).join("")}</div>` : ""}<div class="wr-actions"><button type="button" class="primary" data-wr-share>แชร์เข้า LINE</button><button type="button" class="secondary" data-wr-close>ปิด</button></div>` });
    return { w, out };
  }

  let root = null, at = 0, list = [], timer = 0, data = null, lastFocus = null;
  function ensure() {
    if (root) return root;
    root = document.createElement("div"); root.className = "wr"; root.hidden = true;
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "สรุปซีซั่น");
    document.body.appendChild(root);
    root.addEventListener("click", e => {
      if (e.target.closest("[data-wr-close]")) return close();
      if (e.target.closest("[data-wr-share]")) return share(e.target.closest("[data-wr-share]"));
      if (e.target.closest("button,a")) return;
      const r = root.getBoundingClientRect();
      go(e.clientX < r.left + r.width * .33 ? at - 1 : at + 1);
    });
    document.addEventListener("keydown", e => {
      if (!root || root.hidden) return;
      if (e.key === "Escape") close(); else if (e.key === "ArrowRight") go(at + 1); else if (e.key === "ArrowLeft") go(at - 1);
    });
    return root;
  }
  function go(i) {
    if (i >= list.length) return;
    at = Math.max(0, i);
    clearTimeout(timer);
    root.querySelectorAll(".wr-bar i").forEach((b, j) => { b.className = j < at ? "done" : j === at ? "run" : ""; });
    const s = list[at], body = root.querySelector(".wr-slide");
    body.className = `wr-slide tone-${s.tone}`; body.innerHTML = s.html;
    void body.offsetWidth; body.classList.add("in");
    if (at < list.length - 1 && !still()) timer = setTimeout(() => go(at + 1), SLIDE_MS);
  }
  function open(season) {
    const l = league(), id = (() => { try { return LS()?.sessionUserId(l) || ""; } catch { return ""; } })();
    if (!l?.profiles?.[id] || typeof LeagueStats === "undefined") { window.LeagueToast?.("เข้าสู่ระบบก่อนถึงจะดูสรุปซีซั่นได้", "bad"); return; }
    const s = Number(season) || pickSeason(l, id);
    data = { l, id, season: s, ...slides(l, id, s) }; list = data.out;
    ensure(); lastFocus = document.activeElement;
    root.innerHTML = `<div class="wr-bar">${list.map(() => "<i></i>").join("")}</div><button type="button" class="wr-x" data-wr-close aria-label="ปิด"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button><div class="wr-slide" aria-live="polite"></div>`;
    root.style.setProperty("--wr-ms", `${SLIDE_MS}ms`);
    root.hidden = false; document.body.classList.add("wr-open");
    go(0); root.querySelector(".wr-x").focus({ preventScroll: true });
  }
  function close() {
    if (!root || root.hidden) return;
    clearTimeout(timer); root.hidden = true; document.body.classList.remove("wr-open");
    lastFocus?.focus?.({ preventScroll: true });
  }

  // ---------- Story image (1080x1920) ----------
  function storyCanvas() {
    const { l, id, season, w } = data, W = 1080, H = 1920, cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const c = cv.getContext("2d"), name = l.profiles[id]?.displayName || id, nm = x => l.profiles?.[x]?.displayName || x;
    const DISPLAY = "Kanit, Anuphan, sans-serif", BODY = "Anuphan, system-ui, sans-serif";
    const txt = (s, x, y, size, { color = "#fff", font = DISPLAY, weight = "800 italic", align = "center", max = 960 } = {}) => {
      let z = size; do { c.font = `${weight.includes("italic") ? "italic " : ""}${weight.replace("italic", "").trim()} ${z}px ${font}`; } while (c.measureText(s).width > max && --z > 20);
      c.fillStyle = color; c.textAlign = align; c.fillText(s, x, y);
    };
    c.fillStyle = "#0a0b0e"; c.fillRect(0, 0, W, H);
    const g = c.createRadialGradient(W * .8, 0, 0, W * .8, 0, 1300); g.addColorStop(0, "rgba(229,36,47,.6)"); g.addColorStop(1, "rgba(229,36,47,0)"); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = "rgba(229,36,47,.85)"; c.beginPath(); c.moveTo(0, 1380); c.lineTo(W, 1180); c.lineTo(W, 1230); c.lineTo(0, 1430); c.fill();
    c.strokeStyle = "rgba(255,71,82,.6)"; c.lineWidth = 5; c.strokeRect(28, 28, W - 56, H - 56);
    txt("SEASON WRAPPED", W / 2, 190, 56, { color: "#ff4752" });
    txt(`ซีซั่น ${season}`, W / 2, 270, 46, { font: BODY, weight: "700", color: "rgba(255,255,255,.85)" });
    txt(name, W / 2, 440, 150);
    const box = (x, y, big, small) => {
      c.fillStyle = "rgba(255,255,255,.06)"; c.strokeStyle = "rgba(255,255,255,.16)"; c.lineWidth = 3;
      c.beginPath(); c.roundRect?.(x, y, 460, 250, 28); c.fill(); c.stroke();
      txt(big, x + 230, y + 150, 120, { max: 420 }); txt(small, x + 230, y + 215, 38, { font: BODY, weight: "700", color: "#c9cdd5", max: 420 });
    };
    box(60, 540, String(w.n), "นัดที่ลงแข่ง"); box(560, 540, `${w.rate}%`, "อัตราชนะ");
    box(60, 830, `${w.w}-${w.d}-${w.l}`, "ชนะ-เสมอ-แพ้"); box(560, 830, w.rank ? `#${w.rank}` : `${w.pf}`, w.rank ? "อันดับจบซีซั่น" : "แต้มที่ตีได้");
    let y = 1170;
    if (w.best) { txt(`ชนะขาดสุด ${w.best.f}–${w.best.a} ต่อ ${nm(w.best.o)}`, W / 2, y, 48, { font: BODY, weight: "700" }); y += 80; }
    if (w.nemesis) { txt(`ศัตรูคู่แค้น: ${nm(w.nemesis.o)}`, W / 2, y, 48, { font: BODY, weight: "700", color: "#ff8a92" }); y += 80; }
    if (w.streak >= 2) txt(`ชนะรวดสูงสุด ${w.streak} นัด`, W / 2, y, 48, { font: BODY, weight: "700", color: "#ffe28a" });
    txt("ตีให้สุด หยุดที่เบ้าตา", W / 2, H - 120, 54);
    return cv;
  }
  async function share(btn) {
    if (btn.getAttribute("aria-busy") === "true") return; btn.setAttribute("aria-busy", "true");
    try {
      await (window.SharePoster?.loadFonts?.() || document.fonts?.ready);
      const blob = await new Promise(ok => storyCanvas().toBlob(ok, "image/png")); if (!blob) throw 0;
      const fileName = `wrapped-s${data.season}.png`, file = new File([blob], fileName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: "สรุปซีซั่น" }); return; } catch (e) { if (e?.name === "AbortError") return; } }
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      window.LeagueToast?.("บันทึกรูปแล้ว ส่งเข้า LINE ได้เลย", "good");
    } catch { window.LeagueToast?.("ทำรูปไม่สำเร็จ", "bad"); }
    finally { btn.removeAttribute("aria-busy"); }
  }

  // After a season ends, the home page offers the story once: a pill that opens it, gone once seen or dismissed.
  const SEEN = "pp_wrapped_seen";
  function offer() {
    if (!document.body.classList.contains("sport-page-index-html") || document.querySelector(".wr-offer")) return;
    const l = league(); let id = ""; try { id = LS()?.sessionUserId(l) || ""; } catch {}
    if (!l?.profiles?.[id]) return;
    const s = (l.rankHistory || []).filter(h => (h.standings || []).some(r => r.userId === id)).map(h => Number(h.season)).sort((a, b) => b - a)[0];
    let seen = 0; try { seen = Number(localStorage.getItem(SEEN)) || 0; } catch {}
    if (!s || s <= seen) return;
    const mark = () => { try { localStorage.setItem(SEEN, String(s)); } catch {} pill.remove(); };
    const pill = document.createElement("div"); pill.className = "wr-offer";
    pill.innerHTML = `<button type="button" class="wr-offer-go">สรุปซีซั่น ${s} ของคุณพร้อมแล้ว <b>ดูเลย</b></button><button type="button" class="wr-offer-x" aria-label="ไม่ดูตอนนี้">×</button>`;
    pill.querySelector(".wr-offer-go").addEventListener("click", () => { mark(); open(s); });
    pill.querySelector(".wr-offer-x").addEventListener("click", mark);
    document.body.appendChild(pill);
  }
  if (document.readyState === "complete") setTimeout(offer, 1200); else addEventListener("load", () => setTimeout(offer, 1200), { once: true });

  window.LeagueWrapped = Object.freeze({ open, close });
})();
