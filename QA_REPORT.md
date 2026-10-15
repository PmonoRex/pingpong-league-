# QA Report — Code Review เทียบกับ QA Checklist (SESSION_ROADMAP.md)

วิธีตรวจ: อ่านโค้ดทุกไฟล์ `.js` และลำดับ `<script>` ใน HTML ที่โหลดจริง ไม่ได้แก้ไฟล์เดิมใด ๆ และไม่ได้ทดสอบบนอุปกรณ์จริง (ข้อ 5 Safari iPhone ดูเฉพาะโค้ด) เลขบรรทัดอ้างอิงจาก commit `cd3112f`

ระดับความรุนแรง: **Critical** = ข้อมูล/เงินเสียหายหรือถูกเจาะได้ทันที · **High** = ฟีเจอร์หลักพังหรือข้อมูลผิดโดยผู้ใช้ไม่รู้ตัว · **Medium** = เกิดได้ในการใช้งานจริงแต่มีทางแก้เอง · **Low** = เล็กน้อย/กรณีขอบ

## สรุปอย่างย่อ

| # | ระดับ | หัวข้อ |
|---|---|---|
| A1 | **Critical** | `archive-hook.js` ไม่เคยทำงานจริง → จบ Season แล้วไม่มี Archive, คะแนนรายคู่หายจาก Stats/H2H |
| SEC1 | **Critical** | RLS ให้ `anon` อ่าน/แก้แถว `main` ได้ทั้งแถว + PIN เป็น plaintext + session เป็นแค่ user id |
| B1 | **High** | Restore "เฉพาะคะแนน" ไม่ตรวจว่า roster/rounds ตรงกัน → คะแนนไปลงผิดคู่ |
| P1 | **High** | แก้/ลบคะแนนหลัง settle ไม่ย้อนผลทายอัตโนมัติ; ลบคะแนนแล้วผลทายค้างเป็น won/lost |
| P2 | **High** | จบ Season แล้วทายที่ pending ของ Season เก่าไม่มีวันถูก settle และหายจากตารางยอด |
| B2 | Medium | Full restore ย้อน profiles/PIN/role/แรงค์/archive ทั้งก้อน |
| B3 | Medium | `backup.js` pushCloud อ่าน `updated_at` ใหม่ก่อนเขียน → optimistic lock ไม่มีผล |
| B4 | Medium | `safety-hooks.js` snapshot ไม่มี try/catch → localStorage เต็มแล้วปุ่มจบ Season/ล้างคะแนนกดไม่ได้ |
| P3 | Medium | ตลาดค้างข้ามการสร้างตารางใหม่ → ทายด้วย favorite ที่ไม่อยู่ในคู่ (settle ไม่ได้) |
| P4 | Medium | ทุกการทายเปลี่ยน `updated_at` ของแถวเดียวกัน → admin ที่กำลังบันทึกคะแนนอาจถูก adopt remote ทิ้งการแก้ |
| R1 | Medium | Admin แก้คะแนนได้ + ทายได้ + ตั้งเจ้ามือ/settle ได้ — ไม่มี separation of duties และไม่มี audit ฝั่งทาย |
| R2 | Medium | บัญชีที่ปิดใช้งานหายจากตารางยอดชำระ/ส่งออก → ยอดเจ้ามือผิด |
| R4 | Medium | PIN เริ่มต้น 1234 ทุกบัญชี และผู้เล่นเปลี่ยน PIN เองไม่ได้ |
| S1, S2 | Medium | H2H เมื่อ A = B; ฟอร์ม/streak เรียงตามตารางแทนเวลาที่เล่นจริง |
| X1 | Medium | XSS จากการ insert ข้อมูลที่ไม่ผ่าน `escapeHtml` (รายการเต็มในหัวข้อ 5) |
| อื่น ๆ | Low | A2, A3, B5, B6, S0, S3, S5, P5, P6, R3, R5, X2, X3 |

---

## 1. ข้อ QA 1 — จบ Season แล้ว Archive ครบ

### A1 — Archive hook ถูกผูกไม่ทัน ทำให้ไม่เคยบันทึก Archive · **Critical**
- ไฟล์: `index.js:104`, `archive-hook.js:7`, `safety-hooks.js:14`
- `index.js:104` ทำ `document.getElementById("finishSeason").onclick=finishSeason` ตอนโหลด `index.js` ซึ่งเก็บ **reference ของฟังก์ชันเดิม** ไว้ที่ปุ่ม จากนั้น `archive-hook.js` (โหลดหลัง `index.js`) ทำ `finishSeason = function archiveAwareFinishSeason…` เปลี่ยนแค่ global binding ปุ่มยังเรียกตัวเดิม และ `safety-hooks.js:14` ก็ wrap จาก `btn.onclick` (ตัวเดิม) ไม่มีโค้ดไหน re-bind ปุ่มหรือเรียก `finishSeason` ผ่านชื่อ global (ใน HTML ไม่มี `onclick="…"`)
- สถานการณ์: Admin กรอกครบ 21 คู่ → กด "จบ Season" → `rankHistory` ถูก push, `state.results={}` และ `rounds` ถูกสร้างใหม่ แต่ `seasonArchives` ว่าง → `archive.html` ขึ้น "สรุปอันดับเท่านั้น" (`legacySummaryOnly`) ทุก Season, `stats.js:2`/`dashboard.js:2` อ่านคะแนนจาก `seasonArchives` จึงไม่เหลือ match ย้อนหลังเลย (Stats/H2H/Win rate/streak ข้าม Season ว่างหลังจบ Season แรก) คะแนนรายคู่เหลืออยู่แค่ใน Backup/Recovery ในเครื่อง Admin
- แก้: ย้ายการ snapshot เข้าไปใน `finishSeason` ใน `index.js` โดยตรง (หรือให้ปุ่มเรียกผ่านชื่อ `onclick=()=>finishSeason()`) แล้วลบ monkey-patch; เพิ่มเทสต์ที่โหลด `index.js` + `archive-hook.js` ใน jsdom/vm แล้วจำลองกดปุ่ม ตรวจ `state.seasonArchives.length===1`
- หมายเหตุ: ข้อสรุปมาจากการอ่านลำดับ script และ semantics ของ JS ไม่ได้รันในเบราว์เซอร์ — ควรยืนยันด้วยการจบ Season บนข้อมูลทดสอบ

### A2 — การล้างคะแนนทางอื่นไม่เก็บ Archive · **Low**
- ไฟล์: `index.js:86` (applyRoster), `index.js:104` (clearScores), `recovery.js:152-155`
- เปลี่ยนรายชื่อ/ล้างคะแนนทิ้งผลของ Season ที่ยังไม่จบ มีแค่ snapshot ในเครื่อง (`safety-hooks.js:16`) กู้ข้ามเครื่องไม่ได้ · แก้: เตือนให้ export ก่อน หรือเก็บ snapshot ขึ้น cloud

### A3 — ถ้า hook ทำงาน Archive ก็ยังไม่ครบ · **Low**
- ไฟล์: `archive-hook.js:22-30`
- ไม่เก็บ `bets`/`markets` ของ Season นั้น · แก้: เก็บผลทายของ Season ลง archive หรือบังคับ settle ก่อนจบ (ดู P2)

---

## 2. ข้อ QA 2 — Restore Backup แล้วคะแนนกับ Cloud ตรงกัน

### B1 — Restore "เฉพาะคะแนน" ลงผิดคู่ · **High**
- ไฟล์: `backup.js:8` (`next.results=clone(selected.state.results||{})`), `backup.js:6` (preview)
- `results` คีย์เป็น `r{รอบ}m{คู่}` ไม่มี pair ในตัว ถ้า Backup มาจาก roster/ตารางคนละชุด (เช่นก่อนกด "เปลี่ยนรายชื่อ" ซึ่งสุ่มตารางใหม่ `index.js:86`) การ restore จะวางผลของคู่เก่าลงคู่ใหม่ตามตำแหน่ง Preview แสดงแค่ `results` ไม่แสดงคู่ จึงไม่มีใครเห็น
- สถานการณ์: Backup ก่อนเปลี่ยน roster มี `r0m0` = A–B 11-5; ตอนนี้ `r0m0` = C–D → หลัง restore C ชนะ D 11-5
- แก้: restore คะแนนเฉพาะเมื่อ `rounds` และ `currentSeason` ของ Backup ตรงกับปัจจุบัน มิฉะนั้นให้ใช้ได้แค่ "Restore ทั้ง Season"; ใน preview แสดงคู่ + คะแนน

### B2 — Full restore ย้อนข้อมูลบัญชีและประวัติ · **Medium**
- ไฟล์: `backup.js:8` (`next=clone(selected.state)`)
- แทนที่ทั้ง league: บัญชีที่สร้างหลัง Backup หาย (bets ที่อ้าง userId กลายเป็น orphan), PIN ที่รีเซ็ตแล้วย้อนกลับ, บัญชีที่ปิดถูกเปิดใหม่, Admin ที่เพิ่งตั้งอาจเสียสิทธิ์, `rankHistory`/`seasonArchives`/`auditLog` ย้อนกลับ (Season ที่จบแล้วถูกลบ) และไม่ validate ด้วย `LeagueShared.validateLeague` ก่อนเขียน · `predictions` ไม่ถูก restore จึงไม่สอดคล้องกับ league
- แก้: restore เฉพาะ `seasonPlayerIds/rounds/results/currentSeason` โดย merge เข้า league ปัจจุบัน ไม่แตะ profiles/rankHistory/archives/auditLog และเรียก `validateLeague` ก่อนส่ง

### B3 — optimistic lock ใน Backup ใช้ไม่ได้ · **Medium**
- ไฟล์: `backup.js:7`
- `pushCloud` อ่านแถวล่าสุดแล้วใช้ `updated_at` ของ **แถวที่เพิ่งอ่าน** เป็นเงื่อนไข PATCH จึงผ่านเสมอ ขณะที่ `next` สร้างจาก `league` ที่โหลดตอนเปิดหน้า (อาจเก่านาน) → เขียนทับสิ่งที่คนอื่นแก้ระหว่างนั้น (บัญชีใหม่, คะแนน) · แก้: เก็บ `updated_at` ตอน `init` แล้วใช้ค่านั้นเป็น filter ถ้าได้ 0 แถวให้ขอโหลดใหม่ (มีข้อความรองรับอยู่แล้ว)

### B4 — snapshot ล้มแล้วบล็อกปุ่มอันตราย · **Medium**
- ไฟล์: `safety-hooks.js:8,14`, `backup.js:2`
- `localStorage.setItem` ไม่มี try/catch snapshot ละ `clone(state)` เต็ม (รวม `auditLog` 200 รายการ + archives) ×30 ชุด อาจเกิน quota ~5MB ถ้าโยน exception ใน `wrapButton` จะเกิดก่อน `original.call` → ปุ่ม "จบ Season/ล้างคะแนน/เปลี่ยนรายชื่อ/บันทึก" ไม่ทำงาน (`backup.js:2` ก็ไม่มี try) · แก้: ครอบ try/catch, ลดขนาด snapshot (ไม่เก็บ auditLog), แจ้งผู้ใช้แต่ไม่บล็อก action

### B5 — Restore ที่ sync ไม่สำเร็จทิ้งข้อมูลต่างกัน · **Low**
- ไฟล์: `backup.js:8`
- `saveLocalLeague(next)` ทำก่อน push ถ้า push ล้มเหลว local = ข้อมูลที่ restore แต่ cloud = เดิม แล้ว `index.js:74 initCloud` ให้ remote ชนะ → Restore หายเงียบ ๆ (มีข้อความ "ยังไม่ซิงก์" แต่ไม่มี retry) · แก้: เขียน local หลัง cloud สำเร็จ หรือเก็บเป็น pending-restore ให้ retry

### B6 — Audit/Snapshot ก่อนผู้ใช้ยืนยัน · **Low**
- ไฟล์: `safety-hooks.js:14`
- snapshot + audit `season_finish`/`scores_clear` ถูกบันทึกก่อน `confirm()` ในปุ่มจริง ถ้ากดยกเลิก Audit Log ก็มีรายการทั้งที่ไม่ได้ทำ และ Backup 30 ชุดถูกกินด้วย snapshot ที่ไม่จำเป็น · แก้: ทำหลัง confirm (ใน handler จริง)

### S0 — Sync หลายเครื่อง · **Low**
- ไฟล์: `sync-guard.js:5,97-99`
- `syncBase=clone(state)` ถ่ายตอนโหลด (ข้อมูลในเครื่อง) ก่อน `initCloud` ดึง remote เสร็จ จนกว่า interval 1.2 วินาทีจะปรับ ถ้า Admin แก้คะแนนทันทีหลังเปิดหน้า diff จะคำนวณจาก base ที่ผิด · แก้: ตั้ง `syncBase` ใน `initCloud`/`adoptRemote` เท่านั้น

---

## 3. ข้อ QA 3 — Stats / H2H / Streak ตรงกับผลจริง

### S1 — เลือกผู้เล่น A = B ได้ และ H2H นับทุกแมตช์ของผู้เล่นนั้น · **Medium**
- ไฟล์: `stats.js:5`, `stats.js:7`
- `m.pair.includes(a)&&m.pair.includes(b)` เมื่อ `a===b` เป็นจริงกับทุกคู่ของ a → H2H แสดง "ชนะ/แพ้" ปนกันและจำนวนเจอกันผิด; ถ้ามีผู้เล่น active คนเดียว `playerB` ก็เท่ากับ A · แก้: ถ้า `a===b` แสดงข้อความให้เลือกคนละคน

### S2 — "ฟอร์ม 5 นัดล่าสุด" และ streak เรียงตามตารางแข่ง ไม่ใช่เวลาที่เล่นจริง · **Medium**
- ไฟล์: `stats.js:2,4`, `dashboard.js:2,5`
- ผลไม่มี timestamp; ลำดับ = รอบ→คู่ ถ้า Admin กรอกผลไม่เรียงรอบ (เกิดบ่อย) `slice(-5)` และ streak (`W3/L2`) จะผิด · แก้: เก็บ `playedAt` ใน `results[id]` ตอนกรอกแล้ว sort ตามนั้น หรือระบุใน UI ว่าเรียงตามตาราง

### S3 — นิยามคะแนนที่ "ถูกต้อง" ไม่ตรงกันระหว่างหน้า · **Low**
- ไฟล์: `index.js:10` (integer ≥ 0) vs `stats.js:1`, `dashboard.js:1` (integer ใด ๆ รวมค่าลบ)
- ค่าลบที่หลุดมา (แก้ cloud ตรง ๆ) นับใน Stats/Dashboard แต่ไม่นับในตารางคะแนน · แก้: ใช้ helper เดียวใน `LeagueShared`

### S4 — ผลต่อเนื่องจาก A1 · **High**
- ถ้าไม่แก้ A1 Stats ย้อนหลัง/H2H ข้าม Season จะว่าง การคำนวณเองถูกต้องเมื่อมีข้อมูล: W/D/L, gf/ga, win rate, rival (`stats.js:3-4`) ตรวจแล้วตรงกับตารางคะแนน `index.js:97` เมื่อข้อมูลสมบูรณ์

### S5 — กรณีอื่น · **Low**
- `dashboard.js:6` `bestWinRate` ไม่มีขั้นต่ำจำนวนนัด → 1-0 (100%) ชนะ 9-1 (90%)
- `dashboard.js:7` rankMover เทียบ 2 รายการท้ายของ `rankHistory` โดยไม่เช็คว่าเป็น Season ติดกัน
- `stats.js:7` เลือกดูได้เฉพาะบัญชี active — ผู้เล่นที่ปิดบัญชีหายจากตัวเลือกแต่ยังอยู่ใน H2H ของคนอื่น
- `dashboard.js:4,8` ranking/จำนวนผู้เล่นนับบัญชีที่ปิดแล้ว
- tie-break ตารางคะแนน (`index.js:97`) ไม่มี H2H ผู้เสมอกันเป๊ะเรียงตามชื่อแต่ได้ RP ต่างกัน

---

## 4. ข้อ QA 4 — Prediction settlement เมื่อแก้คะแนนย้อนหลัง

หมายเหตุสำคัญ: ปุ่ม "คำนวณ" ถูก **override** โดย `predictions-realtime.js:102` (`onclick=refreshLeagueAndSettle`) ดังนั้น `settleAll` (`predictions.js:154`) และ `LeagueShared.settlementOutcome` (`shared.js:64`) เป็น dead code ใน UI แต่เป็นส่วนเดียวที่มีเทสต์ (`tests/shared.test.cjs`); logic จริงคือ `latestOutcomeForBet` (`predictions-realtime.js:1-17`) ซึ่งไม่มีเทสต์เลย

### P1 — ผลทายไม่ตามคะแนนที่ถูกแก้/ลบ · **High**
- ไฟล์: `predictions-realtime.js:2-4,19-72`, `predictions.js:165`, `predictions-export.js:16`
- ดีที่: กดปุ่ม "คำนวณ" ซ้ำจะคำนวณใหม่ทุก bet (ไม่ข้าม `won/lost`) และนับ "แก้ผล" ให้ (`:64,79`) ปัญหาคือ
  1. ต้องมีคนกดเอง — admin แก้คะแนน 11-9 → 9-11 หลัง settle ตารางยอดชำระและ export ยังใช้ผลเก่าจนกว่า dealer/admin จะกด ไม่มีการเตือนว่ามีผลที่ settle ไปแล้วถูกแก้
  2. ถ้าลบคะแนน (ทั้งสองช่องว่าง) `hasResult` เป็นเท็จ → `latestOutcomeForBet` คืน `null` → bet ที่เป็น `won/lost` ค้างเหมือนเดิม ไม่กลับเป็น `pending`
  3. การแก้ผลเงินไม่มี audit (เก็บแค่ `settledAt` ล่าสุด ไม่มีค่าเดิม)
- สถานการณ์: dealer กด settle → A ชนะ B 11-9, ทาย 500 ฝั่ง A = won +500; admin พบว่าพิมพ์ผิดและแก้เป็น 9-11 → ตารางยอดชำระยังบอกว่าเจ้ามือจ่าย 500 จนกว่าจะกดอีกรอบ
- แก้: คำนวณ status/net ตอน render จากคะแนนล่าสุดแทนการเก็บลง bet (หรือ re-settle อัตโนมัติเมื่อคะแนนเปลี่ยน); เมื่อ `hasResult` เป็นเท็จให้ reset เป็น `pending`; เก็บค่าก่อนแก้และเขียน audit; เพิ่มเทสต์ให้ `latestOutcomeForBet`

### P2 — ทายของ Season เก่าที่ยัง pending ค้างถาวร · **High**
- ไฟล์: `predictions-realtime.js:2` (`bet.season!==league.currentSeason → null`), `predictions.js:165` (กรอง `currentSeason`), `dashboard.js:8`, `suite.js:18`
- `finishSeason` (`index.js:102`) ไม่รู้จัก `predictions` เลย ไม่บังคับ settle ก่อนจบ หลังจบ Season `rounds` ใหม่ + `currentSeason++` → bets เก่าไม่ถูกคำนวณ ไม่ปรากฏในตารางยอด/ส่งออก (เงินที่ต้องจ่ายหายจากหน้าจอ) และ League Assistant/Dashboard นับ "รอผล" ค้างตลอด
- แก้: ก่อนจบ Season เช็ค bets pending (อ่านจาก cloud) แล้วบล็อก/เตือน; เก็บผลทายของ Season ที่จบไว้กับ archive; ให้ตารางยอดเลือก Season ได้

### P3 — ตลาดค้างข้ามการสร้างตารางใหม่ · **Medium**
- ไฟล์: `index.js:86` (applyRoster → `makeRoundRobin`), `predictions.js:138-139` (placeBet), `shared.js:70-77`
- `markets` คีย์ `s{season}:r{n}m{n}` ไม่ผูก pair เมื่อ Admin เปลี่ยนรายชื่อกลาง Season (Season เดิม) `r0m0` เปลี่ยนเป็นคู่ใหม่ แต่ตลาดเก่ายังอยู่ → `placeBet` ไม่ตรวจว่า `market.favoriteId` อยู่ใน `match.pair` → รับทายได้ แล้ว `predictionOutcome` คืน `null` (`shared.js:56`) ไม่มีวัน settle; bets เดิมที่เก็บ `pair` ไม่ตรงตารางใหม่ก็ pending ตลอด (`predictions-realtime.js:5`)
- แก้: ตอน `applyRoster` ล้างตลาดของ Season นั้นและ void/คืนยอด bets ที่ผูกคู่เก่า และเพิ่มเช็ค `pair.includes(market.favoriteId)` ใน `placeBet`/`betEligibility`

### P4 — การทายชนกับการบันทึกคะแนนของ admin · **Medium**
- ไฟล์: `sync-guard.js:57-90`, `predictions.js:26`
- ผู้เล่นทุกคนเขียน `predictions` ลงแถวเดียวกันและเปลี่ยน `updated_at` ของทั้งแถว ถ้า bet ถูก commit ระหว่างที่ Admin อ่าน→PATCH PATCH ได้ 0 แถว → `saveConflict` + `adoptRemote(remote…)` **ทิ้งการแก้คะแนนล่าสุดของ Admin บนหน้าจอ** (เหลือเป็น draft ในหน้า Backup) ช่วงใกล้จบคู่ยิ่งมีคนทายบ่อย
- แก้: แยก predictions ออกเป็นคนละแถว/ตาราง (หรือ merge ฝั่ง DB) ไม่ให้แชร์ `updated_at` กับ league; หรือเมื่อได้ 0 แถวและ league ไม่เปลี่ยนให้ retry ด้วย `updated_at` ใหม่แทนการทิ้ง

### P5 — ทายหลังเล่นจบแต่ก่อนกรอกผล · **Low**
- ไฟล์: `shared.js:75`, `predictions.js:45`
- ตลาดปิดอัตโนมัติเมื่อ `hasResult` (มีผลครบสองฝั่ง) เท่านั้น ถ้าคู่เล่นจบแล้วแต่ dealer ยังไม่ปิด คนรู้ผลแล้วทายได้ · แก้: ปิดอัตโนมัติเมื่อมีคะแนนฝั่งใดฝั่งหนึ่ง

### P6 — Error ซ้ำและ toast สีสำเร็จ · **Low**
- ไฟล์: `predictions-realtime.js:73,81-85`, `predictions.js:32`, `suite.js:11`
- `mutatePred` alert ของตัวเองแล้ว `refreshLeagueAndSettle` โยน error ซ้ำ ผู้ใช้เห็นล้มเหลว 2 ครั้ง และ `suite.js:11` เปลี่ยน `alert` ทุกอันเป็น toast สี "good" ที่หายใน 3.2 วินาที ข้อความผิดพลาดจึงดูเหมือนสำเร็จและอาจพลาด · แก้: ส่ง type ตามเนื้อหา/ใช้ `LeagueToast(msg,"bad")` ในจุดที่เป็น error

---

## 5. ข้อ QA 6 — Login lockout และสิทธิ์ Admin / Dealer / Player

### SEC1 — สิทธิ์ทั้งหมดบังคับแค่ฝั่ง client · **Critical** (ทราบแล้ว กำลังแก้ใน branch อื่น)
- ไฟล์: `supabase/migrations/20260919163000_create_shared_state.sql:11,25-29`, `shared.js:8-9,80-97`
- `anon` มีสิทธิ์ select/insert/update แถว `main` (publishable key อยู่ใน source) และ `league.profiles[*].pin` เป็น plaintext ดังนั้นใครก็ `GET` อ่านทุก PIN ได้ หรือ `PATCH` เปลี่ยน role/คะแนน/bets ได้ตรง ๆ; `pp_user_id` ใน localStorage คือ session ทั้งหมด แค่ตั้งเป็น id ของ admin ก็เป็น admin บนเครื่องนั้น
- แก้: Supabase Auth/Edge Function ตรวจ PIN แบบ hash ฝั่ง server + RLS ตาม role + policy `update` เฉพาะ admin (งานใน branch auth)

### R1 — ไม่มี separation of duties ระหว่าง admin / dealer / player · **Medium**
- ไฟล์: `index.js:95` (admin แก้คะแนนทุกคู่รวมคู่ตัวเอง), `shared.js:70-77` + เทสต์ "Admin can bet when not dealer", `predictions-realtime.js:20,48` (admin settle ได้) vs `predictions.js:114,157` (ตั้งตลาด/dealer เท่านั้น), `predictions-export.js:8`
- admin เป็นผู้เล่นและทายได้ พร้อมแก้คะแนน/ตั้งเจ้ามือ/settle ได้ → conflict of interest (ทายแล้วแก้ผล หรือตั้งตัวเองเป็นเจ้ามือแล้ว settle); สิทธิ์ settle (admin||dealer) ไม่ตรงกับสิทธิ์ตั้งตลาด (dealer เท่านั้น); เจ้ามือที่แข่ง **ในคู่นั้นเอง** ตั้งราคาต่อของคู่ตัวเองได้ (`canManageMarket` ไม่เช็ค pair) และการกระทำด้านเงิน (ตั้งเจ้ามือ `predictions.js:150`, ตลาด `:118`, settle) **ไม่เขียน `LeagueShared.audit`**
- แก้: กำหนดนโยบายให้ชัด (แนะนำ: ผู้แข่งในคู่แก้คะแนน/ตั้งราคาคู่ตัวเองไม่ได้; settle เฉพาะ dealer หรือ admin อย่างใดอย่างหนึ่ง) และเพิ่ม audit ฝั่ง predictions

### R2 — บัญชีที่ปิดใช้งานหายจากยอดชำระ · **Medium**
- ไฟล์: `predictions.js:165`, `predictions-export.js:13`
- ตารางสรุปวนจาก `activeProfiles()` เท่านั้น ถ้า admin ปิดบัญชีผู้เล่นที่มี bets won/lost ในรอบนี้ ยอดของเขาหายจากตาราง/ข้อความ export ทำให้ "สุทธิเจ้ามือ" ผิดโดยไม่มีคำเตือน · แก้: วนจาก userId ที่มี bets ใน Season (ติดป้าย "ปิดบัญชีแล้ว") หรือห้ามปิดบัญชีที่ยังมี bet ค้าง

### R3 — ปิดเจ้ามือ/แอดมินแล้วระบบค้าง · **Low**
- ไฟล์: `admin.js:54`, `shared.js:23`
- ปิดบัญชีที่เป็นเจ้ามือ → `isDealer` เป็นเท็จ ไม่มีใครตั้งตลาดได้จนกว่า admin ตั้งเจ้ามือใหม่ · admin 2 คนปิดบัญชีกันพร้อมกัน (เช็คแค่ `id===currentUserId`) → ไม่เหลือ admin ต้องแก้ DB · แก้: เช็ค "เหลือ admin active ≥ 1" ใน `mutate`

### R4 — PIN เริ่มต้น 1234 และไม่มีทางเปลี่ยนเอง · **Medium**
- ไฟล์: `index.js:24`, `admin.js:50,65`
- ทุกบัญชีเริ่ม/รีเซ็ตเป็น `1234` และผู้เล่นไม่มี UI เปลี่ยน PIN ของตัวเอง ทุกคนจึงสวมรอยกันได้แค่เลือกชื่อ + 1234 · แก้: บังคับเปลี่ยน PIN ครั้งแรก (หลังย้าย auth)

### R5 — Login lockout · **Low**
- ไฟล์: `shared.js:86-97`, `index.js:78`, `predictions.js:42`
- ล็อก 5 ครั้ง/60 วินาที เก็บใน `localStorage` ต่อเครื่อง: ล้าง storage/เปลี่ยนเบราว์เซอร์/ยิง API ตรงก็ข้ามได้ (เป็นแค่ UX) และ UI ไม่เรียก `loginGuardStatus` เลย → ระหว่างล็อก ใส่ PIN ถูกก็ขึ้น "PIN ไม่ถูกต้อง" ผู้ใช้ไม่รู้ว่าถูกล็อก · แก้: แสดงเวลาที่เหลือ; lockout จริงต้องทำฝั่ง server

### R6 — การเปลี่ยนสิทธิ์ระหว่าง session · **ผ่าน**
- `index.js:50-57`, `sync-guard.js:60-63`, `predictions.js:13-19`, `admin.js:26-29` อ่านโปรไฟล์ล่าสุดก่อนเขียนทุกครั้งและตัดสิทธิ์เมื่อ admin ถูกปิด/ลดสิทธิ์ — ไม่พบช่องว่างในฝั่ง client

---

## 6. รายการ innerHTML / template ที่แทรกข้อมูลผู้ใช้โดยไม่ผ่าน `escapeHtml`

หลักการ: เนื่องจาก `anon` เขียนทั้งแถวได้ (SEC1) **ทุกฟิลด์ที่มาจาก cloud ถือว่าผู้โจมตีควบคุมได้** (ไม่ใช่แค่ชื่อที่ admin พิมพ์) XSS ที่นี่หมายถึงขโมย `pp_user_id` และเรียก API แทนผู้ดูได้ ไม่มีฟิลด์ "note" ในแอป

### X1 — จุดที่ไม่ได้ escape · **Medium** (High เมื่อรวมกับ SEC1)

| ไฟล์:บรรทัด | ข้อมูลที่แทรก | บริบท |
|---|---|---|
| `predictions.js:69` | `${p.displayName}` | HTML ใน profile history — **ชื่อไม่ถูก escape** |
| `stats.js:6` (recentForm) | `title="… ${name(x.opponent)} …"` | attribute — ชื่อ/id ฝั่งตรงข้าม |
| `stats.js:6` (hRows) | `${name(m.pair[0])} vs ${name(m.pair[1])}` | HTML ใน `<td>` — **ชื่อไม่ถูก escape** |
| `stats.js:7` | `value="${p.id}"` | attribute ใน `<option>` |
| `predictions.js:84` | `value="${p.id}"` | attribute |
| `predictions.js:90,102` | `data-profile="${pred.dealerId}"` | attribute (ค่าจาก `predictions`) |
| `predictions.js:107` | `value="${m.pair[0]}"`, `${m.pair[1]}`, `value="${market.handicap}"` | attribute |
| `predictions.js:127` | `value="${m.pair[0]}"`, `${m.pair[1]}` | attribute |
| `predictions.js:165` | `data-profile="${p.id}"` | attribute |
| `predictions.js:166-167` | `data-profile="${b.userId}"`, `${b.id}`, `statusText()` คืน `s` ดิบเมื่อไม่รู้จัก | attribute/HTML จาก `bets[*]` |
| `index.js:83` | `data-roster="${p.id}"` | attribute |
| `index.js:90` | `value="${x.a??""}"` (คะแนนจาก `results`) | attribute |
| `index.js:101` | `${x.seasons}`, `${x.best}`, `${x.rp}` (มาจาก `rankHistory[*].rank/rpAward`) | HTML |
| `backup.js:6` | `${b.reason}`, `summary(b)` (`currentSeason`) | HTML จาก localStorage/snapshot |
| `recovery.js:115,130` | `${playerNames(c.ids)}` → `displayName` | HTML ใน preview — **ชื่อไม่ถูก escape** |
| `recovery.js:127` | `${c.source}` (มีชื่อ key ของ localStorage), `${c.season}`, `${c.reason}` | HTML |
| `archive.js:35` | `data-season="${a.season}"` | attribute |
| `archive.js:47` | `${row.rank}`, `${row.pts}`, `${row.gd}`, `${row.rpAward}` | HTML ใน `<td>` |
| `suite.js:24` | `${leagueState()?.currentSeason}` ผ่าน `document.write` | HTML ในหน้า print |

ที่ escape แล้วถูกต้อง: ชื่อใน `shared.js:102`, `index.js:83,89,90,98,101`, `admin.js:46`, `audit-view.js:2`, `archive.js:35,46,47,49`, `dashboard.js:8`, `predictions.js:84,90,102,107,127,165,167` (เฉพาะส่วนชื่อ), `suite.js:7`, `stats.js:7` (label ของ option), `sport-ui.js:59` (ผ่าน `Number`) · `archive-export.js` และ `predictions-export.js` ใช้ `textContent`/ข้อความล้วน ไม่ใช่ HTML sink

สถานการณ์ตัวอย่าง: คนที่มี publishable key (= ทุกคนที่เปิด source) `PATCH` ให้ `profiles.<id>.displayName = '<img src=x onerror=...>'` — หน้า Stats/H2H, profile popup และหน้า Recovery ของทุกคนที่เปิดจะรันสคริปต์ (หน้าอื่นที่ escape ชื่อไม่โดน แต่ id/ตัวเลขใน attribute ตามตารางข้างบนโดนได้)

- แก้: (1) ใช้ `esc()` กับ **ทุก** ค่าที่มาจากข้อมูล รวมค่าใน attribute และตัวเลข (หรือ `Number(...)`) (2) เปลี่ยนเป็น `textContent`/`createElement` + `dataset` สำหรับ id (3) เพิ่ม CSP ผ่าน `<meta http-equiv="Content-Security-Policy">` (4) validate schema ขาเข้า (`validateLeague` ควรเช็ค `displayName` เป็น string ความยาวจำกัด และ `id` ตรงรูปแบบ `^[A-Za-z0-9_]+$`)

### X2 — CSV Injection · **Low**
- ไฟล์: `suite.js:21`, `archive-export.js:3`
- ชื่อที่ขึ้นต้นด้วย `=`, `+`, `-`, `@` ถูก export โดยครอบ quote อย่างเดียว เปิดใน Excel/Sheets อาจรันสูตร · แก้: นำหน้าเซลล์เสี่ยงด้วย `'`

### X3 — `printPdf` ไม่ตรวจ popup ถูกบล็อก · **Low**
- ไฟล์: `suite.js:24`
- `window.open` คืน `null` เมื่อ Safari บล็อก → `win.document` TypeError ไม่มี toast · แก้: `if(!win) return toast(...)`

---

## 7. ข้อ QA 5 — Export PNG / CSV / PDF บน Safari iPhone (ตรวจจากโค้ดเท่านั้น)

ยังไม่ได้ทดสอบบนอุปกรณ์ จุดที่ควรทดสอบ: `suite.js:23` PNG ใช้ `<a download href=dataURL>` — Safari iOS บางเวอร์ชันเปิดภาพในแท็บแทนการบันทึก; `suite.js:22` ใช้ Blob + `download` ใช้ได้ iOS 13+; `suite.js:24` พึ่ง `window.open` + `window.print()` (ดู X3); `suite.js:25`/`archive-export.js:5` ใช้ `navigator.share` ต้องเรียกจาก user gesture (ถูกต้อง) ถ้าไม่รองรับ fallback เป็น clipboard ที่ไม่ได้ตรวจผลลัพธ์แล้วโชว์ toast สำเร็จเสมอ

---

## 8. ช่องว่างของเทสต์และข้อเสนอ (ตามลำดับความสำคัญ)

1. **แก้ A1 + เพิ่มเทสต์รวมสคริปต์** (โหลด `index.js` + hooks ใน jsdom, กดจบ Season, ตรวจ archive) — ปัจจุบันเทสต์ครอบคลุมเฉพาะ `shared.js`
2. เทสต์ `latestOutcomeForBet`/`refreshLeagueAndSettle` (P1–P3) — ตอนนี้ไม่มี และเทสต์เดิมทดสอบ dead code (`settlementOutcome`)
3. แยกฟังก์ชันคำนวณ (standings, `statsFor`, `h2h`) ออกเป็นโมดูลที่โหลดใน Node ได้ แล้วเขียนเทสต์ (S1–S2)
4. แก้ XSS (X1) และ B1/B3/B4 ซึ่งแก้ง่ายและผลกระทบสูง
5. แก้ SEC1 ผ่าน branch auth ที่กำลังทำ — ระหว่างนี้อย่าใช้กับเงินจริง
