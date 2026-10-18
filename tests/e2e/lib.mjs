// Harness helpers for the end-to-end journeys: static server, Playwright browser, one context per player ("phone"),
// dialog handling, console/page error capture, screenshots and small wait helpers.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PORT = Number(process.env.E2E_PORT || 8822);
export const BASE = `http://127.0.0.1:${PORT}`;
export const SHOTS = process.env.E2E_SHOTS || path.join(ROOT, "tests/e2e/.shots");

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright", "/opt/node22/lib/node_modules/playwright/index.js"].filter(Boolean);
  for (const c of candidates) { try { return require(c); } catch {} }
  throw new Error("Playwright not found: npm i -D playwright, or set PLAYWRIGHT_PATH");
}
export const { chromium } = loadPlaywright();

export async function startServer() {
  try { const r = await fetch(`${BASE}/index.html`); if (r.ok) return { stop() {} }; } catch {}
  const proc = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    try { const r = await fetch(`${BASE}/index.html`); if (r.ok) return { stop() { proc.kill(); } }; } catch {}
  }
  proc.kill();
  throw new Error("static server did not start");
}

export async function launch() {
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  return chromium.launch({ executablePath, headless: true, args: ["--disable-gpu"] });
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Everything wrong that a journey observed. Journeys add to it with problem(); the runner prints it.
export const problems = [];
export function problem(kind, detail) { problems.push({ kind, detail }); console.log(`   !! ${kind}: ${detail}`); }

// Console noise that is not a bug of the app under test.
const IGNORED = [/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/, /net::ERR_FAILED/, /favicon/, /status of 40[14]/, /ERR_BLOCKED/, /Push API in incognito/];

// A "phone": its own context (own localStorage), one or more pages.
export async function phone(browser, fake, label, { width = 390, height = 844, serviceWorkers = "block" } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true, isMobile: false, locale: "th-TH", timezoneId: "Asia/Bangkok", serviceWorkers, permissions: ["notifications"], reducedMotion: "reduce" });
  await context.addInitScript(() => {
    // No install pill (it would cover the tab bar in screenshots).
    try { localStorage.setItem("pp_install_offer", "1"); } catch {}
    // Every toast (suite.js turns alert() into toasts) is recorded with its time, for assertions.
    window.__toasts = [];
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1 && n.classList.contains("toast")) window.__toasts.push({ at: Date.now(), text: n.textContent.trim(), type: n.className });
    }))).observe(document, { childList: true, subtree: true });
  });
  await fake.attach(context);
  // Block anything that is not the local site or the fake backend (fonts are local).
  await context.route(url => !url.href.startsWith(BASE) && !/supabase\.co/.test(url.host), route => route.abort());
  const p = { label, context, pages: [], dialogs: [], answers: [], errors: [], toasts: [] };
  p.open = async (file = "index.html") => {
    const page = await context.newPage();
    page.on("console", msg => { if (msg.type() === "error" && !IGNORED.some(r => r.test(msg.text()))) { p.errors.push(`${file}: ${msg.text()}`); } });
    page.on("pageerror", err => p.errors.push(`${file}: pageerror ${err.message}`));
    page.on("dialog", async d => {
      p.dialogs.push({ type: d.type(), message: d.message(), page: file });
      if (d.type() === "prompt") { const a = p.answers.shift(); return a === null ? d.dismiss() : d.accept(a ?? d.defaultValue()); }
      if (d.type() === "confirm" && p.answers[0] === false) { p.answers.shift(); return d.dismiss(); }
      return d.accept();
    });
    await page.goto(`${BASE}/${file}`);
    p.pages.push(page);
    page.label = `${label}@${file}`;
    return page;
  };
  p.close = () => context.close();
  return p;
}

export async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
}

// Waits until fn() (run in the page) is truthy; returns its value or throws with a label.
export async function until(page, fn, arg, { timeout = 15000, label = "condition" } = {}) {
  try { const h = await page.waitForFunction(fn, arg, { timeout, polling: 150 }); return h.jsonValue(); }
  catch (e) { throw new Error(`${page.label || ""}: timed out waiting for ${label}`); }
}
export async function untilNode(fn, { timeout = 15000, label = "condition", every = 150 } = {}) {
  const end = Date.now() + timeout;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${label}`); await sleep(every); }
}

export async function text(page, selector) { return (await page.locator(selector).first().textContent({ timeout: 5000 }).catch(() => "")) || ""; }
export async function visible(page, selector) { return page.locator(selector).first().isVisible().catch(() => false); }

// Sign in on a page that shows the login card (#auth with #loginUser / #loginPin / #loginBtn).
export async function login(page, userId, pin) {
  await until(page, id => [...document.querySelectorAll("#loginUser option")].some(o => o.value === id), userId, { label: `login option ${userId}` });
  await page.selectOption("#loginUser", userId);
  await page.fill("#loginPin", pin);
  await page.click("#loginBtn");
}
// Fill and submit the forced/optional PIN change card (pin-change.js).
export async function changePin(page, newPin, current = null) {
  await page.waitForSelector(".pin-overlay form", { timeout: 10000 });
  if (current !== null) await page.fill("#pinCurrent", current);
  await page.fill("#pinNew", newPin);
  await page.fill("#pinConfirm", newPin);
  await page.click('.pin-overlay button[type="submit"]');
  await page.waitForSelector(".pin-overlay", { state: "detached", timeout: 10000 });
}
// Answer the "ยืนยัน PIN อีกครั้ง" card (server session missing) if it shows up.
export async function reloginIfAsked(page, pin, timeout = 1500) {
  const card = await page.waitForSelector("#reloginPin", { timeout }).catch(() => null);
  if (!card) return false;
  await page.fill("#reloginPin", pin);
  await page.click('.pin-overlay button[type="submit"]');
  await page.waitForSelector("#reloginPin", { state: "detached", timeout: 8000 });
  return true;
}
// Seed a phone as signed in by logging in through the real UI on index.html, changing PIN when forced.
export async function signIn(p, userId, pin, { newPin = null } = {}) {
  const page = p.pages[0] || await p.open("index.html");
  await login(page, userId, pin);
  if (newPin) await changePin(page, newPin);
  await until(page, () => document.getElementById("auth")?.classList.contains("hidden"), null, { label: "signed in" });
  return page;
}
export async function openMenu(page) {
  await page.click(".sport-tabbar .tab-menu");
  await page.waitForSelector("#siteMenu.open");
}
export async function menu(page, act) {
  await openMenu(page);
  await page.click(`#siteMenu [data-act="${act}"]`);
}
// Generates a small PNG of a solid colour, as a Buffer (for avatar / banner uploads).
export async function makePng(page, color = "#e33", w = 64, h = 64) {
  const b64 = await page.evaluate(([c, w, h]) => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const x = cv.getContext("2d"); x.fillStyle = c; x.fillRect(0, 0, w, h); x.fillStyle = "#fff"; x.fillRect(w / 4, h / 4, w / 2, h / 2); return cv.toDataURL("image/png").split(",")[1]; }, [color, w, h]);
  return Buffer.from(b64, "base64");
}
export const toasts = page => page.evaluate(() => window.__toasts.map(t => t.text));
export async function untilToast(page, re, opts = {}) {
  return until(page, src => window.__toasts.some(t => new RegExp(src).test(t.text)), re.source, { label: `toast ${re}`, ...opts });
}
export function assert(cond, message) { if (!cond) throw new Error(`assertion failed: ${message}`); }
