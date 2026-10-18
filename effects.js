// Arena effects, after Magic UI (magicui.design, MIT), rebuilt without React for this site. Styles live in effects.css.
// - The masthead: swaying stadium spotlights, a light sweep, a running red edge, embers and meteors.
// - Number ticker: big figures count up the first time they scroll into view.
// - Confetti: a burst where a ชนะ stamp strikes, and over the champion on the archive poster.
// - Marquee: finished results and the RP table scroll past under the home masthead.
// Nothing here writes league data. It only reads the page, and it stays still under prefers-reduced-motion.
(() => {
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- Embers + meteors ----------
  function addSky() {
    document.querySelectorAll("body.sport-redesign .hero").forEach(hero => {
      if (hero.querySelector(".fx-sky")) return;
      const sky = document.createElement("div");
      sky.className = "fx-sky"; sky.setAttribute("aria-hidden", "true");
      let html = "";
      html += '<span class="fx-beam"></span><span class="fx-beam fx-beam-red"></span><span class="fx-sweep"></span><span class="fx-edge"></span>';
      for (let i = 0; i < 28; i++) html += `<span class="fx-ember${i % 5 === 0 ? " hot" : ""}" style="left:${rand(4, 98).toFixed(1)}%;--s:${rand(2.5, 5.5).toFixed(1)}px;--d:${rand(5, 10).toFixed(1)}s;--delay:${rand(-10, 0).toFixed(1)}s;--drift:${rand(-40, 40).toFixed(0)}px"></span>`;
      for (let i = 0; i < 3; i++) html += `<span class="fx-meteor" style="top:${rand(-10, 30).toFixed(0)}%;left:${rand(55, 100).toFixed(0)}%;--d:${rand(5, 9).toFixed(1)}s;--delay:${rand(-6, 4).toFixed(1)}s"></span>`;
      sky.innerHTML = html;
      hero.prepend(sky);
    });
  }

  // ---------- Number ticker ----------
  // Counts the first number in the text from 0 to its value, keeping everything around it (+, ฿, RP, %).
  // The digits run inside a child <span>, and the element's own text never changes: suite.js has its own count-up
  // that watches these same elements for value changes, and writing "0 RP" onto the element itself made it count the
  // real value back down to 0 (the RP column showed 0 for everyone). If any script rewrites the element mid-count,
  // the ticker lets go at once.
  const NUM = /([+-]?)(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/;
  const TICK_SEL = ".stat b,.rank-rp,.d-cash-amt,.pod strong,.ring b";
  const ticked = new WeakSet();
  function tick(el) {
    if (ticked.has(el)) return; ticked.add(el);
    const text = el.textContent, m = NUM.exec(text);
    if (!m || el.children.length) return;
    const target = Number((m[2] + (m[3] || "")).replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) return;
    const dec = m[3] ? m[3].length - 1 : 0, grouped = m[2].includes(","), dur = Math.min(1400, 500 + target * 6);
    const fmt = v => { const s = dec ? v.toFixed(dec) : String(Math.round(v)); return grouped ? Number(s).toLocaleString("en-US", { minimumFractionDigits: dec }) : s; };
    const at = v => text.slice(0, m.index) + m[1] + fmt(v) + text.slice(m.index + m[0].length);
    const span = document.createElement("span");
    // Same text, and the first digit change waits for the next frame: suite.js's watcher (a microtask) then sees the
    // element unchanged and leaves it alone.
    span.textContent = text; el.replaceChildren(span);
    let last = text, t0 = 0;
    el.classList.add("fx-ticking");
    const done = () => { el.classList.remove("fx-ticking"); if (el.firstChild === span && el.childNodes.length === 1) el.textContent = text; };
    const step = now => {
      if (el.firstChild !== span || span.textContent !== last) { el.classList.remove("fx-ticking"); return; }
      t0 ||= now;
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      last = p < 1 ? at(target * e) : text;
      span.textContent = last;
      if (p < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  }
  const seen = "IntersectionObserver" in window ? new IntersectionObserver(entries => entries.forEach(en => {
    if (en.isIntersecting) { seen.unobserve(en.target); tick(en.target); }
  }), { threshold: .6 }) : null;
  function watchNumbers() {
    if (!seen) return;
    document.querySelectorAll(TICK_SEL).forEach(el => { if (!ticked.has(el) && !el.dataset.fxWatched) { el.dataset.fxWatched = "1"; seen.observe(el); } });
  }

  // ---------- Confetti ----------
  let canvas = null, parts = [], running = false;
  const COLORS = ["#ff4752", "#d81e29", "#ffffff", "#f5b80b", "#ff8a92"];
  function burst(x, y, n = 60, spread = 1) {
    if (still.matches) return;
    if (!canvas) {
      canvas = document.createElement("canvas"); canvas.className = "fx-confetti"; canvas.setAttribute("aria-hidden", "true");
      document.body.appendChild(canvas);
    }
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI * .9, -Math.PI * .1), v = rand(4, 11) * spread;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: rand(4, 9), h: rand(6, 12), r: rand(0, 6), vr: rand(-.3, .3), c: COLORS[i % COLORS.length], life: 0, max: rand(60, 110) });
    }
    if (!running) { running = true; requestAnimationFrame(frame); }
  }
  function frame() {
    const c = canvas.getContext("2d"), dpr = canvas.width / innerWidth;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.life < p.max);
    parts.forEach(p => {
      p.life++; p.vy += .25; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      c.save(); c.globalAlpha = Math.max(0, 1 - p.life / p.max); c.translate(p.x, p.y); c.rotate(p.r);
      c.fillStyle = p.c; c.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.life / 6))); c.restore();
    });
    if (parts.length) requestAnimationFrame(frame); else { running = false; c.clearRect(0, 0, innerWidth, innerHeight); }
  }
  // index.js strikes the ชนะ stamp only when a result changes while the page is open, so this never fires on page load.
  document.addEventListener("animationstart", e => {
    if (e.animationName !== "stampStrike") return;
    const r = e.target.getBoundingClientRect(), w = e.target.dataset.win;
    burst(w === "b" ? r.right - 50 : r.left + 50, r.top + 10, 46, .8);
  });
  function championBurst() {
    const champ = document.querySelector(".poster-champ b");
    if (!champ || champ.dataset.fxDone || !champ.getClientRects().length) return;
    champ.dataset.fxDone = "1";
    const io = new IntersectionObserver(([en]) => {
      if (!en.isIntersecting) return; io.disconnect();
      const r = champ.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 120, 1.3);
    }, { threshold: .7 });
    io.observe(champ);
  }

  // ---------- Marquee (home) ----------
  // A name's own text, without the avatar initials or banter stamps other layers put inside it.
  const ownText = el => el ? [...el.childNodes].filter(n => !n.classList?.contains("pa") && !n.classList?.contains("banter-stamp")).map(n => n.textContent).join("").trim() : "";
  function marqueeItems() {
    const items = [];
    document.querySelectorAll(".rank-row").forEach((row, i) => {
      if (i > 4) return;
      const name = ownText(row.querySelector("strong")), rp = row.querySelector(".rank-rp")?.textContent.trim();
      if (name && rp) items.push({ gold: i === 0, html: `อันดับ ${i + 1} <b>${esc(name)}</b> ${esc(rp)}` });
    });
    // Each finished match as "winner 11-5 loser" (draws in schedule order), latest first.
    const done = [...document.querySelectorAll(".match[data-win]")].map(m => {
      const [na, nb] = [...m.querySelectorAll(".pair>b")].map(ownText), [sa, sb] = [...m.querySelectorAll(".score-control input")].map(i => i.value);
      if (!na || !nb || sa === "" || sb === "") return "";
      return m.dataset.win === "b" ? `<b>${esc(nb)}</b> ${esc(sb)}-${esc(sa)} ${esc(na)}` : m.dataset.win === "a" ? `<b>${esc(na)}</b> ${esc(sa)}-${esc(sb)} ${esc(nb)}` : `${esc(na)} ${esc(sa)}-${esc(sb)} ${esc(nb)} <b>เสมอ</b>`;
    }).filter(Boolean).slice(-8).reverse();
    done.forEach(html => items.push({ html }));
    return items;
  }
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let marquee = null, marqueeKey = "";
  function renderMarquee() {
    const grid = document.querySelector("body.sport-page-index-html main > .grid");
    if (!grid) return;
    if (!marquee) {
      marquee = document.createElement("div"); marquee.className = "fx-marquee"; marquee.setAttribute("role", "region"); marquee.setAttribute("aria-label", "ผลล่าสุดและอันดับ");
      grid.before(marquee);
    }
    const items = marqueeItems(), key = items.map(i => i.html).join("|");
    if (key === marqueeKey) return; marqueeKey = key;
    marquee.hidden = !items.length;
    if (!items.length) { marquee.innerHTML = ""; return; }
    const group = items.map(i => `<span class="fx-item${i.gold ? " gold" : ""}">${i.html}</span>`).join("");
    marquee.innerHTML = `<div class="fx-track" style="--dur:${Math.max(24, items.length * 5)}s"><div class="fx-group">${group}</div><div class="fx-group" aria-hidden="true">${group}</div></div>`;
  }

  // ---------- Wiring ----------
  let queued = false;
  function refresh() {
    queued = false;
    addSky(); watchNumbers(); championBurst(); renderMarquee();
  }
  const later = () => { if (!queued) { queued = true; setTimeout(refresh, 250); } };
  function start() {
    refresh();
    new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  window.ArenaFX = { burst };
})();
