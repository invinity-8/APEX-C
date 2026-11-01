#!/usr/bin/env node
/**
 * Post-deploy verification (GitHub Actions, after every push to main).
 *
 * Polls the PUBLIC health endpoint of the live site until
 *   - Vercel serves the commit that was just pushed (frontend + API are current), and
 *   - the database reports every expected migration, schema version, campaign, 5 profiles,
 *     Realtime and no RLS/privilege problems (checked inside the database itself).
 * Fails with a clear message on timeout. Needs no credentials.
 *
 * Env: APEX_URL (default https://4pex.online), EXPECTED_COMMIT (full or short SHA), WAIT_SECONDS (default 900)
 */
const base = (process.env.APEX_URL || 'https://4pex.online').replace(/\/$/, '');
const expected = (process.env.EXPECTED_COMMIT || '').slice(0, 7);
const waitSeconds = Number(process.env.WAIT_SECONDS || 900);
const deadline = Date.now() + waitSeconds * 1000;
const gh = !!process.env.GITHUB_ACTIONS;

let last = null;
for (;;) {
  try {
    const res = await fetch(`${base}/api/apex?op=health`, { headers: { 'cache-control': 'no-cache' } });
    last = await res.json().catch(() => ({ error: `HTTP ${res.status}, not JSON` }));
    const commitOk = !expected || last.commit === expected;
    if (commitOk && last.serverConfigured && last.ok && last.migrationsComplete && last.securityOk === true) {
      console.log(JSON.stringify(last, null, 2));
      console.log(`✓ Production verified: commit ${last.commit}, schema v${last.schemaVersion}, all migrations present, security OK.`);
      process.exit(0);
    }
    console.log(
      !commitOk
        ? `waiting for Vercel to serve commit ${expected} (live: ${last.commit ?? 'unknown'})`
        : !last.serverConfigured
          ? `server not configured: ${JSON.stringify(last.missingServerVariables ?? [])}`
          : `database not ready: ${JSON.stringify(last.errors ?? last)}`,
    );
  } catch (e) {
    console.log(`health endpoint not reachable: ${e.message}`);
  }
  if (Date.now() > deadline) {
    console.log(JSON.stringify(last, null, 2));
    const msg =
      `Production deployment incomplete after ${waitSeconds}s. ` +
      (last?.missingMigrations?.length
        ? `Missing migrations: ${last.missingMigrations.join(', ')} – check Supabase Dashboard → Integrations → GitHub (Deploy to production).`
        : `Last health result: ${JSON.stringify(last?.errors ?? last)}`);
    console.log(gh ? `::error::${msg}` : `ERROR: ${msg}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 20_000));
}
