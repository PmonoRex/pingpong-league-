// Player card: tap a player's name or photo anywhere (match cards, standings, ranking, dashboard) and their card
// slides up: their own background picture as the cover, a big ringed photo, name and catchphrase, rank tier and
// titles, all-time record and win rate, the last five results, the record against the signed-in viewer, and a
// "โอนให้" button when they have a way to get paid. Reads the league copy in localStorage only; never writes.
(() => {
  if (typeof document === "undefined") return;
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const UI = () => window.LeagueUI;
  const league = () => { try { return typeof LeagueShared !== "undefined" ? LeagueShared.readLocalLeague() : null; } catch { return null; } };
  const me = l => { try { return l ? LeagueShared.sessionUserId(l) : ""; } catch { return ""; } };
  const valid = x => Number.isInteger(x?.a) && x.a >= 0 && Number.isInteger(x?.b) && x.b >= 0;
  const pred = () => { try { return JSON.parse(localStorage.getItem(LeagueShared.PRED_KEY) || "null"); } catch { return null; } };
  const tier = rp => rp >= 1000 ? "มาสเตอร์" : rp >= 700 ? "เพชร" : rp >= 450 ? "แพลทินัม" : rp >= 250 ? "ทอง" : rp >= 100 ? "เงิน" : "ทองแดง";

  // Every finished match the league still has (archived seasons, then the current one), in schedule order.
  function matches(l) {
    const out = [], take = (rounds, results, season) => (rounds || []).forEach((r, ri) => (r?.m || []).forEach((pair, mi) => {
      const s = results?.[`r${ri}m${mi}`]; if (pair?.[0] && pair?.[1] && valid(s)) out.push({ season, pair, s });
    }));
    const cur = Number(l?.currentSeason) || 1;
    (l?.seasonArchives || []).filter(a => Number(a?.season) !== cur).sort((a, b) => a.season - b.season).forEach(a => take(a.rounds, a.results, Number(a.season)));
    take(l?.rounds, l?.results, cur);
    return out;
  }
  const result = (m, id) => { const side = m.pair[0] === id ? "a" : m.pair[1] === id ? "b" : ""; if (!side) return ""; const o = m.s[side], t = m.s[side === "a" ? "b" : "a"]; return o > t ? "W" : o < t ? "L" : "D"; };
  function summary(l, id) {
    const all = matches(l), mine = all.filter(m => m.pair.includes(id)), rs = mine.map(m => result(m, id));
    const w = rs.filter(r => r === "W").length, d = rs.filter(r => r === "D").length, lo = rs.filter(r => r === "L").length;
    let rp = 0, titles = 0, best = null, seasons = 0;
    (l?.rankHistory || []).forEach(s => (s.standings || []).forEach(row => { if (row.userId !== id) return; rp += row.rpAward || 0; seasons++; if (row.rank === 1) titles++; best = best === null ? row.rank : Math.min(best, row.rank); }));
    const viewer = me(l), vs = viewer && viewer !== id ? mine.filter(m => m.pair.includes(viewer)).map(m => result(m, id)) : [];
    return { played: mine.length, w, d, l: lo, rate: mine.length ? Math.round(w / mine.length * 100) : 0, last: rs.slice(-5), rp, titles, best, seasons,
      vs: vs.length ? { n: vs.length, w: vs.filter(r => r === "W").length, d: vs.filter(r => r === "D").length, l: vs.filter(r => r === "L").length, name: l.profiles?.[viewer]?.displayName || "" } : null };
  }

  const DOT = { W: ["w", "ช"], D: ["d", "ส"], L: ["l", "พ"] };
  function cardHtml(l, id) {
    const p = l.profiles[id], name = p.displayName || id, s = summary(l, id), viewer = me(l);
    const banner = UI()?.bannerOf?.(id) || "", tagline = typeof p.tagline === "string" ? p.tagline.trim() : "";
    const avatar = UI()?.avatar ? UI().avatar(id, name, "xl") : "";
    const pay = window.LeagueProfile?.payMethod?.(p) && viewer !== id;
    const chips = [`<span class="pc-chip tier">${esc(tier(s.rp))} • ${s.rp} RP</span>`];
    if (s.titles) chips.push(`<span class="pc-chip pc-gold">แชมป์ ×${s.titles}</span>`);
    const mvp = Number(window.LeagueSocial?.mvpWins?.(id)) || 0; // social.js, where loaded
    if (mvp) chips.push(`<span class="pc-chip pc-gold">👑 MVP ×${mvp}</span>`);
    const pr = window.PredRank, pd = pr ? pred() : null; // predboard-rank.js: เซียนทายผล titles
    if (pr?.titleChips) chips.push(pr.titleChips(l, pd, id));
    if (p.role === "admin") chips.push('<span class="pc-chip">แอดมิน</span>');
    const form = s.last.length ? s.last.map(r => `<span class="dot ${DOT[r][0]}">${DOT[r][1]}</span>`).join("") : '<small>ยังไม่มีผล</small>';
    const vs = s.vs ? `<div class="pc-vs"><span>เจอกับ${esc(s.vs.name ? ` ${s.vs.name}` : "คุณ")} ${s.vs.n} ครั้ง</span><b>${esc(name)} ชนะ ${s.vs.w} • เสมอ ${s.vs.d} • แพ้ ${s.vs.l}</b></div>` : "";
    return `<div class="pc-cover${banner ? " has-pic" : ""}"${banner ? ` style="--pc-bg:url('${esc(banner)}')"` : ""}><button type="button" class="pc-close" aria-label="ปิด"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
<div class="pc-body">
 <div class="pc-avatar">${avatar}</div>
 <h2 id="pcName" class="pc-name">${esc(name)}</h2>
 ${tagline ? `<p class="pc-tagline">“${esc(tagline)}”</p>` : ""}
 <div class="pc-chips">${chips.join("")}</div>
 ${window.LeagueEloView?.cardHtml?.(l, id) || ""}
 <div class="pc-stats"><div><b>${s.played}</b><small>แข่ง</small></div><div class="w"><b>${s.w}</b><small>ชนะ</small></div><div><b>${s.d}</b><small>เสมอ</small></div><div class="l"><b>${s.l}</b><small>แพ้</small></div><div class="rate"><b>${s.rate}%</b><small>อัตราชนะ</small></div></div>
 <div class="pc-form"><span>ฟอร์ม 5 นัดล่าสุด</span><div class="form-strip">${form}</div></div>
 ${s.best ? `<div class="pc-line"><span>อันดับดีสุด</span><b>#${s.best} • ${s.seasons} ซีซั่น</b></div>` : ""}
 ${vs}
 ${pr?.cardLine?.(l, pd, id) || ""}
 ${badgeHtml(l, id)}
 <div class="pc-actions">${window.LeagueChallenge?.cardButton?.(l, id, viewer) || ""}${pay ? `<button type="button" class="primary" data-pc-pay="${esc(id)}">โอนให้ ${esc(name)}</button>` : ""}${viewer === id && window.LeagueProfile?.openMine ? '<button type="button" class="primary" data-pc-edit>แก้โปรไฟล์ของฉัน</button>' : ""}${viewer && viewer !== id ? `<a class="btn secondary" href="stats.html?a=${encodeURIComponent(viewer)}&b=${encodeURIComponent(id)}#h2h">เทียบกับฉัน</a>` : ""}<a class="btn secondary" href="stats.html?a=${encodeURIComponent(id)}">ดูสถิติเต็ม</a></div>
</div>`;
  }

  function badgeHtml(l, id) {
    if (typeof LeagueStats === "undefined") return "";
    const list = LeagueStats.badges(l, id, pred()), got = list.filter(b => b.have).length;
    return `<div class="pc-badges"><div class="pc-badges-head"><span>ตราความสำเร็จ</span><b>${got}/${list.length}</b></div><ul>${list.map(b =>
      `<li class="${b.have ? "on" : ""}" title="${esc(b.how)}"><i aria-hidden="true">${b.icon}</i><b>${esc(b.name)}</b><small>${esc(b.have ? b.value || "ได้แล้ว" : b.how)}</small></li>`).join("")}</ul></div>`;
  }

  let wrap = null, lastFocus = null;
  function ensure() {
    if (wrap) return wrap;
    wrap = document.createElement("div"); wrap.className = "pc-backdrop"; wrap.hidden = true;
    wrap.innerHTML = '<div class="pc-sheet" role="dialog" aria-modal="true" aria-labelledby="pcName" tabindex="-1"></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => {
      if (e.target === wrap || e.target.closest(".pc-close")) return close();
      const pay = e.target.closest("[data-pc-pay]");
      if (pay) { const id = pay.dataset.pcPay; close(); window.LeagueProfile?.openPay?.({ toId: id }); }
      if (e.target.closest("[data-pc-edit]")) { close(); window.LeagueProfile?.openMine?.(); }
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && wrap && !wrap.hidden) close(); });
    return wrap;
  }
  function open(id) {
    const l = league(); if (!l?.profiles?.[id]) return;
    ensure(); lastFocus = document.activeElement;
    const sheet = wrap.firstElementChild; sheet.innerHTML = cardHtml(l, id);
    wrap.hidden = false; document.body.classList.add("pc-open");
    requestAnimationFrame(() => { wrap.classList.add("on"); sheet.focus({ preventScroll: true }); });
  }
  function close() {
    if (!wrap || wrap.hidden) return;
    wrap.classList.remove("on"); document.body.classList.remove("pc-open");
    setTimeout(() => { wrap.hidden = true; }, 260);
    lastFocus?.focus?.({ preventScroll: true });
  }

  // Which player an element names: its own text without the avatar initials or banter stamps.
  const nameText = el => { if (!el) return ""; const c = el.cloneNode(true); c.querySelectorAll(".pa,.banter-stamp,.pa-tagline").forEach(n => n.remove()); return c.textContent.replace(/^👑\s*/, "").trim(); };
  const TARGETS = ".pair>b,#standings td.name,.rank-row,.pod,.form-who,.next-up-bill b";
  function idFrom(el) {
    const l = league(); if (!l?.profiles) return "";
    const named = el.matches(".rank-row") ? el.querySelector("strong") : el.matches(".pod") ? el.querySelector("b") : el;
    const name = nameText(named), byName = Object.values(l.profiles).find(p => p?.displayName?.trim() === name);
    return byName?.id || "";
  }
  document.addEventListener("click", e => {
    if (e.defaultPrevented || e.target.closest("input,button,a,select,label,.pc-backdrop,#whoami,.profile-link")) return;
    const el = e.target.closest(TARGETS); if (!el) return;
    const id = idFrom(el); if (!id) return;
    e.preventDefault(); open(id);
  });
  // Mark the tappable names so they look and read as buttons.
  function mark() { document.querySelectorAll(TARGETS).forEach(el => { if (el.dataset.pcTap) return; el.dataset.pcTap = "1"; el.classList.add("pc-tap"); el.setAttribute("title", "ดูโปรไฟล์"); }); }
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; mark(); }); }).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mark); else mark();
  window.PlayerCard = Object.freeze({ open, close, summary });
})();
