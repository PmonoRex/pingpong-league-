# Ping Pong League — Session Roadmap

Status: **All planned sessions implemented (Phase 1)**

## Session 1 — Season Archive ✅
Goal: เก็บและเปิดดู Season เก่าย้อนหลังได้

Implemented:
- `archive.html` / `archive.css` / `archive.js`
- `archive-hook.js` เก็บ snapshot ก่อนเริ่ม Season ใหม่
- เก็บ roster, rounds, results, standings, profile names และ finished time
- Season เก่าที่มีเพียง `rankHistory` ยังเปิดดูอันดับได้
- เปิดดูผลการแข่งขันรายคู่เมื่อมี snapshot
- ส่งออก Archive เป็น CSV
- Share Sheet / copy summary ผ่าน `archive-export.js`

## Session 2 — Player Stats + Head-to-Head ✅
Goal: โปรไฟล์ผู้เล่นมีสถิติจริงจากข้อมูลที่ระบบเก็บไว้

Implemented in `stats.html` / `stats.css` / `stats.js`:
- จำนวนแข่งรวม
- Win / Draw / Loss
- Win Rate
- ลูกได้ / ลูกเสีย / ผลต่างรวม
- ฟอร์ม 5 นัดล่าสุด
- current streak เช่น W3 / L2
- Head-to-Head ระหว่างผู้เล่น 2 คน
- คู่ปรับที่เจอบ่อยที่สุด
- สถิติแยกตาม Season

> สถิติแมตช์ย้อนหลังจะละเอียดตามข้อมูลที่เคยถูกเก็บไว้ใน Season Archive; Season เก่ามากที่มีเพียงอันดับจะไม่มีสกอร์รายคู่ย้อนหลังให้คำนวณ

## Session 3 — Backup / Restore ✅
Goal: ลดความเสี่ยงคะแนนหาย

Implemented:
- `backup.html` / `backup.css` / `backup.js`
- Manual Snapshot
- เก็บ Backup ในเครื่องสูงสุด 30 ชุด
- Preview ก่อน Restore
- Restore เฉพาะคะแนน
- Restore ทั้ง Season
- สร้าง Backup ปัจจุบันก่อน Restore อัตโนมัติ
- ซิงก์ข้อมูลที่ Restore กลับ Supabase
- `safety-hooks.js` สร้าง snapshot ก่อนเปลี่ยน roster, ล้างคะแนน, จบ Season และ manual save
- Recovery เดิมยังคงใช้งานร่วมกันได้

## Session 4 — League Dashboard ✅
Goal: หน้าเดียวเห็นสถานะลีกทั้งหมด

Implemented in `dashboard.html` / `dashboard.css` / `dashboard.js`:
- Season ปัจจุบัน
- แมตช์เล่นแล้ว / เหลือ
- Progress bar
- รายการทายที่รอผล
- Top 3 Ranking
- ฟอร์ม 5 นัดล่าสุดของผู้เล่นที่กำลังฟอร์มดี
- ผู้เล่นที่อันดับขยับขึ้นมากที่สุดจาก 2 Season ล่าสุด
- ผู้เล่น Win Rate สูงสุด
- จำนวนแมตช์ทั้งหมด
- จำนวนผู้เล่น
- จำนวน Season ที่จบแล้ว
- ผู้นำตารางปัจจุบัน
- Quick Actions ไปการแข่งขัน / ทายผล / Stats / Backup

## Session 5 — Notifications / Workflow ✅
Goal: ช่วย Admin ไม่ลืมขั้นตอน

Implemented through `suite.js`:
- League Assistant บนหน้าหลัก
- แจ้งจำนวนคู่ที่ยังไม่มีผล
- แจ้งจำนวนรายการทายที่รอผล
- แจ้งเมื่อ Season พร้อมปิด
- สถานะ sync เดิมของเว็บยังคงแสดงแบบ realtime
- ลิงก์ตรงไปหน้าที่ต้องจัดการ
- Confirmation flow เดิมก่อนงานสำคัญยังคงทำงาน

## Session 6 — Export / Share ✅
Goal: ส่งข้อมูลออกจากเว็บได้ง่าย

Implemented:
- ตารางคะแนน CSV
- ตารางคะแนน PNG ที่สร้างจาก Canvas
- PDF/Print ผ่าน print view ของ browser
- Share Sheet บน iPhone / clipboard fallback
- Season Archive CSV
- Season Archive share summary
- ยอดเจ้ามือส่งออกจากหน้าทายผล
- รองรับเก็บรายงานย้อนหลังผ่านไฟล์ที่ export

## Session 7 — UI / Motion / Performance Polish ✅ Phase 1
Goal: ทำให้เว็บลื่นและดูเป็นแอปมากขึ้น

Implemented:
- `motion.css` เป็น Motion System กลาง
- transition duration กลาง fast / base / slow
- press feedback ของปุ่ม
- active animation ของ Bottom Navigation
- card / match / market / account entrance animation
- modal / profile / recovery sheet slide + fade
- input / select focus transition
- sync / realtime status transition
- `prefers-reduced-motion`
- `suite.css` / `suite.js`
- Toast feedback แทน alert ทั่วไปหลายจุด
- smooth number pulse เมื่อค่าเปลี่ยน
- reusable skeleton style
- mobile touch / quick action UI
- cache-busting version parameters ในไฟล์หลัก

## Session 8 — Data Integrity / Security ✅ Client-side baseline
Goal: ทำให้ระบบแข็งแรงขึ้นโดยไม่ทำลาย compatibility ของบัญชีเดิม

Implemented in `shared.js`, `suite.js`, `safety-hooks.js`, `audit-view.js`:
- `schemaVersion = 2`
- normalize/migration ของ fields สำคัญ
- validate league schema
- validate score เป็น integer >= 0
- ตรวจ player reference ใน roster
- Data health badge บนหน้าหลัก
- Login rate limiting: PIN ผิด 5 ครั้ง ล็อก 60 วินาทีบนเครื่องนั้น
- Admin audit log สูงสุด 200 รายการ
- Admin Center แสดง Audit Log ล่าสุด
- automatic backup ก่อน action เสี่ยง
- validation ของ handicap / market / user reference จาก prediction logic เดิม

### Security note
PIN ปัจจุบันยังเป็นระบบ client-side เพื่อให้เด็กและผู้เล่นใช้ง่าย และรักษาความเข้ากันได้กับระบบเดิม หากต้องการระดับ production/public internet ควรย้าย PIN verification และ authorization ไป backend / Supabase Auth หรือ Edge Function และเก็บ credential แบบ hash ฝั่ง server

## Shared files added in this phase
- `motion.css`
- `suite.css`
- `suite.js`
- `stats.html`, `stats.css`, `stats.js`
- `dashboard.html`, `dashboard.css`, `dashboard.js`
- `backup.html`, `backup.css`, `backup.js`
- `safety-hooks.js`
- `archive-export.js`
- `audit-view.js`

## Current focus
ทุก Session 1–8 มี implementation Phase 1 แล้ว ขั้นถัดไปคือ **QA / Regression Testing** บน iPhone และหลายบัญชีพร้อมกัน โดยเฉพาะ:
1. จบ Season แล้ว Archive ครบ
2. Restore Backup แล้วคะแนนและ Cloud ตรงกัน
3. Stats / Head-to-Head ตรงกับผลจริง
4. Prediction settlement ไม่เปลี่ยนผิดเมื่อแก้คะแนนย้อนหลัง
5. Export PNG / CSV / PDF ใช้งานบน Safari iPhone
6. Login lockout และสิทธิ์ Admin/Dealer/Player ไม่ชนกัน
