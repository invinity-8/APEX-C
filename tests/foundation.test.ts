import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMismatch, prFromEnv, readBuildInfo, versionLabel } from '../src/build/buildInfo';
import { APP_VERSION } from '../src/build/version';
import { ASSETS } from '../src/assets/registry';
import { handleApi } from '../src/server/api';
import { MemoryRepo } from './memoryRepo';

describe('versioning (APEX 0.5)', () => {
  it('package.json and APP_VERSION agree', () => {
    expect(JSON.parse(readFileSync('package.json', 'utf8')).version).toBe(APP_VERSION);
  });
  it('PR attribution: preview PR id, production merge commit message, otherwise none (never guessed)', () => {
    expect(prFromEnv({ VERCEL_GIT_PULL_REQUEST_ID: '21' })).toBe(21);
    expect(prFromEnv({ VERCEL_GIT_COMMIT_MESSAGE: 'Merge pull request #17 from invinity-8/fix/x\n\nbody' })).toBe(17);
    expect(prFromEnv({ VERCEL_GIT_COMMIT_MESSAGE: 'fix: something (#12)' })).toBeNull();
    expect(prFromEnv({})).toBeNull();
  });
  it('build info and labels', () => {
    const b = readBuildInfo({ VERCEL_GIT_COMMIT_SHA: 'abc1234def', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_MESSAGE: 'Merge pull request #18 from x' }, '0.5.0', null);
    expect(versionLabel(b)).toBe('APEX v0.5.0 · PR #18');
    expect(buildMismatch(b, { ...b, commit: 'ffff000' })).toBe(true);
    expect(buildMismatch(b, b)).toBe(false);
    expect(buildMismatch(b, null)).toBe(false);
  });
  it('GET op=version answers without touching the database', async () => {
    const repo = new MemoryRepo();
    const r = await handleApi({ method: 'GET', op: 'version', query: {}, body: null, ip: null, headers: {} } as never, repo);
    expect(r.status).toBe(200);
    expect((r.body as { version: string }).version).toBe(APP_VERSION);
  });
});

describe('asset registry', () => {
  it('every asset documents source, format, licence and fallback', () => {
    const ids = new Set<string>();
    for (const a of ASSETS) {
      expect(ids.has(a.id)).toBe(false);
      ids.add(a.id);
      for (const k of ['use', 'path', 'source', 'optimisation', 'licence', 'fallback', 'version'] as const) expect(a[k].length).toBeGreaterThan(0);
    }
  });
});
