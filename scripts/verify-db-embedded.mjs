/** Isolated PostgreSQL/WASM migration check. Supabase services are stubbed; never connects to production.
 * Install the pinned test dependency separately: pnpm --dir .test-tools add --save-exact @electric-sql/pglite@0.5.15
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { PGlite } = require('../.test-tools/node_modules/@electric-sql/pglite');
const db = await PGlite.create();
const clean = sql => sql.split(/\r?\n/).filter(line => !line.startsWith('\\') && !/^(drop|create) database /i.test(line)).join('\n');
try {
  await db.exec(clean(readFileSync('supabase/tests/local_supabase_stub.sql', 'utf8')));
  const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort();
  for (let pass = 1; pass <= 2; pass++) for (const file of files) {
    try { await db.exec(readFileSync('supabase/migrations/' + file, 'utf8')); }
    catch (error) { throw new Error(`${file}, pass ${pass}: ${error.message}`, { cause: error }); }
  }
  console.log('PASS all migrations applied twice in isolated PostgreSQL/WASM');
  for (const file of ['rls_check.sql', 'post_deploy_checks.sql', 'scene_runtime_check.sql']) {
    await db.exec(clean(readFileSync('supabase/tests/' + file, 'utf8')));
    console.log('PASS', file);
  }
} finally { await db.close(); }
