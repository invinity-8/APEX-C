import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../src/server/schema';
// @ts-expect-error – plain ESM script without type declarations
import { checkMigrations, parseVersionList } from '../scripts/check-migrations.mjs';

type Result = { errors: string[]; pending: string[] };
const f = (name: string, sql = 'select 1;') => ({ name, sql });

describe('Supabase migration guard', () => {
  it('fails clearly when a production version has no file', () => {
    const r: Result = checkMigrations([f('20261101100000_apex_online.sql')], ['20261101094428']);
    expect(r.errors.join()).toMatch(/MISSING MIGRATION: version 20261101094428/);
  });

  it('fails when a pending migration is older than the newest applied one', () => {
    const r: Result = checkMigrations([f('20261101094428_apex_initial_account_allowlist.sql'), f('20261101000100_apex_online.sql')], ['20261101094428']);
    expect(r.errors.join()).toMatch(/OUT OF ORDER/);
  });

  it('blocks unreviewed destructive SQL in pending migrations only', () => {
    const bad = checkMigrations([f('20261104000000_x.sql', 'drop table public.apex_access;')], []) as Result;
    expect(bad.errors.join()).toMatch(/DESTRUCTIVE/);
    const ok = checkMigrations([f('20261104000000_x.sql', '-- apex:destructive-reviewed\ndrop table public.tmp;')], []) as Result;
    expect(ok.errors).toEqual([]);
    const applied = checkMigrations([f('20261104000000_x.sql', 'delete from t;')], ['20261104000000']) as Result;
    expect(applied.errors).toEqual([]);
  });

  it('rejects bad names and duplicate versions', () => {
    const r: Result = checkMigrations([f('apex.sql'), f('20261104000000_a.sql'), f('20261104000000_b.sql')], []);
    expect(r.errors.length).toBe(2);
  });

  it('the repository migrations match the production history and the server contract', () => {
    const dir = 'supabase/migrations';
    const names = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
    const files = names.map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, 'utf8') }));
    const remote = parseVersionList(readFileSync('supabase/remote_history.txt', 'utf8'));
    const r: Result = checkMigrations(files, remote);
    expect(r.errors).toEqual([]);
    // EXPECTED_MIGRATIONS (checked by /api/apex?op=health) must list exactly the migration files.
    expect(names.map((n) => n.slice(0, 14))).toEqual([...EXPECTED_MIGRATIONS]);
    // No email addresses in migrations (the repository is public).
    for (const f of files) expect(f.sql).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });
});
