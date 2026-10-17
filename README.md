# 🏓 Ping Pong League — ตีให้สุด หยุดที่เบ้าตา

เว็บลีกปิงปองสำหรับกลุ่มเพื่อน (ภาษาไทย) เปิดบนมือถือได้ลื่น ๆ — จัดตารางแข่งแบบ Round-Robin, กรอกผล, ดูตารางคะแนน, สะสมแรงค์ (RP) ข้าม Season, ทายผลแบบมีเจ้ามือ, และดูสถิติรายคน / Head-to-Head

โปรเจกต์นี้เป็น **vanilla HTML / CSS / JavaScript ไม่มี build step** และเก็บข้อมูลทั้งหมดไว้ใน Supabase **แถวเดียว** (`public.app_state`, `id = 'main'`) ทุกหน้าอ่าน/เขียนแถวนี้ผ่าน Supabase REST API โดยตรง และสำรองสำเนาไว้ใน `localStorage` ของเบราว์เซอร์

## หน้าเว็บและไฟล์หลัก

| หน้า | ไฟล์ | หน้าที่ |
|---|---|---|
| การแข่งขัน (หน้าแรก) | `index.html`, `index.js`, `index.css` | ล็อกอิน, เลือกผู้เล่นใน Season, ตารางแข่ง, กรอกคะแนน, ตารางคะแนน, แรงค์/RP, จบ Season |
| ทายผล | `predictions.html`, `predictions.js`, `predictions-realtime.js`, `predictions-export.js` | เจ้ามือตั้งราคาต่อ, ผู้เล่นทาย, คำนวณผล, สรุปยอดชำระ |
| Dashboard | `dashboard.html`, `dashboard.js` | ภาพรวมลีก, Top 3, ฟอร์มร้อนแรง, ผู้เล่นอันดับขยับ |
| Stats / H2H | `stats.html`, `stats.js` | W/D/L, Win rate, ลูกได้-เสีย, ฟอร์ม 5 นัด, streak, Head-to-Head |
| Season Archive | `archive.html`, `archive.js`, `archive-hook.js`, `archive-export.js` | เปิดดู Season เก่า, ส่งออก CSV / แชร์ |
| Backup Center | `backup.html`, `backup.js`, `safety-hooks.js`, `recovery.js` | Snapshot ในเครื่อง, Restore คะแนน / ทั้ง Season |
| Admin | `admin.html`, `admin.js`, `audit-view.js` | สร้าง/เปลี่ยนชื่อ/ปิดบัญชี, รีเซ็ต PIN, Audit Log |
| นับแต้มดัมมี่ | `dummy.html`, `dummy.js`, `dummy.css` | นับแต้มไพ่ดัมมี่ 2–4 คน แยกจากลีก เก็บใน `localStorage` ของเครื่องเท่านั้น |

ไฟล์ที่ใช้ร่วมกัน:

- `shared.js` — บัญชี/สิทธิ์ (admin, dealer), login + lockout, validate/normalize ข้อมูล, `cloudRequest` ไปยัง Supabase, logic ตัดสินผลทาย
- `sync-guard.js` — ป้องกันการเขียนทับกันเมื่อ Admin หลายเครื่องแก้พร้อมกัน (ทับ `pushCloud` ของ `index.js`)
- `suite.js` — League Assistant, Export (CSV/PNG/PDF/แชร์), Toast, Data health badge
- `sport-ui.js` + `*.css` — ธีม, hero, motion, ปรับ UI มือถือ
- `supabase/migrations/` — SQL สร้างตารางและ policy
- `tests/shared.test.cjs`, `tests/pin.test.cjs` — unit test ของ `shared.js` (รวม PIN hash / เปลี่ยน PIN)
- `pin-change.js` — หน้าต่างบังคับตั้ง/เปลี่ยน PIN
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
2. เปิด **SQL Editor** แล้วรันไฟล์ใน `supabase/migrations/` ตามลำดับชื่อไฟล์ (`20260919163000_create_shared_state.sql` สร้างตาราง `public.app_state`, เปิด RLS, ตั้ง policy และ insert แถว `main` เริ่มต้น; `20261017120000_harden_shared_state.sql` เพิ่ม write guard, rate limit และประวัติทุกเวอร์ชันใน schema `private` — ดู `SECURITY_REVIEW.md`) หรือใช้ Supabase CLI: `supabase db push`
3. แก้ `SUPABASE_URL` และ `SUPABASE_KEY` (publishable/anon key) ที่ต้นไฟล์ `shared.js` ให้เป็นของโปรเจกต์ตัวเอง
4. เปิดเว็บ — ครั้งแรกบัญชีเริ่มต้นจะถูกสร้างจากรายชื่อผู้เล่นเดิม โดย PIN เริ่มต้นคือ `1234` (Admin เริ่มต้นคือบัญชีชื่อ "มอส") ทุกคนจะถูกบังคับให้ตั้ง PIN ใหม่ 4–6 หลักหลังล็อกอินครั้งแรก (PIN ที่ตั้งเก็บเป็น PBKDF2 hash)

โครงสร้างข้อมูลในแถว `main`: คอลัมน์ `league` เก็บ `{ uidLeague: {...} }` (profiles, seasonPlayerIds, rounds, results, rankHistory, seasonArchives, auditLog, schemaVersion), คอลัมน์ `predictions` เก็บ `{ uidPredictions: {...} }` (dealerId, markets, bets), และ `updated_at` ใช้เป็น optimistic lock ตอนเขียน

## รันเทสต์

ต้องมี Node.js 20 ขึ้นไป (ไม่มี dependency ให้ติดตั้ง ไม่มี `package-lock`)

```bash
npm test
```

เทียบเท่ากับ `node --test` ซึ่งจะหาไฟล์ `*.test.cjs` ใน `tests/` เอง (ใน Node 22+ การส่งพาธโฟลเดอร์ `node --test tests/` ใช้ไม่ได้แล้ว) ตอนนี้เทสต์ครอบคลุมเฉพาะ `shared.js` — ดูช่องว่างของเทสต์ใน `QA_REPORT.md`

GitHub Actions (`.github/workflows/test.yml`) รัน `npm test` ทุก push และ pull request

## ⚠️ หมายเหตุด้านความปลอดภัย

ดูรายละเอียดทั้งหมดใน **`SECURITY_REVIEW.md`** (ไทย/อังกฤษ) สรุป: การตรวจ PIN และสิทธิ์ admin/dealer ยังอยู่ในเบราว์เซอร์ และ `anon` ยังแก้แถว `main` ได้ (migration `20261017120000_harden_shared_state.sql` กันการล้าง/ยัดข้อมูลและเก็บประวัติให้กู้คืนได้ แต่ยังกันการแก้ทีละนิดไม่ได้) PIN ที่ตั้งเองเก็บเป็น hash แต่ยังอยู่ในแถวที่ใครก็อ่านได้ จึงเหมาะกับกลุ่มเพื่อนที่ไว้ใจกันเท่านั้น **ไม่ควรเปิดใช้งานบนอินเทอร์เน็ตสาธารณะที่มีเงินจริงเกี่ยวข้อง** จนกว่าจะทำ phase 2 (`supabase/proposed/phase2_server_side_auth.sql`: ตรวจ PIN และสิทธิ์ฝั่ง server ผ่าน RPC)
