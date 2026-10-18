// The journeys: a group of friends using the app over a season. Each gets a fresh fake backend (ctx.fake) and its own
// phones; ctx.check() records a failed expectation as a bug without stopping the journey, assert() stops it.
import * as L from "./lib.mjs";
import { makeWorld, signedPhone, PINS, NAMES } from "./world.mjs";
import { FakeSupabase, seedLeague } from "./fake-supabase.mjs";

const { until, sleep, shot, assert } = L;
const ids = { admin: "u_admin", gift: "u_gift", golf: "u_golf", dragon: "u_dragon", fern: "u_fern", pruek: "u_pruek" };
const standingsRow = (page, name) => page.evaluate(n => { const tr = [...document.querySelectorAll("#standings tr")].find(r => r.querySelector(".name")?.textContent.includes(n)); return tr ? [...tr.querySelectorAll("td")].map(td => td.textContent.trim()) : null; }, name);
const pts = async (page, name) => Number((await standingsRow(page, name))?.at(-1));

export const journeys = {
  // 1. First login with PIN 1234 -> forced PIN change -> log in with the new PIN on another device.
  async j1_first_login(ctx) {
    const { ids: _ids, ...league } = seedLeague();
    const fake = ctx.useFake(new FakeSupabase({ rpc: ctx.rpc, league, predictions: { dealerId: null, markets: {}, bets: [], nextBetId: 1 } }));
    const a = await ctx.phone(fake, "กิฟท์-มือถือ");
    const pa = await a.open("index.html");
    await L.login(pa, ids.gift, "1234");
    await pa.waitForSelector(".pin-overlay form", { timeout: 10000 });
    await shot(pa, `${ctx.tag}-j1-forced-pin`);
    // A rejected PIN first (policy), then a good one.
    await pa.fill("#pinNew", "1111"); await pa.fill("#pinConfirm", "1111"); await pa.click('.pin-overlay button[type="submit"]');
    ctx.check(/เลขซ้ำ/.test(await L.text(pa, ".pin-error")), "PIN policy message for 1111");
    await pa.fill("#pinNew", "1357"); await pa.fill("#pinConfirm", "1357"); await pa.click('.pin-overlay button[type="submit"]');
    await pa.waitForSelector(".pin-overlay", { state: "detached", timeout: 10000 });
    await L.untilToast(pa, /ตั้ง PIN ใหม่แล้ว/);
    ctx.check((await L.text(pa, "#whoami")).endsWith("กิฟท์"), "whoami after first login");
    if (ctx.rpc) ctx.check(fake.creds.get(ids.gift).pin === "1357" && !fake.creds.get(ids.gift).mustChange, "server keeps the new PIN");
    else { const p = fake.league.profiles[ids.gift]; ctx.check(p.pinHash && !("pin" in p) && !p.mustChangePin, "row has the PIN hash, no plaintext"); }
    ctx.check(!JSON.stringify(fake.league).includes('"1357"'), "new PIN never stored in plaintext in the row");
    // Reload: still signed in, not asked again.
    await pa.reload(); await sleep(1500);
    ctx.check(!(await L.visible(pa, ".pin-overlay")), "no PIN card after reload");
    ctx.check(await pa.evaluate(() => document.getElementById("auth").classList.contains("hidden")), "still signed in after reload");
    // Second device: old PIN refused, new PIN works, no forced change.
    const b = await ctx.phone(fake, "กิฟท์-แท็บเล็ต");
    const pb = await b.open("index.html");
    await L.login(pb, ids.gift, "1234");
    await L.untilToast(pb, /PIN ไม่ถูกต้อง/);
    ctx.check(!(await pb.evaluate(() => document.getElementById("auth").classList.contains("hidden"))), "old PIN 1234 refused on device 2");
    await pb.fill("#loginPin", "1357"); await pb.click("#loginBtn");
    await until(pb, () => document.getElementById("auth").classList.contains("hidden"), null, { label: "device 2 signed in" });
    await sleep(1200);
    ctx.check(!(await L.visible(pb, ".pin-overlay")), "device 2 not asked to change PIN again");
    ctx.check((await L.text(pb, "#whoami")).endsWith("กิฟท์"), "device 2 whoami");
    await shot(pb, `${ctx.tag}-j1-device2`);
    // The first device keeps working (it still has its session) — a profile save there must not ask for the PIN.
    await pa.evaluate(() => window.LeagueProfile.openMine());
    await pa.waitForSelector("#meTagline");
    await pa.fill("#meTagline", "ตบไม่เลือกหน้า");
    await pa.click("#meSave");
    const asked = await L.reloginIfAsked(pa, "1357", 2500);
    if (asked && ctx.rpc) ctx.bug("device 1 asked for its PIN again after logging in on device 2 (session dropped)");
    await until(pa, () => document.querySelector(".me-backdrop")?.hidden !== false, null, { label: "profile saved on device 1" });
    ctx.check(fake.league.profiles[ids.gift].tagline === "ตบไม่เลือกหน้า", "tagline saved from device 1");
  },

  // 2. Admin sets the season players and schedule; scores typed and live (นับสด) while a player watches the LIVE strip;
  //    standings, next-up and the share pill.
  async j2_season_setup_scores(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc, season: [] }));
    const admin = await signedPhone(ctx.browser, fake, ids.admin); ctx.track(admin);
    const gift = await signedPhone(ctx.browser, fake, ids.gift); ctx.track(gift);
    const pa = await admin.open("index.html"), pg = await gift.open("index.html");
    await until(pa, () => document.getElementById("syncStatus").textContent.includes("ออนไลน์"), null, { label: "admin online" });
    await pa.evaluate(() => { document.getElementById("rosterBox").open = true; });
    for (const id of [ids.admin, ids.gift, ids.golf, ids.dragon]) await pa.check(`[data-roster="${id}"]`);
    await pa.click("#applyRoster");
    await L.untilNode(() => fake.league.rounds?.length === 3, { label: "schedule saved to cloud" });
    await shot(pa, `${ctx.tag}-j2-schedule`);
    // The player sees the schedule within a poll.
    await until(pg, () => document.querySelectorAll("#schedule .match").length >= 2, null, { label: "player sees schedule" });
    ctx.check(/4 คน • 6 แมตช์/.test(await L.text(pg, "#leagueInfo")), "player header shows 4 players / 6 matches");
    const rounds = fake.league.rounds, [p0a, p0b] = rounds[0].m[0], [p1a, p1b] = rounds[0].m[1];
    // Typed score.
    await pa.fill("#r0m0a", "11"); await pa.fill("#r0m0b", "7");
    await L.untilNode(() => fake.league.results?.r0m0?.a === 11 && fake.league.results.r0m0.b === 7, { label: "typed score saved" });
    await until(pa, () => !!document.querySelector(".share-offer"), null, { timeout: 8000, label: "share pill" }).catch(() => ctx.bug("share pill did not appear after a typed score"));
    await shot(pa, `${ctx.tag}-j2-share-pill`);
    await until(pg, n => [...document.querySelectorAll("#standings tr")].some(r => r.querySelector(".name")?.textContent.includes(n) && r.lastElementChild.textContent.trim() === "3"), NAMES[p0a], { label: "player sees standings 3 pts" });
    // Next-up moved to round 1 match 2.
    const next = await L.text(pg, "#nextUp");
    ctx.check(next.includes(NAMES[p1a]) && next.includes(NAMES[p1b]), `next-up shows ${NAMES[p1a]} vs ${NAMES[p1b]} (got: ${next.slice(0, 80)})`);
    // Workflow helper card follows the schedule.
    const wf = await L.text(pa, "#workflowCard");
    if (wf && !/1\/6/.test(wf)) ctx.bug(`ผู้ช่วยลีก card is stale: "${wf.replace(/\s+/g, " ").slice(0, 60)}" (expected 1/6 played)`);
    // Live scoring by the admin while the player watches.
    await pa.click(`[data-lv-score="r0m1"]`);
    await pa.waitForSelector('[data-lv="start"]');
    await pa.check('input[name="bo"][value="1"]');
    await pa.click('[data-lv="start"]');
    for (let i = 0; i < 5; i++) await pa.click('.lv-side.a');
    for (let i = 0; i < 3; i++) await pa.click('.lv-side.b');
    await until(pg, () => /5–3/.test(document.querySelector(".lv-strip")?.textContent || ""), null, { label: "watcher sees LIVE 5–3", timeout: 20000 });
    await shot(pg, `${ctx.tag}-j2-live-strip`);
    await pg.click(".lv-strip [data-lv-watch]");
    await pg.waitForSelector('.lv[data-mode="watch"]');
    for (let i = 0; i < 6; i++) await pa.click('.lv-side.a');
    await pa.waitForSelector('[data-lv="save"]');
    await until(pg, () => /จบ|ชนะ/.test(document.querySelector(".lv")?.textContent || ""), null, { label: "watcher sees match end", timeout: 20000 }).catch(() => ctx.bug("watcher's open scoreboard did not show the finished match"));
    await pa.click('[data-lv="save"]');
    await L.untilNode(() => fake.league.results?.r0m1?.a === 11 && fake.league.results.r0m1.b === 3, { label: "live result saved into league" });
    await L.untilNode(() => !Object.keys(fake.live?.matches || {}).length, { label: "live entry cleared", timeout: 8000 }).catch(() => ctx.bug("live row still holds the saved match"));
    await until(pg, () => !document.querySelector(".lv-strip"), null, { label: "strip gone on watcher" }).catch(() => ctx.bug("LIVE strip stays on the watcher after the result was saved"));
    await until(pg, n => [...document.querySelectorAll("#standings tr")].some(r => r.querySelector(".name")?.textContent.includes(n) && r.lastElementChild.textContent.trim() === "3"), NAMES[p1a], { label: "watcher standings after live" });
    ctx.check(await pg.evaluate(() => document.getElementById("played").textContent) === "2", "played count 2 on watcher");
    await shot(pg, `${ctx.tag}-j2-standings`);
  },

  // 3. Predictions: the admin names a dealer, the dealer opens a market, two players bet at the same moment, the result
  //    is entered, the dealer settles; ตารางนักทาย and the player card follow.
  async j3_predictions(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc }));   // r0m0 = มอส vs มังกร, r0m1 = กิฟท์ vs กอล์ฟ
    const admin = ctx.track(await signedPhone(ctx.browser, fake, ids.admin));
    const fern = ctx.track(await signedPhone(ctx.browser, fake, ids.fern));
    const gift = ctx.track(await signedPhone(ctx.browser, fake, ids.gift));
    const pruek = ctx.track(await signedPhone(ctx.browser, fake, ids.pruek));
    const golf = ctx.track(await signedPhone(ctx.browser, fake, ids.golf));
    const pa = await admin.open("predictions.html");
    await until(pa, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "predictions online" });
    await pa.selectOption("#dealerSelect", ids.fern);
    await pa.click("#saveDealer");
    await L.untilNode(() => fake.predictions?.dealerId === ids.fern, { label: "dealer saved" });
    // The dealer opens r0m0: มอส gives มังกร half a point.
    const pf = await fern.open("predictions.html");
    await until(pf, () => !!document.querySelector('[data-save="r0m0"]'), null, { label: "dealer sees market controls" });
    await pf.selectOption("#fav-r0m0", ids.admin);
    await pf.fill("#hcp-r0m0", "0.5");
    await pf.selectOption("#open-r0m0", "1");
    await pf.click('[data-save="r0m0"]');
    await L.untilNode(() => fake.predictions?.markets?.["s1:r0m0"]?.open === true, { label: "market open" });
    await shot(pf, `${ctx.tag}-j3-dealer-market`);
    // Two players bet at the same time (one wins the lock, the other retries on the newer copy).
    const pg = await gift.open("predictions.html"), pp = await pruek.open("predictions.html");
    for (const [page, side, stake] of [[pg, ids.dragon, "50"], [pp, ids.admin, "100"]]) {
      await until(page, () => !!document.querySelector('[data-pick="r0m0"]'), null, { label: `${page.label} sees open market` });
      await page.click(`[data-pick="r0m0"][data-side="${side}"]`);
      await page.fill("#stake-r0m0", stake);
    }
    await Promise.all([pg.click('[data-bet="r0m0"]'), pp.click('[data-bet="r0m0"]')]);
    await L.untilNode(() => fake.predictions?.bets?.length === 2, { label: "both bets saved", timeout: 15000 }).catch(() => ctx.bug(`concurrent bets: only ${fake.predictions?.bets?.length} of 2 saved`));
    const betIds = (fake.predictions.bets || []).map(b => b.id);
    ctx.check(new Set(betIds).size === betIds.length, `bet ids unique (${betIds})`);
    await until(pg, () => /ทายแล้ว/.test(document.getElementById("bettingMarkets").textContent), null, { label: "gift sees own bet" });
    await shot(pg, `${ctx.tag}-j3-bet-placed`);
    // The board on the dealer's page counts both.
    await until(pf, () => /2 คน/.test(document.querySelector("#dealerMarkets .board")?.textContent || ""), null, { label: "dealer board shows 2 bettors" }).catch(() => ctx.bug("dealer's กระดานทาย does not show both bets"));
    // Result on the league page: มอส 11–6 มังกร (มอส covers the half point).
    const ia = await admin.open("index.html");
    await until(ia, () => !!document.getElementById("r0m0a") && !document.getElementById("r0m0a").disabled, null, { label: "admin score inputs" });
    await ia.fill("#r0m0a", "11"); await ia.fill("#r0m0b", "6");
    await L.untilNode(() => fake.league.results?.r0m0?.b === 6, { label: "score saved" });
    // Settlement by the dealer.
    await pf.click("#settleAll");
    await L.untilNode(() => fake.predictions.bets.every(b => b.status !== "pending"), { label: "bets settled" });
    const byUser = Object.fromEntries(fake.predictions.bets.map(b => [b.userId, b]));
    ctx.check(byUser[ids.pruek]?.status === "won" && byUser[ids.pruek].net === 100, "pruek won 100");
    ctx.check(byUser[ids.gift]?.status === "lost" && byUser[ids.gift].net === -50, "gift lost 50");
    // ตารางนักทาย on the players' pages, without reloading.
    await until(pp, () => /\+100/.test(document.getElementById("predRankPanel")?.textContent || ""), null, { label: "pruek sees +100 on ตารางนักทาย" }).catch(() => ctx.bug("ตารางนักทาย did not update for the winner"));
    await until(pg, () => /ได้เงิน|ใครได้/.test(document.getElementById("settledPanel")?.textContent || "") && !document.getElementById("settledPanel").classList.contains("hidden"), null, { label: "settled panel" }).catch(() => ctx.bug("ใครได้ ใครเสีย panel not shown after settlement"));
    await shot(pp, `${ctx.tag}-j3-predrank`);
    // Player card prediction line, on the predictions page and on the home page of someone who never opened ทายผล.
    await pp.evaluate(id => window.PlayerCard.open(id), ids.pruek);
    await until(pp, () => /ทายผลตลอดกาล/.test(document.querySelector(".pc-backdrop:not(.ch-backdrop) .pc-sheet")?.textContent || ""), null, { label: "card prediction line" }).catch(() => ctx.bug("player card has no ทายผลตลอดกาล line on predictions page"));
    const gh = await golf.open("index.html");
    await until(gh, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "golf online" });
    await sleep(1000);
    await gh.evaluate(id => window.PlayerCard.open(id), ids.pruek);
    await sleep(500);
    const line = await gh.evaluate(() => document.querySelector(".pc-backdrop:not(.ch-backdrop) .pc-sheet")?.textContent || "");
    if (!/ทายผลตลอดกาล/.test(line)) ctx.bug("player card on the home page has no prediction line for a player with settled bets (card reads a predictions copy only predictions.html refreshes)");
    await shot(gh, `${ctx.tag}-j3-card-home`);
  },

  // 4. Profile: avatar + banner upload, tagline, PromptPay; another player opens the card and the โอนให้ sheet with QR.
  async j4_profile(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc, results: { r0m1: { a: 11, b: 8 } } }));
    const gift = ctx.track(await signedPhone(ctx.browser, fake, ids.gift));
    const golf = ctx.track(await signedPhone(ctx.browser, fake, ids.golf));
    const pg = await gift.open("index.html");
    await until(pg, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "gift online" });
    await L.menu(pg, "profile");
    await pg.waitForSelector("#meTagline");
    const upload = async (kind, color, w, h) => {
      const [chooser] = await Promise.all([pg.waitForEvent("filechooser"), pg.click(`[data-me-pick="${kind}"]`)]);
      await chooser.setFiles({ name: `${kind}.png`, mimeType: "image/png", buffer: await L.makePng(pg, color, w, h) });
      await until(pg, () => /กดบันทึก|บันทึก/.test(document.getElementById("meStatus")?.textContent || ""), null, { label: `${kind} processed` });
    };
    await upload("avatar", "#c22", 300, 300);
    ctx.check(/อัปโหลดภาพคมชัดแล้ว/.test(await L.text(pg, "#meStatus")), `avatar HD upload status (got "${await L.text(pg, "#meStatus")}")`);
    await upload("banner", "#26c", 600, 1000);
    await pg.fill("#meTagline", "ตบไม่เลือกหน้า");
    await pg.check('input[name="mePayMethod"][value="promptpay"]');
    await pg.fill("#mePromptPay", "081-234-5678");
    await shot(pg, `${ctx.tag}-j4-profile-sheet`);
    await pg.click("#meSave");
    await L.untilToast(pg, /บันทึกโปรไฟล์แล้ว/).catch(async () => ctx.bug(`profile save: ${await L.text(pg, "#meStatus")}`));
    const me = fake.league.profiles[ids.gift];
    ctx.check(me.tagline === "ตบไม่เลือกหน้า", "tagline in cloud");
    ctx.check(/^data:image\//.test(me.avatar || ""), "small avatar in row");
    ctx.check(/storage\/v1\/object\/public\/media\/banners\//.test(me.avatarHd || ""), "HD avatar link");
    ctx.check(/storage\/v1\/object\/public\/media\/banners\//.test(me.banner || ""), "banner link (bucket)");
    ctx.check(/0812345678/.test(JSON.stringify(me.promptpay || me)), "PromptPay stored");
    ctx.check(fake.media.size === 2, `two pictures uploaded to storage (${fake.media.size})`);
    // Another player sees it.
    const pk = await golf.open("index.html");
    await until(pk, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "golf online" });
    await until(pk, () => !!document.querySelector("#standings .pa img, #schedule .pa img"), null, { label: "gift's photo on golf's page" }).catch(() => ctx.bug("gift's avatar picture not shown on another player's page"));
    // Tap gift's name on the match card -> player card.
    await pk.evaluate(() => { const r = document.querySelector('.round-tab[data-round="all"]'); r?.click(); });
    const nameCell = pk.locator("#standings td.name", { hasText: "กิฟท์" }).first();
    await nameCell.click();
    await pk.waitForSelector(".pc-backdrop:not([hidden]) .pc-name");
    const card = await L.text(pk, ".pc-backdrop:not(.ch-backdrop) .pc-sheet");
    ctx.check(card.includes("ตบไม่เลือกหน้า"), "tagline on player card");
    ctx.check(/1\s*แข่ง|ชนะ/.test(card), "record on card");
    ctx.check(await pk.evaluate(() => /url\(/.test(getComputedStyle(document.querySelector(".pc-cover")).getPropertyValue("--pc-bg") || document.querySelector(".pc-cover").getAttribute("style") || "")), "banner as card cover");
    await shot(pk, `${ctx.tag}-j4-player-card`);
    await pk.click("[data-pc-pay]");
    await pk.waitForSelector(".pay-qr svg", { timeout: 8000 }).catch(() => ctx.bug("โอนให้ sheet shows no PromptPay QR"));
    ctx.check(/081-234-5678|0812345678/.test(await L.text(pk, ".me-sheet")), "PromptPay number on the transfer sheet");
    await sleep(800);
    await shot(pk, `${ctx.tag}-j4-transfer-qr`);
  },

  // 5. Social: check-in, MVP vote, reactions and comments on a finished match, seen from another phone.
  async j5_social(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc, results: { r0m1: { a: 11, b: 8 } } })); // กิฟท์ 11–8 กอล์ฟ
    const gift = ctx.track(await signedPhone(ctx.browser, fake, ids.gift));
    const golf = ctx.track(await signedPhone(ctx.browser, fake, ids.golf));
    const pg = await gift.open("index.html"), pk = await golf.open("index.html");
    for (const p of [pg, pk]) await until(p, () => !!document.querySelector("[data-sc-in]:not([disabled])"), null, { label: `${p.label} today card` });
    // Both check in at the same moment.
    await Promise.all([pg.click("[data-sc-in]"), pk.click("[data-sc-in]")]);
    await L.untilNode(() => Object.values(fake.club.checkin || {}).some(d => Object.keys(d).length === 2), { label: "two check-ins saved" }).catch(() => ctx.bug(`concurrent check-ins: ${JSON.stringify(fake.club.checkin)}`));
    // Votes.
    await pg.click("[data-sc-mvp]"); await pg.click(`[data-sc-vote="${ids.golf}"]`); await pg.click("[data-sc-close]").catch(() => pg.keyboard.press("Escape"));
    await pk.click("[data-sc-mvp]"); await pk.click(`[data-sc-vote="${ids.gift}"]`); await pk.click("[data-sc-close]").catch(() => pk.keyboard.press("Escape"));
    await L.untilNode(() => Object.values(fake.club.mvp || {}).some(w => w[ids.gift] === ids.golf && w[ids.golf] === ids.gift), { label: "votes saved" });
    // Reactions from both on the finished match, then a comment.
    await pg.evaluate(() => document.querySelector('.round-tab[data-round="all"]')?.click());
    await pk.evaluate(() => document.querySelector('.round-tab[data-round="all"]')?.click());
    await until(pg, () => !!document.querySelector('[data-sc-rx="r0m1"]'), null, { label: "reaction row on finished match" });
    await Promise.all([pg.click('[data-sc-rx="r0m1"][data-e="🔥"]'), pk.click('[data-sc-rx="r0m1"][data-e="😂"]')]);
    await pk.click('[data-sc-cm="r0m1"]');
    await pk.fill("#scText", "แพ้แต่ใจไม่แพ้ 😤");
    await pk.press("#scText", "Enter").catch(() => {});
    if (!(await L.untilNode(() => (fake.club.social?.comments || []).length === 1, { label: "comment", timeout: 3000 }).catch(() => false))) {
      await pk.click(".sc-form button[type=submit]");
    }
    await L.untilNode(() => (fake.club.social?.comments || []).length === 1, { label: "comment saved" });
    await L.untilNode(() => Object.values(fake.club.social?.reactions || {}).some(t => t[ids.gift] === "🔥" && t[ids.golf] === "😂"), { label: "both reactions saved" }).catch(() => ctx.bug(`reactions: ${JSON.stringify(fake.club.social?.reactions)}`));
    await pk.keyboard.press("Escape");
    await shot(pk, `${ctx.tag}-j5-comment`);
    // Gift's phone shows the comment count, both reactions, both check-ins and the vote tally (next poll, ≤15 s).
    await until(pg, () => document.querySelector('[data-sc-cm="r0m1"] b')?.textContent === "1", null, { label: "gift sees 1 comment", timeout: 25000 }).catch(() => ctx.bug("comment count not shown on the other phone"));
    await until(pg, () => document.querySelectorAll('[data-sc-rx="r0m1"].has').length === 2, null, { label: "gift sees both reactions", timeout: 25000 }).catch(() => ctx.bug("other player's reaction not shown"));
    ctx.check(/2 คน/.test(await L.text(pg, ".sc-who")), "today shows 2 checked in");
    await pg.click('[data-sc-cm="r0m1"]');
    await until(pg, () => /แพ้แต่ใจไม่แพ้/.test(document.querySelector(".sc-list")?.textContent || ""), null, { label: "comment visible to gift" });
    await shot(pg, `${ctx.tag}-j5-comments-other`);
    await pg.keyboard.press("Escape");
    await shot(pg, `${ctx.tag}-j5-today`);
  },

  // 6. Challenge: create -> accept -> live score -> result; Elo change on the card; head-to-head on stats.
  async j6_challenge(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc }));
    const golf = ctx.track(await signedPhone(ctx.browser, fake, ids.golf));
    const dragon = ctx.track(await signedPhone(ctx.browser, fake, ids.dragon));
    const pk = await golf.open("index.html");
    await until(pk, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "golf online" });
    const eloBefore = await pk.evaluate(id => { const t = window.LeagueElo?.table?.(LeagueShared.readLocalLeague(), LeagueShared.readLocalClub()); return t?.[id]?.rating ?? t?.get?.(id)?.rating ?? null; }, ids.golf);
    await pk.evaluate(id => window.PlayerCard.open(id), ids.dragon);
    await pk.click("[data-ch-to]");
    await pk.waitForSelector("[data-ch-form] [name=note]");
    await pk.fill("[data-ch-form] [name=note]", "แพ้เลี้ยงชานม");
    await pk.click('[data-ch="send"]');
    await L.untilNode(() => fake.club.challenges?.length === 1, { label: "challenge saved" });
    await L.untilToast(pk, /ส่งคำท้าถึง มังกร/);
    await shot(pk, `${ctx.tag}-j6-sent`);
    await pk.click('.ch-sheet [data-ch="close"]'); await sleep(400);
    // Dragon opens the app: badge on เมนู, accepts.
    const pd = await dragon.open("index.html");
    await until(pd, () => document.querySelector(".tab-menu .ch-badge")?.textContent === "1", null, { label: "challenge badge" }).catch(() => ctx.bug("no challenge badge on the challenged player's เมนู"));
    await L.menu(pd, "challenge");
    await pd.waitForSelector('[data-ch="accept"]');
    ctx.check(/แพ้เลี้ยงชานม/.test(await L.text(pd, ".ch-sheet")), "note shown to the challenged player");
    await pd.click('[data-ch="accept"]');
    await L.untilNode(() => fake.club.challenges[0].status === "accepted", { label: "accepted" });
    await pd.keyboard.press("Escape");
    // Golf reopens ท้าดวล (refreshes) and scores it live; dragon watches on the home page strip.
    if (!(await L.visible(pk, ".sport-tabbar .tab-menu"))) {
      ctx.bug(`tab bar stays hidden after sending a challenge (body.sport-typing=${await pk.evaluate(() => document.body.classList.contains("sport-typing"))})`);
      await pk.evaluate(() => document.body.classList.remove("sport-typing"));
    }
    await L.menu(pk, "challenge");
    await pk.waitForSelector('[data-ch="live"]', { timeout: 10000 });
    await pk.click('[data-ch="live"]');
    await pk.waitForSelector('[data-lv="start"]');
    await pk.check('input[name="bo"][value="1"]');
    await pk.click('[data-lv="start"]');
    for (let i = 0; i < 4; i++) await pk.click(".lv-side.a");
    await pk.click(".lv-side.b");
    await until(pd, () => /4–1/.test(document.querySelector(".lv-strip")?.textContent || ""), null, { label: "dragon sees challenge LIVE", timeout: 20000 }).catch(() => ctx.bug("challenge being scored live does not show on the other player's LIVE strip"));
    await shot(pd, `${ctx.tag}-j6-live-strip`);
    for (let i = 0; i < 7; i++) await pk.click(".lv-side.a");
    await pk.click('[data-lv="save"]');
    await L.untilNode(() => fake.club.matches?.length === 1, { label: "challenge result saved" });
    const m = fake.club.matches[0];
    ctx.check(m.kind === "challenge" && m.s?.a === 11 && m.s?.b === 1, `club match ${JSON.stringify(m.s)}`);
    ctx.check(fake.club.challenges[0].status === "done" || fake.club.challenges.length === 0 || fake.club.challenges[0].status !== "accepted", "challenge closed");
    await L.untilNode(() => !Object.keys(fake.live?.matches || {}).length, { label: "live cleared", timeout: 6000 }).catch(() => ctx.bug("challenge's live entry left in the live row"));
    // Elo on golf's card, seen by dragon after the next club read.
    await pd.evaluate(() => window.LeagueChallenge.refresh());
    await sleep(500);
    await pd.evaluate(id => window.PlayerCard.open(id), ids.golf);
    const cardText = await L.text(pd, ".pc-backdrop:not(.ch-backdrop) .pc-sheet");
    ctx.check(/Elo\s*10[2-9]\d/.test(cardText.replace(/\s+/g, " ")) || /\+\d+/.test(cardText), `golf's Elo went up on the card (${cardText.replace(/\s+/g, " ").slice(0, 120)})`);
    await shot(pd, `${ctx.tag}-j6-elo-card`);
    // Stats head-to-head, from a phone that never loaded the club row before.
    const fern = ctx.track(await signedPhone(ctx.browser, fake, ids.fern));
    const ps = await fern.open(`stats.html?a=${ids.golf}&b=${ids.dragon}#h2h`);
    await until(ps, () => /เจอกัน 1 ครั้ง/.test(document.getElementById("hFace")?.textContent || ""), null, { label: "h2h shows the challenge", timeout: 8000 }).catch(() => ctx.bug("stats ตัวต่อตัว misses the challenge match on a phone without a cached club copy"));
    await shot(ps, `${ctx.tag}-j6-h2h`);
    void eloBefore;
  },

  // 7. Tournament: a 5-player knockout (byes) played through, typed by the admin and by a player on their own phone,
  //    one game counted live; champion card; then a doubles one.
  async j7_tournament(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc }));
    const admin = ctx.track(await signedPhone(ctx.browser, fake, ids.admin));
    const gift = ctx.track(await signedPhone(ctx.browser, fake, ids.gift));
    const pa = await admin.open("tournament.html"), pg = await gift.open("tournament.html");
    const create = async ({ players, doubles = false, name }) => {
      await pa.goto(`${L.BASE}/tournament.html`);
      await pa.waitForSelector('[data-act="new"]', { timeout: 15000 });
      await pa.click('[data-act="new"]');
      await pa.waitForSelector(".tc-form");
      if (doubles) await pa.click('.tc-form .t-opt:has([name=format][value="doubles"])');
      for (const id of players) await pa.click(`.tc-form .tc-person:has([name=player][value="${id}"])`);
      await pa.fill(".tc-form [name=name]", name);
      await pa.click('.tc-form [type="submit"]');
      await L.untilNode(() => fake.club.tournaments?.some(t => t.name === name), { label: `tournament ${name} saved` });
      return fake.club.tournaments.find(t => t.name === name);
    };
    const t1 = await create({ players: [ids.gift, ids.golf, ids.dragon, ids.fern, ids.pruek], name: "ศึกน็อกเอาต์ e2e" });
    await shot(pa, `${ctx.tag}-j7-bracket`);
    // The player sees it in the list and opens it.
    await until(pg, n => document.getElementById("tApp")?.textContent.includes(n), t1.name, { label: "player sees new tournament", timeout: 20000 });
    await pg.goto(`${L.BASE}/tournament.html#t=${t1.id}`);
    let liveDone = false, guard = 0;
    const playable = page => page.evaluate(() => [...document.querySelectorAll("button.tb-m:not(.done):not(:disabled)")].filter(b => !b.querySelector(".tbd") && !b.querySelector(".bye")).map(b => ({ id: b.dataset.match, text: b.textContent })));
    while (!(fake.club.tournaments.find(t => t.id === t1.id)?.status === "done") && guard++ < 10) {
      // What is left to play, from the server's copy; each phone waits until its own bracket shows that game.
      const tt = fake.club.tournaments.find(t => t.id === t1.id), names = tt.entrants.map(id => NAMES[id]);
      const list = Object.values(tt.bracket.matches).filter(m => m.a !== null && m.b !== null && m.a >= 0 && m.b >= 0 && !m.s).map(m => ({ id: m.id, text: `${names[m.a]} ${names[m.b]}` }));
      if (!list.length) { await sleep(1000); continue; }
      const ready = (page, id) => until(page, id => !!document.querySelector(`button.tb-m[data-match="${id}"]:not(:disabled):not(.done)`), id, { label: `${page.label} shows ${id} playable`, timeout: 20000 });
      const giftMatch = list.find(m => m.text.includes("กิฟท์"));
      const before = (fake.club.matches || []).length;
      if (giftMatch) {
        // Gift types her own result on her phone (waits for the bracket to show this match first).
        await ready(pg, giftMatch.id);
        await pg.click(`button.tb-m[data-match="${giftMatch.id}"]`);
        await pg.waitForSelector(".ts-form");
        const giftIsA = (await L.text(pg, "#tsTitle span")).includes("กิฟท์");
        await pg.fill("#tsa", giftIsA ? "11" : "9"); await pg.fill("#tsb", giftIsA ? "9" : "11");
        await pg.click('.ts-form [type="submit"]');
      } else if (!liveDone) {
        liveDone = true;
        await ready(pa, list[0].id);
        await pa.click(`button.tb-m[data-match="${list[0].id}"]`);
        await pa.click('[data-ts="live"]');
        await pa.waitForSelector('[data-lv="start"]');
        await pa.check('input[name="bo"][value="1"]');
        await pa.click('[data-lv="start"]');
        for (let i = 0; i < 11; i++) await pa.click(".lv-side.b");
        await pa.click('[data-lv="save"]');
      } else {
        await ready(pa, list[0].id);
        await pa.click(`button.tb-m[data-match="${list[0].id}"]`);
        await pa.waitForSelector(".ts-form");
        await pa.fill("#tsa", "11"); await pa.fill("#tsb", "6");
        await pa.click('.ts-form [type="submit"]');
      }
      await L.untilNode(() => (fake.club.matches || []).length > before, { label: "tournament game saved", timeout: 10000 }).catch(async () => ctx.bug(`tournament result not saved (match ${giftMatch ? giftMatch.id + " by gift" : list[0].id}; err="${await L.text(giftMatch ? pg : pa, ".t-err")}"; toasts=${JSON.stringify((await L.toasts(giftMatch ? pg : pa)).slice(-3))}; sheet=${await L.visible(pg, ".t-sheet")}; ko=${JSON.stringify(Object.values(fake.club.tournaments.find(t => t.id === t1.id).bracket.matches || {}).map(m => `${m.id}:${m.a}v${m.b}:${m.s ? m.s.a + "-" + m.s.b : ""}:${m.w || ""}`))}; ent=${JSON.stringify(fake.club.tournaments.find(t => t.id === t1.id).entrants)})`));
      await sleep(300);
    }
    const done = fake.club.tournaments.find(t => t.id === t1.id);
    ctx.check(done?.status === "done", "knockout finished");
    ctx.check(liveDone, "one game was counted live");
    await pa.waitForSelector("#tChamp", { timeout: 10000 }).catch(() => ctx.bug("no champion card on the admin's page"));
    await until(pg, () => !!document.getElementById("tChamp"), null, { label: "player sees champion", timeout: 20000 }).catch(() => ctx.bug("champion card not shown on the player's page"));
    await shot(pg, `${ctx.tag}-j7-champion`);
    ctx.check((fake.club.matches || []).filter(m => m.kind === "tournament").length === 4, `4 tournament games recorded (${(fake.club.matches || []).length})`);
    // Doubles: 4 players -> 2 teams -> final.
    const t2 = await create({ players: [ids.gift, ids.golf, ids.dragon, ids.fern], doubles: true, name: "ศึกคู่ e2e" });
    ctx.check(t2.format === "doubles" && t2.entrants.length === 2 && t2.entrants.every(e => Array.isArray(e) && e.length === 2), "doubles teams of two");
    await pa.waitForSelector("button.tb-m:not(:disabled)");
    const fin = (await playable(pa))[0];
    await pa.click(`button.tb-m[data-match="${fin.id}"]`);
    await pa.waitForSelector(".ts-form");
    await pa.fill("#tsa", "2"); await pa.fill("#tsb", "1");
    await pa.click('.ts-form [type="submit"]');
    await L.untilNode(() => fake.club.tournaments.find(t => t.id === t2.id)?.status === "done", { label: "doubles finished" });
    await pa.waitForSelector("#tChamp");
    ctx.check(/&|\//.test(await L.text(pa, ".t-champ-name")), "doubles champion shows a team");
    await shot(pa, `${ctx.tag}-j7-doubles-champion`);
  },

  // 8. Finish the season: last score, จบซีซั่น, archive, Wrapped pill/story, awards pill + ceremony, Hall of Fame,
  //    and season 2 starting clean on every phone.
  async j8_finish_season(ctx) {
    // r2m0 (มอส vs กิฟท์) is the last match left.
    const results = { r0m0: { a: 11, b: 5 }, r0m1: { a: 11, b: 8 }, r1m0: { a: 7, b: 11 }, r1m1: { a: 11, b: 9 }, r2m1: { a: 11, b: 4 } };
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc, results }));
    const admin = ctx.track(await signedPhone(ctx.browser, fake, ids.admin));
    const gift = ctx.track(await signedPhone(ctx.browser, fake, ids.gift));
    const pa = await admin.open("index.html"), pg = await gift.open("index.html");
    await until(pa, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "admin online" });
    await pa.evaluate(() => document.querySelector('.round-tab[data-round="2"]')?.click());
    await pa.fill("#r2m0a", "11"); await pa.fill("#r2m0b", "9");
    await L.untilNode(() => fake.league.results?.r2m0?.a === 11, { label: "last score saved" });
    await until(pa, () => !document.getElementById("finishSeason").disabled, null, { label: "finish button enabled" });
    await shot(pa, `${ctx.tag}-j8-ready-to-finish`);
    await pa.click("#finishSeason");
    await L.untilNode(() => fake.league.currentSeason === 2, { label: "season 2 in cloud" });
    await L.untilNode(() => (fake.league.seasonArchives || []).length === 1, { label: "season 1 archived", timeout: 8000 }).catch(() => ctx.bug(`season archive not saved (archives=${(fake.league.seasonArchives || []).length})`));
    const L1 = fake.league;
    ctx.check(L1.rankHistory?.length === 1 && L1.rankHistory[0].standings[0].userId === ids.admin, "rankHistory S1 with มอส first");
    ctx.check(Object.keys(L1.results || {}).length === 0 && L1.rounds?.length === 3, "season 2 schedule fresh, no results");
    ctx.check(Object.keys(L1.seasonArchives?.[0]?.results || {}).length === 6, "archive keeps all 6 results");
    // The player's open page follows to season 2.
    await until(pg, () => /ซีซั่น 2/.test(document.getElementById("leagueInfo").textContent), null, { label: "gift sees season 2", timeout: 15000 });
    ctx.check(await pg.evaluate(() => document.getElementById("played").textContent) === "0", "season 2 played 0 on gift");
    // Wrapped pill, then the awards pill, on the next open of the home page.
    await pg.reload();
    await pg.waitForSelector(".wr-offer", { timeout: 8000 }).catch(() => ctx.bug("no สรุปซีซั่น (Wrapped) pill after the season ended"));
    await shot(pg, `${ctx.tag}-j8-wrapped-pill`);
    if (await L.visible(pg, ".wr-offer-go")) {
      await pg.click(".wr-offer-go");
      await pg.waitForSelector(".wr:not([hidden]) .wr-slide");
      await sleep(600);
      await shot(pg, `${ctx.tag}-j8-wrapped-story`);
      ctx.check(/ซีซั่น 1|S1/.test(await L.text(pg, ".wr")), "Wrapped story is about season 1");
      await pg.click("[data-wr-close]");
    }
    await pg.waitForSelector(".aw-offer", { timeout: 8000 }).catch(() => ctx.bug("no พิธีมอบรางวัล pill after the Wrapped pill"));
    if (await L.visible(pg, ".aw-offer-go")) {
      await pg.click(".aw-offer-go");
      for (let i = 0; i < 30 && await L.visible(pg, "[data-aw-next]"); i++) { await pg.click("[data-aw-next]"); await sleep(120); }
      await until(pg, () => /ทำเนียบรางวัล/.test(document.querySelector(".aw-title")?.textContent || ""), null, { label: "awards summary" });
      await shot(pg, `${ctx.tag}-j8-awards`);
      ctx.check(/มอส/.test(await L.text(pg, ".aw-grid")), "champion มอส among the awards");
      await pg.click("[data-aw-close]");
    }
    await pg.reload(); await sleep(2500);
    ctx.check(!(await L.visible(pg, ".wr-offer")) && !(await L.visible(pg, ".aw-offer")), "pills not offered again after being seen");
    // Hall of Fame and the archive.
    const ph = await gift.open("hall.html");
    await until(ph, () => /มอส/.test(document.querySelector(".hall-champs")?.textContent || ""), null, { label: "hall lists the S1 champion", timeout: 10000 }).catch(() => ctx.bug("Hall of Fame does not list the season 1 champion"));
    await shot(ph, `${ctx.tag}-j8-hall`);
    const pr = await gift.open("archive.html");
    await until(pr, () => /ซีซั่น 1/.test(document.body.textContent), null, { label: "archive shows season 1" }).catch(() => ctx.bug("archive page does not show season 1"));
    // Season 2: standings all zero, next-up round 1, predictions empty for S2.
    const p2 = await gift.open("index.html");
    await until(p2, () => /ซีซั่น 2/.test(document.getElementById("leagueInfo").textContent), null, { label: "S2" });
    const rows = await p2.evaluate(() => [...document.querySelectorAll("#standings tr")].map(r => r.lastElementChild.textContent.trim()));
    ctx.check(rows.length === 4 && rows.every(x => x === "0"), `S2 standings all 0 (${rows})`);
    ctx.check(/รอบ 1/.test(await L.text(p2, "#nextUp")), "next-up at round 1");
    ctx.check(/100 RP/.test(await L.text(p2, "#rankingList")), "RP awarded to the champion");
    const wf = await L.text(p2, "#workflowCard");
    ctx.check(/0\/6/.test(wf), `helper card S2 0/6 (${wf.replace(/\s+/g, " ").slice(0, 50)})`);
    await shot(p2, `${ctx.tag}-j8-season2`);
  },

  // 9. Dummy (ดัมมี่) with 3 players, saved to the cloud; two phones save a game at the same moment; both games kept.
  async j9_dummy(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc }));
    const gift = ctx.track(await signedPhone(ctx.browser, fake, ids.gift));
    const golf = ctx.track(await signedPhone(ctx.browser, fake, ids.golf));
    const pa = await gift.open("dummy.html");
    await pa.waitForSelector("#dNames [data-name]");
    await pa.click("#dAddPlayer");
    const names = ["กิฟท์", "กอล์ฟ", "มังกร"];
    for (let i = 0; i < 3; i++) await pa.fill(`[data-name="${i}"]`, names[i]);
    await pa.click("#dStart");
    await L.untilNode(() => fake.rows.main.dummy?.players?.length === 3, { label: "dummy players in cloud" });
    const pb = await golf.open("dummy.html");
    await until(pb, () => !document.getElementById("dGame").hidden && document.querySelectorAll("[data-score]").length === 3, null, { label: "golf's phone adopts the sheet" });
    const enter = async (page, scores) => {
      for (let i = 0; i < scores.length; i++) {
        await page.fill(`[data-score="${i}"]`, String(Math.abs(scores[i])));
        if (scores[i] < 0) await page.click(`[data-sign="${i}"]`);
      }
    };
    await enter(pa, [50, -20, 10]);
    await enter(pb, [30, 40, -10]);
    await Promise.all([pa.click("#dSaveRound"), pb.click("#dSaveRound")]);
    await L.untilNode(() => fake.rows.main.dummy?.rounds?.length === 2, { label: "both games in the cloud", timeout: 15000 }).catch(() => ctx.bug(`concurrent dummy saves: cloud has ${fake.rows.main.dummy?.rounds?.length} games`));
    // Each phone picks the other's game up on its next sync (every 4 s).
    for (const p of [pa, pb]) await until(p, () => /กิฟท์รวม 80 แต้ม/.test(document.getElementById("dBoard").textContent.replace(/\s+/g, " ")), null, { label: `${p.label} shows both games`, timeout: 15000 }).catch(() => ctx.bug(`${p.label} does not converge to both games`));
    const totals = await Promise.all([pa, pb].map(p => p.evaluate(() => document.getElementById("dBoard").textContent.replace(/\s+/g, " "))));
    ctx.check(totals[0] === totals[1], `both phones show the same board (${totals[0].slice(0, 80)} | ${totals[1].slice(0, 80)})`);
    ctx.check(/80/.test(totals[0]) && /20/.test(totals[0]), `totals 80 / 20 / 0 (${totals[0].slice(0, 80)})`);
    await shot(pa, `${ctx.tag}-j9-dummy`);
    const rows = fake.rows.main.dummy.rounds.map(r => r.scores.join(","));
    ctx.check(rows.includes("50,-20,10") && rows.includes("30,40,-10"), `both score lines saved (${rows})`);
    // Undo on one phone shows up on the other.
    await pb.reload();
    await until(pb, () => document.querySelectorAll("#dHistBody tr").length >= 2, null, { label: "golf reload shows 2" });
  },

  // 10. In-app notifications (pwa.js): turned on from เมนู; my result, my next match, a market opening, a comment on my
  //     match each show once, and not again after a reload.
  async j10_notifications(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc, predictions: { dealerId: ids.fern, markets: {}, bets: [], nextBetId: 1 } }));
    const admin = ctx.track(await signedPhone(ctx.browser, fake, ids.admin));
    // Gift's phone runs the real service worker (sw.js): notifications wait for navigator.serviceWorker.ready.
    const gift = ctx.track(await signedPhone(ctx.browser, fake, ids.gift, undefined, { serviceWorkers: "allow" }));
    const fern = ctx.track(await signedPhone(ctx.browser, fake, ids.fern));
    const golf = ctx.track(await signedPhone(ctx.browser, fake, ids.golf));
    const pg = await gift.open("index.html");
    await until(pg, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "gift online" });
    await L.menu(pg, "notify");
    await L.untilToast(pg, /เปิดแจ้งเตือนแล้ว/, { timeout: 8000 }).catch(() => ctx.bug("turning notifications on never confirms (no เปิดแจ้งเตือนแล้ว toast)"));
    ctx.check(await pg.evaluate(() => window.LeaguePWA.enabled()), "notifications enabled");
    const count = async re => (await L.toasts(pg)).filter(t => re.test(t)).length;
    // Gift's first match r0m1 (กิฟท์ vs กอล์ฟ): the admin enters 11–8.
    const pa = await admin.open("index.html");
    await until(pa, () => !!document.getElementById("r0m1a") && !document.getElementById("r0m1a").disabled, null, { label: "admin inputs" });
    await pa.fill("#r0m1a", "11"); await pa.fill("#r0m1b", "8");
    await L.untilToast(pg, /ชนะแล้ว/, { timeout: 20000 }).catch(() => ctx.bug("no ชนะแล้ว notification for my result"));
    // The dealer opens a market on r1m0 (กอล์ฟ vs มอส).
    const pf = await fern.open("predictions.html");
    await until(pf, () => !!document.querySelector('[data-save="r1m0"]'), null, { label: "dealer controls" });
    await pf.selectOption("#open-r1m0", "1"); await pf.click('[data-save="r1m0"]');
    await L.untilNode(() => fake.predictions.markets?.["s1:r1m0"]?.open, { label: "market open" });
    await L.untilToast(pg, /เปิดทายผลแล้ว/, { timeout: 20000 }).catch(() => ctx.bug("no เปิดทายผลแล้ว notification on the home page"));
    // Golf comments on gift's match.
    const pk = await golf.open("index.html");
    await pk.evaluate(() => document.querySelector('.round-tab[data-round="all"]')?.click());
    await until(pk, () => !!document.querySelector('[data-sc-cm="r0m1"]'), null, { label: "comment button" });
    await pk.click('[data-sc-cm="r0m1"]'); await pk.fill("#scText", "ฟลุ๊ค!"); await pk.click(".sc-form button[type=submit]");
    await L.untilNode(() => (fake.club.social?.comments || []).length === 1, { label: "comment saved" });
    await pg.evaluate(() => window.LeagueSocial?.refresh?.());
    await L.untilToast(pg, /คอมเมนต์คู่ของคุณ/, { timeout: 20000 }).catch(() => ctx.bug("no comment notification"));
    await sleep(11000); // two more pwa.js checks
    for (const re of [/ชนะแล้ว/, /เปิดทายผลแล้ว/, /คอมเมนต์คู่ของคุณ/]) { const n = await count(re); ctx.check(n <= 1, `${re} shown once (got ${n})`); }
    await shot(pg, `${ctx.tag}-j10-notified`);
    await pg.reload(); await sleep(7000);
    const again = (await L.toasts(pg)).filter(t => /ชนะแล้ว|เปิดทายผลแล้ว|คอมเมนต์คู่ของคุณ|ถึงคิวคุณแล้ว/.test(t));
    ctx.check(!again.length, `nothing re-notified after reload (${again})`);
  },

  // 11. The network drops during score entry (typed and live), then comes back: nothing is lost, the status pill says
  //     what is going on, and a watcher catches up.
  async j11_offline(ctx) {
    const fake = ctx.useFake(makeWorld({ rpc: ctx.rpc }));
    const admin = ctx.track(await signedPhone(ctx.browser, fake, ids.admin));
    const gift = ctx.track(await signedPhone(ctx.browser, fake, ids.gift));
    const pa = await admin.open("index.html"), pg = await gift.open("index.html");
    await until(pa, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "admin online" });
    fake.offline = true;
    await pa.fill("#r0m0a", "11"); await pa.fill("#r0m0b", "5");
    await until(pa, () => /ออฟไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "offline status shown" }).catch(() => ctx.bug("status pill does not say offline when a save fails"));
    await pa.fill("#r0m1a", "9"); await pa.fill("#r0m1b", "11");
    await sleep(1500);
    await shot(pa, `${ctx.tag}-j11-offline`);
    ctx.check(await pa.evaluate(() => { const l = JSON.parse(localStorage.getItem("pp_league_v7_uid")); return l.results?.r0m0?.a === 11 && l.results?.r0m1?.b === 11; }), "scores kept on the phone while offline");
    fake.offline = false;
    // No more typing: the phone should send what it kept by itself once the network is back.
    const synced = await L.untilNode(() => fake.league.results?.r0m0?.a === 11 && fake.league.results?.r0m1?.b === 11, { label: "offline scores reach the cloud", timeout: 15000 }).catch(() => false);
    if (!synced) ctx.bug("scores typed while offline are not sent after the network returns (no retry until the next edit; a reload then loses them)");
    await until(pa, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "online again", timeout: 15000 }).catch(() => ctx.bug("status pill stays offline after the network is back"));
    await until(pg, () => document.getElementById("played").textContent === "2", null, { label: "watcher gets both scores", timeout: 15000 }).catch(() => ctx.bug("other phone never gets the offline scores"));
    // Reload on the admin phone: nothing lost.
    await pa.reload();
    await until(pa, () => /ออนไลน์/.test(document.getElementById("syncStatus").textContent), null, { label: "admin online after reload" });
    await until(pa, () => document.getElementById("played").textContent === "2", null, { label: "2 played after reload", timeout: 5000 })
      .catch(async () => ctx.bug(`after reload played=${await L.text(pa, "#played")} cloud=${JSON.stringify(fake.league.results)}`));
    // Live scoring through a drop: points tapped offline reach the watcher once the network is back, without more taps.
    await pa.evaluate(() => document.querySelector('.round-tab[data-round="1"]')?.click());
    await pa.click('[data-lv-score="r1m0"]');
    await pa.check('input[name="bo"][value="1"]');
    await pa.click('[data-lv="start"]');
    await pa.click(".lv-side.a");
    await L.untilNode(() => Object.keys(fake.live?.matches || {}).length === 1, { label: "live started" });
    fake.offline = true;
    for (let i = 0; i < 3; i++) await pa.click(".lv-side.a");
    await sleep(1500);
    fake.offline = false;
    const caught = await L.untilNode(() => Object.values(fake.live?.matches || {})[0]?.cur?.[0] === 4, { label: "live points after reconnect", timeout: 12000 }).catch(() => false);
    if (!caught) ctx.bug("live points tapped during a network drop are not sent after it comes back (watchers stay behind until the next tap)");
    await until(pg, () => /4–0/.test(document.querySelector(".lv-strip")?.textContent || ""), null, { label: "watcher sees 4–0", timeout: 15000 }).catch(() => ctx.bug("watcher's LIVE strip did not catch up after the drop"));
    await shot(pg, `${ctx.tag}-j11-live-after-drop`);
  }
};
