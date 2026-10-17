-- Dummy (ดัมมี่) card scores shared across devices.
-- Lives beside league/predictions in the same row; the page uses dummy->>'rev' as its own optimistic lock
-- and never touches updated_at, so Dummy saves do not collide with league or prediction saves.
alter table public.app_state
  add column if not exists dummy jsonb not null default '{}'::jsonb;
