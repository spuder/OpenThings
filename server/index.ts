/**
 * OpenThings server: serves the web app and the sync, REST and MCP endpoints from one process.
 *
 *   PORT                        listen port (default 8080)
 *   DATA_DIR                    where openthings.sqlite lives (default ./data)
 *   STATIC_DIR                  built web app (default ./dist)
 *   OPENTHINGS_ALLOWED_ORIGINS  extra browser origins allowed to call the API, comma-separated
 *   OPENTHINGS_TOKEN            require Authorization: Bearer <token> on the API; comma-separate several
 *   OPENTHINGS_HOSTNAMES        only answer requests for these host names (plus localhost), comma-separated
 *   TZ                          time zone for "today" in the REST API and MCP tools
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { createApp } from './app';
import { ServerDb } from './db';

const port = Number(process.env.PORT ?? 8080);
const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const staticDir = resolve(process.env.STATIC_DIR ?? 'dist');
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const allowedOrigins = list(process.env.OPENTHINGS_ALLOWED_ORIGINS).map((s) => s.replace(/\/+$/, ''));
const tokens = list(process.env.OPENTHINGS_TOKEN);
const hostnames = list(process.env.OPENTHINGS_HOSTNAMES);

mkdirSync(dataDir, { recursive: true });
const db = new ServerDb(join(dataDir, 'openthings.sqlite'));
const fetch = createApp({ db, staticDir, version: pkg.version, allowedOrigins, tokens, hostnames });

const server = Bun.serve({ port, fetch, maxRequestBodySize: 64 * 1024 * 1024 });
console.log(`OpenThings ${pkg.version} on http://localhost:${server.port} · data ${dataDir} · device ${db.device} · ${db.opCount()} ops${tokens.length ? ' · token required' : ''}${hostnames.length ? ` · hosts ${hostnames.join(', ')}` : ''}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.stop();
    db.close();
    process.exit(0);
  });
}
