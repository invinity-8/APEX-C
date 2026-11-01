/**
 * Shown by production builds that were deployed without the public Supabase variables.
 * APEX deliberately does NOT fall back to a local demo game here – that would look like a
 * working multiplayer game while every browser silently plays its own copy.
 */
import { ApexEmblem } from './brand';

export function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <main className="auth-bg flex min-h-full items-center justify-center px-4 py-10">
      <div className="panel w-full max-w-lg p-6">
        <div className="flex items-center gap-3">
          <ApexEmblem className="h-12 w-12" />
          <h1 className="font-display text-xl font-bold text-gold-300">APEX is not connected yet</h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-marble-300">
          This deployment was built without its online configuration, so the shared campaign cannot be opened. No local game was started – nothing you do
          here could be saved or shared.
        </p>
        <div className="mt-4 rounded-lg border border-blood-400/40 bg-blood-600/15 p-3 text-xs text-red-200">
          Missing build variables: <b className="font-mono">{missing.join(', ')}</b>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-marble-500">
          Administrator: add the variables in Vercel → Project → Settings → Environment Variables (scope “Production”), then redeploy. Variables starting
          with <code>VITE_</code> are read at build time, so a redeploy is required. Server status: <a className="text-gold-300 underline" href="/api/apex?op=health">/api/apex?op=health</a>
        </p>
      </div>
    </main>
  );
}
