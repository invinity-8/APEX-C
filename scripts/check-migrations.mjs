#!/usr/bin/env node
/**
 * Supabase migration guard for APEX.
 *
 * Fails (exit code 1) with a clear message when:
 *   - a migration file name is invalid or a version is duplicated
 *   - a version registered in production (supabase/remote_history.txt, or --remote <file>
 *     with one version per line) has NO file in supabase/migrations   → "missing migration"
 *   - a pending (not yet applied) migration is older than the newest applied one
 *     → Supabase would refuse or skip it
 *   - a pending migration contains destructive SQL (DROP TABLE, TRUNCATE, DELETE FROM, DROP COLUMN …)
 *     without the review marker  -- apex:destructive-reviewed
 *
 * Usage:  node scripts/check-migrations.mjs [--remote versions.txt] [--json]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME_RE = /^(\d{14})_([a-z0-9_]+)\.sql$/;
const DESTRUCTIVE = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+schema\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[^;]*\bdrop\s+column\b/i,
  /\bdrop\s+type\b/i,
];
const REVIEWED = /--\s*apex:destructive-reviewed/i;

/** Parses "version [name]" lines, ignoring comments and blanks. */
export function parseVersionList(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/)[0])
    .filter((v) => /^\d{14}$/.test(v));
}

/** Pure check – easy to unit test. files: [{ name, sql }], remote: string[] */
export function checkMigrations(files, remote) {
  const errors = [];
  const warnings = [];
  const local = new Map();
  for (const f of files) {
    const m = NAME_RE.exec(f.name);
    if (!m) {
      errors.push(`Invalid migration file name "${f.name}" – expected <14-digit timestamp>_<lower_snake_name>.sql`);
      continue;
    }
    if (local.has(m[1])) errors.push(`Duplicate migration version ${m[1]} ("${local.get(m[1]).name}" and "${f.name}")`);
    local.set(m[1], f);
  }
  const remoteSet = [...new Set(remote)].sort();
  for (const v of remoteSet) {
    if (!local.has(v)) {
      errors.push(
        `MISSING MIGRATION: version ${v} is registered in the production database but there is no file supabase/migrations/${v}_*.sql. ` +
          `Restore it from the production history (docs/MIGRATIONS_DE.md, Schritt 2) – do not invent its contents.`,
      );
    }
  }
  const newestApplied = remoteSet.length ? remoteSet[remoteSet.length - 1] : '';
  const pending = [...local.keys()].filter((v) => !remoteSet.includes(v)).sort();
  for (const v of pending) {
    const f = local.get(v);
    if (v <= newestApplied) {
      errors.push(
        `OUT OF ORDER: pending migration ${f.name} is older than the newest applied version ${newestApplied}. ` +
          `Supabase would refuse or skip it. Give it a newer timestamp (it has not been applied yet).`,
      );
    }
    if (DESTRUCTIVE.some((re) => re.test(f.sql)) && !REVIEWED.test(f.sql)) {
      errors.push(
        `DESTRUCTIVE SQL in pending migration ${f.name} (DROP/TRUNCATE/DELETE). Review it, then add the line "-- apex:destructive-reviewed" to allow it.`,
      );
    }
  }
  if (!remoteSet.length) warnings.push('No production migration history given – only local checks were run.');
  return { errors, warnings, pending: pending.map((v) => local.get(v).name), applied: remoteSet };
}

function main() {
  const args = process.argv.slice(2);
  const remoteIdx = args.indexOf('--remote');
  const dir = join(ROOT, 'supabase', 'migrations');
  const files = readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
  const manifest = join(ROOT, 'supabase', 'remote_history.txt');
  const remoteText = remoteIdx >= 0 ? readFileSync(args[remoteIdx + 1], 'utf8') : existsSync(manifest) ? readFileSync(manifest, 'utf8') : '';
  const source = remoteIdx >= 0 ? `live production history (${args[remoteIdx + 1]})` : 'supabase/remote_history.txt';
  const res = checkMigrations(files, parseVersionList(remoteText));
  const gh = !!process.env.GITHUB_ACTIONS;
  console.log(`Supabase migration check – compared with ${source}`);
  console.log(`  applied in production: ${res.applied.join(', ') || '(none listed)'}`);
  console.log(`  pending (will be applied in this order): ${res.pending.join(', ') || '(none)'}`);
  for (const w of res.warnings) console.log(gh ? `::warning::${w}` : `WARNING: ${w}`);
  for (const e of res.errors) console.log(gh ? `::error::${e}` : `ERROR: ${e}`);
  if (args.includes('--json')) console.log(JSON.stringify(res));
  if (res.errors.length) {
    console.log(`\n✗ ${res.errors.length} problem(s). The database deployment must not run until they are fixed.`);
    process.exit(1);
  }
  console.log('\n✓ Migrations are consistent.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
