# 🏓 Ping Pong League — ตีให้สุด หยุดที่เบ้าตา

เว็บลีกปิงปองสำหรับกลุ่มเพื่อน (ภาษาไทย) เปิดบนมือถือได้ลื่น ๆ — จัดตารางแข่งแบบ Round-Robin, กรอกผล, ดูตารางคะแนน, สะสมแรงค์ (RP) ข้าม Season, ทายผลแบบมีเจ้ามือ, และดูสถิติรายคน / Head-to-Head

โปรเจกต์นี้เป็น **vanilla HTML / CSS / JavaScript ไม่มี build step** และเก็บข้อมูลทั้งหมดไว้ใน Supabase **แถวเดียว** (`public.app_state`, `id = 'main'`) ทุกหน้าอ่าน/เขียนแถวนี้ผ่าน Supabase REST API โดยตรง และสำรองสำเนาไว้ใน `localStorage` ของเบราว์เซอร์

## หน้าเว็บและไฟล์หลัก

| หน้า | ไฟล์ | หน้าที่ |
|---|---|---|
| การแข่งขัน (หน้าแรก) | `index.html`, `index.js`, `index.css` | ล็อกอิน, เลือกผู้เล่นใน Season, ตารางแข่ง, กรอกคะแนน, ตารางคะแนน, แรงค์/RP, จบ Season |
| ทายผล | `predictions.html`, `predictions.js`, `predictions-board.js`, `predictions-realtime.js`, `predictions-export.js` | เจ้ามือตั้งราคาต่อ, ผู้เล่นทายแบบโปสเตอร์มวย (แตะมุมแดง/น้ำเงิน + ชิปยอด), กระดานทาย, แสตมป์ได้เงิน/คำแซวเมื่อตัดสิน, คำนวณผล, สรุปยอดชำระ |
| Dashboard | `dashboard.html`, `dashboard.js` | ภาพรวมลีก, Top 3, ฟอร์มร้อนแรง, ผู้เล่นอันดับขยับ |
| Stats / H2H | `stats.html`, `stats.js` | W/D/L, Win rate, ลูกได้-เสีย, ฟอร์ม 5 นัด, streak, Head-to-Head |
| Season Archive | `archive.html`, `archive.js`, `archive-hook.js`, `archive-export.js` | เปิดดู Season เก่า, ส่งออก CSV / แชร์ |
| Backup Center | `backup.html`, `backup.js`, `safety-hooks.js`, `recovery.js` | Snapshot ในเครื่อง, Restore คะแนน / ทั้ง Season |
| Admin | `admin.html`, `admin.js`, `audit-view.js` | สร้าง/เปลี่ยนชื่อ/ปิดบัญชี, รีเซ็ต PIN, Audit Log |
| นับแต้มดัมมี่ | `dummy.html`, `dummy.js`, `dummy.css` | นับแต้มไพ่ดัมมี่ 2–4 คน แยกจากลีก ซิงก์ข้ามเครื่องผ่านคอลัมน์ `dummy` (สำเนาออฟไลน์ใน `localStorage`), สรุปรายวัน + ปุ่มเริ่มวันใหม่ |
| โป๊กเกอร์ | `poker.html`, `poker.js`, `poker-bet.js`, `poker-cards.js`, `poker.css` | เดิมพันทีละรอบ (ก่อนฟล็อป/ฟล็อป/เทิร์น/ริเวอร์): ระบบวางบลายด์ เลื่อนปุ่มดีลเลอร์ บอกว่าใครถึงตา ให้แต่ละคนหมอบ/เช็ค/คอล/เบท/เรส/ออลอินจากมือถือตัวเอง แบ่งกองข้างเมื่อมีคนออลอิน จ่ายกองให้คนชนะ (ตัดสินจากไพ่ที่เปิดครบหรือแตะเลือกคนชนะ) และนับชิปบนโต๊ะต่อเนื่องทุกตา (`poker-bet.js` เทสต์ใน `tests/poker-bet.test.cjs`) • ส่องไพ่: แตะเลือกไพ่กองกลาง 5 ใบและไพ่ในมือ 2 ใบ บอกชื่อไพ่ที่ดีที่สุด (ภาษาไทย) และโอกาสชนะ/เสมอกับคู่แข่ง 1–8 คน (ใส่ไพ่คู่แข่งได้ถ้าเปิดแล้ว ที่เหลือสุ่ม 3,000 รอบ) เก็บไว้ในเครื่องเท่านั้น • จดซื้อชิป/ซื้อเพิ่ม นับชิปตอนเลิก แล้วสรุปให้โอนน้อยครั้งที่สุด (ปุ่มโอนขึ้น QR PromptPay) เปิดจากเมนู → โป๊กเกอร์ ซิงก์ผ่านคอลัมน์ `dummy` ใต้คีย์ `poker` (ไม่ต้องรัน migration เพิ่ม) แต่ละวงเก็บเป็นรายการเหตุการณ์ สองเครื่องกดพร้อมกันได้ไม่ทับกัน |

ไฟล์ที่ใช้ร่วมกัน:

- `shared.js` — บัญชี/สิทธิ์ (admin, dealer), login + lockout, validate/normalize ข้อมูล, `cloudRequest` ไปยัง Supabase, logic ตัดสินผลทาย
- `sync-guard.js` — ป้องกันการเขียนทับกันเมื่อ Admin หลายเครื่องแก้พร้อมกัน (ทับ `pushCloud` ของ `index.js`)
- `banter.js` + `banter.css` — แซวจากผลจริง: ป้ายสตรีค (ไฟลุก / ฟอร์มตก / คืนชีพ), สถิติคู่ปรับ + ป้าย ศึกล้างตา, โปสเตอร์แชมป์จบ Season (pure functions, เทสต์ใน `tests/banter.test.cjs`)
- `profile-me.js` + `profile-me.css` — แผ่น "โปรไฟล์ของฉัน" (เปิดจาก เครื่องมือ → โปรไฟล์ของฉัน หรือแตะชื่อตัวเอง): ชื่อเล่น, คำท้า (≤40 ตัว), รูปโปรไฟล์ (ย่อเป็น 96×96 WebP/JPEG ไม่เกิน 12KB), ช่องทางรับเงิน PromptPay หรือรูป QR ธนาคาร (ไม่เกิน 20KB) และแผ่น "โอน" ที่ขึ้น QR พร้อมยอดบนหน้าดัมมี่และสรุปยอดทายผล
- `promptpay.js` — สร้าง payload PromptPay (EMVCo + CRC16) เทสต์ใน `tests/promptpay.test.cjs`; วาด QR ด้วย `vendor/qrcode-generator/` (MIT, ไม่โหลดจาก CDN)
- `suite.js` — League Assistant, Export (CSV/PNG/PDF/แชร์), Toast, Data health badge
- `sport-ui.js` + `*.css` — ธีม, hero, motion, ปรับ UI มือถือ
- `manifest.webmanifest`, `icons/`, `sw.js` — ติดตั้งเป็นแอปบนหน้าโฮม (PWA): `sw.js` เก็บหน้าเว็บ/CSS/JS/ฟอนต์ไว้ในเครื่องให้เปิดได้แม้เน็ตหลุด (หน้า HTML ดึงจากเน็ตก่อน, ไฟล์ asset อัปเดตตาม `?v=`) และไม่แคชคำขอไป Supabase เด็ดขาด ถ้าแก้ logic ใน `sw.js` ให้เปลี่ยนค่า `CACHE`
- `supabase/migrations/` — SQL สร้างตารางและ policy
- `tests/shared.test.cjs`, `tests/pin.test.cjs` — unit test ของ `shared.js` (รวม PIN hash / เปลี่ยน PIN)
- `pin-change.js` — หน้าต่างบังคับตั้ง/เปลี่ยน PIN (เปิดจาก "เปลี่ยน PIN" ในเมนูได้ทุกหน้า)
- `SESSION_ROADMAP.md` — รายการฟีเจอร์ที่ทำในแต่ละ Session และ QA checklist
- `QA_REPORT.md` — ผลรีวิวโค้ดเทียบกับ QA checklist

> ไฟล์ `?v=...` ท้าย `<script>`/`<link>` ใน HTML คือ cache-busting แบบแมนวล ถ้าแก้ไฟล์ JS/CSS ให้เปลี่ยนเลขเวอร์ชันด้วย

## รันบนเครื่อง

ไม่ต้อง build — เปิดด้วย static server ตัวไหนก็ได้ที่โฟลเดอร์รากของโปรเจกต์ เช่น

```bash
# Python
python -m http.server 8080

# หรือ Node
npx serve .
```

แล้วเปิด <http://localhost:8080/index.html>

ควรเปิดผ่าน `http://localhost` แทนการดับเบิลคลิกไฟล์ (`file://`) เพราะ `fetch` ไป Supabase และ `localStorage` ทำงานเสถียรกว่า

## ตั้งค่า Supabase

1. สร้างโปรเจกต์ใน [Supabase](https://supabase.com)
2. เปิด **SQL Editor** แล้วรันไฟล์ใน `supabase/migrations/` ตามลำดับชื่อไฟล์ (`20260919163000_create_shared_state.sql`, `20261017120000_add_dummy_state.sql`, `20261018120000_media_bucket.sql` แล้วตามด้วย `20261018130000_harden_shared_state.sql`) ซึ่งจะสร้างตาราง `public.app_state`, เปิด RLS, ตั้ง policy, insert แถว `main` เริ่มต้น และ (ไฟล์สุดท้าย) เพิ่ม write guard, rate limit, ประวัติทุกเวอร์ชันใน schema `private` และแถว `live` สำหรับ live scoring — ดู `SECURITY_REVIEW.md` หรือใช้ Supabase CLI: `supabase db push`
3. แก้ `SUPABASE_URL` และ `SUPABASE_KEY` (publishable/anon key) ที่ต้นไฟล์ `shared.js` ให้เป็นของโปรเจกต์ตัวเอง
4. เปิดเว็บ — ครั้งแรกบัญชีเริ่มต้นจะถูกสร้างจากรายชื่อผู้เล่นเดิม โดย PIN เริ่มต้นคือ `1234` (Admin เริ่มต้นคือบัญชีชื่อ "มอส") ทุกคนจะถูกบังคับให้ตั้ง PIN ใหม่ 4–6 หลักหลังล็อกอินครั้งแรก (PIN ที่ตั้งเก็บเป็น PBKDF2 hash)

### อัปเดตโปรเจกต์ที่ใช้งานอยู่แล้ว: เปิดซิงก์หน้าดัมมี่

หน้าดัมมี่จะซิงก์ข้ามเครื่องได้ก็ต่อเมื่อมีคอลัมน์ `dummy` แล้ว ให้ Owner เปิด **SQL Editor** ของโปรเจกต์ที่ใช้งานจริงแล้วรัน `supabase/migrations/20261017120000_add_dummy_state.sql` ครั้งเดียว:

```sql
alter table public.app_state
  add column if not exists dummy jsonb not null default '{}'::jsonb;
```

ก่อนรัน หน้าดัมมี่ยังใช้ได้ตามเดิมแบบเก็บในเครื่อง (ป้ายสถานะขึ้น "ยังไม่เปิดซิงก์ • เก็บในเครื่อง") หลังรันแล้ว เปิดหน้าดัมมี่บนเครื่องที่มีแต้มเดิม แต้มในเครื่องจะถูกส่งขึ้น Cloud ให้อัตโนมัติ (ถ้าหลายเครื่องมีแต้มเก่าคนละชุดและผู้เล่นคนละชุด ชุดที่ขึ้น Cloud ก่อนจะถูกใช้ และของเครื่องที่มาทีหลังถูกเก็บสำรองไว้ใน `localStorage` คีย์ `pp_dummy_conflict_v1`)

โครงสร้างข้อมูลในแถว `main`: คอลัมน์ `league` เก็บ `{ uidLeague: {...} }` (profiles — แต่ละคนมี `tagline`, `avatar`, `promptpay` หรือ `payQr` ได้ถ้าตั้งไว้ ซึ่ง**ใครเปิดเว็บก็อ่านได้**, seasonPlayerIds, rounds, results, rankHistory, seasonArchives, auditLog, schemaVersion), คอลัมน์ `predictions` เก็บ `{ uidPredictions: {...} }` (dealerId, markets, bets), และ `updated_at` ใช้เป็น optimistic lock ตอนเขียน ส่วนคอลัมน์ `dummy` เก็บแต้มดัมมี่ (players, rounds, ตั้งค่าเงิน, `dayStart`) โดยใช้ `dummy.rev` เป็น lock ของตัวเองและไม่แตะ `updated_at` เพื่อไม่ให้การบันทึกดัมมี่ไปชนกับการบันทึกลีก/ทายผล

## รันเทสต์

ต้องมี Node.js 20 ขึ้นไป (ไม่มี dependency ให้ติดตั้ง ไม่มี `package-lock`)

```bash
npm test
```

เทียบเท่ากับ `node --test` ซึ่งจะหาไฟล์ `*.test.cjs` ใน `tests/` เอง (ใน Node 22+ การส่งพาธโฟลเดอร์ `node --test tests/` ใช้ไม่ได้แล้ว) ตอนนี้เทสต์ครอบคลุมเฉพาะ `shared.js` — ดูช่องว่างของเทสต์ใน `QA_REPORT.md`

GitHub Actions (`.github/workflows/test.yml`) รัน `npm test` ทุก push และ pull request

## ⚠️ หมายเหตุด้านความปลอดภัย

ดูรายละเอียดทั้งหมดใน **`SECURITY_REVIEW.md`** (ไทย/อังกฤษ) สรุป: การตรวจ PIN และสิทธิ์ admin/dealer ยังอยู่ในเบราว์เซอร์ และ `anon` ยังแก้แถว `main` ได้ (migration `20261018130000_harden_shared_state.sql` กันการล้าง/ยัดข้อมูลและเก็บประวัติให้กู้คืนได้ แต่ยังกันการแก้ทีละนิดไม่ได้) PIN ที่ตั้งเองเก็บเป็น hash แต่ยังอยู่ในแถวที่ใครก็อ่านได้ จึงเหมาะกับกลุ่มเพื่อนที่ไว้ใจกันเท่านั้น **ไม่ควรเปิดใช้งานบนอินเทอร์เน็ตสาธารณะที่มีเงินจริงเกี่ยวข้อง** จนกว่าจะเปิด phase 2 (`supabase/migrations/20261019140000_server_auth.sql`: ตรวจ PIN และสิทธิ์ฝั่ง server ผ่าน RPC แล้วรัน `update private.settings set enforce = true;` ดูขั้นตอนใน `docs/security-phase2.md`)
