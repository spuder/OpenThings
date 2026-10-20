/**
 * HTTP routes: the web app (static files), sync (/api/health, /api/sync), the REST API (/api/v1)
 * and MCP (/mcp). `createApp` returns a fetch handler so tests can call it without a socket.
 */
import { join, normalize } from 'node:path';
import { PROTOCOL_VERSION, type HealthResponse, type SyncResponse } from '../src/lib/sync/protocol';
import { validOp, type ServerDb } from './db';
import { handleRpc } from './mcp';
import { Service, UserError } from './service';

export interface AppOptions {
  db: ServerDb;
  service?: Service;
  /** Built web app (vite build output). Omit to serve the API only. */
  staticDir?: string;
  version?: string;
  /** Extra browser origins allowed to call the API (the app's own origin always is). */
  allowedOrigins?: string[];
  /** Where devices reach this server (OPENTHINGS_PUBLIC_URL), reported by /api/health. */
  publicUrl?: string;
}

/** Origins of the native shells and local development, always allowed. */
const BUILTIN_ORIGINS = [/^capacitor:\/\/localhost$/, /^ionic:\/\/localhost$/, /^tauri:\/\/localhost$/, /^https?:\/\/tauri\.localhost$/, /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/];

const MAX_BODY = 32 * 1024 * 1024;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const err = (message: string, status: number) => json({ error: message }, status);

async function readJson(req: Request): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new UserError('Request body too large', 413);
  const text = await req.text();
  if (text.length > MAX_BODY) throw new UserError('Request body too large', 413);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new UserError('Body is not valid JSON');
  }
}

async function readObject(req: Request): Promise<Record<string, unknown>> {
  const body = await readJson(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new UserError('Body must be a JSON object');
  return body as Record<string, unknown>;
}

const flag = (v: string | null) => v === '1' || v === 'true' || v === 'yes';

export function createApp(opts: AppOptions) {
  const { db } = opts;
  const service = opts.service ?? new Service(db);
  const version = opts.version ?? '0.0.0';
  const extraOrigins = new Set(opts.allowedOrigins ?? []);
  const gzipCache = new Map<string, Uint8Array<ArrayBuffer>>();

  /** Same host as the request (behind a TLS proxy the scheme differs, so compare hosts). */
  function sameOrigin(origin: string, req: Request): boolean {
    try {
      const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  function originAllowed(origin: string, req: Request) {
    return sameOrigin(origin, req) || extraOrigins.has(origin) || BUILTIN_ORIGINS.some((re) => re.test(origin));
  }

  function withCors(res: Response, origin: string | null): Response {
    if (origin) {
      res.headers.set('access-control-allow-origin', origin);
      res.headers.set('vary', 'origin');
    }
    return res;
  }

  // ---------- REST ----------

  async function rest(req: Request, url: URL, parts: string[]): Promise<Response> {
    const m = req.method;
    const q = url.searchParams;
    const [res, id, action] = parts;

    if (!res) {
      return json({
        name: 'OpenThings REST API',
        version,
        docs: 'https://github.com/spuder/OpenThings/blob/main/docs/api.md',
        today: service.today(),
      });
    }

    if (res === 'tasks') {
      if (!id) {
        if (m === 'GET') {
          const search = q.get('q');
          const limit = q.get('limit') ? Number(q.get('limit')) : undefined;
          const tasks = search
            ? service.search(search, { include_completed: flag(q.get('include_completed')), limit })
            : service.list({
                view: q.get('view') ?? undefined,
                project: q.get('project') ?? undefined,
                area: q.get('area') ?? undefined,
                tag: q.get('tag') ?? undefined,
                include_completed: flag(q.get('include_completed')),
                limit,
              });
          return json({ today: service.today(), tasks });
        }
        if (m === 'POST') return json(service.addTask(await readObject(req)), 201);
      } else if (!action) {
        if (m === 'GET') return json(service.getTask(id));
        if (m === 'PATCH') return json(service.updateTask(id, await readObject(req)));
        if (m === 'DELETE') return json(service.trashTask(id));
      } else if (m === 'POST') {
        if (action === 'complete') return json(service.completeTask(id));
        if (action === 'uncomplete') return json(service.uncompleteTask(id));
        if (action === 'restore') return json(service.restoreTask(id));
        if (action === 'move') return json(service.moveTask(id, await readObject(req)));
        if (action === 'checklist') return json(service.addChecklistItem(id, String((await readObject(req)).title ?? '')), 201);
      }
    }

    if (res === 'checklist' && id && m === 'PATCH') {
      const body = await readObject(req);
      return json(service.setChecklistItem(id, body.done !== false));
    }

    if (res === 'projects' && !id) {
      if (m === 'GET') return json({ projects: service.projects() });
      if (m === 'POST') {
        const b = await readObject(req);
        return json(service.addProject(String(b.name ?? ''), (b.area as string | undefined) ?? null), 201);
      }
    }
    if (res === 'areas' && !id) {
      if (m === 'GET') return json({ areas: service.areas() });
      if (m === 'POST') return json(service.addArea(String((await readObject(req)).name ?? '')), 201);
    }
    if (res === 'tags' && !id && m === 'GET') return json({ tags: service.tags() });

    if (res === 'habits') {
      if (!id) {
        if (m === 'GET') return json({ today: service.today(), habits: service.habits() });
        if (m === 'POST') {
          const b = await readObject(req);
          return json(service.addHabit(String(b.text ?? b.name ?? '')), 201);
        }
      } else if (action === 'check') {
        const day = q.get('day') ?? undefined;
        if (m === 'POST') {
          const b = await readObject(req);
          return json(service.checkHabit(id, { day: (b.day as string | undefined) ?? day, done: true }));
        }
        if (m === 'DELETE') return json(service.checkHabit(id, { day, done: false }));
      }
    }

    if (res === 'timers') {
      if (!id && m === 'GET') return json({ running: service.timer() });
      if (id === 'start' && m === 'POST') {
        const b = await readObject(req);
        return json(service.startTimer(String(b.task_id ?? '')));
      }
      if (id === 'stop' && m === 'POST') return json({ stopped: service.stopTimer() });
    }

    return err(`No route for ${m} ${url.pathname}`, 404);
  }

  // ---------- API dispatch ----------

  async function api(req: Request, url: URL): Promise<Response> {
    const path = url.pathname.replace(/\/+$/, '');

    if (path === '/api/health' && req.method === 'GET') {
      const body: HealthResponse = { ok: true, server: 'openthings', protocol: PROTOCOL_VERSION, version, ...(opts.publicUrl ? { publicUrl: opts.publicUrl } : {}) };
      return json(body);
    }

    if (path === '/api/sync') {
      if (req.method !== 'POST') return err('Use POST', 405);
      const body = await readObject(req);
      if (body.protocol !== PROTOCOL_VERSION) return err(`This server speaks sync protocol ${PROTOCOL_VERSION}; the app sent ${String(body.protocol)}`, 400);
      if (typeof body.device !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.device)) return err('Missing or invalid device id', 400);
      if (body.cursor !== null && body.cursor !== undefined && typeof body.cursor !== 'string') return err('Invalid cursor', 400);
      if (!Array.isArray(body.ops)) return err('"ops" must be an array', 400);
      const ops = body.ops.map(validOp);
      const bad = ops.filter((o) => !o).length;
      if (bad) console.warn(`sync from ${body.device}: ignored ${bad} malformed op(s)`);
      const accepted = db.push(ops.filter((o) => o !== null));
      const pulled = db.pull(body.device, (body.cursor as string | null) ?? null);
      const res: SyncResponse = { accepted, ops: pulled.ops, cursor: pulled.cursor, more: pulled.more };
      return json(res);
    }

    if (path === '/api/v1' || path.startsWith('/api/v1/')) {
      const parts = path.slice('/api/v1'.length).split('/').filter(Boolean).map(decodeURIComponent);
      return rest(req, url, parts);
    }

    return err(`No route for ${req.method} ${url.pathname}`, 404);
  }

  async function mcp(req: Request): Promise<Response> {
    if (req.method !== 'POST') return err('This MCP server is stateless: POST JSON-RPC messages to /mcp', 405);
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }
    const replies = (Array.isArray(body) ? body : [body]).map((m) => handleRpc(service, m, version)).filter((r) => r !== null);
    if (!replies.length) return new Response(null, { status: 202 });
    return json(Array.isArray(body) ? replies : replies[0]);
  }

  // ---------- static files ----------

  async function serveStatic(req: Request, url: URL): Promise<Response> {
    if (!opts.staticDir) return err('Not found', 404);
    if (req.method !== 'GET' && req.method !== 'HEAD') return err('Method not allowed', 405);
    let rel: string;
    try {
      rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    } catch {
      return err('Bad path', 400);
    }
    let path = join(opts.staticDir, rel);
    if (!path.startsWith(opts.staticDir)) return err('Not found', 404);
    let file = Bun.file(path);
    if (rel.endsWith('/') || !(await file.exists())) {
      // Client-side routes fall back to the app; missing assets are real 404s.
      if (/\.[a-z0-9]+$/i.test(rel) && !rel.endsWith('.html')) return new Response('Not found', { status: 404 });
      path = join(opts.staticDir, 'index.html');
      file = Bun.file(path);
    }
    const type = path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.webmanifest') ? 'application/manifest+json' : file.type;
    const headers: Record<string, string> = {
      'content-type': type,
      'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    const compressible = /^(text\/|application\/(javascript|json|wasm|manifest\+json)|image\/svg)/.test(type);
    if (compressible && (req.headers.get('accept-encoding') ?? '').includes('gzip')) {
      let gz = gzipCache.get(path);
      if (!gz) {
        gz = Bun.gzipSync(new Uint8Array(await file.arrayBuffer())) as Uint8Array<ArrayBuffer>;
        gzipCache.set(path, gz);
      }
      return new Response(req.method === 'HEAD' ? null : gz, { headers: { ...headers, 'content-encoding': 'gzip', vary: 'accept-encoding' } });
    }
    return new Response(req.method === 'HEAD' ? null : file, { headers });
  }

  return async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/');
    if (!isApi) return serveStatic(req, url);

    // Browsers send Origin on cross-site requests. Only the app's own origin, the native shells and
    // listed origins may call the API, so a web page you visit can't read or change your to-dos.
    const origin = req.headers.get('origin');
    if (origin && !originAllowed(origin, req)) return err(`Origin ${origin} is not allowed (set OPENTHINGS_ALLOWED_ORIGINS)`, 403);
    const cors = origin && !sameOrigin(origin, req) ? origin : null;
    if (req.method === 'OPTIONS') {
      return withCors(
        new Response(null, {
          status: 204,
          headers: {
            'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
            'access-control-allow-headers': req.headers.get('access-control-request-headers') ?? 'content-type',
            'access-control-max-age': '86400',
          },
        }),
        cors,
      );
    }

    try {
      const res = url.pathname.startsWith('/mcp') ? await mcp(req) : await api(req, url);
      return withCors(res, cors);
    } catch (e) {
      if (e instanceof UserError) return withCors(err(e.message, e.status), cors);
      console.error(`${req.method} ${url.pathname} failed`, e);
      return withCors(err('Internal server error', 500), cors);
    }
  };
}
