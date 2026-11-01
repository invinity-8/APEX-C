/**
 * Entry experience: Welcome → "Who are you?" → password (handled by the online module).
 * These screens contain no Supabase code, so they also render when the deployment
 * is not configured – joining then shows a clear setup error instead of a local game.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ApexEmblem, Spinner } from '../components/brand';
import { PROFILES, type ProfileConfig } from '../data/profiles';
import { CampaignPreview } from './CampaignPreview';
import { Portrait } from './Portrait';

export const PROFILE_KEY = 'apex.profile';

export function loadChosenProfile(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}
export function saveChosenProfile(key: string | null) {
  try {
    if (key) localStorage.setItem(PROFILE_KEY, key);
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
}

function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="auth-bg flex min-h-full items-center justify-center px-4 py-8">
      <div className={`w-full ${wide ? 'max-w-5xl' : 'max-w-3xl'}`}>{children}</div>
    </main>
  );
}

export function WelcomeScreen({ onJoin }: { onJoin: () => void }) {
  return (
    <Shell>
      <div className="flex flex-col items-center text-center">
        <ApexEmblem className="h-16 w-16 drop-shadow-[0_0_24px_rgba(212,166,74,.5)]" />
        <h1 className="mt-4 font-display text-4xl font-black tracking-[0.08em] text-gold-300 sm:text-5xl">Welcome to APEX</h1>
        <p className="mt-2 font-display text-lg tracking-[0.12em] text-gold-200/90 sm:text-xl">APEX – Arena of the Eternal Will</p>
      </div>
      <CampaignPreview className="mt-6 h-56 sm:h-72" />
      <div className="panel mt-6 p-6">
        <p className="text-sm leading-relaxed text-marble-100">
          At the height of its power, the Empire built an arena that no map can contain. Floating aqueducts, roads that carry the marching and
          forests older than the legions surround a golden eagle at its heart – and around the eagle winds a labyrinth whose inscriptions glow when
          night falls.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-marble-300">
          You are tributes of the <i>Tributum Voluntatis</i>. Your will is your weapon, the unknown is your enemy, and the arena itself is closing in.
          Explore together, find what the Gamemakers hide – and survive.
        </p>
        <div className="mt-6 flex flex-col items-center gap-2">
          <button className="btn btn-gold px-10 py-3 text-base" onClick={onJoin} autoFocus>
            Join Campaign
          </button>
          <span className="text-[11px] text-marble-500">A private campaign. Access by invitation of the Game Master.</span>
        </div>
      </div>
    </Shell>
  );
}

/** key → can be selected (activated with a password, or the GM profile awaiting first-time setup). */
export type ProfileStatus = Record<string, boolean> | null;

/** Loads which profiles are active (public, no account data). null = unknown. */
export function useProfileStatus(enabled: boolean): { status: ProfileStatus; needsSetup: string[]; error: string | null; loading: boolean } {
  const [status, setStatus] = useState<ProfileStatus>(null);
  const [needsSetup, setNeedsSetup] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/apex?op=profiles')
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error ?? `The APEX server answered with an error (${r.status}).`);
        return body as { profiles: Array<{ key: string; active: boolean; needsSetup?: boolean }> };
      })
      .then((b) => {
        if (cancelled) return;
        setStatus(Object.fromEntries(b.profiles.map((p) => [p.key, p.active || !!p.needsSetup])));
        setNeedsSetup(b.profiles.filter((p) => p.needsSetup).map((p) => p.key));
      })
      .catch((e: Error) => !cancelled && setError(e.message.includes('fetch') ? 'Cannot reach the APEX server.' : e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return { status, needsSetup, error, loading };
}

export function ProfileSelect({
  status,
  statusError,
  loading,
  onSelect,
  onBack,
  backLabel = '← Back',
}: {
  status: ProfileStatus;
  statusError: string | null;
  loading: boolean;
  onSelect: (p: ProfileConfig) => void;
  onBack: () => void;
  backLabel?: string;
}) {
  return (
    <Shell wide>
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-[0.35em] text-marble-500">APEX – Arena of the Eternal Will</p>
        <h1 className="mt-2 font-display text-3xl font-black text-gold-300">Who are you?</h1>
        <p className="mt-2 text-sm text-marble-300">Choose your profile. You will confirm it with your password.</p>
      </div>
      {statusError && (
        <div role="alert" className="mx-auto mt-4 max-w-xl rounded-lg border border-blood-400/50 bg-blood-600/20 px-3 py-2 text-center text-xs text-red-200">
          {statusError} Signing in may not work right now.
        </div>
      )}
      <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" aria-busy={loading}>
        {PROFILES.map((p) => {
          const inactive = status !== null && status[p.key] === false;
          return (
            <li key={p.key}>
              <button
                onClick={() => onSelect(p)}
                disabled={inactive}
                className={`group flex h-full w-full flex-col items-center rounded-2xl border p-4 text-center transition-all ${
                  inactive
                    ? 'cursor-not-allowed border-ink-600 bg-ink-850/60 opacity-50'
                    : 'border-gold-700/50 bg-ink-850/90 hover:-translate-y-1 hover:border-gold-400 hover:shadow-[0_10px_30px_-10px_rgba(212,166,74,.6)] focus-visible:border-gold-400 focus-visible:outline-none'
                }`}
                aria-label={`${p.name} – ${p.role === 'gm' ? 'Game Master' : `plays ${p.character}`}${inactive ? ' – not activated yet' : ''}`}
              >
                <Portrait profile={p} />
                <span className="mt-3 font-display text-lg font-bold text-marble-50">{p.name}</span>
                <span className="text-xs text-gold-200">{p.role === 'gm' ? 'All characters' : p.character}</span>
                <span className="mt-1 text-[10px] uppercase tracking-[0.18em] text-marble-500">{p.role === 'gm' ? 'Game Master' : p.epithet}</span>
                <span className={`mt-3 chip ${p.role === 'gm' ? 'border-gold-500/60 text-gold-200' : 'text-marble-300'}`}>
                  {inactive ? 'Not activated yet' : p.role === 'gm' ? 'Game Master' : 'Player'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex items-center justify-center gap-3 text-xs">
        {loading && (
          <span className="text-marble-500">
            <Spinner /> Checking profiles…
          </span>
        )}
        <button className="text-gold-300 underline-offset-2 hover:underline" onClick={onBack}>
          {backLabel}
        </button>
      </div>
    </Shell>
  );
}

/** Shown when "Join Campaign" is clicked on a deployment without online configuration. */
export function NotConnectedScreen({ missing, onBack }: { missing: string[]; onBack: () => void }) {
  return (
    <Shell>
      <div className="panel mx-auto max-w-xl p-6" role="alert">
        <div className="flex items-center gap-3">
          <ApexEmblem className="h-12 w-12" />
          <h1 className="font-display text-xl font-bold text-gold-300">APEX is not connected yet</h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-marble-300">
          The campaign cannot be joined because this website was built without its connection to the campaign server. No local game was started –
          nothing could be saved or shared here.
        </p>
        <div className="mt-4 rounded-lg border border-blood-400/40 bg-blood-600/15 p-3 text-xs text-red-200">
          Missing build variables: <b className="font-mono">{missing.join(', ')}</b>
        </div>
        <details className="mt-4 text-xs leading-relaxed text-marble-500">
          <summary className="cursor-pointer text-marble-300">For the administrator: how to fix this</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-marble-300">
            <li>Vercel → project → Settings → Environment Variables.</li>
            <li>
              Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> for <b>Production</b> and <b>Preview</b>.
            </li>
            <li>
              Add the server variables <code>SUPABASE_URL</code> and <code>SUPABASE_SECRET_KEY</code> (never with a <code>VITE_</code> prefix).
            </li>
            <li>Deployments → latest → ⋯ → Redeploy. VITE variables only take effect after a new build.</li>
            <li>
              Check <a className="text-gold-300 underline" href="/api/apex?op=health">/api/apex?op=health</a> – everything should be <code>true</code>.
            </li>
          </ol>
          <p className="mt-2">Full guide in the repository: docs/SETUP_DE.md.</p>
        </details>
        <button className="btn btn-ghost mt-5" onClick={onBack}>
          ← Back to the welcome screen
        </button>
      </div>
    </Shell>
  );
}
