# แจ้งเตือนแบบ Push (เด้งแม้ปิดแอป)

คู่มือนี้สำหรับเจ้าของโปรเจกต์ Supabase ทำทุกอย่างผ่านหน้าเว็บ Supabase Dashboard ได้ ไม่ต้องใช้คำสั่ง (CLI) ใช้เวลาประมาณ 20 นาที

## ทำงานอย่างไร

1. ผู้เล่นกด **เปิดแจ้งเตือน** ในเมนูของเว็บ มือถือเครื่องนั้นจะได้ "ที่อยู่รับแจ้งเตือน" จาก Google หรือ Apple แล้วเว็บบันทึกไว้ในตาราง `push_subscriptions` คู่กับรหัสผู้เล่น
2. ทุกครั้งที่ข้อมูลลีกเปลี่ยน (ตาราง `app_state`) Supabase จะเรียก **Edge Function** ชื่อ `push-notify` ผ่าน **Database Webhook**
3. ฟังก์ชันเทียบข้อมูลก่อนและหลังการบันทึก แล้วส่งแจ้งเตือนไปที่มือถือของคนที่เกี่ยวข้อง:
   - **ผลออกแล้ว / ชนะแล้ว!**: ส่งถึงผู้เล่นทั้งสองคนของแมตช์นั้น เช่น "คุณ 11–7 บอม"
   - **ถึงคิวคุณแล้ว**: ส่งถึงผู้เล่นในรอบถัดไปเมื่อรอบก่อนหน้าแข่งครบ
   - **เปิดทายผลแล้ว**: ส่งถึงทุกคน ยกเว้นเจ้ามือและสองคนที่แข่งคู่นั้น (เพราะทายคู่ตัวเองไม่ได้)
   - **มีคนท้าดวลคุณ! / รับคำท้าแล้ว / คอมเมนต์แมตช์คุณ**: จากข้อมูลคลับ (แถว `club`)

ระหว่างที่ยังตั้งค่าไม่เสร็จ เว็บจะใช้การแจ้งเตือนแบบเดิมต่อไปตามปกติ (เด้งเฉพาะตอนเปิดเว็บหรือแอปค้างไว้) ไม่มีอะไรพัง

**มือถือที่รองรับ:** Android ที่ใช้ Chrome รองรับทันที ส่วน iPhone/iPad ต้องเป็น iOS 16.4 ขึ้นไป และต้อง **ติดตั้งเป็นแอป** (Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม) แล้วเปิดแจ้งเตือนจากแอปที่ติดตั้งแล้ว

## สิ่งที่ต้องมีก่อนเริ่ม

- รัน `20261018130000_harden_shared_state.sql` และ `20261019120000_club_row.sql` แล้ว (ดู SECURITY_REVIEW.md)
- **กุญแจ VAPID** (คู่กุญแจสำหรับส่งแจ้งเตือน) ผู้ดูแลโค้ดจะส่งให้ 2 ค่า:
  - `publicKey` (กุญแจสาธารณะ ยาวประมาณ 87 ตัวอักษร ขึ้นต้นด้วย `B`) เปิดเผยได้
  - `privateKey` (กุญแจลับ ยาวประมาณ 43 ตัวอักษร) **ห้ามเปิดเผย** ห้ามใส่ในแชตกลุ่มหรือในโค้ด
- **รหัสลับ webhook**: ตั้งเองเป็นข้อความสุ่มยาวอย่างน้อย 32 ตัว ใช้แค่ตัวอังกฤษกับตัวเลข เช่น สร้างจากโปรแกรมจัดการรหัสผ่าน จดไว้ เพราะต้องใช้ 2 ที่ (ขั้นที่ 3 และ 4)

## ขั้นที่ 1: สร้างตาราง (SQL)

1. เข้า Supabase Dashboard แล้วเลือกโปรเจกต์ของลีก
2. เมนูซ้ายเลือก **SQL Editor** แล้วกด **New query**
3. เปิดไฟล์ `supabase/migrations/20261019130000_push.sql` คัดลอกทั้งไฟล์ไปวาง แล้วกด **Run**
4. ต้องขึ้นว่า `Success. No rows returned` (รันซ้ำได้ ไม่เสียหาย)

ไฟล์นี้สร้างตาราง `push_subscriptions` และฟังก์ชันที่เว็บใช้บันทึกหรือลบเครื่อง คนทั่วไปอ่านรายชื่อเครื่องในตารางนี้ไม่ได้

## ขั้นที่ 2: สร้าง Edge Function

1. เมนูซ้ายเลือก **Edge Functions** → **Deploy a new function** → **Via Editor**
2. ตั้งชื่อฟังก์ชันว่า `push-notify` (ต้องตรงตัวนี้)
3. ในหน้าแก้ไข ต้องมีไฟล์ 3 ไฟล์ ชื่อต้องตรงทุกตัวอักษร:
   - `index.ts`: ลบโค้ดตัวอย่างที่มีอยู่ทิ้ง แล้ววางเนื้อหาจาก `supabase/functions/push-notify/index.ts`
   - `events.js`: กดปุ่มเพิ่มไฟล์ (**+** หรือ **Add file**) ตั้งชื่อ `events.js` แล้ววางเนื้อหาจาก `supabase/functions/push-notify/events.js`
   - `webpush.js`: เพิ่มไฟล์อีกไฟล์ ตั้งชื่อ `webpush.js` แล้ววางเนื้อหาจาก `supabase/functions/push-notify/webpush.js`
4. กด **Deploy function** แล้วรอจนขึ้นว่า deploy สำเร็จ
5. เปิดฟังก์ชัน `push-notify` → แท็บ **Details** (หรือ **Settings**) → ปิด **Enforce JWT verification** (Verify JWT) แล้วกด **Save**
   (ฟังก์ชันนี้ตรวจรหัสลับ webhook เองอยู่แล้ว ถ้าไม่ปิด webhook จะถูกปฏิเสธด้วย 401)

> ถ้าหน้าแก้ไขเพิ่มไฟล์ไม่ได้: ให้วางเนื้อหา `events.js` แล้วต่อด้วย `webpush.js` ไว้บนสุดของ `index.ts` แล้วลบ 2 บรรทัด `import "./events.js";` และ `import "./webpush.js";` ออก ผลลัพธ์เหมือนกัน

## ขั้นที่ 3: ใส่ค่าลับ (Secrets)

เมนูซ้าย **Edge Functions** → **Secrets** (บางเวอร์ชันอยู่ที่ **Project Settings → Edge Functions**) แล้วเพิ่มทีละค่า:

| Name | Value |
|---|---|
| `VAPID_PUBLIC_KEY` | `publicKey` ที่ได้รับ |
| `VAPID_PRIVATE_KEY` | `privateKey` ที่ได้รับ |
| `VAPID_SUBJECT` | `mailto:` ตามด้วยอีเมลของคุณ เช่น `mailto:owner@gmail.com` (Apple และ Google ใช้ติดต่อกรณีมีปัญหา) |
| `PUSH_WEBHOOK_SECRET` | รหัสลับ webhook ที่ตั้งไว้ |

กด **Save** ค่าใหม่มีผลกับฟังก์ชันทันที ไม่ต้อง deploy ใหม่
(`SUPABASE_URL` กับ `SUPABASE_SERVICE_ROLE_KEY` Supabase ใส่ให้เอง ไม่ต้องเพิ่ม)

## ขั้นที่ 4: สร้าง Database Webhook

1. เมนูซ้าย **Database** → **Webhooks** (ถ้ามีปุ่ม **Enable webhooks** ให้กดก่อน)
2. กด **Create a new hook** แล้วกรอก:
   - **Name:** `push-notify` (ต้องตรงตัวนี้ ขั้นที่ 5 ใช้ชื่อนี้)
   - **Table:** `app_state` (schema `public`)
   - **Events:** ติ๊กเฉพาะ **Update** (ไม่ติ๊ก Insert และ Delete)
   - **Type of webhook:** **Supabase Edge Functions**
   - **Edge Function:** `push-notify` และ **Method:** `POST`
   - **Timeout:** `5000` (ms)
   - **HTTP Headers:** กด **Add a new header** ตั้ง Name เป็น `x-push-secret` และ Value เป็นรหัสลับ webhook (ต้องตรงกับ `PUSH_WEBHOOK_SECRET`) ส่วน header `Content-type: application/json` ที่มีอยู่แล้วให้คงไว้
3. กด **Create webhook**

## ขั้นที่ 5 (แนะนำ): กรองให้เรียกเฉพาะตอนที่จำเป็น

แถว `live` (นับแต้มสด) ถูกบันทึกทุก 2–3 วินาทีระหว่างแข่ง และหน้า Dummy ก็บันทึกบ่อย ถ้าไม่กรอง ฟังก์ชันจะถูกเรียกทุกครั้งโดยไม่ได้ส่งอะไร ซึ่งเปลืองโควตา

ไปที่ **SQL Editor** → **New query** วางโค้ดด้านล่างแล้วกด **Run** ต้องขึ้นว่า Success

```sql
do $$
declare def text;
begin
  select pg_get_triggerdef(t.oid) into def from pg_trigger t
  where t.tgrelid = 'public.app_state'::regclass and t.tgname = 'push-notify' and not t.tgisinternal;
  if def is null then raise exception 'ไม่พบ webhook ชื่อ push-notify (ทำขั้นที่ 4 ก่อน)'; end if;
  if position(' WHEN ' in def) > 0 then raise notice 'กรองไว้แล้ว ไม่ต้องทำซ้ำ'; return; end if;
  def := replace(def, 'FOR EACH ROW EXECUTE',
    'FOR EACH ROW WHEN (old.id in (''main'', ''club'') and (old.league is distinct from new.league or old.predictions is distinct from new.predictions)) EXECUTE');
  execute 'drop trigger "push-notify" on public.app_state';
  execute def;
end $$;
```

ถ้าภายหลังแก้ webhook ในหน้า Dashboard อีก ตัวกรองจะหายไป ให้รันโค้ดนี้ซ้ำ

## ขั้นที่ 6: ใส่กุญแจสาธารณะในเว็บ

ใส่ `publicKey` ในไฟล์ `push-config.js`:

```js
window.PUSH_VAPID_PUBLIC_KEY = "ใส่ publicKey ตรงนี้";
```

ผู้ดูแลโค้ดจะเป็นคนใส่และขึ้นเว็บให้ (ตอนแก้ไฟล์นี้ต้องเปลี่ยนเลข `?v=` ของ `push-config.js` ในทุกหน้า `.html` ด้วย มือถือจะได้โหลดไฟล์ใหม่) **ใส่เฉพาะ publicKey เท่านั้น** ห้ามใส่ privateKey ในโค้ด

ก่อนที่ไฟล์นี้จะมีกุญแจ เว็บจะใช้การแจ้งเตือนแบบเดิม

## ทดสอบ

**ทดสอบด้วยมือถือจริง**
1. เปิดเว็บบนมือถือ Android (Chrome) หรือแอปที่ติดตั้งบน iPhone แล้วเข้าสู่ระบบ
2. เมนู → **เปิดแจ้งเตือน** → อนุญาต ข้อความยืนยันต้องลงท้ายว่า "แม้ปิดแอปอยู่"
3. ดูใน Dashboard: **Table Editor** → `push_subscriptions` ต้องมีแถวใหม่ และ `user_id` ต้องเป็นรหัสผู้เล่นของคุณ
4. ปิดแอปบนมือถือ แล้วใช้อีกเครื่องกรอกผลแมตช์ของผู้เล่นคนนั้น ภายในไม่กี่วินาทีต้องมีแจ้งเตือน "ผลออกแล้ว" เด้งขึ้นมา

**ทดสอบฟังก์ชันอย่างเดียว (ไม่ต้องกรอกผลจริง)**
ใน **Edge Functions** → `push-notify` → **Test** (หรือ Invoke) เลือก `POST` แล้ว:
- Header: `x-push-secret` = รหัสลับ webhook
- Body: วางข้อความด้านล่าง โดยเปลี่ยน `ใส่รหัสผู้เล่น` (2 ที่) เป็นรหัสผู้เล่นของคุณ ซึ่งดูได้จากคอลัมน์ `user_id` ในตาราง `push_subscriptions`

```json
{"type":"UPDATE","table":"app_state","schema":"public",
 "record":{"id":"main","league":{"uidLeague":{"currentSeason":1,"profiles":{"ใส่รหัสผู้เล่น":{"displayName":"ฉัน"},"t_test":{"displayName":"คู่ทดสอบ"}},"rounds":[{"m":[["ใส่รหัสผู้เล่น","t_test"]]}],"results":{"r0m0":{"a":11,"b":7}}}}},
 "old_record":{"id":"main","league":{"uidLeague":{"currentSeason":1,"profiles":{},"rounds":[{"m":[["ใส่รหัสผู้เล่น","t_test"]]}],"results":{}}}}}
```

คำตอบควรเป็น `{"events":2}` (สถานะ 200 หรือ 202 ส่วนคู่ทดสอบไม่มีเครื่องลงทะเบียน จึงไม่มีใครได้รับ) และมือถือต้องได้รับแจ้งเตือน "ชนะแล้ว! คุณ 11–7 คู่ทดสอบ" การทดสอบนี้ไม่แก้ข้อมูลลีกจริง

## แก้ปัญหา

| อาการ | สาเหตุและวิธีแก้ |
|---|---|
| เปิดแจ้งเตือนแล้ว แต่ไม่มีแถวใน `push_subscriptions` | ยังไม่ได้รันขั้นที่ 1 หรือ `push-config.js` ยังไม่มีกุญแจ (ขั้นที่ 6) หรือยังไม่ได้เข้าสู่ระบบ หรือบน iPhone ยังไม่ได้ติดตั้งเป็นแอป ลองปิดแล้วเปิดแจ้งเตือนใหม่ |
| ดูว่า webhook ถูกเรียกหรือยัง | SQL Editor: `select status_code, content, created from net._http_response order by created desc limit 10;` ต้องเห็น 200 หรือ 202 |
| `401 bad secret` | header `x-push-secret` ในขั้นที่ 4 ไม่ตรงกับ `PUSH_WEBHOOK_SECRET` ในขั้นที่ 3 (ระวังเว้นวรรคหน้าหรือหลัง) |
| 401 ที่ไม่มีคำว่า bad secret | ยังไม่ได้ปิด Enforce JWT verification (ขั้นที่ 2 ข้อ 5) |
| `500 ... is not set` | ใส่ Secrets ไม่ครบหรือสะกดชื่อผิด (ขั้นที่ 3) |
| `database 401` ใน Logs | โปรเจกต์ปิด service_role key แบบเก่าไว้ ให้สร้าง Secret key ใหม่ (Project Settings → API Keys → Secret keys ขึ้นต้น `sb_secret_`) แล้วเพิ่ม Secret ชื่อ `PUSH_SERVICE_KEY` เป็นค่านั้น |
| `database 404` ใน Logs | ยังไม่ได้รันขั้นที่ 1 |
| Logs ขึ้น `... failed [403 ...]` | กุญแจ VAPID สองค่าไม่ใช่คู่เดียวกัน หรือไม่ตรงกับใน `push-config.js` ให้ใส่ใหม่ให้ตรงกัน แล้วให้ผู้เล่นปิดและเปิดแจ้งเตือนใหม่ |
| ดู Logs ที่ไหน | Edge Functions → `push-notify` → **Logs** ทุกครั้งที่ส่งจะมีบรรทัด `push-notify row main: 2 event(s), 2 push(es): 2 ok, 0 gone, 0 failed` |
| `gone` ใน Logs | มือถือเครื่องนั้นยกเลิกแจ้งเตือนหรือลบแอปแล้ว ระบบลบเครื่องนั้นออกจากตารางให้เอง ไม่ต้องทำอะไร |
| Android ได้ช้าหรือไม่ได้ | โหมดประหยัดแบตบางรุ่นปิดแจ้งเตือนของ Chrome ให้ไปที่ ตั้งค่า → แอป → Chrome → แบตเตอรี่ → ไม่จำกัด |
| ปิดระบบทั้งหมด | ลบ webhook `push-notify` ใน Database → Webhooks แล้วเว็บจะกลับไปใช้แจ้งเตือนแบบเดิม |

## ข้อจำกัดที่ควรรู้

- ทุกคนที่มีเว็บนี้สามารถลงทะเบียนเครื่องของตัวเองโดยใส่รหัสผู้เล่นของคนอื่นได้ จึงอาจได้รับแจ้งเตือนของคนนั้น ซึ่งเป็นข้อมูลที่ทุกคนเห็นบนเว็บอยู่แล้ว (ผลแข่ง คิว คำท้า) แต่จะไม่ได้สิทธิ์อื่นเพิ่ม
- แจ้งเตือนส่งตามข้อมูลที่บันทึกลงคลาวด์ ถ้าแก้ผลซ้ำ แจ้งเตือนใหม่จะแทนที่อันเดิมบนมือถือ ไม่ซ้อนกัน
- คนหนึ่งได้รับแจ้งเตือนไม่เกิน 3 รายการต่อการบันทึกหนึ่งครั้ง และลงทะเบียนได้สูงสุด 10 เครื่อง
