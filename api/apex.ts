/**
 * Vercel Function: /api/apex?op=…
 *
 * The secure server-side execution layer of APEX online mode.
 * Configuration (Vercel → Project → Settings → Environment Variables, server-only):
 *   SUPABASE_URL          – e.g. https://xqkyaqxuoaxadpkcdhch.supabase.co
 *   SUPABASE_SECRET_KEY   – Supabase secret / service_role key (NEVER prefix with VITE_)
 * Sign-in uses profile + password with HttpOnly session cookies – no email service is needed.
 */
import { handleApi } from '../src/server/api.js';
import { SupabaseRepo, readServerEnv } from '../src/server/supabaseRepo.js';

let repo: SupabaseRepo | null = null;

function json(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

/** Non-secret deployment facts for the setup check (which Git commit is live, which variables are missing). */
function deploymentInfo() {
  return {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    environment: process.env.VERCEL_ENV ?? null,
    missingServerVariables: [
      ...(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL ? [] : ['SUPABASE_URL']),
      ...(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ? [] : ['SUPABASE_SECRET_KEY']),
    ],
  };
}

/** Client IP as set by the Vercel edge (the left-most x-forwarded-for entry is the client). */
function clientIp(request: Request): string | null {
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  const fwd = request.headers.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : null;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const env = readServerEnv(process.env);
  if (!env) {
    if (url.searchParams.get('op') === 'health') return json(200, { serverConfigured: false, ...deploymentInfo() });
    return json(503, { error: 'Online mode is not configured on the server.', code: 'not_configured' });
  }
  repo ??= new SupabaseRepo(env);

  let body: unknown = null;
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 3_000_000) return json(413, { error: 'Request too large.' });
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return json(400, { error: 'Invalid JSON.' });
    }
  }
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
  const res = await handleApi(
    {
      method: request.method,
      op: url.searchParams.get('op') ?? '',
      query: Object.fromEntries(url.searchParams.entries()),
      body,
      headers,
      ip: clientIp(request),
    },
    repo,
  );
  if (res.status === 200 && url.searchParams.get('op') === 'health') {
    const h = res.body as { errors?: string[] };
    return json(200, { serverConfigured: true, ok: !h.errors?.length, ...deploymentInfo(), ...(res.body as object) });
  }
  return json(res.status, res.body, res.cookies);
}

export const GET = handle;
export const POST = handle;
