/**
 * Sign-in screens: "Enter the Arena" with profile + password, and the one-time
 * Game Master setup (setup code + new password). No email, no codes by mail.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApexEmblem, Spinner } from '../components/brand';
import type { ProfileConfig } from '../data/profiles';
import { Portrait } from '../entry/Portrait';
import { api, ApiError } from './api';

export { ApexEmblem, Spinner };

export function AuthShell({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <main className="auth-bg flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <ApexEmblem className="h-20 w-20 drop-shadow-[0_0_24px_rgba(212,166,74,.45)]" />
          <h1 className="mt-3 font-display text-4xl font-black tracking-[0.35em] text-gold-300">APEX</h1>
          <p className="mt-1 text-[11px] uppercase tracking-[0.3em] text-marble-500">Arena of the Eternal Will</p>
          {subtitle && <p className="mt-4 text-sm text-marble-300">{subtitle}</p>}
        </div>
        <div className="panel p-6">{children}</div>
        <p className="mt-6 text-center text-[11px] text-marble-500">A private campaign. Access by invitation of the Game Master.</p>
      </div>
    </main>
  );
}

function PasswordField(props: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean; name?: string }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-marble-300">
        {props.label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={props.name}
          type={show ? 'text' : 'password'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          autoComplete={props.autoComplete}
          autoFocus={props.autoFocus}
          required
          className="w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-2.5 pr-16 text-sm text-marble-50 placeholder:text-marble-500 focus:border-gold-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
        />
        <button
          type="button"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded px-2 py-1 text-[11px] text-marble-300 hover:text-gold-200"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

export function Message({ kind, children }: { kind: 'error' | 'info'; children: ReactNode }) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${
        kind === 'error' ? 'border-blood-400/50 bg-blood-600/20 text-red-200' : 'border-gold-400/40 bg-gold-400/10 text-gold-200'
      }`}
    >
      {children}
    </div>
  );
}

/** Formats a wait time for humans ("45 s", "12 min"). */
const waitText = (s: number) => (s >= 90 ? `${Math.ceil(s / 60)} min` : `${s} s`);

/**
 * Profile + password sign-in. The password is checked by the APEX server (Argon2id); on success
 * the server sets an HttpOnly session cookie and onSignedIn() opens the campaign.
 */
export function LoginPage({
  profile,
  needsSetup,
  onBack,
  onSignedIn,
}: {
  profile: ProfileConfig;
  needsSetup: boolean;
  onBack: () => void;
  onSignedIn: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'setup'>(needsSetup ? 'setup' : 'login');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), [mode]);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const fail = (e: unknown) => {
    const err = e instanceof ApiError ? e : new ApiError(0, String(e));
    setError(err.message);
    if (err.code === 'rate_limited') setWait(err.retryAfter ?? 60);
    if (err.code === 'needs_setup') setMode('setup');
  };

  const signIn = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || wait > 0 || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(profile.key, password);
      setPassword('');
      onSignedIn();
    } catch (err) {
      fail(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const setup = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || wait > 0) return;
    if (newPassword !== repeat) return setError('The two passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await api.setup(code, newPassword);
      onSignedIn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      {mode === 'login' ? (
        <form onSubmit={signIn} className="space-y-4" aria-busy={busy}>
          <ProfileHeader profile={profile} />
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-lg font-bold text-marble-50 focus:outline-none">
            Welcome back, {profile.name}
          </h2>
          {/* Hidden username helps password managers store the profile with the password. */}
          <input type="text" name="username" autoComplete="username" value={profile.key} readOnly hidden />
          <PasswordField label="Password" name="password" value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          {error && (
            <Message kind="error">
              {error}
              {wait > 0 && <span className="block pt-1 tabular-nums">You can try again in {waitText(wait)}.</span>}
            </Message>
          )}
          <button type="submit" className="btn btn-gold w-full py-2.5 text-sm" disabled={busy || wait > 0 || !password}>
            {busy ? <Spinner /> : null}
            {busy ? 'Opening the gates…' : 'Enter the Arena'}
          </button>
          <p className="text-[11px] leading-relaxed text-marble-500">
            Forgot your password? Ask your Game Master – they can set a new one for you.
            {profile.role === 'gm' && (
              <>
                {' '}
                Game Master:{' '}
                <button type="button" className="text-gold-300 underline-offset-2 hover:underline" onClick={() => setMode('setup')}>
                  use a setup code
                </button>
                .
              </>
            )}
          </p>
          <button type="button" className="block w-full text-center text-xs text-gold-300 underline-offset-2 hover:underline" onClick={onBack}>
            Not {profile.name}? Choose another profile
          </button>
        </form>
      ) : (
        <form onSubmit={setup} className="space-y-4" aria-busy={busy}>
          <ProfileHeader profile={profile} />
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-lg font-bold text-marble-50 focus:outline-none">
            First-time setup
          </h2>
          <p className="text-xs leading-relaxed text-marble-300">
            Enter the one-time setup code and choose your Game Master password. The code is created in the Supabase SQL editor with{' '}
            <code className="text-gold-200">select apex_private.create_gm_setup_code();</code> and works only once.
          </p>
          <SetupCodeField value={code} onChange={setCode} />
          <input type="text" name="username" autoComplete="username" value={profile.key} readOnly hidden />
          <PasswordField label="New Game Master password (at least 8 characters)" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          <PasswordField label="Repeat the password" value={repeat} onChange={setRepeat} autoComplete="new-password" />
          {error && (
            <Message kind="error">
              {error}
              {wait > 0 && <span className="block pt-1 tabular-nums">You can try again in {waitText(wait)}.</span>}
            </Message>
          )}
          <button type="submit" className="btn btn-gold w-full py-2.5 text-sm" disabled={busy || wait > 0 || !code || !newPassword}>
            {busy ? <Spinner /> : null} Set password and enter
          </button>
          <div className="flex justify-between text-xs">
            <button type="button" className="text-gold-300 underline-offset-2 hover:underline" onClick={() => setMode('login')}>
              ← I already have a password
            </button>
            <button type="button" className="text-gold-300 underline-offset-2 hover:underline" onClick={onBack}>
              Other profile
            </button>
          </div>
        </form>
      )}
    </AuthShell>
  );
}

function SetupCodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-marble-300">
        Setup code
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().slice(0, 40))}
        autoComplete="one-time-code"
        spellCheck={false}
        required
        placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        className="w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-2.5 text-center font-mono text-sm tracking-wider text-marble-50 placeholder:text-marble-500/40 focus:border-gold-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
      />
    </div>
  );
}

function ProfileHeader({ profile }: { profile: ProfileConfig }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gold-700/40 bg-ink-900/60 p-2">
      <Portrait profile={profile} size={48} />
      <div className="leading-tight">
        <div className="font-display text-sm font-bold text-marble-50">{profile.name}</div>
        <div className="text-xs text-gold-200">{profile.role === 'gm' ? 'Game Master · all characters' : `plays ${profile.character}`}</div>
      </div>
    </div>
  );
}

export function Splash({ text }: { text: string }) {
  return (
    <main className="auth-bg flex min-h-full flex-col items-center justify-center gap-4" aria-busy="true">
      <ApexEmblem className="h-16 w-16 animate-pulse drop-shadow-[0_0_20px_rgba(212,166,74,.4)]" />
      <p className="flex items-center gap-2 text-sm text-marble-300" role="status">
        <Spinner /> {text}
      </p>
    </main>
  );
}

export function MessageScreen({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <AuthShell>
      <h2 className="font-display text-lg font-bold text-marble-50">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-marble-300">{children}</div>
      {actions && <div className="mt-5 flex flex-wrap gap-2">{actions}</div>}
    </AuthShell>
  );
}
