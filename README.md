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

ไฟล์ที่ใช้ร่วมกัน:

- `shared.js` — บัญชี/สิทธิ์ (admin, dealer), login + lockout, validate/normalize ข้อมูล, `cloudRequest` ไปยัง Supabase, logic ตัดสินผลทาย
- `sync-guard.js` — ป้องกันการเขียนทับกันเมื่อ Admin หลายเครื่องแก้พร้อมกัน (ทับ `pushCloud` ของ `index.js`)
- `suite.js` — League Assistant, Export (CSV/PNG/PDF/แชร์), Toast, Data health badge
- `sport-ui.js` + `*.css` — ธีม, hero, motion, ปรับ UI มือถือ
- `supabase/migrations/` — SQL สร้างตารางและ policy
- `tests/shared.test.cjs` — unit test ของ `shared.js`
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
2. เปิด **SQL Editor** แล้วรันไฟล์ใน `supabase/migrations/` ตามลำดับชื่อไฟล์ (`20260919163000_create_shared_state.sql` → `20261015120000_server_side_auth.sql` → `20261016120000_settlement_rules.sql`) ซึ่งจะสร้างตาราง `public.app_state` (anon อ่านได้อย่างเดียว), ตาราง PIN แบบ hash + session ใน schema `private` และ RPC สำหรับ login/บันทึกข้อมูล หรือใช้ Supabase CLI: `supabase db push` • ทดสอบ migration กับ Postgres ในเครื่องได้ด้วย `sh supabase/tests/run-local.sh auth|settlement` (ต้องมี Docker)
3. แก้ `SUPABASE_URL` และ `SUPABASE_KEY` (publishable/anon key) ที่ต้นไฟล์ `shared.js` ให้เป็นของโปรเจกต์ตัวเอง
4. PIN อยู่ฝั่ง server เท่านั้น: ตั้ง PIN ชั่วคราวให้ Admin คนแรกใน SQL Editor ด้วย `select private.set_pin('<profile id>', '<pin>');` แล้วเข้าสู่ระบบ ระบบจะบังคับตั้ง PIN ใหม่ จากนั้น Admin ออก PIN ชั่วคราวให้คนอื่นได้ที่หน้า Admin

โครงสร้างข้อมูลในแถว `main`: คอลัมน์ `league` เก็บ `{ uidLeague: {...} }` (profiles, seasonPlayerIds, rounds, results, rankHistory, seasonArchives, auditLog, schemaVersion), คอลัมน์ `predictions` เก็บ `{ uidPredictions: {...} }` (dealerId, markets, bets), และ `updated_at` ใช้เป็น optimistic lock ตอนเขียน

## รันเทสต์

ต้องมี Node.js 20 ขึ้นไป (ไม่มี dependency ให้ติดตั้ง ไม่มี `package-lock`)

```bash
npm test
```

เทียบเท่ากับ `node --test` ซึ่งจะหาไฟล์ `*.test.cjs` ใน `tests/` เอง (ใน Node 22+ การส่งพาธโฟลเดอร์ `node --test tests/` ใช้ไม่ได้แล้ว) ตอนนี้เทสต์ครอบคลุมเฉพาะ `shared.js` — ดูช่องว่างของเทสต์ใน `QA_REPORT.md`

GitHub Actions (`.github/workflows/test.yml`) รัน `npm test` ทุก push และ pull request

## ⚠️ หมายเหตุด้านความปลอดภัย

PIN ถูกตรวจฝั่ง server (hash ด้วย bcrypt, ล็อก 60 วินาทีหลังผิด 5 ครั้ง) และ `anon` แก้ตาราง `app_state` ตรงๆ ไม่ได้แล้ว ทุกการเขียนผ่าน RPC `save_league` (Admin) / `save_predictions` (เจ้ามือ/ผู้เล่นตามกฎ) ที่ตรวจ session token และคำนวณผลทายซ้ำจากคะแนนจริง ข้อมูลลีกและการทายยังอ่านได้สาธารณะด้วย publishable key จึงยังเหมาะกับกลุ่มเพื่อน **ไม่ควรใช้กับเงินจริง** — รายละเอียดดู `QA_REPORT.md`
