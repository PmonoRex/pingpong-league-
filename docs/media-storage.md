# Sharp match-card backgrounds (Supabase Storage)

Card background pictures can be stored in two ways:

- **Without setup:** a 480px copy is stored inside the league data (about 36KB each). It works, but is a little soft on phones.
- **With the `media` bucket:** a 1080px copy is uploaded to Supabase Storage, and only its link is stored in the league data. It is sharp, and polls stay small.

## One-time setup

1. Open the Supabase project → **SQL Editor** → **New query**.
2. Paste the contents of `supabase/migrations/20261018120000_media_bucket.sql` and press **Run**.
3. Have players pick their background picture again (เมนู → โปรไฟล์ของฉัน → ภาพพื้นหลังการ์ด). The status line then reads "อัปโหลดภาพคมชัดแล้ว".

The bucket only accepts WebP or JPEG files up to 1MB in the `banners/` folder. Anyone who opens the site can view the pictures, the same as profile pictures.
