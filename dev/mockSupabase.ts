/**
 * LOCAL TEST HARNESS ONLY – never deployed.
 *
 * A Vite plugin that runs the REAL APEX server code (handleApi) with an in-memory repository
 * and imitates Supabase Realtime broadcast, so the online client can be exercised in browsers
 * without network access to Supabase:
 *   - /api/apex                  the REAL handleApi() (password login, HttpOnly session cookies, CSRF)
 *   - /realtime/v1/websocket     Phoenix (vsn 2.0.0) broadcast on the campaign's secret topic
 *
 * Usage: npm run dev:mock  → http://localhost:5174
 * Test profiles: Hannah (password "hannah-test-pass"), Jean ("jean-test-pass"). The GM profile needs
 * first-time setup: the one-time setup code is printed in the terminal and readable at /__mock/setup-code.
 * Simon and Jerba are locked until the GM sets a password.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';

/** When true, /api/apex answers 503 – simulates a server/database outage. */
let apiDown = false;
/** Artificial latency for every /api/apex request (simulates a slow database). */
let latencyMs = 0;
let apiRequests = 0;
const CAMPAIGN = 'c0000000-0000-4000-8000-000000000001';
export const MOCK_PASSWORDS = { hannah: 'hannah-test-pass', jean: 'jean-test-pass' };
const SETUP_CODE = 'A1B2-C3D4-E5F6-0718-293A-4B5C';

type Repo = import('../tests/memoryRepo').MemoryRepo;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function send(res: ServerResponse, status: number, body: unknown, cookies: string[] = []) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

export function mockSupabase(): Plugin {
  let repo: Repo | null = null;
  const subs = new Set<{ ws: WebSocket; topic: string; joinRef: string }>();

  async function getRepo(server: ViteDevServer): Promise<Repo> {
    if (repo) return repo;
    const { MemoryRepo } = (await server.ssrLoadModule('/tests/memoryRepo.ts')) as typeof import('../tests/memoryRepo');
    const seed = (await server.ssrLoadModule('/tests/seed.ts')) as typeof import('../tests/seed');
    const r = new MemoryRepo();
    r.campaigns.push({ id: CAMPAIGN, slug: 'main', name: 'APEX – Arena of the Eternal Will' });
    seed.seedProfiles(r, CAMPAIGN);
    await seed.activate(r, CAMPAIGN, 'hannah', MOCK_PASSWORDS.hannah);
    await seed.activate(r, CAMPAIGN, 'jean', MOCK_PASSWORDS.jean);
    seed.addSetupCode(r, CAMPAIGN, SETUP_CODE, 24 * 3600_000);
    console.log(`[mock] GM setup code: ${SETUP_CODE}`);

    // Realtime: broadcast like the database triggers do (version after game-state writes, "sheet" after sheet writes).
    const broadcast = async (campaignId: string, event: 'version' | 'sheet') => {
      const topic = `realtime:${await r.syncTopic(campaignId)}`;
      const payload = event === 'version' ? { version: r.states.get(campaignId)?.version ?? 0 } : { sheet: true };
      for (const s of subs) {
        if (s.topic !== topic) continue;
        s.ws.send(JSON.stringify([s.joinRef, null, s.topic, 'broadcast', { type: 'broadcast', event, payload }]));
      }
    };
    const save = r.saveState.bind(r);
    const replace = r.replaceState.bind(r);
    const saveSheet = r.saveSheet.bind(r);
    const transition = r.worldTransition.bind(r);
    r.worldTransition = async (...a) => {
      const res = await transition(...a);
      if (a[2]) void broadcast(a[0], 'version');
      return res;
    };
    r.saveState = async (...a) => {
      const v = await save(...a);
      if (v !== null) void broadcast(a[0], 'version');
      return v;
    };
    r.replaceState = async (...a) => {
      const v = await replace(...a);
      void broadcast(a[0], 'version');
      return v;
    };
    r.saveSheet = async (...a) => {
      const v = await saveSheet(...a);
      if (v !== null) void broadcast(a[0], 'sheet');
      return v;
    };
    repo = r;
    return r;
  }

  return {
    name: 'apex-mock-supabase',
    configureServer(server) {
      // ---------- Test controls ----------
      server.middlewares.use('/__mock', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://x');
        if (url.pathname === '/setup-code') return send(res, 200, { code: SETUP_CODE });
        if (url.pathname === '/portrait') {
          const p = repo?.portraits.get(String(url.searchParams.get('path')));
          if (!p) return send(res, 404, {});
          res.statusCode = 200;
          res.setHeader('content-type', p.contentType);
          return res.end(Buffer.from(p.bytes));
        }
        if (url.pathname === '/latency') {
          latencyMs = Math.max(0, Number(url.searchParams.get('ms')) || 0);
          return send(res, 200, { latencyMs });
        }
        if (url.pathname === '/stats') return send(res, 200, { requests: apiRequests });
        if (url.pathname === '/api-down') {
          apiDown = url.searchParams.get('on') === '1';
          return send(res, 200, { apiDown });
        }
        if (url.pathname === '/inspect') {
          // Test-only: proves what is stored (hashes, never plain passwords).
          const r = repo;
          return send(res, 200, {
            credentials: r ? [...r.credentials.entries()].map(([k, c]) => [k, c.passwordHash.slice(0, 30)]) : [],
            sessions: r ? [...r.sessions.values()].filter((s) => !s.revokedAt).map((s) => s.profileKey) : [],
            sheets: r ? [...r.sheets.keys()] : [],
          });
        }
        return send(res, 404, {});
      });

      // ---------- API (real handler, in-memory repo) ----------
      server.middlewares.use('/api/apex', async (req, res) => {
        apiRequests++;
        if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
        if (apiDown) return send(res, 503, { error: 'Database unavailable (simulated outage).' });
        const r = await getRepo(server);
        const { handleApi } = (await server.ssrLoadModule('/src/server/api.ts')) as typeof import('../src/server/api');
        const url = new URL(req.url ?? '/', 'http://x');
        const raw = req.method === 'POST' ? await readBody(req) : '';
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
        let body: unknown = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          return send(res, 400, { error: 'Invalid JSON.' });
        }
        const out = await handleApi(
          {
            method: req.method ?? 'GET',
            op: url.searchParams.get('op') ?? '',
            query: Object.fromEntries(url.searchParams.entries()),
            body,
            headers,
            ip: req.socket.remoteAddress ?? null,
          },
          r,
        );
        if (out.status === 302 && out.headers?.location) {
          res.statusCode = 302;
          for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
          return res.end();
        }
        send(res, out.status, out.body, out.cookies);
      });

      // ---------- Realtime (Phoenix vsn 2.0.0, JSON array frames, broadcast only) ----------
      const wss = new WebSocketServer({ noServer: true });
      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/realtime/v1/websocket')) return;
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      });
      wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          const [joinRef, ref, topic, event] = JSON.parse(String(raw));
          const reply = (response: unknown, status = 'ok') => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status, response }]));
          if (event === 'heartbeat') return reply({});
          if (event === 'phx_join') {
            subs.add({ ws, topic, joinRef });
            return reply({ postgres_changes: [] });
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
