/**
 * Login, password recovery and "set new password" screens (Supabase Auth, email + password).
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApexEmblem, Spinner } from '../components/brand';
import type { ProfileConfig } from '../data/profiles';
import { Portrait } from '../entry/Portrait';

export { ApexEmblem, Spinner };
import { supabase } from './supabase';

/** Turns Supabase Auth errors into friendly English messages. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('expired') || m.includes('invalid') || m.includes('otp')) return 'This code is wrong or has expired. Request a new code and use the most recent email.';
  if (m.includes('invalid login credentials')) return 'The email address or password is incorrect.';
  if (m.includes('email not confirmed')) return 'Please confirm your email address first – check your inbox for the confirmation link.';
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Please wait a minute and try again.';
  if (m.includes('password should be') || m.includes('weak')) return 'This password is too weak. Use at least 8 characters with letters and numbers.';
  if (m.includes('already registered')) return 'An account with this email already exists. Try signing in or reset your password.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) return 'New accounts can only be created by invitation.';
  if (m.includes('fetch') || m.includes('network')) return 'Cannot reach the authentication server. Check your connection.';
  if (m.includes('same password')) return 'The new password must be different from the old one.';
  return message;
}

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

function Field(props: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  minLength?: number;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-marble-300">
        {props.label}
      </label>
      <input
        id={id}
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        minLength={props.minLength}
        required
        className="w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-2.5 text-sm text-marble-50 placeholder:text-marble-500 focus:border-gold-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
      />
    </div>
  );
}

function Message({ kind, children }: { kind: 'error' | 'info'; children: ReactNode }) {
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

/**
 * Invite-only login with a one-time email code:
 *  1. The player enters their email. The APEX server asks Supabase to send a code – but only
 *     for invited/member addresses (the answer looks the same for everyone).
 *  2. The player types the 6-digit code; Supabase Auth verifies it (single use, expiring, rate-limited).
 * No passwords, no public self-registration.
 */
type RequestState =
  | { kind: 'idle' }
  | { kind: 'requested'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'quota'; message: string }
  | { kind: 'delivery_failed'; message: string }
  | { kind: 'error'; message: string };

/** Formats a wait time for humans ("45 s", "12 min"). */
const waitText = (s: number) => (s >= 90 ? `${Math.ceil(s / 60)} min` : `${s} s`);

export function LoginPage({ profile, onBack }: { profile: ProfileConfig; onBack: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [req, setReq] = useState<RequestState>({ kind: 'idle' });
  /** Seconds until a new code may be requested – only ever set from a server answer. */
  const [wait, setWait] = useState(0);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  /** Exactly one request per click; never retried automatically. */
  const sendCode = async () => {
    if (inFlight.current || !emailValid) return;
    inFlight.current = true;
    setBusy(true);
    setVerifyError(null);
    try {
      const { api } = await import('./api');
      const res = await api.requestCode(email.trim(), profile.key);
      setReq({
        kind: 'requested',
        message: `Code requested. If ${email.trim()} belongs to ${profile.name}’s profile, an email with a 6-digit code is on its way – check your inbox and spam folder.`,
      });
      setWait(res.retryAfter ?? 60);
      setStep('code');
      setCode('');
    } catch (e) {
      const err = e as { message: string; code?: string; retryAfter?: number };
      const kind =
        err.code === 'rate_limited' ? 'rate_limited' : err.code === 'email_quota' ? 'quota' : err.code === 'delivery_failed' ? 'delivery_failed' : 'error';
      setReq({ kind, message: err.message });
      // Only a server-reported limit starts a countdown – failures never do.
      setWait(kind === 'rate_limited' || kind === 'quota' ? (err.retryAfter ?? 0) : 0);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const token = code.replace(/\D/g, '');
    if (token.length < 6) return setVerifyError('Please enter the complete code from the email.');
    setBusy(true);
    setVerifyError(null);
    const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token, type: 'email' });
    setBusy(false);
    if (error) setVerifyError(friendlyAuthError(error.message));
    // On success onAuthStateChange (OnlineRoot) opens the campaign.
  };

  const requestNotice =
    req.kind === 'idle' ? null : (
      <Message kind={req.kind === 'requested' ? 'info' : 'error'}>
        <span className="font-semibold">
          {req.kind === 'requested'
            ? 'Code requested'
            : req.kind === 'rate_limited'
              ? 'Please wait'
              : req.kind === 'quota'
                ? 'Email limit reached'
                : req.kind === 'delivery_failed'
                  ? 'Email delivery failed'
                  : 'Request failed'}
          {': '}
        </span>
        {req.message}
        {wait > 0 && req.kind !== 'requested' && <span className="block pt-1 tabular-nums">New request possible in {waitText(wait)}.</span>}
      </Message>
    );

  return (
    <AuthShell>
      {step === 'email' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendCode();
          }}
          className="space-y-4"
          aria-busy={busy}
        >
          <ProfileHeader profile={profile} />
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-lg font-bold text-marble-50 focus:outline-none">
            Continue as {profile.name}
          </h2>
          <p className="text-xs leading-relaxed text-marble-300">
            Enter the email address of {profile.name}’s account. We will email you a one-time 6-digit code – no password needed.
          </p>
          <Field label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
          {requestNotice}
          <button type="submit" className="btn btn-gold w-full py-2.5 text-sm" disabled={busy || wait > 0 || !emailValid}>
            {busy ? <Spinner /> : null}
            {busy ? 'Requesting code…' : wait > 0 ? `Send code (in ${waitText(wait)})` : 'Send me a code'}
          </button>
          <button
            type="button"
            className="block w-full text-center text-xs text-marble-300 underline-offset-2 hover:underline disabled:opacity-40"
            disabled={!emailValid}
            onClick={() => {
              setStep('code');
              setVerifyError(null);
            }}
          >
            I already have a code
          </button>
          <button type="button" className="block w-full text-center text-xs text-gold-300 underline-offset-2 hover:underline" onClick={onBack}>
            Not {profile.name}? Choose another profile
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4" aria-busy={busy}>
          <ProfileHeader profile={profile} />
          <h2 ref={headingRef} tabIndex={-1} className="font-display text-lg font-bold text-marble-50 focus:outline-none">
            Enter your code
          </h2>
          <p className="text-xs text-marble-300">
            Code for <b className="text-marble-50">{email.trim()}</b>. You can use a code you already received – no new request needed.
          </p>
          {requestNotice}
          <CodeField value={code} onChange={setCode} />
          {verifyError && <Message kind="error">{verifyError}</Message>}
          <button type="submit" className="btn btn-gold w-full py-2.5 text-sm" disabled={busy}>
            {busy ? <Spinner /> : null} Sign in
          </button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <button
              type="button"
              className="text-gold-300 underline-offset-2 hover:underline"
              onClick={() => {
                setStep('email');
                setVerifyError(null);
              }}
            >
              ← Use a different email
            </button>
            <button
              type="button"
              className="text-marble-300 underline-offset-2 hover:underline disabled:opacity-50"
              disabled={busy || wait > 0}
              onClick={() => void sendCode()}
            >
              {wait > 0 ? `New code possible in ${waitText(wait)}` : 'Send a new code'}
            </button>
          </div>
        </form>
      )}
    </AuthShell>
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

function CodeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-marble-300">
        Code from the email
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        autoFocus
        required
        placeholder="123456"
        className="w-full rounded-lg border border-ink-500 bg-ink-900 px-3 py-3 text-center font-mono text-2xl tracking-[0.5em] text-marble-50 placeholder:text-marble-500/40 focus:border-gold-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
      />
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
