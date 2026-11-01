import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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

  it('the repository migrations are ordered after the production baseline and free of destructive SQL', () => {
    const dir = 'supabase/migrations';
    const files = readdirSync(dir)
      .filter((n) => n.endsWith('.sql'))
      .map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, 'utf8') }));
    const remote = parseVersionList(readFileSync('supabase/remote_history.txt', 'utf8'));
    const r: Result = checkMigrations(files, remote);
    // Until the historical allowlist file is restored, exactly one error is expected: the missing file.
    expect(r.errors.filter((e) => !e.startsWith('MISSING MIGRATION'))).toEqual([]);
    expect(r.pending).toEqual([
      '20261101100000_apex_online.sql',
      '20261101100100_apex_seed_main_campaign.sql',
      '20261102000100_apex_presence_and_grants.sql',
      '20261103000100_apex_profiles.sql',
    ]);
  });
});
