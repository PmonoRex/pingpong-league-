-- Public "media" bucket for full-resolution pictures (match-card backgrounds), so they stay out of the league row.
-- Anyone can read; the site's publishable key may add and replace files under banners/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 1048576, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp', 'image/jpeg'];

drop policy if exists "media read" on storage.objects;
create policy "media read" on storage.objects for select
  using (bucket_id = 'media');

drop policy if exists "media upload banners" on storage.objects;
create policy "media upload banners" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = 'banners');

drop policy if exists "media replace banners" on storage.objects;
create policy "media replace banners" on storage.objects for update to anon, authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = 'banners');
