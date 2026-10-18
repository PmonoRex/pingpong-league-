// Share a finished match or the season table as a poster image (1080x1350 PNG) to LINE via the share sheet.
// Names are drawn with canvas fillText and never become markup; the pure helpers at the top are covered by tests/share-poster.test.cjs.
(() => {
  const W = 1080, H = 1350;
  const LEAGUE = "ตีให้สุด หยุดที่เบ้าตา";
  // Night-arena inks: near-black ground, smoked panels, red as the one loud colour (same palette as arena.css).
  const C = { bg: "#0a0b0e", night: "#0c0d11", paper: "#15171d", paper2: "#1c1f26", ink: "#f4f5f7", inkSoft: "#9ba1ad", line: "rgba(255,255,255,.14)",
    redHi: "#ff4752", magentaDeep: "#ff4752", red: "#ff5560", redSolid: "#d81e29", blue: "#5b8cff", redField: "#2a1216", blueField: "#121a2e",
    gold: "#f5b80b", silver: "#c3cad5", bronze: "#d68a4c", onMedal: "#14171c" };
  const DISPLAY = "Kanit, Anuphan, sans-serif", UI = "Anuphan, system-ui, sans-serif";

  // {n} is the loser's name. Friendly ribbing only.
  const TAUNTS = [
    "{n} กลับไปซ้อมเสิร์ฟก่อนนะ",
    "{n} วันนี้ไม้งอน ไม่ยอมเข้าลูก",
    "{n} ตีโดนแต่อากาศ",
    "{n} ลูกออกเยอะกว่าลูกเข้า",
    "{n} รอบหน้าเอาคืนได้ (มั้ง)",
    "{n} อย่าลืมเลี้ยงน้ำผู้ชนะ",
    "{n} โทษแสงไฟไปก่อนก็ได้",
    "{n} ยังอุ่นเครื่องไม่เสร็จ",
    "{n} โต๊ะเอียงแน่ ๆ ใช่ไหม",
    "{n} ไปซ้อมกับกำแพงสักอาทิตย์",
    "{n} เปลี่ยนไม้ใหม่ก็ช่วยไม่ได้",
    "{n} มาเป็นกำลังใจให้คู่แข่ง",
    "{n} ตีเต็มที่ แต่ลูกไม่เต็มที่",
    "{n} ตบหนักมาก แต่ตบติดเน็ต",
    "ตีให้สุดแล้ว แต่ {n} หยุดที่เบ้าตา",
    "{n} ขอเสิร์ฟใหม่ได้ไหมกรรมการ"
  ];
  const DRAW_LINES = ["สูสีเกิน ไม่มีใครยอมใคร", "เสมอกัน นัดล้างตาด่วน", "ต่างคนต่างเลี้ยงน้ำตัวเอง", "แรงพอกัน ต้องมีภาคสอง"];

  // Plain text for canvas: no control characters, trimmed, at most `max` characters (counted by code point).
  function cleanName(value, max = 32) {
    const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    const chars = Array.from(text);
    return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : text;
  }
  // A function replacer so names containing "$&" or "$1" are inserted literally.
  function taunt(name, rand = Math.random) {
    const line = TAUNTS[Math.floor(rand() * TAUNTS.length) % TAUNTS.length];
    return line.replace("{n}", () => cleanName(name, 18));
  }
  function drawLine(rand = Math.random) { return DRAW_LINES[Math.floor(rand() * DRAW_LINES.length) % DRAW_LINES.length] }
  // Who won a stored result, or null when the scores are not two whole non-negative numbers.
  function matchOutcome(a, b) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return null;
    return a > b ? "a" : b > a ? "b" : "d";
  }
  // Largest font size (step 2) at which measure(text,size) fits maxWidth, never below min.
  function fitSize(measure, text, maxWidth, size, min) {
    while (size > min && measure(text, size) > maxWidth) size -= 2;
    return Math.max(size, min);
  }
  function posterFileName(kind, season) {
    const s = Number.isInteger(Number(season)) ? Number(season) : "x";
    return `pingpong-season-${s}-${String(kind).replace(/[^a-z0-9-]/gi, "").toLowerCase() || "poster"}.png`;
  }
  // Billing for the standings poster: #1 is the main event, #2 and #3 the undercard, the rest run as rows.
  function standingsBill(rows, complete) {
    const top = rows.slice(0, 3).map((row, i) => ({ ...row, rank: i + 1, label: i === 0 ? (complete ? "แชมป์" : "จ่าฝูง") : i === 1 ? "รองจ่าฝูง" : "อันดับ 3" }));
    return { top, rest: rows.slice(3).map((row, i) => ({ ...row, rank: i + 4 })) };
  }

  const api = { TAUNTS, DRAW_LINES, cleanName, taunt, drawLine, matchOutcome, fitSize, posterFileName, standingsBill };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // ---------- Drawing ----------
  let fontsReady = null;
  // Google Fonts serves Thai as a unicode-range subset, so load with Thai sample text or the subset never arrives.
  function loadFonts() {
    if (fontsReady) return fontsReady;
    const sample = "ตีให้สุด หยุดที่เบ้าตา ชนะ 0123456789";
    fontsReady = !document.fonts?.load ? Promise.resolve() : Promise.all([
      document.fonts.load(`italic 800 80px Kanit`, sample), document.fonts.load(`700 40px Anuphan`, sample), document.fonts.load(`600 40px Anuphan`, sample)
    ]).then(() => document.fonts.ready).catch(() => {});
    return fontsReady;
  }
  const font = (size, family = DISPLAY, weight = 400) => family === DISPLAY ? `italic 800 ${size}px ${family}` : `${weight} ${size}px ${family}`;
  function rrect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath() }
  function panel(c, x, y, w, h, fill, line = 3) { rrect(c, x, y, w, h, 18); c.fillStyle = fill; c.fill(); if (line) { c.lineWidth = line; c.strokeStyle = C.line; c.stroke() } }
  // Fits text to maxWidth by shrinking the size; returns the size used.
  function text(c, str, x, y, { size = 40, min = 24, family = DISPLAY, weight = 400, color = C.ink, align = "center", maxWidth = 900 } = {}) {
    const s = fitSize((t, px) => { c.font = font(px, family, weight); return c.measureText(t).width }, str, maxWidth, size, min);
    c.font = font(s, family, weight); c.fillStyle = color; c.textAlign = align; c.textBaseline = "alphabetic"; c.fillText(str, x, y, maxWidth);
    return s;
  }
  function disc(c, x, y, r, fill, ring) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = fill; c.fill(); c.lineWidth = 6; c.strokeStyle = ring; c.stroke() }
  // A word in a coloured border on a dark plate, rotated: the result stamp.
  function stamp(c, word, x, y, color, deg, size = 88) {
    c.save(); c.translate(x, y); c.rotate(deg * Math.PI / 180); c.font = font(size);
    const w = c.measureText(word).width + 56, h = size + 34;
    rrect(c, -w / 2, -h / 2, w, h, 8); c.fillStyle = C.paper; c.fill(); c.lineWidth = 9; c.strokeStyle = color; c.stroke();
    c.fillStyle = color; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(word, 0, 6); c.restore();
  }
  function ribbon(c, str, y) {
    c.font = font(40); const w = c.measureText(str).width + 80;
    rrect(c, (W - w) / 2, y - 38, w, 76, 38); c.fillStyle = C.redSolid; c.fill();
    text(c, str, W / 2, y + 14, { size: 40, color: "#fff" });
  }
  function base(c, season, sub) {
    c.fillStyle = C.bg; c.fillRect(0, 0, W, H);
    const glow = c.createRadialGradient(W, 0, 0, W, 0, 900); glow.addColorStop(0, "rgba(229,36,47,.35)"); glow.addColorStop(1, "rgba(229,36,47,0)");
    c.fillStyle = glow; c.fillRect(0, 0, W, H);
    c.lineWidth = 4; c.strokeStyle = "rgba(255,71,82,.55)"; c.strokeRect(22, 22, W - 44, H - 44);
    panel(c, 48, 48, W - 96, 250, C.paper);
    c.save(); rrect(c, 48, 48, W - 96, 250, 18); c.clip(); c.fillStyle = "rgba(229,36,47,.5)";
    c.beginPath(); c.moveTo(700, 48); c.lineTo(760, 48); c.lineTo(600, 298); c.lineTo(540, 298); c.closePath(); c.fill(); c.restore();
    disc(c, 138, 173, 58, C.redSolid, "rgba(255,255,255,.16)");
    text(c, "ศึก", 138, 190, { size: 44, color: "#fff" });
    text(c, LEAGUE, 222, 178, { size: 78, min: 44, color: "#fff", align: "left", maxWidth: 770 });
    text(c, `SEASON ${season}  •  ${sub}`, 224, 246, { size: 34, min: 22, family: UI, weight: 700, color: "rgba(255,255,255,.92)", align: "left", maxWidth: 770 });
  }
  function footer(c, season) {
    const d = new Date(), date = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`;
    text(c, `${LEAGUE}  •  ซีซั่น ${season}  •  ${date}`, W / 2, H - 62, { size: 28, family: UI, weight: 600, color: C.inkSoft });
  }

  function drawMatch(c, m) {
    const season = Number(m.season) || 1, a = cleanName(m.aName), b = cleanName(m.bName), win = matchOutcome(m.a, m.b);
    base(c, season, "ศึกปิงปองประจำก๊วน");
    ribbon(c, "ผลการประลอง", 352);
    const top = 420, h = 540, mid = W / 2, xa = 48 + (mid - 48) / 2, xb = mid + (W - 48 - mid) / 2;
    rrect(c, 48, top, W - 96, h, 12); c.save(); c.clip();
    c.fillStyle = C.redField; c.fillRect(48, top, mid - 48, h); c.fillStyle = C.blueField; c.fillRect(mid, top, mid - 48, h); c.restore();
    // Each player's own background picture fills their half (darkened so the score stays loud), and their photo sits on top.
    const cover = (img, x, w) => { if (!img) return; c.save(); c.beginPath(); c.rect(x, top, w, h); c.clip();
      const s = Math.max(w / img.width, h / img.height); c.globalAlpha = .5; c.drawImage(img, x + (w - img.width * s) / 2, top + (h - img.height * s) / 2, img.width * s, img.height * s);
      c.globalAlpha = 1; const g = c.createLinearGradient(0, top, 0, top + h); g.addColorStop(0, "rgba(10,11,14,.2)"); g.addColorStop(1, "rgba(10,11,14,.85)"); c.fillStyle = g; c.fillRect(x, top, w, h); c.restore(); };
    rrect(c, 48, top, W - 96, h, 12); c.save(); c.clip(); cover(m.aBanner, 48, mid - 48); cover(m.bBanner, mid, mid - 48); c.restore();
    rrect(c, 48, top, W - 96, h, 18); c.lineWidth = 3; c.strokeStyle = C.line; c.stroke();
    const face = (img, x, ring) => { c.save(); c.beginPath(); c.arc(x, top + 100, 62, 0, Math.PI * 2); c.closePath(); c.fillStyle = C.night; c.fill(); c.clip();
      const s = Math.max(124 / img.width, 124 / img.height); c.drawImage(img, x - img.width * s / 2, top + 100 - img.height * s / 2, img.width * s, img.height * s); c.restore();
      c.beginPath(); c.arc(x, top + 100, 62, 0, Math.PI * 2); c.lineWidth = 6; c.strokeStyle = ring; c.stroke(); };
    if (m.aFace) face(m.aFace, xa, C.red); else text(c, "มุมแดง", xa, top + 120, { size: 30, family: UI, weight: 700, color: C.red });
    if (m.bFace) face(m.bFace, xb, C.blue); else text(c, "มุมน้ำเงิน", xb, top + 120, { size: 30, family: UI, weight: 700, color: C.blue });
    const fade = side => (win === "a" && side === "b") || (win === "b" && side === "a") ? .42 : 1;
    c.globalAlpha = fade("a"); text(c, a, xa, top + 210, { size: 74, min: 34, color: C.red, maxWidth: 400 });
    text(c, String(m.a), xa, top + 470, { size: 240, color: C.red, maxWidth: 400 });
    c.globalAlpha = fade("b"); text(c, b, xb, top + 210, { size: 74, min: 34, color: C.blue, maxWidth: 400 });
    text(c, String(m.b), xb, top + 470, { size: 240, color: C.blue, maxWidth: 400 });
    c.globalAlpha = 1;
    disc(c, mid, top + 300, 66, C.night, "rgba(255,71,82,.7)");
    text(c, "VS", mid, top + 318, { size: 48, color: C.redHi });
    if (win === "a") stamp(c, "ชนะ", 190, top + 6, C.red, -7);
    else if (win === "b") stamp(c, "ชนะ", W - 190, top + 6, C.blue, 7);
    else stamp(c, "เสมอ", mid, top + 44, C.ink, -4, 72);
    const loser = win === "a" ? b : win === "b" ? a : "";
    panel(c, 48, 1000, W - 96, 200, C.night);
    text(c, loser ? `ฝากถึง ${loser}` : "เสมอกันไป", W / 2, 1062, { size: 32, family: UI, weight: 700, color: C.inkSoft, maxWidth: 900 });
    text(c, loser ? taunt(loser) : drawLine(), W / 2, 1150, { size: 60, min: 30, color: C.redHi, maxWidth: 920 });
    footer(c, season);
  }

  function drawStandings(c, s) {
    const season = Number(s.season) || 1, complete = s.total > 0 && s.played === s.total, bill = standingsBill(s.rows, complete);
    base(c, season, `แข่งแล้ว ${s.played}/${s.total} คู่`);
    ribbon(c, "ตารางคะแนน", 352);
    const statLine = r => `${r.pts} แต้ม  •  ชนะ ${r.w} เสมอ ${r.d} แพ้ ${r.l}  •  ${r.gd > 0 ? "+" : ""}${r.gd}`;
    const medal = [C.gold, C.silver, C.bronze];
    const [first, ...under] = bill.top;
    if (first) {
      panel(c, 48, 420, W - 96, 250, C.paper);
      disc(c, 150, 545, 62, C.gold, "rgba(255,255,255,.2)"); text(c, "1", 150, 572, { size: 72, color: C.onMedal });
      text(c, first.label === "แชมป์" ? "คู่เอก • แชมป์ซีซั่น" : "คู่เอก • จ่าฝูง", 240, 490, { size: 30, family: UI, weight: 700, color: C.magentaDeep, align: "left", maxWidth: 560 });
      text(c, cleanName(first.name), 240, 580, { size: 84, min: 40, align: "left", maxWidth: 560 });
      text(c, statLine(first), 240, 636, { size: 32, family: UI, weight: 600, color: C.inkSoft, align: "left", maxWidth: 740 });
      stamp(c, first.label, W - 170, 470, C.magentaDeep, -4, 54);
    }
    under.forEach((r, i) => {
      const x = 48 + i * 498, w = 486;
      panel(c, x, 700, w, 220, C.paper);
      disc(c, x + 70, 775, 42, medal[r.rank - 1], "rgba(255,255,255,.2)"); text(c, String(r.rank), x + 70, 794, { size: 50, color: C.onMedal });
      text(c, r.label, x + 130, 768, { size: 28, family: UI, weight: 700, color: C.inkSoft, align: "left", maxWidth: w - 150 });
      text(c, cleanName(r.name), x + 130, 818, { size: 54, min: 30, align: "left", maxWidth: w - 150 });
      text(c, `${r.pts} แต้ม`, x + 36, 892, { size: 40, color: C.red, align: "left", maxWidth: 200 });
      text(c, `${r.w}-${r.d}-${r.l}  ${r.gd > 0 ? "+" : ""}${r.gd}`, x + w - 36, 890, { size: 30, family: UI, weight: 600, color: C.inkSoft, align: "right", maxWidth: 230 });
    });
    if (bill.rest.length) {
      const top = 950, room = H - 120 - top, rowH = Math.max(56, Math.min(76, (room - 20) / bill.rest.length)), fit = Math.floor((room - 20) / rowH);
      const shown = bill.rest.length > fit ? bill.rest.slice(0, fit - 1) : bill.rest;
      const height = (shown.length + (shown.length < bill.rest.length ? 1 : 0)) * rowH + 20;
      panel(c, 48, top, W - 96, height, C.paper);
      shown.forEach((r, i) => {
        const y = top + 10 + i * rowH, cy = y + rowH / 2;
        if (i) { c.fillStyle = "rgba(255,255,255,.1)"; c.fillRect(70, y, W - 140, 2) }
        disc(c, 108, cy, rowH * .3, C.paper2, C.line); text(c, String(r.rank), 108, cy + rowH * .14, { size: Math.round(rowH * .4) });
        text(c, cleanName(r.name), 160, cy + 14, { size: 40, min: 26, color: C.ink, align: "left", maxWidth: 470 });
        text(c, `${r.w}-${r.d}-${r.l}`, 790, cy + 12, { size: 30, family: UI, weight: 600, color: C.inkSoft, align: "right", maxWidth: 150 });
        text(c, `${r.pts}`, 990, cy + 14, { size: 42, color: C.red, align: "right", maxWidth: 140 });
      });
      if (shown.length < bill.rest.length) text(c, `และอีก ${bill.rest.length - shown.length} คน`, W / 2, top + 10 + shown.length * rowH + rowH * .62, { size: 30, family: UI, weight: 600, color: C.inkSoft });
    }
    footer(c, season);
  }

  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  const say = (msg, type) => window.LeagueToast ? window.LeagueToast(msg, type) : alert(msg);
  // Share sheet with the PNG when the browser can share files (LINE shows up there on phones); otherwise download it.
  async function render(draw, data, name, title, shareText, button) {
    if (button) { if (button.getAttribute("aria-busy") === "true") return; button.setAttribute("aria-busy", "true") }
    try {
      await loadFonts();
      const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
      draw(canvas.getContext("2d"), data);
      let blob = null;
      try { blob = await new Promise(ok => canvas.toBlob(ok, "image/png")); }
      catch { // a picture without CORS taints the canvas: draw the poster again without pictures
        draw(canvas.getContext("2d"), { ...data, aFace: null, bFace: null, aBanner: null, bBanner: null });
        blob = await new Promise(ok => canvas.toBlob(ok, "image/png"));
      }
      if (!blob) throw new Error("no image");
      const file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title, text: shareText }); return }
        catch (e) { if (e?.name === "AbortError") return }
      }
      saveBlob(blob, name); say("บันทึกโปสเตอร์แล้ว ส่งเข้า LINE ได้เลย", "good");
    } catch { say("ทำโปสเตอร์ไม่สำเร็จ", "bad") }
    finally { button?.removeAttribute("aria-busy") }
  }
  // Pictures for the poster: a data URL, or a link in the league's public media bucket (served with CORS, so the canvas
  // stays exportable). They are already in the browser cache from the page; anything that fails to load within 1.2 s is left out and the poster draws without it.
  function loadImage(src) {
    return !src ? Promise.resolve(null) : new Promise(done => {
      const img = new Image(), t = setTimeout(() => done(null), 1200);
      if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
      img.onload = () => { clearTimeout(t); done(img); }; img.onerror = () => { clearTimeout(t); done(null); }; img.src = src;
    });
  }
  async function withPictures(m) {
    const ui = window.LeagueUI, prof = id => { try { return LeagueShared.readLocalLeague()?.profiles?.[id]; } catch { return null; } };
    if (!ui || !m.aId || !m.bId) return m;
    const face = id => { const hd = prof(id)?.avatarHd; return ui.mediaOk?.(hd) ? hd : ui.pictureOf?.(id) || ""; };
    const [aFace, bFace, aBanner, bBanner] = await Promise.all([face(m.aId), face(m.bId), ui.bannerOf?.(m.aId), ui.bannerOf?.(m.bId)].map(loadImage));
    return { ...m, aFace, bFace, aBanner, bBanner };
  }
  async function shareMatch(m, button) {
    const win = matchOutcome(m.a, m.b); if (!win) return say("คู่นี้ยังไม่มีผล", "bad");
    m = await withPictures(m);
    const a = cleanName(m.aName), b = cleanName(m.bName);
    const line = win === "d" ? `${a} เสมอ ${b} ${m.a}-${m.b}` : win === "a" ? `${a} ชนะ ${b} ${m.a}-${m.b}` : `${b} ชนะ ${a} ${m.b}-${m.a}`;
    return render(drawMatch, m, posterFileName(`match-${m.id || ""}`, m.season), LEAGUE, `${LEAGUE} • ซีซั่น ${m.season}: ${line}`, button);
  }
  function shareStandings(s, button) {
    if (!s.rows?.length) return say("ยังไม่มีผู้เล่นในซีซั่นนี้", "bad");
    const lead = cleanName(s.rows[0].name);
    return render(drawStandings, s, posterFileName("standings", s.season), LEAGUE, `${LEAGUE} • ตารางคะแนนซีซั่น ${s.season} • จ่าฝูง: ${lead}`, button);
  }
  window.SharePoster = { ...api, shareMatch, shareStandings, drawMatch, drawStandings, loadFonts };
  // Warm the fonts so the first tap reaches the share sheet while the tap still counts as a user gesture.
  if (document.readyState === "complete") loadFonts(); else addEventListener("load", () => loadFonts(), { once: true });
})();
