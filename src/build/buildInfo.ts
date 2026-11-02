/**
 * One versioning convention for the whole app (APEX 0.5). The SAME function computes the build facts for
 *  - the frontend bundle (vite.config.ts, at build time → __APEX_BUILD__),
 *  - the API (api/apex.ts, at run time → GET /api/apex?op=version),
 * from Vercel's system environment variables. Nothing is hardcoded per deployment:
 *  - version: package.json "version" (semantic version, bumped per release)
 *  - commit:  VERCEL_GIT_COMMIT_SHA
 *  - pr:      VERCEL_GIT_PULL_REQUEST_ID (preview of a PR) or "Merge pull request #N" in the deployed commit's
 *             message (production merge). Otherwise null – never guessed.
 */
export interface BuildInfo {
  version: string;
  commit: string | null;
  branch: string | null;
  environment: 'production' | 'preview' | 'development' | string;
  pr: number | null;
  repo: string | null;
  builtAt: string | null;
}

type Env = Record<string, string | undefined>;

export function prFromEnv(env: Env): number | null {
  const id = Number(env.VERCEL_GIT_PULL_REQUEST_ID);
  if (Number.isInteger(id) && id > 0) return id;
  const m = /^Merge pull request #(\d+)\b/.exec(env.VERCEL_GIT_COMMIT_MESSAGE ?? '');
  return m ? Number(m[1]) : null;
}

export function readBuildInfo(env: Env, version: string, builtAt: string | null): BuildInfo {
  const owner = env.VERCEL_GIT_REPO_OWNER;
  const slug = env.VERCEL_GIT_REPO_SLUG;
  return {
    version,
    commit: env.VERCEL_GIT_COMMIT_SHA || env.APEX_COMMIT_SHA || null,
    branch: env.VERCEL_GIT_COMMIT_REF || null,
    environment: env.VERCEL_ENV || (env.NODE_ENV === 'production' ? 'local build' : 'development'),
    pr: prFromEnv(env),
    repo: owner && slug ? `${owner}/${slug}` : env.APEX_REPO || 'invinity-8/APEX-C',
    builtAt,
  };
}

/** "APEX v0.5.0 · PR #18" / "APEX v0.5.0" */
export const versionLabel = (b: BuildInfo) => `APEX v${b.version}${b.pr ? ` · PR #${b.pr}` : ''}`;
export const shortSha = (sha: string | null) => (sha ? sha.slice(0, 7) : 'unknown');
export const envLabel = (e: string) => (e === 'production' ? 'Production' : e === 'preview' ? 'Preview' : e[0].toUpperCase() + e.slice(1));
export const commitUrl = (b: BuildInfo) => (b.commit && b.repo ? `https://github.com/${b.repo}/commit/${b.commit}` : null);
export const prUrl = (b: BuildInfo) => (b.pr && b.repo ? `https://github.com/${b.repo}/pull/${b.pr}` : null);

/** Frontend and API were built from different commits (e.g. a stale cached bundle after a new deployment). */
export const buildMismatch = (front: BuildInfo, api: BuildInfo | null) => !!(api && front.commit && api.commit && front.commit !== api.commit);
