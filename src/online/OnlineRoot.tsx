/**
 * Online mode entry: Welcome → "Who are you?" → password → shared campaign.
 * Nothing campaign-related is rendered before the server has confirmed the session
 * (HttpOnly cookie). The profile shown on the card is only a choice of WHICH password to
 * check: role and characters always come from the server.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import App from '../App';
import { DEFAULT_RADIUS, DEFAULT_SEED, MAX_RADIUS, MIN_RADIUS } from '../data/demo';
import { hexCount } from '../game/hex';
import type { SessionInfo } from '../server/protocol';
import { api, ApiError, newRequestId } from './api';
import { LoginPage, MessageScreen, Splash, Spinner } from './AuthScreens';
import { useOnlineGame } from './useOnlineGame';
import { PlayerJournal } from '../components/PlayerJournal';
import { profileByKey, type ProfileConfig } from '../data/profiles';
import { ProfileSelect, WelcomeScreen, loadChosenProfile, saveChosenProfile, useProfileStatus } from '../entry/EntryScreens';

type Auth = { kind: 'checking' } | { kind: 'signedOut' } | { kind: 'signedIn'; info: SessionInfo } | { kind: 'error'; error: ApiError };

export function OnlineRoot() {
  const [auth, setAuth] = useState<Auth>({ kind: 'checking' });
  const [profile, setProfileState] = useState<ProfileConfig | undefined>(() => profileByKey(loadChosenProfile()));
  const [step, setStep] = useState<'welcome' | 'profiles' | 'login'>('welcome');
  const setProfile = useCallback((p: ProfileConfig | undefined) => {
    saveChosenProfile(p?.key ?? null);
    setProfileState(p);
  }, []);

  const checkSession = useCallback(() => {
    setAuth({ kind: 'checking' });
    api
      .session()
      .then((info) => setAuth({ kind: 'signedIn', info }))
      .catch((e: unknown) => {
        const err = e instanceof ApiError ? e : new ApiError(0, String(e));
        setAuth(err.status === 401 ? { kind: 'signedOut' } : { kind: 'error', error: err });
      });
  }, []);
  useEffect(checkSession, [checkSession]);

  /** Ends the session on the server (cookie cleared) and returns to "Who are you?". */
  const signOut = useCallback(() => {
    void api
      .logout()
      .catch(() => undefined)
      .finally(() => {
        setAuth({ kind: 'signedOut' });
        setStep('profiles');
      });
  }, []);

  if (auth.kind === 'checking') return <Splash text="Opening the gates…" />;
  if (auth.kind === 'error') return <ErrorScreen error={auth.error} signOut={signOut} retry={checkSession} />;
  if (auth.kind === 'signedIn') {
    return <CampaignLoader key={auth.info.user.id} info={auth.info} signOut={signOut} />;
  }
  if (step === 'welcome') return <WelcomeScreen onJoin={() => setStep(profile ? 'login' : 'profiles')} />;
  return (
    <ProfileStep
      step={step}
      profile={profile}
      onSelect={(p) => {
        setProfile(p);
        setStep('login');
      }}
      onBack={() => (step === 'login' ? setStep('profiles') : setStep('welcome'))}
      onSignedIn={checkSession}
    />
  );
}

function ProfileStep({
  step,
  profile,
  onSelect,
  onBack,
  onSignedIn,
}: {
  step: 'profiles' | 'login';
  profile: ProfileConfig | undefined;
  onSelect: (p: ProfileConfig) => void;
  onBack: () => void;
  onSignedIn: () => void;
}) {
  const { status, needsSetup, error, loading } = useProfileStatus(true);
  if (step === 'login' && profile) {
    if (loading) return <Splash text="Checking profiles…" />;
    return <LoginPage profile={profile} needsSetup={needsSetup.includes(profile.key)} onBack={onBack} onSignedIn={onSignedIn} />;
  }
  return <ProfileSelect status={status} statusError={error} loading={loading} onSelect={onSelect} onBack={onBack} />;
}

function CampaignLoader({ info, signOut }: { info: SessionInfo; signOut: () => void }) {
  const campaign = info.campaigns[0];
  if (!campaign) {
    return (
      <MessageScreen
        title="No access yet"
        actions={
          <button className="btn btn-ghost" onClick={signOut}>
            Sign out
          </button>
        }
      >
        <p>This profile is not part of an APEX campaign.</p>
      </MessageScreen>
    );
  }
  return <OnlineCampaign campaignId={campaign.id} info={info} signOut={signOut} />;
}

function OnlineCampaign({ campaignId, info, signOut }: { campaignId: string; info: SessionInfo; signOut: () => void }) {
  const firstCharacter = profileByKey(info.user.profile)?.tokenIds[0];
  const { game, payload, error, loading, refresh } = useOnlineGame(campaignId, info.user.displayName, info.syncTopic, signOut, firstCharacter);

  if (error) return <ErrorScreen error={error} signOut={signOut} retry={refresh} />;
  if (loading || !payload) return <Splash text="Entering the arena…" />;
  if (game) return <App game={game} />;

  if (payload.role === 'gm') return <InitCampaign campaignId={campaignId} name={payload.campaignName} onDone={refresh} signOut={signOut} />;
  return (
    <MessageScreen
      title="Character Sanctuary"
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
      <p className="text-xs text-marble-500">Signed in as {info.user.displayName}.</p>
      <PlayerJournal />
    </MessageScreen>
  );
}

function InitCampaign({ campaignId, name, onDone, signOut }: { campaignId: string; name: string; onDone: () => void; signOut: () => void }) {
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One request id per dialog: repeated clicks or a retry after a timeout can never create two worlds.
  const requestId = useRef(newRequestId());
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.admin(campaignId, { action: 'initCampaign', radius, seed, requestId: requestId.current }, { timeoutMs: 45_000 });
      onDone();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, String(e));
      if (err.status === 0 || err.status >= 502 || err.code === 'in_progress') {
        // Response lost: ask whether the world was created before allowing anything else.
        const s = await api.commandStatus(requestId.current).catch(() => null);
        if (s?.state === 'ok') return onDone();
        setError(
          s?.state === 'pending' || !s
            ? 'The server has not confirmed yet whether the arena was created. Wait a moment, then press the button again – it will not create a second arena.'
            : `${err.message} The arena was not created – you can try again.`,
        );
      } else setError(err.message);
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
      title={unauth ? 'Session ended' : forbidden ? 'Access denied' : 'Something went wrong'}
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
