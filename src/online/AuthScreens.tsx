/**
 * Login, password recovery and "set new password" screens (Supabase Auth, email + password).
 */
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApexEmblem, Spinner } from '../components/brand';
import { signupAllowed } from './config';

export { ApexEmblem, Spinner };
import { supabase } from './supabase';

/** Turns Supabase Auth errors into friendly English messages. */
export function friendlyAuthError(message: string): string {
  const m = message.toLowerCase();
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

type Mode = 'signin' | 'forgot' | 'signup';

export function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    setError(null);
    setInfo(null);
    headingRef.current?.focus();
  }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const auth = supabase().auth;
    try {
      if (mode === 'signin') {
        const { error } = await auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError(friendlyAuthError(error.message));
      } else if (mode === 'forgot') {
        const { error } = await auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/` });
        if (error) setError(friendlyAuthError(error.message));
        else setInfo('If an account exists for this address, a reset link is on its way. Check your inbox (and spam folder).');
      } else {
        const { data, error } = await auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/` } });
        if (error) setError(friendlyAuthError(error.message));
        else if (!data.session) setInfo('Account created. Please confirm your email address via the link we just sent you.');
      }
    } catch (err) {
      setError(friendlyAuthError((err as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const title = mode === 'signin' ? 'Enter the Arena' : mode === 'forgot' ? 'Reset your password' : 'Create your account';
  return (
    <AuthShell>
      <form onSubmit={submit} className="space-y-4" noValidate={false} aria-busy={busy}>
        <h2 ref={headingRef} tabIndex={-1} className="font-display text-lg font-bold text-marble-50 focus:outline-none">
          {title}
        </h2>
        <Field label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" autoFocus />
        {mode !== 'forgot' && (
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? 8 : undefined}
          />
        )}
        {error && <Message kind="error">{error}</Message>}
        {info && <Message kind="info">{info}</Message>}
        <button type="submit" className="btn btn-gold w-full py-2.5 text-sm" disabled={busy}>
          {busy ? <Spinner /> : null}
          {mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Create account'}
        </button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {mode === 'signin' ? (
            <button type="button" className="text-gold-300 underline-offset-2 hover:underline" onClick={() => setMode('forgot')}>
              Forgot your password?
            </button>
          ) : (
            <button type="button" className="text-gold-300 underline-offset-2 hover:underline" onClick={() => setMode('signin')}>
              ← Back to sign in
            </button>
          )}
          {signupAllowed && mode === 'signin' && (
            <button type="button" className="text-marble-300 underline-offset-2 hover:underline" onClick={() => setMode('signup')}>
              Invited? Create an account
            </button>
          )}
        </div>
      </form>
    </AuthShell>
  );
}

/** Shown after a password-recovery or invitation link. */
export function SetPasswordPage({ onDone, invite }: { onDone: () => void; invite: boolean }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Please use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(friendlyAuthError(error.message));
    window.history.replaceState(null, '', window.location.pathname);
    onDone();
  };

  return (
    <AuthShell subtitle={invite ? 'Welcome! Choose a password for your account.' : 'Choose a new password for your account.'}>
      <form onSubmit={submit} className="space-y-4" aria-busy={busy}>
        <h2 className="font-display text-lg font-bold text-marble-50">Set password</h2>
        <Field label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" autoFocus minLength={8} />
        <Field label="Repeat password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} />
        {error && <Message kind="error">{error}</Message>}
        <button type="submit" className="btn btn-gold w-full py-2.5 text-sm" disabled={busy}>
          {busy ? <Spinner /> : null} Save password
        </button>
      </form>
    </AuthShell>
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
