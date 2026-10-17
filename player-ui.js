// Player identity + empty states shared by every page: initials avatar with a colour derived from the profile id,
// and a small illustrated empty state. Pages owned by other work (index.js, predictions.js) are decorated after render.
(() => {
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // 12 hues spaced around the wheel. LMAX caps lightness per hue so the white initials keep >= 4.5:1 contrast
  // (yellow/green/cyan hues need a darker shade than red/blue/purple).
  const HUES = [4,24,42,88,142,168,192,212,232,262,288,318];
  const LMAX = [47,42,34,30,31,30,35,47,47,47,47,47];
  function hash(id) { let h = 2166136261; for (const ch of String(id)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function color(id) { const h = hash(id), i = h % HUES.length; return `hsl(${HUES[i]} ${58 + (h >>> 8) % 12}% ${Math.min(40 + (h >>> 16) % 8, LMAX[i])}%)`; }
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
  function league() {
    try { if (typeof state !== "undefined" && state?.profiles) return state; } catch {}
    try { if (typeof league !== "undefined" && league?.profiles) return league; } catch {}
    try { return window.LeagueShared?.readLocalLeague?.() || null; } catch { return null; }
  }
  const nameOf = id => league()?.profiles?.[id]?.displayName || id;
  function avatar(id, name = nameOf(id), size = "") {
    return `<span class="pa ${size}" style="--pa:${color(id)}" aria-hidden="true">${esc(initials(name))}</span>`;
  }
  const chip = (id, name = nameOf(id), size = "") => `<span class="pchip">${avatar(id, name, size)}<span class="pchip-name">${esc(name)}</span></span>`;

  const ART = {
    table: '<svg viewBox="0 0 96 64" aria-hidden="true"><rect x="8" y="30" width="80" height="6" rx="2" fill="#16202c"/><rect x="47" y="18" width="2" height="18" fill="#2b3745"/><path d="M14 36v18M82 36v18" stroke="#202b37" stroke-width="3" stroke-linecap="round"/><circle cx="66" cy="14" r="5" fill="#ff464b"/><path d="M58 20q-6 6-14 4" stroke="#ff464b" stroke-opacity=".35" stroke-width="2" fill="none" stroke-dasharray="2 3"/></svg>',
    trophy: '<svg viewBox="0 0 96 64" aria-hidden="true"><path d="M34 8h28v14a14 14 0 0 1-28 0z" fill="#16202c" stroke="#ffba45" stroke-opacity=".55" stroke-width="2"/><path d="M34 12h-8a8 8 0 0 0 9 11M62 12h8a8 8 0 0 1-9 11" stroke="#ffba45" stroke-opacity=".45" stroke-width="2" fill="none"/><rect x="44" y="35" width="8" height="10" fill="#202b37"/><rect x="36" y="45" width="24" height="7" rx="2" fill="#202b37"/></svg>',
    paddle: '<svg viewBox="0 0 96 64" aria-hidden="true"><circle cx="40" cy="28" r="18" fill="#cb0f23" fill-opacity=".8"/><rect x="50" y="40" width="7" height="20" rx="3" transform="rotate(-40 53 50)" fill="#2b3745"/><circle cx="72" cy="16" r="5" fill="#f7f8fa" fill-opacity=".85"/></svg>'
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
  function ownName(el) { let t = ""; el.childNodes.forEach(n => { if (!n.classList?.contains("banter-stamp")) t += n.textContent; }); return t.replace(/^👑\s*/, "").trim(); }
  function idByName() { const m = new Map(); Object.values(league()?.profiles || {}).forEach(p => p?.displayName && m.set(p.displayName.trim(), p.id)); return m; }
  function decorate(root = document) {
    let map = null;
    DECORATE.forEach(([sel, how]) => root.querySelectorAll?.(sel).forEach(el => {
      if (el.querySelector(":scope > .pa")) return;
      let id = how === "data" ? el.dataset.profile : null;
      if (!id) { map = map || idByName(); id = map.get(ownName(el)); }
      if (!id) return;
      const known = league()?.profiles?.[id]?.displayName;
      el.classList.add("has-pa"); el.insertAdjacentHTML("afterbegin", avatar(id, known || ownName(el) || id, "sm"));
    }));
    const sheetName = document.getElementById("profileName"), sheetAvatar = document.querySelector(".profile-avatar");
    if (sheetName && sheetAvatar) { const id = (map || idByName()).get(sheetName.textContent.trim()); if (id && sheetAvatar.dataset.pid !== id) { sheetAvatar.dataset.pid = id; sheetAvatar.textContent = initials(nameOf(id)); sheetAvatar.style.background = color(id); } }
  }
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; try { decorate(); } catch {} }); };
  function boot() { decorate(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  window.LeagueUI = Object.freeze({ color, initials, avatar, chip, empty, decorate });
})();
