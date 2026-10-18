# Security Review — Ping Pong League

วันที่ / Date: 2026-10-17 (phase 2: 2026-10-19, branch `feat-security2`) · Branch: `security-review` · ขอบเขต / Scope: `shared.js`, `sync-guard.js`, `restore-guard.js`, `safety-hooks.js`, `index.js`, `predictions.js`, `admin.js`, `backup.js`, `supabase/migrations/*.sql`

> **สรุปสั้น (TH):** ใครก็ตามที่เปิดเว็บ (หรือแค่อ่าน `shared.js`) ใช้ publishable key เดียวกับเว็บ **อ่าน PIN ของทุกคน, แก้คะแนน/สิทธิ์/ยอดทาย, หรือล้างข้อมูลลีกทั้งแถวได้ทันที** โดยไม่ต้องล็อกอิน เพราะ RLS อนุญาตให้ `anon` `UPDATE` แถว `main` ได้ทั้งแถว และการตรวจ PIN/สิทธิ์ทั้งหมดอยู่ในเบราว์เซอร์ PR นี้ (1) บังคับเปลี่ยน PIN จาก 1234 และเก็บ PIN เป็น hash แทนข้อความ (2) เพิ่ม migration ที่ **ใช้กับเว็บปัจจุบันได้ทันทีโดยไม่พัง**: กันการล้าง/ยัดข้อมูลก้อนใหญ่, จำกัดความถี่การเขียน และเก็บประวัติทุกเวอร์ชันไว้ฝั่ง server ให้กู้คืนได้ (3) ร่าง SQL เฟส 2 ที่ย้ายการตรวจ PIN และสิทธิ์ไปไว้ฝั่ง server ซึ่งต้องทำคู่กับการแก้ฝั่งเว็บ
>
> **Summary (EN):** Anyone who opens the site (or just reads `shared.js`) can use the same publishable key to **read every PIN, change scores/roles/bets, or wipe the whole league row**, with no login, because RLS lets `anon` `UPDATE` the `main` row and every PIN and role check happens in the browser. This PR (1) forces a PIN change away from 1234 and stores PINs as salted hashes instead of plaintext, (2) adds a migration that is **safe to apply under the live site**: it blocks wipes and oversized writes, rate-limits writes, and keeps a server-side history of every previous version so vandalism can be undone, and (3) drafts phase-2 SQL that moves PIN and role checks to the server, to be shipped together with a client change.

> **อัปเดตเฟส 2 / Phase 2 update (2026-10-19):** `supabase/migrations/20261019140000_server_auth.sql` + client in `shared.js` implement the phase 2 below (it replaces the draft `supabase/proposed/phase2_server_side_auth.sql`, now removed). It ships behind a switch: nothing changes for the live site until the owner runs `update private.settings set enforce = true;`. See **"Phase 2 (shipped)"** at the end and the Thai owner guide `docs/security-phase2.md`.

## ตารางสรุป / Findings at a glance

| # | ระดับ / Severity | หัวข้อ / Finding | สถานะใน PR นี้ / Status in this PR |
|---|---|---|---|
| S1 | **Critical** | `anon` เขียนทับ/ล้างแถว `main` ได้ทั้งแถว · anon can overwrite or wipe the whole row | ลดความเสียหาย: phase 1 SQL · **Fixed by phase 2 once `enforce = true`** (direct UPDATE revoked, RPC-only writes) |
| S2 | **Critical** | PIN ทุกคนเป็น plaintext ในแถวที่ใครก็อ่านได้ และทุกบัญชีใช้ 1234 · All PINs are plaintext in a world-readable row, and all default to 1234 | **Fixed by phase 2 once `enforce = true`** (bcrypt in `private.credentials`, stripped from the row) |
| S3 | **High** | Session คือ `pp_user_id` ใน localStorage ปลอมเป็น Admin ได้โดยไม่ต้องรู้ PIN · Session is just `pp_user_id`; anyone can impersonate the admin without a PIN | **Fixed by phase 2** (server session token, 30 days) |
| S4 | **High** | สิทธิ์ Admin/เจ้ามือ ตรวจในเบราว์เซอร์อย่างเดียว · Admin/dealer permissions are enforced only in the browser | **Fixed by phase 2 once `enforce = true`** (rules in Postgres, see table below) |
| S5 | **Medium** | Lockout อยู่ใน localStorage ข้ามได้ · Login lockout lives in localStorage and is trivially bypassed | **Fixed by phase 2** (5 fails → 15 min per account, 30/10 min per IP, server-side) |
| S6 | **Medium** | ไม่มีประวัติ/audit ฝั่ง server · No server-side history or audit; the audit log sits inside the writable row | แก้: phase 1 SQL · Fixed by phase 1 SQL |
| S7 | **Medium** | ไม่จำกัดขนาด/รูปแบบข้อมูล + ทุกหน้าดึงทั้งแถวทุก 3 วิ · No size/shape limit, and every open page re-downloads the whole row every 3 s | แก้: phase 1 SQL · Fixed by phase 1 SQL |
| S8 | **Medium** | ทุกฟิลด์ในแถวควบคุมได้โดยผู้โจมตี → XSS ถ้าหลุด escape จุดเดียว, ไม่มี CSP · Every field is attacker-controlled, so one missed escape is stored XSS for every visitor; no CSP | แนะนำ · Recommendation |
| S9 | **Low** | สำเนาในเครื่อง (localStorage, Backup) มี PIN ของทุกคน · Local copies and backups on every device hold everyone's PIN | **Fixed by phase 2 once `enforce = true`** (no credentials in the row; older local backups still hold old hashes until rotated) |
| S10 | **Low** | Restore ทั้ง Season ย้อน PIN/สิทธิ์กลับ · A full restore rolls PINs and roles back | แก้ PIN แล้ว · Fixed for PINs |

---

## S1 — `anon` เขียนทับหรือล้างข้อมูลทั้งแถวได้ · anon can overwrite or wipe the whole row — **Critical**

**TH:** `20260919163000_create_shared_state.sql` ให้ `grant select, insert, update ... to anon` และ policy `for update to anon using (id = 'main') with check (id = 'main')` ซึ่งไม่ได้ตรวจว่าใครเป็นคนเขียน publishable key อยู่ใน `shared.js` (ตั้งใจให้เป็นสาธารณะ) ดังนั้นความปลอดภัยทั้งหมดขึ้นกับ RLS ซึ่งตอนนี้เปิดกว้าง

**EN:** The first migration grants `select, insert, update` to `anon`, and the update policy only checks `id = 'main'`, not who is writing. The publishable key in `shared.js` is public by design, so RLS is the only protection, and it allows everything except `DELETE`.

**เส้นทางโจมตี / Attack path:**
1. เปิด `shared.js` คัดลอก `SUPABASE_URL` และ `SUPABASE_KEY` · Copy the URL and key from `shared.js`.
2. `PATCH /rest/v1/app_state?id=eq.main` with body `{"league":{},"predictions":{}}` and the key in the `apikey` / `Authorization` headers.
3. ลีก, แรงค์ทุก Season, archive, audit log และยอดทายหายหมดสำหรับทุกคน วิธีกู้มีแค่ Backup ใน localStorage ของเครื่องที่บังเอิญเก็บไว้ (สูงสุด 30 ชุด/เครื่อง) · League, all seasons' RP, archives, audit log and bets are gone for everyone. Recovery depends on someone's browser happening to hold a local backup.
- `INSERT ... ON CONFLICT` (PostgREST `Prefer: resolution=merge-duplicates`) also works today, because both grants exist. There is no `DELETE` grant, but a wipe via `UPDATE` has the same effect.

**วิธีแก้ / Fix:**
- **Phase 1 (ในPR นี้ ใช้ได้ทันที / in this PR, safe now)** `supabase/migrations/20261018130000_harden_shared_state.sql`:
  - เลิกให้ `INSERT` และแก้ได้เฉพาะคอลัมน์ `league, predictions, dummy, updated_at` (เปลี่ยน `id` ไม่ได้) · Revoke `INSERT`; column-level `UPDATE` on `league, predictions, dummy, updated_at` only (`dummy` is the Dummy page's column; leaving it out would break every Dummy save).
  - Trigger `private.app_state_guard` ปฏิเสธการเขียนจาก API ที่ล้างลีก (ต้องยังเป็นลีกที่มี `profiles`), ลบบัญชีเกินครึ่ง, ลบ `rankHistory` / `seasonArchives` / `bets` เกินครึ่งในครั้งเดียว, ขนาดเกินเพดาน และเขียนถี่เกินกำหนด (ดู "เพดานของ phase 1" ด้านล่าง) · A guard trigger rejects API writes that wipe the league, drop more than half of the accounts / RP history / archives / bets in one write, exceed the size caps, or exceed the per-row rate limit (see "Phase 1 limits" below).
  - Trigger `private.app_state_record_history` เก็บค่าก่อนหน้าของ**คอลัมน์ที่เปลี่ยน**ทุกครั้ง (+ IP, user-agent) ใน `private.app_state_history` ที่ API มองไม่เห็น และ `private.restore_app_state(id)` ให้เจ้าของกู้คืนจาก SQL Editor · The previous value of each **changed** column is stored server-side (with IP and user agent) where the API cannot reach it, and the owner can restore the row to any recorded point from the SQL Editor. A Dummy save stores only the old `dummy` (a few KB), not another copy of the league with everyone's pictures.
  - แถวที่สอง `id = 'live'` สำหรับฟีเจอร์ live scoring ที่วางแผนไว้ (สร้างใน migration นี้ก่อนตัดสิทธิ์ INSERT, policy select/update ครอบคลุม `main` และ `live`) · A second row `id = 'live'` for the planned live-scoring feature, created by this migration before INSERT is revoked; the select/update policies now cover `'main'` and `'live'` (the original policies covered `'main'` only, so anon could neither read nor write `'live'`). On `'live'` the guard only enforces a 64 KB cap and a 600/min rate limit (no wipe/shape checks) and **no history is recorded**, so point-by-point writes cannot push real league versions out of history.
  - ผ่านการทดสอบกับ Postgres 16 ในเครื่องด้วย role แบบ Supabase (anon / authenticated / authenticator): ดู "ทดสอบ / Verified" ด้านล่าง · Tested on local Postgres 16 with Supabase-style roles; see "Verified" below.
  - **ข้อจำกัด / Limit:** ยังแก้ทีละนิดได้ (เช่น เปลี่ยน role ตัวเองเป็น admin, แก้คะแนนคู่เดียว) แต่ทุกครั้งถูกบันทึกและกู้คืนได้ · Small well-formed edits (make yourself admin, change one score) still pass; they are now recorded and reversible.
- **Phase 2 (shipped: `supabase/migrations/20261019140000_server_auth.sql`, draft removed)**: เลิกให้ `anon` `UPDATE` ตรง ๆ ทั้งหมด การเขียนผ่าน RPC `SECURITY DEFINER` ที่ตรวจ session token + role ฝั่ง server · Revoke direct `UPDATE`; all writes go through `SECURITY DEFINER` RPCs that check a server-issued session token and the caller's role.

## S2 — PIN เป็น plaintext ที่ใครก็อ่านได้ และทุกคนใช้ 1234 · Plaintext PINs anyone can read, all set to 1234 — **Critical**

**TH:** `profiles[id].pin` เก็บเป็นข้อความธรรมดาใน `league` ที่ `anon` `SELECT` ได้ บัญชีใหม่และการรีเซ็ตตั้งเป็น `1234` และไม่มีหน้าให้ผู้เล่นเปลี่ยน PIN เอง ดังนั้นในทางปฏิบัติ PIN ของทุกบัญชี (รวม Admin "มอส") น่าจะเป็น 1234 การเทียบ PIN (`person.pin !== pin`) ทำในเบราว์เซอร์

**EN:** `profiles[id].pin` is plaintext inside the world-readable `league` column. New accounts and resets use `1234`, and there was no way for a player to change their own PIN, so in practice every account, the admin's included, is probably on 1234. The comparison happens in the browser.

**เส้นทางโจมตี / Attack path:** เลือกชื่อ "มอส • Admin" + 1234 ในหน้าแรก → เป็น Admin · Pick "มอส • Admin" and type 1234. Or `GET /rest/v1/app_state?select=league` and read every PIN. If anyone reused a real PIN (e.g. their ATM PIN), it was public.

**วิธีแก้ / Fix:**
- **ในPR นี้ / in this PR (client):**
  - หลังล็อกอินด้วย 1234 หรือบัญชีที่ยังเป็น PIN แบบเก่า ระบบบังคับตั้ง PIN ใหม่ 4–6 หลัก (ห้าม 1234, เลขซ้ำ, เลขเรียง) ถ้ากดยกเลิกจะถูกออกจากระบบ ถ้าบันทึกไม่ได้ (offline) ใช้งานต่อได้และจะถามอีกครั้ง · After logging in with 1234 (or any account still on a plaintext PIN), the user must set a new 4–6 digit PIN (not 1234, not repeated, not a sequence). Cancelling logs out. If saving fails (offline) they can continue and are asked again later, so an outage never locks anyone out.
  - มี "เปลี่ยน PIN" ในหมวดบัญชีของเมนู (ทุกหน้า) · A "เปลี่ยน PIN" item in the account section of the เมนู drawer, on every page.
  - PIN ใหม่เก็บเป็น `pinHash = "pbkdf2-sha256$150000$<salt>$<hash>"` (PBKDF2-SHA256, salt สุ่ม 16 ไบต์ต่อบัญชี, WebCrypto) และลบฟิลด์ `pin` ออก PIN ที่พิมพ์ไม่ถูกเก็บที่ไหนเลย · New PINs are stored as salted PBKDF2-SHA256 (150k iterations, random 16-byte salt per account) and the plaintext `pin` field is deleted. The typed PIN is never stored anywhere.
  - Admin "รีเซ็ต PIN" ตั้งกลับเป็น 1234 พร้อม `mustChangePin: true` · Admin reset sets 1234 and `mustChangePin: true`.
  - ปลอดภัยต่อการ deploy: บัญชีเก่ายังล็อกอินด้วย 1234 ได้ (ต้องเปลี่ยน `?v=` ของไฟล์ที่แก้และ `CACHE` ใน `sw.js` ก่อน deploy) · Backward compatible: existing accounts still log in with 1234 and are then asked to change it (bump `?v=` of the edited files and `sw.js` `CACHE` before deploying).
- **ข้อจำกัดที่ต้องรู้ / Honest limit:** hash ยังอยู่ในแถวที่ใครก็อ่านได้ PIN 4–6 หลักมีแค่ 10⁴–10⁶ แบบ จึงยัง brute-force แบบ offline ได้ (นาทีถึงชั่วโมงบน GPU) hash แค่ทำให้ "อ่าน PIN ออกมาตรง ๆ" ไม่ได้อีก และ salt ทำให้ PIN เดียวกันของคนละคนดูไม่เหมือนกัน · The hash still sits in a world-readable row and a 4–6 digit PIN has only 10⁴–10⁶ values, so it can still be brute-forced offline in minutes to hours. Hashing only stops PINs being read off directly and hides reuse between accounts.
- **Phase 2:** ย้าย credential ไปตาราง `private.credentials` (bcrypt, อ่านจาก API ไม่ได้), ตรวจ PIN ใน `pp_login` ฝั่ง server, ลบ `pin`/`pinHash` ออกจากแถวสาธารณะ hash PBKDF2 จาก PR นี้ตรวจได้ฝั่ง server (`private.pbkdf2_sha256_hex`, ทดสอบแล้วว่าตรงกับ JS) และถูกแปลงเป็น bcrypt ตอนล็อกอินครั้งแรก จึงไม่ต้องให้ทุกคนตั้ง PIN ใหม่อีกรอบ · Credentials move to `private.credentials` (bcrypt, invisible to the API) and are checked in `pp_login`; `pin`/`pinHash` are stripped from the public row. The PBKDF2 hashes written by this PR are verified server-side (tested to match the JS output) and upgraded to bcrypt on first login, so nobody has to change their PIN twice.

## S3 — Session ปลอมได้ · Forgeable session — **High**

**TH:** "ล็อกอิน" = `localStorage.pp_user_id = <id>` เท่านั้น id ของทุกบัญชีอยู่ในแถวที่อ่านได้ ใครก็พิมพ์ใน DevTools ว่า `localStorage.setItem("pp_user_id","<id ของ มอส>")` แล้วรีเฟรช ก็เป็น Admin ในเบราว์เซอร์นั้น ไม่ต้องรู้ PIN (PIN hash ใน PR นี้แก้ข้อนี้ไม่ได้)

**EN:** Being logged in means `localStorage.pp_user_id` holds an account id, and every id is in the readable row. Setting it to the admin's id in DevTools makes that browser the admin, with no PIN. Hashing PINs does not change this.

**วิธีแก้ / Fix (phase 2):** `pp_login` คืน session token สุ่ม 32 ไบต์ (เก็บแค่ SHA-256 ฝั่ง server, หมดอายุ 30 วัน) ทุก RPC ที่เขียนข้อมูลรับ token และหา user จาก token เอง เมื่อ S1/S4 แก้แล้ว การปลอม `pp_user_id` จะได้แค่หน้าจอ Admin ปลอมที่บันทึกอะไรไม่ได้ · `pp_login` returns a random 32-byte token (only its SHA-256 is stored, 30-day expiry). Every write RPC takes the token and derives the user from it. Once direct writes are revoked, a forged `pp_user_id` only shows a fake admin screen that cannot save anything.

## S4 — สิทธิ์ตรวจในเบราว์เซอร์อย่างเดียว · Browser-only authorization — **High**

**TH:** การกระทำต่อไปนี้ตรวจด้วย `isAdmin()` / `isDealer()` ฝั่ง client เท่านั้น: กรอก/ล้างคะแนน, เปลี่ยนรายชื่อ Season, จบ Season, Restore, สร้าง/ปิด/เปลี่ยนชื่อบัญชี, รีเซ็ต PIN, ตั้งเจ้ามือ, เปิด/ปิดตลาด, ตั้งราคาต่อ, คำนวณผลทาย การ PATCH ตรง (S1) หรือปลอม session (S3) ข้ามได้ทั้งหมด รวมถึงตั้ง `role: "admin"` ให้ตัวเอง หรือแก้ `bets[*].stake` / `status` ของคนอื่น

**EN:** Score entry and clearing, roster changes, finishing a season, restores, account create/disable/rename, PIN reset, dealer appointment, opening and closing markets, handicaps and settlement are all gated only by `isAdmin()` / `isDealer()` in the browser. A direct PATCH (S1) or forged session (S3) bypasses all of them, including setting your own `role` to `"admin"` or editing other players' bets.

**วิธีแก้ / Fix (phase 2):** `pp_save_league` (Admin เท่านั้น, ตัดฟิลด์ credential ทิ้ง, optimistic lock ด้วย `updated_at` แบบเดิม) และ `pp_save_predictions` (ผู้เล่นทั่วไปได้แค่ "เพิ่ม bet ในชื่อตัวเอง", แก้ตลาด/bet เดิมได้เฉพาะเจ้ามือหรือ Admin, เปลี่ยนเจ้ามือได้เฉพาะ Admin) จากนั้น `revoke update on public.app_state from anon, authenticated` ทดสอบแล้วในเครื่อง: ผู้เล่นบันทึกลีก/ทายแทนคนอื่น/ปิดตลาด/ลบ bet/ตั้งตัวเองเป็นเจ้ามือ ถูกปฏิเสธ · `pp_save_league` (admin only, strips credential fields, same `updated_at` optimistic lock) and `pp_save_predictions` (players may only append bets in their own name; markets and existing bets only by the dealer or an admin; only an admin changes the dealer), then revoke direct `UPDATE`. Tested locally: a player saving the league, betting as someone else, closing a market, deleting a bet or making themselves dealer is refused.

## S5 — Lockout ข้ามได้ · Bypassable lockout — **Medium**

**TH:** ผิด 5 ครั้ง ล็อก 60 วินาที แต่เก็บใน `localStorage` ของเครื่องนั้น ลบ storage / เปิด private window ก็หาย และไม่จำเป็นด้วยซ้ำเพราะอ่าน PIN ได้ (S2) เดิม UI ไม่บอกว่าถูกล็อก (ขึ้น "PIN ไม่ถูกต้อง" แม้ใส่ถูก)

**EN:** 5 failures → 60 s lock, stored in that browser's `localStorage`; clearing storage or a private window resets it, and it is moot while PINs are readable. The UI also did not say the account was locked.

**วิธีแก้ / Fix:** PR นี้แสดง "ใส่ PIN ผิดหลายครั้ง • ลองใหม่ใน N วินาที" · This PR shows the remaining lock time. Phase 2 `pp_login`: server-side 5 failures → 15 min per account, plus 30 attempts / 10 min per IP; failures are returned (not raised) so the counters commit.

## S6 — ไม่มีประวัติฝั่ง server · No server-side history — **Medium**

**TH:** `auditLog` อยู่ในแถวเดียวกับข้อมูลที่ใครก็เขียนได้ ผู้โจมตีลบร่องรอยได้ Backup อยู่ใน localStorage ของแต่ละเครื่องเท่านั้น

**EN:** `auditLog` lives inside the same writable row, so an attacker can erase it. Backups exist only in individual browsers.

**วิธีแก้ / Fix (phase 1, in this PR):** `private.app_state_history` เก็บค่าก่อนหน้าของคอลัมน์ที่เปลี่ยนทุกครั้งที่มีการ UPDATE/DELETE ของแถว `main` พร้อมเวลา, role, IP, user-agent เก็บ 100 เวอร์ชันล่าสุด + เวอร์ชันแรกของแต่ละวันย้อนหลัง 14 วัน (การยิงขยะรัว ๆ จึงดันจุดกู้คืนรายวันออกไม่ได้) `anon` อ่าน/แก้/ลบไม่ได้ แถว `live` ไม่เก็บประวัติ · Every UPDATE/DELETE of `'main'` stores the previous value of each changed column with time, role, IP and user agent: the newest 100 versions plus the first of each day (Bangkok time) for 14 days, so a burst of junk writes cannot push out the daily restore points. anon cannot read, modify or delete it. `'live'` is not recorded. (The draft kept 500 full versions; with profile pictures in the row a version can be ~1 MB, which would have meant ~500 MB, the whole free-tier database.)

## S7 — ไม่จำกัดขนาด/รูปแบบ · No size or shape limit — **Medium**

**TH:** ทุกหน้าที่เปิดอยู่ดึงทั้งแถวทุก 3 วินาที (`pullCloud`, `pull`) ถ้ามีคนยัด JSON 20 MB เข้าไป ทุกคนที่เปิดเว็บจะโหลด 20 MB ทุก 3 วิ ทั้งมือถือค้างและโควตา egress ของ Supabase หมดเร็ว และ JSON ผิดรูป (เช่น `rounds: null`) ทำให้หน้าเว็บพังสำหรับทุกคน

**EN:** Every open page re-downloads the whole row every 3 s. A 20 MB payload means every visitor pulls 20 MB every 3 s: phones stall and the project's egress quota drains. Malformed JSON (e.g. `rounds: null`) breaks the page for everyone.

**วิธีแก้ / Fix (phase 1, in this PR):** จำกัดขนาด + ตรวจรูปแบบหลักใน guard trigger (ดู S1) · Size limits and shape checks in the guard trigger (see S1). Later, optionally poll a cheap `updated_at`-only request before fetching the full row.

## S8 — ทุกฟิลด์คือ input ของผู้โจมตี · Every field is attacker input — **Medium**

**TH:** เพราะใครก็เขียนแถวได้ ทุกค่าที่ render (ชื่อ, id, คะแนน, เหตุผล backup ฯลฯ) ต้อง escape หมด ถ้าหลุดจุดเดียวคือ stored XSS ที่รันในเครื่องทุกคน `QA_REPORT.md` §6 (X1) เคยลิสต์จุดที่ยังไม่ escape ไว้ ตรวจแบบสุ่มบน `main` ตอนนี้พบว่าจุดหลัก (stats, recovery, predictions profile) escape แล้ว แต่ยังไม่ได้ตรวจครบทุกจุดใน review นี้ และไม่มี Content-Security-Policy

**EN:** Since anyone can write the row, every rendered value must be escaped; one miss is stored XSS for every visitor. `QA_REPORT.md` §6 (X1) listed unescaped sinks; a spot check of current `main` shows the main ones (stats, recovery, predictions profile) are now escaped, but this review did not re-audit every sink, and there is no CSP.

**วิธีแก้ / Fix:** (1) ไล่ตาม X1 ให้ครบและเพิ่มเทสต์ด้วยชื่อแบบ `<img src=x onerror=alert(1)>` (2) เพิ่ม `<meta http-equiv="Content-Security-Policy">` เช่น `default-src 'self'; script-src 'self'; connect-src 'self' https://<project>.supabase.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:` ต้องทดสอบทุกหน้าก่อน (มี inline style และการพิมพ์ PDF ผ่าน `document.write`) จึงไม่ได้ใส่ใน PR นี้ · Finish the X1 list with tests that use a hostile display name, and add a CSP like the above. It needs testing on every page first (inline styles, the print/PDF window), so it is not in this PR.

## S9 — สำเนาในเครื่องมี PIN ของทุกคน · Local copies hold everyone's PIN — **Low**

**TH:** `pp_league_v7_uid`, `pp_backup_center_v1` (30 ชุด) และ `pp_conflict_draft_v1` เก็บทั้งลีกรวม `profiles[*].pin` ไว้ในทุกเครื่องที่เคยเปิดเว็บ และหน้า Backup แสดง JSON ทั้งก้อน หลัง PR นี้ PIN ที่ตั้งใหม่จะเป็น hash (บัญชีที่ยังไม่เปลี่ยนมีแค่ 1234 ซึ่งเป็นค่าสาธารณะอยู่แล้ว) Backup เก่าในเครื่องยังมี PIN เดิมอยู่จนกว่าจะถูกแทนที่ (เก็บแค่ 30 ชุดล่าสุด) · The local league copy, up to 30 local backups and the conflict draft hold the full league, including PINs, on every device that opened the site, and the Backup page shows the JSON. After this PR, chosen PINs are stored only as hashes (unchanged accounts hold the public default 1234). Older local backups keep old values until rotated out (30 kept).

**Phase 2:** credential ไม่อยู่ในแถวสาธารณะอีก จึงไม่ถูกคัดลอกลงเครื่อง · Credentials leave the public row, so they are no longer copied to devices.

## S10 — Restore ย้อน PIN กลับ · Restore rolled PINs back — **Low**

**TH:** "กู้ทั้ง Season" เขียน profiles จาก backup ทับทั้งก้อน PIN ที่เพิ่งเปลี่ยนจะกลับเป็นค่าเก่า (QA B2) · A full restore overwrote profiles with the backup's, reverting changed PINs (QA B2).

**Fix (this PR):** `LeagueShared.keepCredentials` ทำให้ทุกการเขียนลีก (Backup restore, sync-guard) ใช้ฟิลด์ PIN จากข้อมูลล่าสุดบน cloud เสมอ PIN เปลี่ยนได้ทางเดียวคือ `changePin` / Admin reset · Every league write (backup restore, sync-guard) now takes the PIN fields from the latest cloud copy; PINs change only through `changePin` or an admin reset. Role/active rollback on full restore is still QA B2.

## เพดานของ phase 1 / Phase 1 limits

ตรวจกับโค้ดปัจจุบันบน `main` (ตุลาคม 2026) แล้วปรับจากร่างแรก · Checked against current `main` and raised from the first draft:

| | ร่างแรก / Draft | ตอนนี้ / Now | เหตุผล / Why |
|---|---|---|---|
| `main` league | 2 MB | **5 MB** | รูปโปรไฟล์อยู่ในแถวเป็น data URL: avatar ≤ 12 KB, banner ≤ 40 KB (กรณีอัปโหลดขึ้น bucket ไม่ได้), QR ≤ 20 KB → ~72 KB/คน ลีก 12 คน + 30 Season (`rankHistory` + `seasonArchives`) + `auditLog` 200 รายการ วัดได้ ~1.03 MB แล้ว 2 MB เหลือที่ไม่พอเมื่อเพิ่มคนหรือ Season · Pictures are data URLs in the row (~72 KB a player at most). A synthetic 12-player league with every picture at its cap, 30 finished seasons and 200 audit entries measured 1.03 MB; 2 MB left too little headroom. |
| `main` predictions | 1 MB | **2 MB** | bet เก็บตลอดไป (~200 B ต่อ bet) · Bets are kept forever. |
| `main` dummy | — | **1 MB** | คอลัมน์ใหม่ของหน้าดัมมี่ · New Dummy column (was not size-checked, and not even writable under the draft's column grant). |
| `main` rate | 90/min | **300/min** | กรอกคะแนน (debounce 400 ms), ทายผล, ดัมมี่ (เขียนบ่อยและเป็นแถวเดียวกัน), แก้โปรไฟล์ และ retry สูงสุด `LOCK_TRIES = 6` ครั้งต่อการบันทึก (PATCH ที่แพ้ optimistic lock ไม่โดนนับเพราะไม่ match แถว) และเผื่อ live scoring ถ้าเขียนลงแถวนี้ · Score entry, predictions, Dummy saves (frequent, same row), profile saves and up to 6 lock retries per save (a lost-race PATCH matches no row and is not counted), with room for live scoring if it ever writes here. |
| `live` size | — | **64 KB** | เฉพาะคะแนนสดของแมตช์ที่กำลังแข่ง · Live scores of matches in progress only. |
| `live` rate | — | **600/min** | ~1 write / 2 s ต่อเครื่องที่กรอก = 30/min ต่อเครื่อง · ~30/min per scoring device, room for many devices. |

Rate limit เป็นหน้าต่างคงที่ 1 นาทีต่อแถว (`private.app_state_rate`) แทนการนับจากตารางประวัติ เพราะแถว `live` ไม่มีประวัติ และการบันทึกที่ไม่เปลี่ยนข้อมูลก็ไม่สร้างประวัติ · The rate limit is a fixed one-minute window per row in `private.app_state_rate`, not a count of history rows, because `'live'` has no history and a no-op save records none.

ไม่ถูกบล็อก (ทดสอบแล้ว) / Not refused (tested): score save, stale-lock PATCH (no row), Dummy save, new bet, profile banner change (40 KB), PIN change, admin PIN reset, finish season (archive + rank history append, results cleared), clear scores, full restore of a backup two seasons older. **ถูกบล็อกโดยตั้งใจ / Refused by design:** a full restore of a backup that would drop more than half of `rankHistory`/`seasonArchives` (owner restores those with `private.restore_app_state` instead).

---

## สิ่งที่ PR นี้เปลี่ยน / What this PR changes

| ไฟล์ / File | การเปลี่ยนแปลง / Change |
|---|---|
| `shared.js` | `pinPolicyError`, `hashPin` (PBKDF2-SHA256 150k, salt สุ่ม), `verifyPin` (รับ hash ใหม่ + PIN แบบเก่า, ปฏิเสธ iteration ผิดปกติที่อาจถูกยัดมาให้มือถือค้าง / refuses tampered iteration counts), `setPin`, `resetPin`, `needsPinChange`, `keepCredentials`, `changePin` (อ่านล่าสุด → ตรวจ PIN เดิม → เขียนเฉพาะบัญชีนั้น ด้วย optimistic lock / re-read, verify, write only that account under the optimistic lock); `login` เป็น async |
| `pin-change.js`, `pin-change.css` | หน้าต่างตั้ง/เปลี่ยน PIN (บังคับหลังล็อกอินด้วย 1234 หรือเมื่อเปิดหน้าด้วย session เดิม) · PIN dialog, forced after a default-PIN login or on a restored session |
| `index.js`, `predictions.js` | `await` login, บอกเวลาที่ถูกล็อก, บังคับเปลี่ยน PIN · Async login, lock message, forced PIN change |
| `sport-ui.js` | "เปลี่ยน PIN" ในหมวดบัญชีของเมนู (ทุกหน้า) · "เปลี่ยน PIN" in the account section of the เมนู drawer, on every page |
| `admin.js` | รีเซ็ต/สร้างบัญชี → 1234 + `mustChangePin` · Reset/create sets 1234 + `mustChangePin` |
| `backup.js`, `sync-guard.js` | `keepCredentials` ก่อน PATCH · `keepCredentials` before PATCH |
| `*.html` | เพิ่ม `pin-change.js` / `pin-change.css` ทุกหน้า · `pin-change.js` / `pin-change.css` on every page |
| `tests/pin.test.cjs` | 9 tests: policy, salt, verify, tampered hash, setPin/resetPin, login + lockout + nothing stored, changePin (wrong PIN, writes only a hash, retries a lost race, gives up cleanly after `LOCK_TRIES`), keepCredentials |
| `supabase/migrations/20261018130000_harden_shared_state.sql` | Phase 1 (ใช้ได้ทันที / safe now) |
| `supabase/proposed/phase2_server_side_auth.sql` | Phase 2 draft (อยู่นอก `migrations/` โดยตั้งใจ / deliberately outside `migrations/`) |

ทดสอบ / Verified: `npm test` · Browser smoke test with Playwright against a mocked Supabase row (see the PR). Phase 1 SQL on local Postgres 16 with Supabase-style roles (`anon` via `authenticator`), on a synthetic 1.03 MB league: every save in "Phase 1 limits" passes; wipe, mass account / archive / rank-history / bet deletion, oversized league / dummy / live payloads, INSERT, DELETE and `id` changes are refused; anon cannot read history or call the restore function; the 301st `main` write and the 601st `live` write in a minute are refused; `live` writes leave no history; the owner restores the row to an earlier point (columns that write did not touch come from later entries); re-running the file is safe; the phase 2 draft still applies on top. **Nothing was run against the real Supabase project.**

---

## สิ่งที่เจ้าของต้องทำ / What the owner must do

### A. Phase 1 SQL (แนะนำให้ทำเลย / recommended now)

ลำดับกับการ merge PR ไม่สำคัญ: เว็บทำงานได้ทั้งก่อนและหลังรัน SQL · Order relative to merging the PR does not matter; the site works with or without it.

1. **Supabase Dashboard → SQL Editor** ตรวจขนาดข้อมูลปัจจุบัน (ต้องต่ำกว่า 5,000,000 / 2,000,000 / 1,000,000 ไบต์มาก ถ้าใกล้ให้เพิ่มตัวเลขในไฟล์ migration ก่อน) และต้องมีคอลัมน์ `dummy` แล้ว (ไฟล์นี้เพิ่มให้ถ้ายังไม่มี) · Check current sizes; they must be well under the limits, otherwise raise them in the file first:
   ```sql
   select id, octet_length(league::text) as league_bytes, octet_length(predictions::text) as predictions_bytes,
          octet_length(dummy::text) as dummy_bytes
   from public.app_state;
   ```
2. สำรองแถวไว้ใน schema `private` (**ห้ามสร้างตาราง backup ใน `public`** เพราะ Supabase จะเปิดให้ `anon` อ่าน/เขียนได้) · Back up the row into the `private` schema (**never** into `public`, which the API exposes):
   ```sql
   create schema if not exists private;
   revoke all on schema private from public, anon, authenticated;
   create table private.app_state_backup_20261017 as select * from public.app_state;
   ```
3. เปิดไฟล์ `supabase/migrations/20261018130000_harden_shared_state.sql` คัดลอกทั้งไฟล์ไปวางใน SQL Editor แล้วกด **Run** (หรือ `supabase db push` ถ้าใช้ CLI ที่ link โปรเจกต์ไว้) · Paste the whole file into the SQL Editor and **Run** (or `supabase db push` with a linked CLI).
4. **Settings → API (Data API) → Exposed schemas** ต้องมีแค่ `public` (และ `graphql_public`) **ห้ามเพิ่ม `private`** · Make sure `private` is not in the exposed schemas.
5. ทดสอบบนเว็บจริง: กรอกคะแนน 1 คู่ และทาย 1 ครั้ง ต้องขึ้น "บันทึกแล้ว" แล้วตรวจว่ามีประวัติ · On the live site, save one score and one bet, then check:
   ```sql
   select history_id, changed_at, db_role, client_ip from private.app_state_history order by history_id desc limit 5;
   ```
6. ถ้ามีปัญหา ใช้บล็อก "Rollback" ท้ายไฟล์ migration · If anything goes wrong, run the rollback block at the end of the migration file.

**กู้คืนเมื่อโดนป่วน / Restoring after vandalism:**
```sql
select history_id, changed_at, db_role, client_ip, octet_length(league::text) as league_bytes,
       predictions is not null as predictions_changed, dummy is not null as dummy_changed
from private.app_state_history order by history_id desc limit 50;
-- กลับไปเป็นสภาพ "ก่อน" write ที่เลือก / puts the row back to how it was just before that write
select private.restore_app_state(<history_id ของเวอร์ชันที่ดี / of the good version>);
```

### B. Merge PR นี้ / Merge this PR

ทุกคนที่ยังใช้ 1234 จะถูกให้ตั้ง PIN ใหม่ตอนล็อกอินหรือเปิดหน้าครั้งถัดไป ควรให้ Admin (มอส) ตั้งก่อน แล้วแจ้งกลุ่ม · Everyone still on 1234 is asked to set a new PIN at their next login or page load. The admin should go first, then tell the group. ใครลืม PIN ให้ Admin กด "รีเซ็ต PIN" · Forgotten PINs: admin reset.

### C. Phase 2 — ดู "Phase 2 (shipped)" ด้านล่าง / see "Phase 2 (shipped)" below

*(The plan below is kept for history; the shipped version differs: Dummy, live and club writes are RPCs too, and the cut-over is a single switch.)*

ทำใน PR แยก / In a separate PR:
1. Client: login ผ่าน `POST /rest/v1/rpc/pp_login` เก็บ token (ไม่ใช่ PIN) ใน localStorage; เปลี่ยน PIN ผ่าน `pp_change_pin`; รีเซ็ตผ่าน `pp_reset_pin`; บันทึกลีกผ่าน `pp_save_league(token, league, expected_updated_at)` และทายผ่าน `pp_save_predictions(...)` (คืน `null` เมื่อชนกับอีกเครื่อง เหมือน PATCH ว่างในปัจจุบัน); logout เรียก `pp_logout` · Log in via `pp_login` and keep the token (not the PIN); route PIN change/reset and both saves through the RPCs (`null` means another device saved first, like today's empty PATCH result); logout calls `pp_logout`.
2. SQL Editor: รันไฟล์ `supabase/proposed/phase2_server_side_auth.sql` (ทำแค่ section A + C ซึ่งไม่กระทบเว็บเดิม) แล้วทดสอบเว็บเวอร์ชันใหม่ · Run the file (applies only sections A and C, harmless to the current site) and test the new client.
3. Cut-over: deploy เว็บใหม่ แล้วรัน section B (copy PIN → `private.credentials`, ลบ PIN ออกจากแถว) และ D (`revoke update ... from anon, authenticated`) ในครั้งเดียวกัน · Deploy the new client, then run sections B and D together. **Section D must then re-grant what still writes directly:** `grant update (dummy) on public.app_state to anon, authenticated;` for the Dummy page, and keep an update policy for `'live'` (or move both behind RPCs too), otherwise Dummy and live scoring stop saving.

ทดสอบแล้วในเครื่อง / Tested locally: login with a 1234 account and with a PBKDF2 hash from this PR (upgraded to bcrypt on success), wrong PIN, lockout after 5 failures (900 s), PIN change and policy, admin-only league save with optimistic lock, credential fields stripped on save, new accounts get default credentials, player bet rules, direct `PATCH` refused after cut-over, `private.credentials` unreadable by anon.

### หมายเหตุ / Notes

- Publishable key ใน `shared.js` ตั้งใจให้เป็นสาธารณะ การ rotate key ไม่ช่วย ความปลอดภัยต้องมาจาก RLS / grants / RPC · The publishable key is public by design; rotating it does not help.
- ระหว่างนี้ ควรถือว่า PIN เดิมทุกตัวรั่วแล้ว (อ่านได้จาก API มาตลอด) ใครเคยใช้ PIN จริง (เช่น PIN ATM) ควรเปลี่ยนที่อื่นด้วย · Treat every existing PIN as already leaked; anyone who reused a real PIN elsewhere should change it there.
- เว็บนี้บันทึกแค่ "ยอด" ไม่ได้รับ/จ่ายเงินจริง แต่ยอดทายถูกแก้ได้จนกว่าจะทำ phase 2 · Bet amounts can be edited by anyone until phase 2.

---

## Phase 2 (shipped) — server-side auth and authorization

ไฟล์ / Files: `supabase/migrations/20261019140000_server_auth.sql`, `shared.js`, `pin-change.js` (re-login dialog), `dummy.js` (one status message), `tests/server-auth-client.test.cjs`, `tests/server-auth-sql.test.cjs`, owner guide `docs/security-phase2.md` (TH).

### Design

- **Credentials** move to `private.credentials` (bcrypt; the browser's PBKDF2 hashes are verified server-side and upgraded on first login). The migration imports every account's PIN / hash from the row; while `enforce` is off an `AFTER UPDATE` trigger keeps importing PIN changes the old site writes (only when that profile's pin fields changed, `row_fp`), so the old and new site can run side by side.
- **Sessions**: `pp_login(user_id, pin)` → `{token, must_change, expires_at}` (32 random bytes; only the SHA-256 is stored; 30 days). Failures are returned, not raised, so counters commit: 5 wrong PINs → 15 min lock per account, 30 attempts / 10 min per IP. Also `pp_logout`, `pp_whoami(token)` (never raises), `pp_change_pin(token, current, new)` (counts wrong PINs toward the lock, signs out the account's other devices), `pp_reset_pin(token, target)` (admin), `pp_auth_version()` (the client's probe).
- **Writes**: `pp_save_league(token, league, expected)`, `pp_save_predictions(token, predictions, expected)`, `pp_save_live(token, live, expected)`, `pp_save_club(token, club, expected)` lock the row, return `null` when `updated_at <> expected` (same as today's empty PATCH result) or the new `updated_at`; `pp_save_dummy(token, dummy, expected_rev)` keeps Dummy's own `dummy.rev` lock and never touches `updated_at`. Phase 1's guard (size, shape, rate limit) and history still run on every RPC write.
- **The switch** `private.settings.enforce` (default `false`). `update private.settings set enforce = true` (trigger) imports the last PIN changes, strips `pin / pinHash / mustChangePin / pinChangedAt` from the row, and revokes `UPDATE` on `public.app_state` from `anon, authenticated` (SELECT stays). A `BEFORE UPDATE` guard additionally refuses any API write that is not inside a `pp_save_*` call and any league write carrying credential fields while enforced, so re-running the phase 1 file (which re-grants UPDATE) does not reopen direct writes. `enforce = false` re-grants phase 1's column UPDATE (rollback).
- **Admin PIN reset through the league save**: `LeagueShared.resetPin` now also sets `profiles[id].pinResetAt`; `pp_save_league` resets that account's credentials when an admin save changes it (so `admin.js` is unchanged). `pinResetAt` is carried by `keepCredentials`, so restoring a backup never re-triggers a reset. Accounts created by an admin save get default credentials (1234, must change).

### Authorization rules (enforced in `private.*_change_denied`)

| Data | Admin | Dealer | Player (signed in, active) |
|---|---|---|---|
| league (`uidLeague`) | anything (phase 1 shape guard) | — | own `displayName` (≤ 30, unique), `tagline`, `avatar`, `avatarHd`, `banner`, `promptpay`, `payQr` (own profile ≤ 200 KB); may prepend ≤ 5 `auditLog` entries with own `actorId`; nothing else |
| predictions | anything | everything except `dealerId`; existing bets only `status / net / settledAt`; no removals; cannot bet | append only: `userId` = self, `pending`, `net` 0, whole stake 1..1,000,000, market `open` with matching favorite/handicap, not own match, once per match |
| dummy | ✓ | ✓ | any signed-in account (shared sheet) |
| live | anything | — | add/change/remove a match only as one of its `pair` or its scorer `by`; remove anyone's entry older than 6 h (live.js prunes those); only `{matches}` |
| club | anything (1 MB cap) | — | `matches` / `challenges` / `tournaments`: new items must have self as owner (`by` / `from` / `by`); change/remove only items where self is owner or participant (`a`, `b`, `to`, `teamA`, `teamB`, `entrants`); `from` of a challenge and `by` of a tournament cannot change (`club.matches[].by` means "last recorded by" and may); a `club.matches` entry with a `tournamentId` may also be changed/removed by that tournament's creator or entrants (tournament.js rewrites and prunes them); `social.reactions`, `mvp`, `checkin`: own user key only (whole check-in days older than 29 days may be pruned by anyone, as social.js does); `social.comments`: own only (others' may drop off the 300 cap); other keys: signed-in + 1 MB cap |

**Live: why players of the match, not "any signed-in player"**: live.js only lets the admin or the two players start scoring, and it is cheap to check per key (`pair` / `by` are in each entry), so the stricter rule costs nothing. Watchers never write.

### Client (`shared.js`, `?v=20261019-sec2`)

- `serverAuth()` probes `pp_auth_version` once, caches `{available, enforce}` 10 minutes (memory + `localStorage.pp_server_auth_v1`; network errors retried after 30 s). Without the functions every path is exactly the old code.
- `login()` calls `pp_login` and stores `{token, userId, mustChange, expiresAt}` in `localStorage.pp_session_v2` beside `pp_user_id`; a server lockout fills the local guard so the existing "ลองใหม่ใน N วินาที" message works. If the server cannot be reached it falls back to the in-browser hash check (a local session that cannot save). `logout()` calls `pp_logout`.
- Every write already goes through `cloudRequest` / `liveRequest` / `clubRequest` (`clubMutate`) / `saveDummyCloud`; a PATCH there is turned into the matching `pp_save_*` call with the token and the `updated_at=eq.` (or `dummy->>rev`) lock parsed from the filter, and answers like the PATCH did (`[row]` saved, `[]` lost race), so every page's retry loop, and the club / live code other branches are adding, work unchanged. PIN secrets are stripped from league payloads. A body no RPC covers falls back to the PATCH. A 404 (functions dropped) falls back to the PATCH and re-caches "unavailable".
- No token or `session expired` → `PinChange.relogin` asks for the PIN (same card style as the PIN dialog) and retries once; cancelling throws `authRequired` (pages show their usual "บันทึกไม่ได้ / ออฟไลน์" state). Refusals throw `denied` with "ไม่มีสิทธิ์ทำรายการนี้ (…)".
- `changePin` uses `pp_change_pin` (signing in with the current PIN first when needed); `needsPinChange` uses the server's `must_change` from the session once server auth is on or the row has no PIN fields, so stripping the row never forces everyone to change PIN.

### Verified

- `npm test` (all pass): `tests/server-auth-client.test.cjs` (9 tests, mocked fetch: RPC absent vs present, token handling, conflict `[]`, dummy rev lock, live, club retry, expired session → re-login → retry, cancel, denied, 404 fallback, server `changePin`, `needsPinChange`, `pinResetAt`); `tests/server-auth-sql.test.cjs` runs every migration except the storage bucket one (incl. push) plus this one (twice) on a scratch Postgres 16 with `anon / authenticated / service_role / authenticator` and exercises every RPC including denials: wrong PIN, inactive account, lockout and unlock, per-IP throttle, PBKDF2 (150k) → bcrypt upgrade, whoami, logout, expired token, player editing another profile / role / results / audit log / `pinResetAt`, duplicate name, admin reset + new account, PIN change policy and other-device sign-out, bet in another name / bad stake / closed market / own match / twice, dealer betting or editing stakes, non-admin dealer change, dummy rev lock, live other players' match, club ownership rules (incl. a tournament entrant recording a result / pruning downstream entries, a non-entrant refused, check-in day pruning), 1 MB cap, push RPCs still working with enforce on, old-site PIN change imported while off, enforce on (row stripped, direct UPDATE refused on main and live, RPCs and sessions keep working, credentials never land in the row, re-running phase 1 still refused by the guard), enforce off restores direct PATCH. Skipped automatically where Postgres server binaries are missing or a scratch cluster cannot start.
- Playwright (Chromium, mocked `rest/v1/rpc/**` and `rest/v1/app_state**`): RPC mode — login → token, score save via `pp_save_league` with no PIN hash sent, profile edit via RPC, Dummy via `pp_save_dummy`, expired session → PIN prompt (wrong PIN message, then saved); legacy mode (functions 404) — hash login, PATCH saves exactly as before; 9 pages (incl. tournament.html) with no console or page errors (the only log is Chrome's "404" line for the probe when the functions are not installed, once per 10 minutes).
- **Not run against the real Supabase project.** A bug the SQL test caught during development: a PIN check returning SQL `NULL` (no legacy hash) passed `if not ...`; `private.verify_pin` now never returns `NULL`.

### Residual risks

- Until `enforce = true`, phase 1 limits apply (anyone with the key can still write small changes, including a `pinHash` that is then imported). Flip it as soon as the people who write have signed in again.
- The admin account can do anything; its PIN is the crown jewel (4–6 digits, online guessing limited by the lockout).
- Club: unknown top-level keys only get "signed-in + 1 MB"; tournament entrants may edit their tournament's bracket. New club features should add a rule to `private.club_change_denied`.
- Predictions: the server does not check whether a match already has a result when a bet is placed (the dealer closes markets, as today).
- Dummy is one shared sheet: any signed-in account may change it (history in `private.app_state_history` allows restore).
- The publishable key can still read the whole row (by design): profile pictures, payment details, bets.
- Web Push (`20261019130000_push.sql`) is unaffected by the switch (it does not write `app_state`), but `pp_push_subscribe(…, p_user_id)` trusts the user id it is given, so a device can subscribe to someone else's notifications. A follow-up could take the session token instead.
- Verified on main after Elo/challenges, social, tournaments and push were merged: every write still goes through `cloudRequest` / `liveRequest` / `clubMutate` / `saveDummyCloud`.
