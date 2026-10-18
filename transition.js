// Page change: a red blade and a dark cover sweep across (motion.css html.pt-out / html.pt-in) with the owner's video
// loader playing in the middle: the smash that leaves the ball spinning in mid-air, or the spinning deck when the Dummy
// page is involved. Loaded in <head> without defer, so the arriving page is covered before its first frame.
// Every cover ends uncovered on its own (CSS animations plus timers), so a hiccup here can never hide a page.
(() => {
  const html = document.documentElement;
  const KEY = "pp_pt";
  // H.264 MP4 for phones and most browsers; VP9 WebM where H.264 is missing (e.g. open-source Chromium builds).
  const EXT = document.createElement("video").canPlayType('video/mp4; codecs="avc1.4D401E"') ? ".mp4" : ".webm";
  const SMASH = "img/video/loader-smash" + EXT + "?v=2", CARDS = "img/video/loader-cards" + EXT + "?v=1";
  const LOOP_FROM = 1.7, LOOP_TO = 4.7; // the smash clip: 0-0.6s the hit, the ball in the rings from ~1.2s, 1.7-4.7s loops
  // The arriving page keeps the cover up until the clip reaches this point (the ball spinning in its rings), within limits.
  const SHOW_UNTIL = { smash: 1.45, cards: 0.9 }, MIN_HOLD = 350, MAX_HOLD = 2200, START_GRACE = 700;
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  function video(cards, start) {
    const v = document.createElement("video");
    v.className = "pt-video"; v.muted = true; v.playsInline = true; v.autoplay = true; v.preload = "auto";
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
    // Start where the previous page's clip was, via a media fragment (#t=) so no seek is needed after load.
    const at = start > 0 ? (cards ? start % 4 : (start > LOOP_TO ? LOOP_FROM : start)) : 0;
    v.src = (cards ? CARDS : SMASH) + (at ? "#t=" + at.toFixed(2) : "");
    if (cards) v.loop = true;
    else v.addEventListener("timeupdate", () => { if (v.currentTime > LOOP_TO) v.currentTime = LOOP_FROM; });
    v.addEventListener("playing", () => v.classList.add("on"), { once: true });
    html.appendChild(v);
    const p = v.play && v.play(); if (p && p.catch) p.catch(() => {});
    return v;
  }
  function fadeOut(v, after) {
    setTimeout(() => { v.classList.remove("on"); setTimeout(() => v.remove(), 300); }, after);
  }

  // ---------- Arriving: pick up the cover (and the clip's position) from the page that was just left ----------
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) || "null");
    sessionStorage.removeItem(KEY);
    if (t && Date.now() - t.at < 4000 && !still()) {
      html.classList.add("pt-in"); if (t.cards) html.classList.add("pt-cards");
      const v = video(t.cards, (t.vt || 0) + (Date.now() - t.at) / 1000), t0 = Date.now(), need = t.cards ? SHOW_UNTIL.cards : SHOW_UNTIL.smash;
      let done = false, playing = false;
      // Lift the cover (html.pt-go starts the sweep) once the ball is spinning; never later than MAX_HOLD, and at once
      // if the clip cannot play (autoplay blocked, low power mode, a failed load).
      const go = () => {
        if (done) return; done = true;
        html.classList.add("pt-go"); v.style.transition = "opacity 120ms ease"; fadeOut(v, 0);
        setTimeout(() => html.classList.remove("pt-in", "pt-cards", "pt-go"), 1300);
      };
      v.addEventListener("playing", () => { playing = true; }, { once: true });
      v.addEventListener("timeupdate", () => { if (v.currentTime >= need && Date.now() - t0 >= MIN_HOLD) go(); });
      v.addEventListener("error", go);
      setTimeout(() => { if (!playing) go(); }, START_GRACE);
      setTimeout(go, MAX_HOLD);
    }
  } catch {}

  // ---------- Leaving: an internal link tap covers the screen, starts the clip, then goes ----------
  let leaving = null;
  document.addEventListener("click", e => {
    if (still() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest("a[href]"); if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !/\.html$|\/$/.test(url.pathname) || (url.pathname === location.pathname && url.search === location.search)) return;
    e.preventDefault();
    const cards = /dummy\.html$/i.test(url.pathname) || /dummy\.html$/i.test(location.pathname);
    html.classList.remove("pt-in"); html.classList.toggle("pt-cards", cards); html.classList.add("pt-out");
    leaving = video(cards, 0);
    const started = Date.now();
    setTimeout(() => {
      try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), cards, vt: leaving && !leaving.paused ? leaving.currentTime : (Date.now() - started) / 1000 })); } catch {}
      location.href = url.href;
    }, 420);
    // If the next page never comes (offline, a stalled request) the cover lifts again instead of trapping the screen.
    setTimeout(() => { html.classList.remove("pt-out", "pt-cards"); if (leaving) { leaving.remove(); leaving = null; } }, 5000);
  });
  // Coming back through the back/forward cache must not leave the page covered.
  addEventListener("pageshow", e => { if (e.persisted) { html.classList.remove("pt-out", "pt-cards"); if (leaving) { leaving.remove(); leaving = null; } } });
  // Warm both clips in the HTTP cache a moment after load, so the first tap already has them.
  addEventListener("load", () => setTimeout(() => [SMASH, CARDS].forEach(src => fetch(src).catch(() => {})), 1500), { once: true });
})();
