#!/usr/bin/env bash
# Post-deploy verification for APEX (runs in GitHub Actions after a push to main).
#
# 1. Waits until the Supabase GitHub integration has registered EVERY local migration in the
#    production history (supabase_migrations.schema_migrations). Fails clearly on timeout.
# 2. Runs the read-only schema/RLS/grant checks (supabase/tests/post_deploy_checks.sql).
# 3. Optionally calls the public health endpoint of the live site (APEX_URL).
#
# Environment: DB_URL (read-only role, see docs/MIGRATIONS_DE.md), optional APEX_URL, WAIT_SECONDS (default 900).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DB_URL:?DB_URL is not set}"
WAIT_SECONDS="${WAIT_SECONDS:-900}"

mapfile -t LOCAL < <(ls supabase/migrations/*.sql | xargs -n1 basename | cut -c1-14 | sort)
echo "Local migrations: ${LOCAL[*]}"

deadline=$((SECONDS + WAIT_SECONDS))
while true; do
  REMOTE="$(psql "$DB_URL" -At -c 'select version from supabase_migrations.schema_migrations order by version')"
  missing=()
  for v in "${LOCAL[@]}"; do grep -qx "$v" <<<"$REMOTE" || missing+=("$v"); done
  # Versions in production without a file are a hard error (the integration cannot work then).
  extra=()
  while read -r v; do [ -n "$v" ] && ! printf '%s\n' "${LOCAL[@]}" | grep -qx "$v" && extra+=("$v"); done <<<"$REMOTE"
  if [ ${#extra[@]} -gt 0 ]; then
    echo "::error::Production has migration versions without a file in supabase/migrations: ${extra[*]}. Restore them (docs/MIGRATIONS_DE.md, Schritt 2)."
    exit 1
  fi
  if [ ${#missing[@]} -eq 0 ]; then
    echo "All ${#LOCAL[@]} migrations are registered in production."
    break
  fi
  if [ $SECONDS -ge $deadline ]; then
    echo "::error::The Supabase GitHub integration did not apply these migrations within ${WAIT_SECONDS}s: ${missing[*]}. Check Supabase Dashboard → Project Settings → Integrations → GitHub (Deploy to production) and the deployment log."
    exit 1
  fi
  echo "Waiting for the Supabase GitHub integration to apply: ${missing[*]}"
  sleep 30
done

echo "Production migration history:"
psql "$DB_URL" -c 'select version, name from supabase_migrations.schema_migrations order by version'
psql "$DB_URL" -v ON_ERROR_STOP=1 -v require_legacy=1 -f supabase/tests/post_deploy_checks.sql

if [ -n "${APEX_URL:-}" ]; then
  echo "Checking ${APEX_URL}/api/apex?op=health"
  curl -fsS "${APEX_URL%/}/api/apex?op=health" -o health.json || { echo "::error::Health endpoint not reachable"; exit 1; }
  node -e '
    const h = require("./health.json");
    const keys = ["serverConfigured", "database", "authAdmin", "campaignSeeded", "presenceColumn", "profilesTable"];
    const bad = keys.filter((k) => h[k] !== true);
    console.log(JSON.stringify(h, null, 2));
    if (bad.length) { console.log(`::error::Health check not OK: ${bad.join(", ")} ${JSON.stringify(h.errors ?? [])}`); process.exit(1); }
  '
fi
echo "✓ Production database verified."
