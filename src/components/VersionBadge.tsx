/**
 * Always-visible, unobtrusive deployment indicator (bottom right) – APEX 0.5.
 * Line 1: "APEX v0.5.0 · PR #18" (PR only when reliably known). Line 2: "Commit abc1234 · Production".
 * Expands to the full deployment details, the build time, GitHub links, and the API's own build facts.
 * The API is asked exactly ONCE per page load (GET op=version, no database access) – no polling.
 */
import { useEffect, useId, useState } from 'react';
import { buildMismatch, commitUrl, envLabel, prUrl, shortSha, versionLabel, type BuildInfo } from '../build/buildInfo';

export const FRONTEND_BUILD: BuildInfo = __APEX_BUILD__;

let apiBuildPromise: Promise<BuildInfo | null> | null = null;
/** Shared single request for the whole page (StrictMode double effects, several mounts). */
export function fetchApiBuild(): Promise<BuildInfo | null> {
  apiBuildPromise ??= fetch('/api/apex?op=version', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<BuildInfo>) : null))
    .catch(() => null);
  return apiBuildPromise;
}

export function VersionBadge() {
  const b = FRONTEND_BUILD;
  const [open, setOpen] = useState(false);
  const [api, setApi] = useState<BuildInfo | null | undefined>(undefined);
  const id = useId();
  useEffect(() => {
    let live = true;
    void fetchApiBuild().then((r) => live && setApi(r));
    return () => {
      live = false;
    };
  }, []);
  const mismatch = buildMismatch(b, api ?? null);
  const cUrl = commitUrl(b);
  const pUrl = prUrl(b);
  return (
    <div className="apex-version" data-testid="version-badge" data-commit={b.commit ?? ''} data-api-commit={api?.commit ?? ''} data-mismatch={mismatch ? '1' : '0'}>
      {open && (
        <div id={id} role="dialog" aria-label="Deployment details" className="apex-version-details">
          <dl>
            <dt>Version</dt>
            <dd>v{b.version}</dd>
            <dt>Commit</dt>
            <dd>{cUrl ? <a href={cUrl} target="_blank" rel="noreferrer">{shortSha(b.commit)}</a> : shortSha(b.commit)}</dd>
            <dt>Environment</dt>
            <dd>{envLabel(b.environment)}</dd>
            <dt>Branch</dt>
            <dd>{b.branch ?? '–'}</dd>
            <dt>Pull request</dt>
            <dd>{pUrl ? <a href={pUrl} target="_blank" rel="noreferrer">#{b.pr}</a> : 'not attributable'}</dd>
            <dt>Built</dt>
            <dd>{b.builtAt ? new Date(b.builtAt).toLocaleString() : '–'}</dd>
            <dt>API</dt>
            <dd>
              {api === undefined ? 'checking…' : api === null ? 'not reachable' : `v${api.version} · ${shortSha(api.commit)} · ${envLabel(api.environment)}`}
            </dd>
          </dl>
          {mismatch && (
            <p className="apex-version-warn" role="alert">
              Frontend ({shortSha(b.commit)}) and server ({shortSha(api!.commit)}) are different builds. Reload the page; if it persists, a deployment is in progress.
            </p>
          )}
        </div>
      )}
      <button type="button" className="apex-version-button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)}>
        <span className="apex-version-line1">
          {versionLabel(b)}
          {mismatch && <span className="apex-version-dot" aria-label="Version mismatch" title="Frontend and API versions differ" />}
        </span>
        <span className="apex-version-line2">
          Commit {shortSha(b.commit)} · {envLabel(b.environment)}
        </span>
      </button>
    </div>
  );
}
