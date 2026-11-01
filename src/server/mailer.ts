/**
 * Delivery of APEX sign-in codes through the operator's own SMTP account (server-side only).
 * Configured with Vercel environment variables (never VITE_ prefixed):
 *   SMTP_HOST, SMTP_PORT (default 465), SMTP_USER, SMTP_PASS, optional SMTP_FROM.
 * The code itself is generated and later verified by Supabase Auth; this module only sends it.
 */
import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export function readSmtpEnv(env: Record<string, string | undefined>): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.replace(/\s+/g, ''); // Google shows app passwords with spaces
  if (!host || !user || !pass) return null;
  const port = Number(env.SMTP_PORT || 465);
  const from = env.SMTP_FROM?.trim() || `APEX <${user}>`;
  return { host, port, user, pass, from };
}

let cached: { key: string; t: Transporter } | null = null;
function transporter(c: SmtpConfig): Transporter {
  const key = `${c.host}:${c.port}:${c.user}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      t: nodemailer.createTransport({
        host: c.host,
        port: c.port,
        secure: c.port === 465,
        auth: { user: c.user, pass: c.pass },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      }),
    };
  }
  return cached.t;
}

export async function verifySmtp(c: SmtpConfig): Promise<{ ok: boolean; detail?: string }> {
  try {
    await transporter(c).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** Sends the code. Resolves with the SMTP server's acceptance, throws on rejection. */
export async function sendCodeEmail(c: SmtpConfig, to: string, code: string): Promise<{ accepted: boolean; response: string }> {
  const text = [
    'APEX – Arena of the Eternal Will',
    '',
    `Your sign-in code: ${code}`,
    '',
    'Enter this code on the APEX sign-in page. It can be used once and expires soon.',
    'If you did not request it, you can ignore this email.',
  ].join('\n');
  const html = `<div style="font-family:Georgia,serif;background:#0b0a0e;color:#f6f1e7;padding:28px;border-radius:12px;max-width:440px">
  <div style="color:#e9c46a;letter-spacing:4px;font-size:20px;font-weight:bold">APEX</div>
  <div style="color:#8c826f;font-size:12px;letter-spacing:2px;margin-bottom:20px">ARENA OF THE ETERNAL WILL</div>
  <p style="margin:0 0 8px">Your sign-in code:</p>
  <p style="font-size:34px;font-weight:bold;letter-spacing:8px;color:#f3dc9a;margin:0 0 16px;font-family:monospace">${code}</p>
  <p style="color:#bdb29e;font-size:13px;margin:0">Enter this code on the APEX sign-in page. It can be used once and expires soon.<br>If you did not request it, you can ignore this email.</p>
</div>`;
  const info = await transporter(c).sendMail({ from: c.from, to, subject: `Your APEX sign-in code: ${code}`, text, html });
  return { accepted: info.accepted.length > 0 && info.rejected.length === 0, response: String(info.response ?? '') };
}
