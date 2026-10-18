// Player identity + empty states shared by every page: initials avatar with a colour derived from the profile id,
// and a small illustrated empty state. Pages owned by other work (index.js, predictions.js) are decorated after render.
(() => {
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // Fight-poster inks: [ground, initials]. Every pair keeps >= 5.4:1 contrast; the yellow plate takes ink initials.
  const INKS = [["#c8202a","#fff"],["#1c4fc0","#fff"],["#c0106a","#fff"],["#17110f","#ffd21f"],["#0b7a40","#fff"],["#ffd21f","#17110f"],["#b8420e","#fff"],["#5b2a86","#fff"]];
  function hash(id) { let h = 2166136261; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const ink = id => INKS[hash(id) % INKS.length];
  function color(id) { return ink(id)[0]; }
  function inkOn(id) { return ink(id)[1]; }
  const THAI_LEAD = /^[เ-ไ]/, THAI_PREFIX = /^(พี่|น้อง|นาย|นาง|คุณ)\s*/;
  function graphemes(s) { try { return [...new Intl.Segmenter("th", { granularity: "grapheme" }).segment(s)].map(x => x.segment); } catch { return [...s]; } }
  function initials(name) {
    let s = String(name || "?").trim().replace(/^[^\p{L}\p{N}]+/u, "");
    if (/[฀-๿]/.test(s)) {
      const rest = s.replace(THAI_PREFIX, ""); if (rest) s = rest;
      const g = graphemes(s.replace(THAI_LEAD, "")); return (g[0] || "?").replace(/[ัิ-ฺ็-๎]/g, "") || "?";
    }
    const words = s.split(/\s+/).filter(Boolean);
    return ((words[0]?.[0] || "?") + (words[1]?.[0] || "")).toUpperCase();
  }
  // index.js keeps the live league in `state`; other pages read the local copy (LeagueShared is a const, not on window).
  // The shared read-only copy (parsed again only when the stored league changes), so a page full of chips parses it once.
  function league() {
    try { if (typeof state !== "undefined" && state?.profiles) return state; } catch {}
    try { return typeof LeagueShared !== "undefined" ? (LeagueShared.peekLocalLeague || LeagueShared.readLocalLeague)() : null; } catch { return null; }
  }
  const nameOf = id => league()?.profiles?.[id]?.displayName || id;
  // Pictures live in the shared row as data URLs (profile-me.js compresses them); anything else is never used as a src.
  const LIMITS = Object.freeze({ avatar: 12 * 1024, payQr: 20 * 1024, banner: 40 * 1024 });
  // The pattern test on a 40 KB data URL is slow on a phone and decorate() asks for every card corner on every change,
  // so each picture's answer is remembered.
  const okMemo = new Map();
  function imageOk(url, max) {
    if (typeof url !== "string" || url.length > max) return false;
    let ok = okMemo.get(url);
    if (ok === undefined) {
      ok = /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(url);
      if (okMemo.size > 200) okMemo.clear();
      okMemo.set(url, ok);
    }
    return ok;
  }
  const pictureOf = id => { const url = league()?.profiles?.[id]?.avatar; return imageOk(url, LIMITS.avatar) ? url : ""; };
  // A player's own background picture (square, up to 480px), shown behind their corner of every match card.
  const mediaOk = url => { try { return typeof LeagueShared !== "undefined" && !!LeagueShared.mediaUrlOk?.(url); } catch { return false; } };
  // Linked pictures are probed once; one that fails to load is treated as absent, so the card shows the avatar again.
  const probed = new Map();
  function probe(url) {
    if (probed.has(url)) return probed.get(url);
    probed.set(url, "loading");
    const img = new Image();
    img.onload = () => { probed.set(url, "ok"); schedule(); };
    img.onerror = () => { probed.set(url, "bad"); try { console.warn("Card background failed to load:", url); } catch {} schedule(); };
    img.src = url;
    return "loading";
  }
  const bannerOf = id => {
    const url = league()?.profiles?.[id]?.banner;
    if (imageOk(url, LIMITS.banner)) return url;
    return mediaOk(url) && probe(url) === "ok" ? url : "";
  };
  const IMG_STYLE = "width:100%;height:100%;border-radius:50%;object-fit:cover;display:block";
  // The sharp 512px copy in the media bucket, once it is known to load (see probe below); "" otherwise.
  const sharpPictureOf = id => { const url = league()?.profiles?.[id]?.avatarHd; return mediaOk(url) && probe(url) === "ok" ? url : ""; };
  function avatar(id, name = nameOf(id), size = "") {
    const pic = sharpPictureOf(id) || pictureOf(id);
    return `<span class="pa ${size}${pic ? " pa-img" : ""}" data-pid="${esc(id)}" style="--pa:${color(id)};--pa-fg:${inkOn(id)}" aria-hidden="true">${pic ? `<img src="${esc(pic)}" alt="" decoding="async" style="${IMG_STYLE}">` : esc(initials(name))}</span>`;
  }
  const chip = (id, name = nameOf(id), size = "") => `<span class="pchip">${avatar(id, name, size)}<span class="pchip-name">${esc(name)}</span></span>`;

  const ART = {
    table: '<img class="empty-pic" src="img/icons/paddle-256.webp" width="112" height="112" alt="" decoding="async">',
    trophy: '<svg viewBox="0 0 96 64" aria-hidden="true"><path d="M34 8h28v14a14 14 0 0 1-28 0z" fill="#16202c" stroke="#ffba45" stroke-opacity=".55" stroke-width="2"/><path d="M34 12h-8a8 8 0 0 0 9 11M62 12h8a8 8 0 0 1-9 11" stroke="#ffba45" stroke-opacity=".45" stroke-width="2" fill="none"/><rect x="44" y="35" width="8" height="10" fill="#202b37"/><rect x="36" y="45" width="24" height="7" rx="2" fill="#202b37"/></svg>',
    paddle: '<img class="empty-pic" src="img/icons/paddle-256.webp" width="112" height="112" alt="" decoding="async">'
  };
  // Empty state: illustration + what it means + what to do next (optional link).
  function empty(title, hint = "", action = null, art = "table") {
    return `<div class="empty-state">${ART[art] || ART.table}<b>${esc(title)}</b>${hint ? `<small>${esc(hint)}</small>` : ""}${action ? `<a class="btn secondary" href="${esc(action.href)}">${esc(action.label)}</a>` : ""}</div>`;
  }

  // Decorate names rendered by files this layer does not own. Idempotent; marks handled nodes.
  const DECORATE = [
    ["#standings td.name", "text"], [".rank-row strong", "text"], [".pair>b", "text"], [".roster-item strong", "text"],
    [".profile-link[data-profile]", "data"], ["#dealerCurrentPublic", "text"], ["#whoami", "text"]
  ];
  // A name cell may also carry banter stamps (banter.js); they are not part of the name.
  // The name alone, without the avatar initials decorate() put in front of it.
  function nameText(el) { let t = ""; el.childNodes.forEach(n => { if (!n.classList?.contains("banter-stamp") && !n.classList?.contains("pa")) t += n.textContent; }); return t.trim(); }
  function ownName(el) { let t = ""; el.childNodes.forEach(n => { if (!n.classList?.contains("banter-stamp")) t += n.textContent; }); return t.replace(/^👑\s*/, "").trim(); }
  const taglineOf = id => { const t = id ? league()?.profiles?.[id]?.tagline : ""; return typeof t === "string" && t.trim() ? `“${t.trim().slice(0, 40)}”` : ""; };
  function idByName() { const m = new Map(); Object.values(league()?.profiles || {}).forEach(p => p?.displayName && m.set(p.displayName.trim(), p.id)); return m; }
  // The same avatar as avatar() builds, as a node: parsed once per player and picture, then cloned (the photo is a
  // data URL of up to 12 KB, and a schedule has a hundred-odd names to decorate).
  const protos = new Map();
  function avatarNode(id, name, size) {
    const pic = sharpPictureOf(id) || pictureOf(id), key = `${size}\n${id}\n${name}`;
    let hit = protos.get(key);
    if (!hit || hit.pic !== pic) {
      const t = document.createElement("template"); t.innerHTML = avatar(id, name, size);
      hit = { pic, node: t.content.firstElementChild };
      if (protos.size > 300) protos.clear();
      protos.set(key, hit);
    }
    return hit.node.cloneNode(true);
  }
  // One rule per picture and corner (".pa-bga3{--bg-a:url(...)}") in a small stylesheet of our own; cards carry the class.
  // The URL is a checked data URL (base64 characters only) or a checked media-bucket URL, so it is safe inside url("").
  const bgRules = { a: new Map(), b: new Map() }; let bgSheet = null;
  function bgClass(side, pic) {
    let cls = bgRules[side].get(pic);
    if (cls) return cls;
    cls = `pa-bg${side}${bgRules.a.size + bgRules.b.size}`;
    if (!bgSheet) { const el = document.createElement("style"); el.id = "paBgRules"; document.head.appendChild(el); bgSheet = el.sheet; }
    bgSheet.insertRule(`.${cls}{--bg-${side}:url("${pic}")}`, bgSheet.cssRules.length);
    bgRules[side].set(pic, cls);
    return cls;
  }
  // Where the browser knows :has(), it skips names that already carry their avatar itself, so a long list (every
  // prediction in the history) is not walked again in script on every change of the page.
  const HAS = (() => { try { return CSS.supports("selector(:has(> a))"); } catch { return false; } })();
  const PENDING = DECORATE.map(([sel, how]) => [HAS ? sel.split(",").map(s => `${s}:not(:has(> .pa))`).join(",") : sel, how]);
  function decorate(root = document) {
    let map = null;
    PENDING.forEach(([sel, how]) => root.querySelectorAll?.(sel).forEach(el => {
      if (el.querySelector(":scope > .pa")) return;
      let id = how === "data" ? el.dataset.profile : null;
      if (!id) { map = map || idByName(); id = map.get(ownName(el)); }
      if (!id) return;
      const known = league()?.profiles?.[id]?.displayName;
      el.classList.add("has-pa"); el.prepend(avatarNode(id, known || ownName(el) || id, "sm"));
    }));
    // Avatars drawn before their sharp copy finished loading switch to it now.
    root.querySelectorAll?.(".pa.pa-img[data-pid] > img").forEach(img => { const sharp = sharpPictureOf(img.parentElement.dataset.pid); if (sharp && img.getAttribute("src") !== sharp) img.setAttribute("src", sharp); });
    // Match cards: each corner gets its player's background picture (--bg-a red corner, --bg-b blue corner).
    root.querySelectorAll?.(".match").forEach(m => {
      const names = m.querySelectorAll(":scope > .pair > b"); if (names.length < 2) return;
      // The two corners and the seam between them are drawn as three clipped layers, so a picture stops exactly at the line.
      if (!m.querySelector(":scope > .mbg")) m.insertAdjacentHTML("afterbegin", '<span class="mbg mbg-a" aria-hidden="true"></span><span class="mbg mbg-b" aria-hidden="true"></span><span class="mbg mbg-seam" aria-hidden="true"></span>');
      map = map || idByName();
      // The picture last put on this card is remembered on it, and set through a class (bgClass below) rather than an
      // inline url() of the whole data URL on every card, which the browser parsed once per card.
      const put = m.__paBg || (m.__paBg = {});
      ["a", "b"].forEach((side, i) => {
        const id = map.get(nameText(names[i])), pic = id ? bannerOf(id) : "";
        if (put[side] !== pic) {
          const was = put[side + "Class"], cls = pic ? bgClass(side, pic) : "";
          if (was && was !== cls) m.classList.remove(was);
          if (cls) m.classList.add(cls);
          put[side] = pic; put[side + "Class"] = cls;
        }
        m.classList.toggle(`has-bg-${side}`, !!pic);
      });
    });
    const sheetName = document.getElementById("profileName"), sheetAvatar = document.querySelector(".profile-avatar");
    if (sheetName && sheetAvatar) { const id = (map || idByName()).get(sheetName.textContent.trim()), pic = id ? pictureOf(id) : ""; if (id && sheetAvatar.dataset.pid !== id + pic.length) { sheetAvatar.dataset.pid = id + pic.length; sheetAvatar.style.background = color(id); if (pic) sheetAvatar.innerHTML = `<img src="${esc(pic)}" alt="" style="${IMG_STYLE.replace("50%", "inherit")}">`; else sheetAvatar.textContent = initials(nameOf(id)); } }
    // A player's catchphrase rides under their name in the roster and the predictions profile sheet.
    root.querySelectorAll?.(".roster-item strong").forEach(el => {
      const id = el.closest(".roster-item")?.querySelector("[data-roster]")?.dataset.roster, line = taglineOf(id), box = el.parentElement;
      const shown = box.querySelector(":scope > .pa-tagline");
      if (shown?.textContent === line) return; shown?.remove();
      if (line) el.insertAdjacentHTML("afterend", `<small class="pa-tagline">${esc(line)}</small>`);
    });
    const meta = document.getElementById("profileMeta");
    if (sheetName && meta) { const id = (map || idByName()).get(sheetName.textContent.trim()), line = taglineOf(id), shown = meta.querySelector(".pa-tagline"); if ((shown?.textContent || "") !== line) { shown?.remove(); if (line) meta.insertAdjacentHTML("beforeend", ` <span class="pa-tagline">${esc(line)}</span>`); } }
  }
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { decorate(); } catch {} }); };
  function boot() { decorate(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.LeagueUI = Object.freeze({ color, inkOn, initials, avatar, chip, empty, decorate, imageOk, mediaOk, pictureOf, bannerOf, LIMITS });
})();
