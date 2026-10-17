# Security Review — Ping Pong League

วันที่ / Date: 2026-10-17 · Branch: `security-review` · ขอบเขต / Scope: `shared.js`, `sync-guard.js`, `restore-guard.js`, `safety-hooks.js`, `index.js`, `predictions.js`, `admin.js`, `backup.js`, `supabase/migrations/*.sql`

> **สรุปสั้น (TH):** ใครก็ตามที่เปิดเว็บ (หรือแค่อ่าน `shared.js`) ใช้ publishable key เดียวกับเว็บ **อ่าน PIN ของทุกคน, แก้คะแนน/สิทธิ์/ยอดทาย, หรือล้างข้อมูลลีกทั้งแถวได้ทันที** โดยไม่ต้องล็อกอิน เพราะ RLS อนุญาตให้ `anon` `UPDATE` แถว `main` ได้ทั้งแถว และการตรวจ PIN/สิทธิ์ทั้งหมดอยู่ในเบราว์เซอร์ PR นี้ (1) บังคับเปลี่ยน PIN จาก 1234 และเก็บ PIN เป็น hash แทนข้อความ (2) เพิ่ม migration ที่ **ใช้กับเว็บปัจจุบันได้ทันทีโดยไม่พัง**: กันการล้าง/ยัดข้อมูลก้อนใหญ่, จำกัดความถี่การเขียน และเก็บประวัติทุกเวอร์ชันไว้ฝั่ง server ให้กู้คืนได้ (3) ร่าง SQL เฟส 2 ที่ย้ายการตรวจ PIN และสิทธิ์ไปไว้ฝั่ง server ซึ่งต้องทำคู่กับการแก้ฝั่งเว็บ
>
> **Summary (EN):** Anyone who opens the site (or just reads `shared.js`) can use the same publishable key to **read every PIN, change scores/roles/bets, or wipe the whole league row**, with no login, because RLS lets `anon` `UPDATE` the `main` row and every PIN and role check happens in the browser. This PR (1) forces a PIN change away from 1234 and stores PINs as salted hashes instead of plaintext, (2) adds a migration that is **safe to apply under the live site**: it blocks wipes and oversized writes, rate-limits writes, and keeps a server-side history of every previous version so vandalism can be undone, and (3) drafts phase-2 SQL that moves PIN and role checks to the server, to be shipped together with a client change.

## ตารางสรุป / Findings at a glance

| # | ระดับ / Severity | หัวข้อ / Finding | สถานะใน PR นี้ / Status in this PR |
|---|---|---|---|
| S1 | **Critical** | `anon` เขียนทับ/ล้างแถว `main` ได้ทั้งแถว · anon can overwrite or wipe the whole row | ลดความเสียหาย: phase 1 SQL (กันล้าง, ประวัติ, rate limit) · Mitigated by phase 1 SQL; fixed by phase 2 |
| S2 | **Critical** | PIN ทุกคนเป็น plaintext ในแถวที่ใครก็อ่านได้ และทุกบัญชีใช้ 1234 · All PINs are plaintext in a world-readable row, and all default to 1234 | แก้ฝั่ง client: hash + บังคับเปลี่ยน · Client fix (hash + forced change); full fix in phase 2 |
| S3 | **High** | Session คือ `pp_user_id` ใน localStorage ปลอมเป็น Admin ได้โดยไม่ต้องรู้ PIN · Session is just `pp_user_id`; anyone can impersonate the admin without a PIN | ต้องใช้ phase 2 · Needs phase 2 |
| S4 | **High** | สิทธิ์ Admin/เจ้ามือ ตรวจในเบราว์เซอร์อย่างเดียว · Admin/dealer permissions are enforced only in the browser | ต้องใช้ phase 2 · Needs phase 2 |
| S5 | **Medium** | Lockout อยู่ใน localStorage ข้ามได้ · Login lockout lives in localStorage and is trivially bypassed | ปรับ UX (บอกเวลาที่เหลือ) · UX fixed; real lockout in phase 2 |
| S6 | **Medium** | ไม่มีประวัติ/audit ฝั่ง server · No server-side history or audit; the audit log sits inside the writable row | แก้: phase 1 SQL · Fixed by phase 1 SQL |
| S7 | **Medium** | ไม่จำกัดขนาด/รูปแบบข้อมูล + ทุกหน้าดึงทั้งแถวทุก 3 วิ · No size/shape limit, and every open page re-downloads the whole row every 3 s | แก้: phase 1 SQL · Fixed by phase 1 SQL |
| S8 | **Medium** | ทุกฟิลด์ในแถวควบคุมได้โดยผู้โจมตี → XSS ถ้าหลุด escape จุดเดียว, ไม่มี CSP · Every field is attacker-controlled, so one missed escape is stored XSS for every visitor; no CSP | แนะนำ · Recommendation |
| S9 | **Low** | สำเนาในเครื่อง (localStorage, Backup) มี PIN ของทุกคน · Local copies and backups on every device hold everyone's PIN | แก้บางส่วน (เก็บเป็น hash) · Partly fixed (hashes, not PINs) |
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
- **Phase 1 (ในPR นี้ ใช้ได้ทันที / in this PR, safe now)** `supabase/migrations/20261017120000_harden_shared_state.sql`:
  - เลิกให้ `INSERT` และแก้ได้เฉพาะคอลัมน์ `league, predictions, updated_at` (เปลี่ยน `id` ไม่ได้) · Revoke `INSERT`; column-level `UPDATE` on `league, predictions, updated_at` only.
  - Trigger `private.app_state_guard` ปฏิเสธการเขียนจาก API ที่ล้างลีก (ต้องยังเป็นลีกที่มี `profiles`), ลบบัญชีเกินครึ่ง, ลบ `rankHistory` / `seasonArchives` / `bets` เกินครึ่งในครั้งเดียว, ขนาดเกิน 2 MB (league) / 1 MB (predictions) และเขียนเกิน 90 ครั้งต่อนาที · A guard trigger rejects API writes that wipe the league, drop more than half of the accounts / RP history / archives / bets in one write, exceed 2 MB / 1 MB, or exceed 90 writes per minute.
  - Trigger `private.app_state_record_history` เก็บเวอร์ชันก่อนหน้าทุกครั้ง (+ IP, user-agent) ใน `private.app_state_history` ที่ API มองไม่เห็น และ `private.restore_app_state(id)` ให้เจ้าของกู้คืนจาก SQL Editor · Every previous version is stored server-side (with IP and user agent) where the API cannot reach it, and the owner can restore any version from the SQL Editor.
  - ผ่านการทดสอบกับ Postgres 16 ในเครื่องด้วย role แบบ Supabase (anon / authenticated / authenticator / service_role): เขียนคะแนนปกติผ่าน, ล้างแถว/ลบบัญชี/ลบ bets/ยัด 2 MB ถูกปฏิเสธ, INSERT/DELETE/เปลี่ยน id ถูกปฏิเสธ, อ่านตารางประวัติไม่ได้, ครั้งที่ 91 ใน 1 นาทีถูกปฏิเสธ, owner กู้คืนได้ · Tested on local Postgres 16 with Supabase-style roles: normal score saves pass; wipe, mass account/bet deletion, a 2 MB payload, INSERT, DELETE and id changes are refused; anon cannot read the history; the 91st write in a minute is refused; the owner can restore.
  - **ข้อจำกัด / Limit:** ยังแก้ทีละนิดได้ (เช่น เปลี่ยน role ตัวเองเป็น admin, แก้คะแนนคู่เดียว) แต่ทุกครั้งถูกบันทึกและกู้คืนได้ · Small well-formed edits (make yourself admin, change one score) still pass; they are now recorded and reversible.
- **Phase 2 (ร่าง / draft)** `supabase/proposed/phase2_server_side_auth.sql`: เลิกให้ `anon` `UPDATE` ตรง ๆ ทั้งหมด การเขียนผ่าน RPC `SECURITY DEFINER` ที่ตรวจ session token + role ฝั่ง server · Revoke direct `UPDATE`; all writes go through `SECURITY DEFINER` RPCs that check a server-issued session token and the caller's role.

## S2 — PIN เป็น plaintext ที่ใครก็อ่านได้ และทุกคนใช้ 1234 · Plaintext PINs anyone can read, all set to 1234 — **Critical**

**TH:** `profiles[id].pin` เก็บเป็นข้อความธรรมดาใน `league` ที่ `anon` `SELECT` ได้ บัญชีใหม่และการรีเซ็ตตั้งเป็น `1234` และไม่มีหน้าให้ผู้เล่นเปลี่ยน PIN เอง ดังนั้นในทางปฏิบัติ PIN ของทุกบัญชี (รวม Admin "มอส") น่าจะเป็น 1234 การเทียบ PIN (`person.pin !== pin`) ทำในเบราว์เซอร์

**EN:** `profiles[id].pin` is plaintext inside the world-readable `league` column. New accounts and resets use `1234`, and there was no way for a player to change their own PIN, so in practice every account, the admin's included, is probably on 1234. The comparison happens in the browser.

**เส้นทางโจมตี / Attack path:** เลือกชื่อ "มอส • Admin" + 1234 ในหน้าแรก → เป็น Admin · Pick "มอส • Admin" and type 1234. Or `GET /rest/v1/app_state?select=league` and read every PIN. If anyone reused a real PIN (e.g. their ATM PIN), it was public.

**วิธีแก้ / Fix:**
- **ในPR นี้ / in this PR (client):**
  - หลังล็อกอินด้วย 1234 หรือบัญชีที่ยังเป็น PIN แบบเก่า ระบบบังคับตั้ง PIN ใหม่ 4–6 หลัก (ห้าม 1234, เลขซ้ำ, เลขเรียง) ถ้ากดยกเลิกจะถูกออกจากระบบ ถ้าบันทึกไม่ได้ (offline) ใช้งานต่อได้และจะถามอีกครั้ง · After logging in with 1234 (or any account still on a plaintext PIN), the user must set a new 4–6 digit PIN (not 1234, not repeated, not a sequence). Cancelling logs out. If saving fails (offline) they can continue and are asked again later, so an outage never locks anyone out.
  - มีปุ่ม "เปลี่ยน PIN" ในเมนูเครื่องมือของหน้าแรกและหน้าทายผล · A "เปลี่ยน PIN" button in the tools menu on the league and predictions pages.
  - PIN ใหม่เก็บเป็น `pinHash = "pbkdf2-sha256$150000$<salt>$<hash>"` (PBKDF2-SHA256, salt สุ่ม 16 ไบต์ต่อบัญชี, WebCrypto) และลบฟิลด์ `pin` ออก PIN ที่พิมพ์ไม่ถูกเก็บที่ไหนเลย · New PINs are stored as salted PBKDF2-SHA256 (150k iterations, random 16-byte salt per account) and the plaintext `pin` field is deleted. The typed PIN is never stored anywhere.
  - Admin "รีเซ็ต PIN" ตั้งกลับเป็น 1234 พร้อม `mustChangePin: true` · Admin reset sets 1234 and `mustChangePin: true`.
  - ปลอดภัยต่อการ deploy: บัญชีเก่ายังล็อกอินด้วย 1234 ได้, เวอร์ชันใน `?v=` ถูกเปลี่ยนแล้ว · Backward compatible: existing accounts still log in with 1234 and are then asked to change it; script versions are bumped.
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

**วิธีแก้ / Fix (phase 1, in this PR):** `private.app_state_history` เก็บเวอร์ชันก่อนหน้าทุกครั้งที่มีการ UPDATE/DELETE พร้อมเวลา, role, IP, user-agent เก็บ 500 เวอร์ชันล่าสุด + เวอร์ชันแรกของทุกวัน (การยิงขยะรัว ๆ จึงดันจุดกู้คืนรายวันออกไม่ได้) `anon` อ่าน/แก้/ลบไม่ได้ · Every UPDATE/DELETE stores the previous version with time, role, IP and user agent: the newest 500 versions plus the first of each day (Bangkok time), so a burst of junk writes cannot push out the daily restore points. anon cannot read, modify or delete it.

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

---

## สิ่งที่ PR นี้เปลี่ยน / What this PR changes

| ไฟล์ / File | การเปลี่ยนแปลง / Change |
|---|---|
| `shared.js` | `pinPolicyError`, `hashPin` (PBKDF2-SHA256 150k, salt สุ่ม), `verifyPin` (รับ hash ใหม่ + PIN แบบเก่า, ปฏิเสธ iteration ผิดปกติที่อาจถูกยัดมาให้มือถือค้าง / refuses tampered iteration counts), `setPin`, `resetPin`, `needsPinChange`, `keepCredentials`, `changePin` (อ่านล่าสุด → ตรวจ PIN เดิม → เขียนเฉพาะบัญชีนั้น ด้วย optimistic lock / re-read, verify, write only that account under the optimistic lock); `login` เป็น async |
| `pin-change.js`, `pin-change.css` | หน้าต่างตั้ง/เปลี่ยน PIN (บังคับหลังล็อกอินด้วย 1234 หรือเมื่อเปิดหน้าด้วย session เดิม) · PIN dialog, forced after a default-PIN login or on a restored session |
| `index.js`, `predictions.js` | `await` login, บอกเวลาที่ถูกล็อก, ปุ่ม "เปลี่ยน PIN" · Async login, lock message, change-PIN button |
| `admin.js` | รีเซ็ต/สร้างบัญชี → 1234 + `mustChangePin` · Reset/create sets 1234 + `mustChangePin` |
| `backup.js`, `sync-guard.js` | `keepCredentials` ก่อน PATCH · `keepCredentials` before PATCH |
| `*.html` | เพิ่ม script/css, ปุ่ม, เปลี่ยน `?v=` · New script/css, button, cache-busting versions |
| `tests/pin.test.cjs` | 8 tests: policy, salt, verify, tampered hash, setPin/resetPin, login + lockout + nothing stored, changePin (wrong PIN, conflict, writes only a hash), keepCredentials |
| `supabase/migrations/20261017120000_harden_shared_state.sql` | Phase 1 (ใช้ได้ทันที / safe now) |
| `supabase/proposed/phase2_server_side_auth.sql` | Phase 2 draft (อยู่นอก `migrations/` โดยตั้งใจ / deliberately outside `migrations/`) |

ทดสอบ / Verified: `npm test` (41 tests) · Browser smoke test with Playwright against a mocked Supabase row: login with 1234 → forced dialog → policy error for 1234 → new PIN saved as hash only (not in any PATCH body or localStorage) → score entry keeps the hash → old PIN refused, new PIN works → restored session on the predictions page asks for the current PIN, cancel logs out → admin reset sets 1234 + `mustChangePin`. Both SQL files were applied to local Postgres 16 with Supabase-style roles and exercised as `anon` (results above). **Nothing was run against the real Supabase project.**

---

## สิ่งที่เจ้าของต้องทำ / What the owner must do

### A. Phase 1 SQL (แนะนำให้ทำเลย / recommended now)

ลำดับกับการ merge PR ไม่สำคัญ: เว็บทำงานได้ทั้งก่อนและหลังรัน SQL · Order relative to merging the PR does not matter; the site works with or without it.

1. **Supabase Dashboard → SQL Editor** ตรวจขนาดข้อมูลปัจจุบัน (ต้องต่ำกว่า 2,000,000 และ 1,000,000 ไบต์มาก ถ้าใกล้ให้เพิ่มตัวเลขในไฟล์ migration ก่อน) · Check current sizes; they must be well under the limits, otherwise raise them in the file first:
   ```sql
   select octet_length(league::text) as league_bytes, octet_length(predictions::text) as predictions_bytes
   from public.app_state where id = 'main';
   ```
2. สำรองแถวไว้ใน schema `private` (**ห้ามสร้างตาราง backup ใน `public`** เพราะ Supabase จะเปิดให้ `anon` อ่าน/เขียนได้) · Back up the row into the `private` schema (**never** into `public`, which the API exposes):
   ```sql
   create schema if not exists private;
   revoke all on schema private from public, anon, authenticated;
   create table private.app_state_backup_20261017 as select * from public.app_state;
   ```
3. เปิดไฟล์ `supabase/migrations/20261017120000_harden_shared_state.sql` คัดลอกทั้งไฟล์ไปวางใน SQL Editor แล้วกด **Run** (หรือ `supabase db push` ถ้าใช้ CLI ที่ link โปรเจกต์ไว้) · Paste the whole file into the SQL Editor and **Run** (or `supabase db push` with a linked CLI).
4. **Settings → API (Data API) → Exposed schemas** ต้องมีแค่ `public` (และ `graphql_public`) **ห้ามเพิ่ม `private`** · Make sure `private` is not in the exposed schemas.
5. ทดสอบบนเว็บจริง: กรอกคะแนน 1 คู่ และทาย 1 ครั้ง ต้องขึ้น "บันทึกแล้ว" แล้วตรวจว่ามีประวัติ · On the live site, save one score and one bet, then check:
   ```sql
   select history_id, changed_at, db_role, client_ip from private.app_state_history order by history_id desc limit 5;
   ```
6. ถ้ามีปัญหา ใช้บล็อก "Rollback" ท้ายไฟล์ migration · If anything goes wrong, run the rollback block at the end of the migration file.

**กู้คืนเมื่อโดนป่วน / Restoring after vandalism:**
```sql
select history_id, changed_at, db_role, client_ip, octet_length(league::text) as league_bytes
from private.app_state_history order by history_id desc limit 50;
select private.restore_app_state(<history_id ของเวอร์ชันที่ดี / of the good version>);
```

### B. Merge PR นี้ / Merge this PR

ทุกคนที่ยังใช้ 1234 จะถูกให้ตั้ง PIN ใหม่ตอนล็อกอินหรือเปิดหน้าครั้งถัดไป ควรให้ Admin (มอส) ตั้งก่อน แล้วแจ้งกลุ่ม · Everyone still on 1234 is asked to set a new PIN at their next login or page load. The admin should go first, then tell the group. ใครลืม PIN ให้ Admin กด "รีเซ็ต PIN" · Forgotten PINs: admin reset.

### C. Phase 2 (งานถัดไป ต้องแก้ฝั่งเว็บด้วย / next, needs a client PR)

ทำใน PR แยก / In a separate PR:
1. Client: login ผ่าน `POST /rest/v1/rpc/pp_login` เก็บ token (ไม่ใช่ PIN) ใน localStorage; เปลี่ยน PIN ผ่าน `pp_change_pin`; รีเซ็ตผ่าน `pp_reset_pin`; บันทึกลีกผ่าน `pp_save_league(token, league, expected_updated_at)` และทายผ่าน `pp_save_predictions(...)` (คืน `null` เมื่อชนกับอีกเครื่อง เหมือน PATCH ว่างในปัจจุบัน); logout เรียก `pp_logout` · Log in via `pp_login` and keep the token (not the PIN); route PIN change/reset and both saves through the RPCs (`null` means another device saved first, like today's empty PATCH result); logout calls `pp_logout`.
2. SQL Editor: รันไฟล์ `supabase/proposed/phase2_server_side_auth.sql` (ทำแค่ section A + C ซึ่งไม่กระทบเว็บเดิม) แล้วทดสอบเว็บเวอร์ชันใหม่ · Run the file (applies only sections A and C, harmless to the current site) and test the new client.
3. Cut-over: deploy เว็บใหม่ แล้วรัน section B (copy PIN → `private.credentials`, ลบ PIN ออกจากแถว) และ D (`revoke update ... from anon, authenticated`) ในครั้งเดียวกัน · Deploy the new client, then run sections B and D together.

ทดสอบแล้วในเครื่อง / Tested locally: login with a 1234 account and with a PBKDF2 hash from this PR (upgraded to bcrypt on success), wrong PIN, lockout after 5 failures (900 s), PIN change and policy, admin-only league save with optimistic lock, credential fields stripped on save, new accounts get default credentials, player bet rules, direct `PATCH` refused after cut-over, `private.credentials` unreadable by anon.

### หมายเหตุ / Notes

- Publishable key ใน `shared.js` ตั้งใจให้เป็นสาธารณะ การ rotate key ไม่ช่วย ความปลอดภัยต้องมาจาก RLS / grants / RPC · The publishable key is public by design; rotating it does not help.
- ระหว่างนี้ ควรถือว่า PIN เดิมทุกตัวรั่วแล้ว (อ่านได้จาก API มาตลอด) ใครเคยใช้ PIN จริง (เช่น PIN ATM) ควรเปลี่ยนที่อื่นด้วย · Treat every existing PIN as already leaked; anyone who reused a real PIN elsewhere should change it there.
- เว็บนี้บันทึกแค่ "ยอด" ไม่ได้รับ/จ่ายเงินจริง แต่ยอดทายถูกแก้ได้จนกว่าจะทำ phase 2 · Bet amounts can be edited by anyone until phase 2.
