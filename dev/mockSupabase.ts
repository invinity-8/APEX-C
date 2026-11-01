/**
 * LOCAL TEST HARNESS ONLY – never deployed.
 *
 * A Vite plugin that imitates the parts of Supabase the APEX client uses, so the real
 * online client (supabase-js auth + realtime, /api/apex) can be exercised in browsers
 * without network access to Supabase:
 *   - /auth/v1/*                 email/password auth with fixed test accounts
 *   - /realtime/v1/websocket     Phoenix (vsn 2.0.0) postgres_changes for apex_campaign_heads
 *   - /api/apex                  the REAL handleApi() with an in-memory repository
 *
 * Usage: npm run dev:mock  → http://localhost:5174  (accounts listed in MOCK_USERS below).
 * Login works like production: enter the email, then the 6-digit code. In the mock the code is
 * printed to the terminal and readable at /__mock/code?email=… instead of being emailed.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';

/** Last emailed one-time code per address (exposed at /__mock/code?email=… for the E2E script). */
const codes = new Map<string, { code: string; expires: number; used: boolean }>();
/** When true, /api/apex answers 503 – simulates a server/database outage. */
let apiDown = false;
export const MOCK_USERS = [
  { id: '00000000-0000-4000-8000-000000000001', email: 'gm@apex.test' },
  { id: '00000000-0000-4000-8000-000000000002', email: 'player1@apex.test' },
  { id: '00000000-0000-4000-8000-000000000003', email: 'player2@apex.test' },
  { id: '00000000-0000-4000-8000-000000000004', email: 'stranger@apex.test' },
];
const CAMPAIGN = 'c0000000-0000-4000-8000-000000000001';

type Repo = import('../tests/memoryRepo').MemoryRepo;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(body === undefined ? '' : JSON.stringify(body));
}

const userJson = (u: (typeof MOCK_USERS)[number]) => ({
  id: u.id,
  aud: 'authenticated',
  role: 'authenticated',
  email: u.email,
  email_confirmed_at: '2026-11-01T00:00:00Z',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  created_at: '2026-11-01T00:00:00Z',
});

const session = (u: (typeof MOCK_USERS)[number]) => ({
  access_token: `tok-${u.id}`,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: `ref-${u.id}`,
  user: userJson(u),
});

const userFromBearer = (req: IncomingMessage) => {
  const t = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  return MOCK_USERS.find((u) => `tok-${u.id}` === t) ?? null;
};

export function mockSupabase(): Plugin {
  let repo: Repo | null = null;
  const subs = new Set<{ ws: WebSocket; topic: string; joinRef: string; id: number; campaign: string; userId: string }>();

  async function getRepo(server: ViteDevServer): Promise<Repo> {
    if (repo) return repo;
    const { MemoryRepo } = (await server.ssrLoadModule('/tests/memoryRepo.ts')) as typeof import('../tests/memoryRepo');
    const r = new MemoryRepo();
    r.campaigns.push({ id: CAMPAIGN, slug: 'main', name: 'APEX – Arena of the Eternal Will' });
    for (const u of MOCK_USERS) r.users.set(`tok-${u.id}`, { id: u.id, email: u.email, emailConfirmed: true });
    r.inviteList.push(
      { campaignId: CAMPAIGN, email: 'gm@apex.test', role: 'gm', tokenIds: [], acceptedAt: null },
      { campaignId: CAMPAIGN, email: 'player1@apex.test', role: 'player', tokenIds: ['livia'], acceptedAt: null },
      { campaignId: CAMPAIGN, email: 'player2@apex.test', role: 'player', tokenIds: ['marcus'], acceptedAt: null },
    );
    // Realtime: broadcast the head version after every write (like the DB trigger).
    const notify = (campaignId: string) => {
      const v = r.states.get(campaignId)?.version ?? 0;
      for (const s of subs) {
        if (s.campaign !== campaignId || !r.memberList.some((m) => m.campaignId === campaignId && m.userId === s.userId)) continue;
        s.ws.send(
          JSON.stringify([
            s.joinRef,
            null,
            s.topic,
            'postgres_changes',
            {
              ids: [s.id],
              data: {
                schema: 'public',
                table: 'apex_campaign_heads',
                commit_timestamp: new Date().toISOString(),
                type: 'UPDATE',
                columns: [
                  { name: 'campaign_id', type: 'uuid' },
                  { name: 'version', type: 'int8' },
                  { name: 'updated_at', type: 'timestamptz' },
                ],
                record: { campaign_id: campaignId, version: v, updated_at: new Date().toISOString() },
                old_record: { campaign_id: campaignId },
                errors: null,
              },
            },
          ]),
        );
      }
    };
    const save = r.saveState.bind(r);
    const replace = r.replaceState.bind(r);
    r.saveState = async (...a) => {
      const v = await save(...a);
      if (v !== null) notify(a[0]);
      return v;
    };
    r.replaceState = async (...a) => {
      const v = await replace(...a);
      notify(a[0]);
      return v;
    };
    // Emailed codes → generated here, verified by the /auth/v1/verify mock (single use, 10 min).
    r.sendLoginCode = async (email) => {
      if (!r.authAccounts.has(email)) return { ok: false, reason: 'failed', detail: 'no such user' };
      const prev = codes.get(email);
      if (prev && !prev.used && prev.expires - 600_000 + 5_000 > Date.now()) return { ok: false, reason: 'rate_limited' };
      const code = String(Math.floor(100000 + Math.random() * 900000));
      codes.set(email, { code, expires: Date.now() + 600_000, used: false });
      console.log(`[mock] login code for ${email}: ${code}`);
      return { ok: true };
    };
    repo = r;
    return r;
  }

  return {
    name: 'apex-mock-supabase',
    configureServer(server) {
      // ---------- Auth ----------
      server.middlewares.use('/auth/v1', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        const body = req.method === 'POST' ? await readBody(req) : '';
        if (url.pathname === '/verify') {
          const data = body ? JSON.parse(body) : {};
          const email = String(data.email ?? '').toLowerCase();
          const c = codes.get(email);
          const u = MOCK_USERS.find((x) => x.email === email);
          if (!u || !c || c.used || c.expires < Date.now() || c.code !== data.token) {
            return send(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
          }
          c.used = true;
          return send(res, 200, session(u));
        }
        if (url.pathname === '/token') {
          const data = body ? JSON.parse(body) : {};
          const grant = url.searchParams.get('grant_type');
          if (grant === 'refresh_token') {
            const u = MOCK_USERS.find((x) => `ref-${x.id}` === data.refresh_token);
            return u ? send(res, 200, session(u)) : send(res, 400, { code: 400, msg: 'Invalid Refresh Token' });
          }
        }
        if (url.pathname === '/user') {
          const u = userFromBearer(req);
          return u ? send(res, 200, userJson(u)) : send(res, 401, { code: 401, msg: 'invalid JWT' });
        }
        if (url.pathname === '/logout') return send(res, 204, undefined);
        if (url.pathname === '/recover') return send(res, 200, {});
        return send(res, 404, { msg: 'mock: not implemented' });
      });

      // ---------- Test controls ----------
      server.middlewares.use('/__mock', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/code') return send(res, 200, { code: codes.get(String(url.searchParams.get('email')).toLowerCase())?.code ?? null });
        if (url.pathname === '/api-down') {
          apiDown = url.searchParams.get('on') === '1';
          return send(res, 200, { apiDown });
        }
        return send(res, 404, {});
      });

      // ---------- API (real handler, in-memory repo) ----------
      server.middlewares.use('/api/apex', async (req, res) => {
        if (apiDown) return send(res, 503, { error: 'Database unavailable (simulated outage).' });
        const r = await getRepo(server);
        const { handleApi } = (await server.ssrLoadModule('/src/server/api.ts')) as typeof import('../src/server/api');
        const url = new URL(req.url ?? '/', 'http://x');
        const raw = req.method === 'POST' ? await readBody(req) : '';
        const auth = req.headers.authorization ?? '';
        const out = await handleApi(
          {
            method: req.method ?? 'GET',
            op: url.searchParams.get('op') ?? '',
            token: auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null,
            query: Object.fromEntries(url.searchParams.entries()),
            body: raw ? JSON.parse(raw) : null,
          },
          r,
        );
        send(res, out.status, out.body);
      });

      // ---------- Realtime (Phoenix vsn 2.0.0, JSON array frames) ----------
      const wss = new WebSocketServer({ noServer: true });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/realtime/v1/websocket')) return;
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
      let nextId = 1000;
      wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw));
          const reply = (response: unknown, status = 'ok') => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status, response }]));
          if (event === 'heartbeat') return reply({});
          if (event === 'phx_join') {
            const token = payload?.access_token as string | undefined;
            const user = MOCK_USERS.find((u) => `tok-${u.id}` === token);
            const filters = (payload?.config?.postgres_changes ?? []) as Array<{ event: string; schema: string; table: string; filter?: string }>;
            const out = filters.map((f) => ({ ...f, id: nextId++ }));
            for (const f of out) {
              const campaign = /campaign_id=eq\.(.+)$/.exec(f.filter ?? '')?.[1];
              if (campaign && user) subs.add({ ws, topic, joinRef, id: f.id, campaign, userId: user.id });
            }
            return reply({ postgres_changes: out });
          }
          if (event === 'phx_leave') {
            for (const s of subs) if (s.ws === ws && s.topic === topic) subs.delete(s);
            return reply({});
          }
          return reply({});
        });
        ws.on('close', () => {
          for (const s of subs) if (s.ws === ws) subs.delete(s);
        });
      });
    },
  };
}
