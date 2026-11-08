#!/usr/bin/env bash
# Runs the APEX migrations twice (idempotency) against a throw-away local PostgreSQL
# database with a minimal Supabase stub, then runs the RLS behaviour checks.
# Usage: PSQL="psql -h localhost -U postgres" scripts/verify-db-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL=${PSQL:-"sudo -u postgres psql"}
$PSQL -q -v ON_ERROR_STOP=1 < supabase/tests/local_supabase_stub.sql
for pass in 1 2; do
  for f in supabase/migrations/*.sql; do
    $PSQL -q -v ON_ERROR_STOP=1 -d apex_test < "$f" > /dev/null 2>&1 || { echo "FAILED: $f (pass $pass)"; exit 1; }
  done
done
echo "Migrations applied twice without errors."
$PSQL -q -v ON_ERROR_STOP=1 -d apex_test < supabase/tests/rls_check.sql
$PSQL -q -v ON_ERROR_STOP=1 -d apex_test < supabase/tests/scene_runtime_check.sql
$PSQL -q -v ON_ERROR_STOP=1 -d apex_test < supabase/tests/scene_motion_check.sql
$PSQL -q -v ON_ERROR_STOP=1 -d apex_test < supabase/tests/scene_travel_check.sql
$PSQL -q -v ON_ERROR_STOP=1 -d apex_test < supabase/tests/scene_local_time_check.sql
$PSQL -q -v ON_ERROR_STOP=1 -d apex_test < supabase/tests/scene_turn_blocks_check.sql

# Post-deploy checks (the same file the GitHub workflow runs against production).
$PSQL -q -v ON_ERROR_STOP=1 -d apex_test < supabase/tests/post_deploy_checks.sql
$PSQL -q -v ON_ERROR_STOP=1 -d apex_test < supabase/tests/asset_pack_catalog_check.sql
echo "Post-deploy checks passed."

