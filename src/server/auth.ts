/**
 * Password hashing, session tokens and cookies for the profile + password login (server only).
 *
 *  - Passwords: Argon2id (hash-wasm, pure WebAssembly – runs on Vercel without native modules),
 *    OWASP parameters m=19 MiB, t=2, p=1, 16-byte random salt, PHC string output.
 *  - Sessions: 32 random bytes, sent to the browser ONLY as an HttpOnly, Secure, SameSite=Strict
 *    cookie (__Host- prefix: no Domain, Path=/). The database stores only SHA-256(token).
 */
import { argon2id, argon2Verify } from 'hash-wasm';

export const SESSION_COOKIE = '__Host-apex_session';
/** A session ends 30 days after sign-in at the latest … */
export const SESSION_ABSOLUTE_MS = 30 * 86400_000;
/** … or after 14 days without any use. */
export const SESSION_IDLE_MS = 14 * 86400_000;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

const ARGON = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const;

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function hashPassword(password: string): Promise<string> {
  return argon2id({ ...ARGON, password, salt: randomBytes(16), outputType: 'encoded' });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith('$argon2id$')) return false;
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}

/** Burns about the same time as a real verification (used when there is nothing to compare). */
let dummyHash: Promise<string> | null = null;
export async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword('apex-dummy-password');
  await verifyPassword(password, await dummyHash);
}

export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Please enter a password.';
  if (pw.length < PASSWORD_MIN) return `The password must have at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `The password may have at most ${PASSWORD_MAX} characters.`;
  if (!pw.trim()) return 'The password must not consist of spaces only.';
  return null;
}

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const newSessionToken = () => b64url(randomBytes(32));

export async function sha256Hex(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Session tokens are base64url, 43 characters. Anything else is rejected without a database lookup. */
export const looksLikeToken = (t: string | undefined): t is string => !!t && /^[A-Za-z0-9_-]{43}$/.test(t);

export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** Normalises a GM setup code ("abcd-1234-…" → "ABCD1234…"); null if it cannot be one. */
export function normaliseSetupCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.toUpperCase().replace(/[^0-9A-F]/g, '');
  return c.length === 24 ? c : null;
}
