# Ping Pong League — Session Roadmap

## Session 1 — Season Archive ✅ Started
Goal: เก็บและเปิดดู Season เก่าย้อนหลังได้

- เพิ่มหน้า `archive.html`
- เพิ่ม `archive.css` / `archive.js`
- เพิ่มปุ่มเข้า Season Archive จากหน้าหลัก
- เมื่อจบ Season ใหม่ จะเก็บ snapshot ของ roster, ตารางแข่ง, ผลทุกคู่, ตารางอันดับ และชื่อผู้เล่น ณ ตอนนั้น
- Season เก่าที่มีแค่ `rankHistory` จะแสดงตารางอันดับได้ แม้ไม่มีสกอร์รายคู่
- ไฟล์ `archive-hook.js` ทำหน้าที่จับ snapshot โดยไม่รื้อ logic เดิมใน `index.js`

Next in this session:
- ทดสอบจบ Season จริง 1 รอบ
- ตรวจว่า Archive ซิงก์ข้ามเครื่องผ่าน Supabase
- เพิ่มปุ่มแชร์/ส่งออก Season Archive หากต้องการ

## Session 2 — Player Stats + Head-to-Head
Goal: โปรไฟล์ผู้เล่นมีสถิติจริงจากทุก Season

- Win / Draw / Loss รวม
- Win Rate
- ลูกได้ / ลูกเสีย / ผลต่างรวม
- ฟอร์ม 5 นัดล่าสุด
- ชนะติดกัน / แพ้ติดกัน
- Head-to-Head ระหว่างผู้เล่น 2 คน
- คู่ปรับที่เจอบ่อยที่สุด
- สถิติแยกตาม Season

## Session 3 — Backup / Restore
Goal: ลดความเสี่ยงคะแนนหาย

- Snapshot ก่อนเปลี่ยน roster
- Snapshot ก่อนล้างคะแนน
- Snapshot ก่อนจบ Season
- รายการ Backup พร้อมวัน/เวลา
- Preview ก่อน Restore
- Restore เฉพาะคะแนนหรือทั้ง Season
- ป้องกันเขียนทับข้อมูลปัจจุบันโดยไม่ยืนยัน

> ระบบ Recovery พื้นฐานมีแล้ว จะรวมให้เป็น Backup Center ใน Session นี้

## Session 4 — League Dashboard
Goal: หน้าแรกสรุปลีกแบบดูง่าย

- Top 3 Ranking
- ฟอร์มแรงสุด
- คนที่อันดับขึ้น/ลงมากที่สุด
- จำนวนแมตช์ที่เล่นแล้ว / เหลือ
- ผู้เล่น Win Rate สูงสุด
- สถิติลีกทั้งหมด
- Quick actions สำหรับ Admin

## Session 5 — Notifications / Workflow
Goal: ช่วย Admin ไม่ลืมขั้นตอน

- แจ้งเตือนคู่ที่ยังไม่กรอกผล
- แจ้งเตือนรายการทายที่รอผล
- แจ้งเมื่อ Season พร้อมปิด
- แจ้งเมื่อมีคะแนนที่ยังไม่ซิงก์
- Confirmation flow ก่อนเปลี่ยน Season

## Session 6 — Export / Share
Goal: ส่งข้อมูลออกจากเว็บได้ง่าย

- ส่งออกตารางคะแนนเป็นรูป
- ส่งออก Season summary
- ส่งออกผลการแข่งขันทั้งหมด
- ส่งออกยอดเจ้ามือ
- Share Sheet บน iPhone
- PDF / CSV สำหรับเก็บย้อนหลัง

## Session 7 — UI / Performance Polish
Goal: ทำให้เว็บลื่นและดูเป็นแอปมากขึ้น

- Skeleton loading
- Toast แทน alert บางจุด
- Sticky navigation ที่สม่ำเสมอ
- Animation แบบเบา
- ปรับ mobile spacing
- ลดการ render ซ้ำ
- cache busting / version strategy

## Session 8 — Data Integrity / Security
Goal: ทำให้ระบบแข็งแรงขึ้น

- ตรวจ schema ของ league/predictions
- migration version
- validate score / handicap / user references
- PIN hashing หรือย้าย auth ไป backend หากต้องการความปลอดภัยสูงขึ้น
- audit log สำหรับ Admin actions

## Current focus
กำลังทำ **Session 1 — Season Archive** ก่อน แล้วจะต่อ Session 2 เมื่อ Archive ผ่านการทดสอบ
