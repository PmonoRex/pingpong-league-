#!/usr/bin/env sh
# Replays the migrations and the anon RPC scenarios against a throwaway local Postgres (never a Supabase project).
# Usage: sh supabase/tests/run-local.sh auth|settlement   (needs Docker; prints each step, "ERROR" lines are the expected rejections)
set -e
case "$1" in auth|settlement) ;; *) echo "usage: $0 auth|settlement"; exit 2;; esac
dir=$(dirname "$0"); name=pp-local-pg-$$
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test postgres:16 >/dev/null
trap 'docker rm -f "$name" >/dev/null' EXIT
until docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done; sleep 2
psql() { docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql < "$dir/00_local_roles.sql"
psql < "$dir/../migrations/20260919163000_create_shared_state.sql" 2>/dev/null
psql < "$dir/$1_seed.sql"
for f in "$dir"/../migrations/2026101*.sql; do psql < "$f"; done
docker exec -i "$name" psql -U postgres -tA < "$dir/$1_scenario.sql" 2>&1
