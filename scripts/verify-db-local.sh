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
