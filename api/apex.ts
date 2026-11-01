/**
 * Vercel Function: /api/apex?op=session|state|command|admin
 *
 * The secure server-side execution layer of APEX online mode.
 * Configuration (Vercel → Project → Settings → Environment Variables, server-only):
 *   SUPABASE_URL          – e.g. https://xqkyaqxuoaxadpkcdhch.supabase.co
 *   SUPABASE_SECRET_KEY   – Supabase secret / service_role key (NEVER prefix with VITE_)
 */
import { handleApi } from '../src/server/api';
import { SupabaseRepo, readServerEnv } from '../src/server/supabaseRepo';

let repo: SupabaseRepo | null = null;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function handle(request: Request): Promise<Response> {
  const env = readServerEnv(process.env);
  if (!env) return json(503, { error: 'Online mode is not configured on the server.', code: 'not_configured' });
  repo ??= new SupabaseRepo(env);

  const url = new URL(request.url);
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;
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
  const res = await handleApi(
    {
      method: request.method,
      op: url.searchParams.get('op') ?? '',
      token,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    },
    repo,
  );
  return json(res.status, res.body);
}

export const GET = handle;
export const POST = handle;
