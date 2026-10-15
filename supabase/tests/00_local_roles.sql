-- Local-only stand-ins for the Supabase roles/schema (run before the migrations on plain Postgres).
create role anon nologin; create role authenticated nologin;
create schema extensions; grant usage on schema public to anon, authenticated;
