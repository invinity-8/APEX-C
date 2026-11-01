/**
 * Online mode entry: authentication → campaign membership → shared game.
 * Nothing campaign-related is rendered before the server has confirmed the user's access.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import App from '../App';
import { DEFAULT_RADIUS, DEFAULT_SEED, MAX_RADIUS, MIN_RADIUS } from '../data/demo';
import { hexCount } from '../game/hex';
import type { SessionInfo } from '../server/protocol';
import { api, ApiError } from './api';
import { LoginPage, MessageScreen, Splash, Spinner } from './AuthScreens';
import { supabase } from './supabase';
import { useOnlineGame } from './useOnlineGame';

export function OnlineRoot() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const auth = supabase().auth;
    void auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  /** Always ends the session in this browser, even if the network request fails. */
  const signOut = useCallback(() => {
    const auth = supabase().auth;
    void auth
      .signOut({ scope: 'local' })
      .catch(() => undefined)
      .finally(() => {
        try {
          for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k);
        } catch {
          /* ignore */
        }
        setSession(null);
      });
  }, []);

  if (session === undefined) return <Splash text="Opening the gates…" />;
  if (!session) return <LoginPage />;
  return <CampaignLoader key={session.user.id} signOut={signOut} />;
}

function CampaignLoader({ signOut }: { signOut: () => void }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .session()
      .then((s) => {
        if (cancelled) return;
        setInfo(s);
        if (s.campaigns.length === 1) setCampaignId(s.campaigns[0].id);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof ApiError ? e : new ApiError(0, String(e))));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error) return <ErrorScreen error={error} signOut={signOut} retry={() => setAttempt((a) => a + 1)} />;
  if (!info) return <Splash text="Checking your access…" />;
  if (!info.campaigns.length) {
    return (
      <MessageScreen
        title="No access yet"
        actions={
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        }
      >
        <p>
          You are signed in as <b className="text-marble-50">{info.user.email}</b>, but this account has not been invited to an APEX campaign.
        </p>
        <p>Ask your Game Master to invite this email address, then sign in again.</p>
      </MessageScreen>
    );
  }
  if (!campaignId) {
    return (
      <MessageScreen title="Choose a campaign">
        <ul className="space-y-2">
          {info.campaigns.map((c) => (
            <li key={c.id}>
              <button className="btn btn-ghost w-full justify-between" onClick={() => setCampaignId(c.id)}>
                <span>{c.name}</span>
                <span className="text-marble-500">{c.role === 'gm' ? 'Game Master' : 'Player'}</span>
              </button>
            </li>
          ))}
        </ul>
      </MessageScreen>
    );
  }
  return <OnlineCampaign campaignId={campaignId} email={info.user.email} signOut={signOut} />;
}

function OnlineCampaign({ campaignId, email, signOut }: { campaignId: string; email: string; signOut: () => void }) {
  const { game, payload, error, loading, refresh } = useOnlineGame(campaignId, email, signOut);

  if (error) return <ErrorScreen error={error} signOut={signOut} retry={refresh} />;
  if (loading || !payload) return <Splash text="Entering the arena…" />;
  if (game) return <App game={game} />;

  if (payload.role === 'gm') return <InitCampaign campaignId={campaignId} name={payload.campaignName} onDone={refresh} signOut={signOut} />;
  return (
    <MessageScreen
      title={payload.campaignName}
      actions={
        <>
          <button className="btn btn-ghost" onClick={refresh}>
            Check again
          </button>
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </>
      }
    >
      <p>{payload.notice ?? 'Waiting for the Game Master.'}</p>
      <p className="text-xs text-marble-500">Signed in as {email}.</p>
    </MessageScreen>
  );
}

function InitCampaign({ campaignId, name, onDone, signOut }: { campaignId: string; name: string; onDone: () => void; signOut: () => void }) {
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.admin(campaignId, { action: 'initCampaign', radius, seed });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <MessageScreen
      title={`Open the arena – ${name}`}
      actions={
        <>
          <button className="btn btn-gold" onClick={create} disabled={busy}>
            {busy && <Spinner />} Generate arena ({hexCount(radius).toLocaleString('en-US')} hexes)
          </button>
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        </>
      }
    >
      <p>The shared campaign has no arena yet. As Game Master you can generate it now. You can regenerate or import a save later.</p>
      <div className="grid grid-cols-2 gap-3 pt-2">
        <label className="text-xs text-marble-300">
          Radius ({MIN_RADIUS}–{MAX_RADIUS})
          <input
            type="number"
            min={MIN_RADIUS}
            max={MAX_RADIUS}
            value={radius}
            onChange={(e) => setRadius(Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Number(e.target.value) || DEFAULT_RADIUS)))}
            className="mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-xs text-marble-300">
          Seed
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value) || 1)}
            className="mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-blood-400">
          {error}
        </p>
      )}
    </MessageScreen>
  );
}

function ErrorScreen({ error, signOut, retry }: { error: ApiError; signOut: () => void; retry: () => void }) {
  const unauth = error.status === 401;
  const forbidden = error.status === 403;
  return (
    <MessageScreen
      title={unauth ? 'Session expired' : forbidden ? 'Access denied' : 'Something went wrong'}
      actions={
        <>
          {!forbidden && !unauth && (
            <button className="btn btn-gold" onClick={retry}>
              Try again
            </button>
          )}
          <button className="btn btn-ghost" onClick={signOut}>
            {unauth ? 'Sign in again' : 'Sign out'}
          </button>
        </>
      }
    >
      <p>{error.message}</p>
      {error.code === 'not_configured' && <p className="text-xs text-marble-500">The server is missing SUPABASE_URL / SUPABASE_SECRET_KEY.</p>}
    </MessageScreen>
  );
}
