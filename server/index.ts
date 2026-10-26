/**
 * OpenThings server: serves the web app and the sync, REST and MCP endpoints from one process.
 *
 *   PORT                        listen port (default 8080)
 *   DATA_DIR                    where openthings.sqlite lives (default ./data)
 *   STATIC_DIR                  built web app (default ./dist)
 *   OPENTHINGS_ALLOWED_ORIGINS  extra browser origins allowed to call the API, comma-separated
 *   OPENTHINGS_PUBLIC_URL       the address devices use, e.g. https://openthings.<tailnet>.ts.net;
 *                               apps prefill it and put it in phone pairing QR codes
 *   TZ                          time zone for "today" in the REST API and MCP tools
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pkg from '../package.json' with { type: 'json' };
import { parsePairCode } from '../src/lib/sync/pair';
import { createApp } from './app';
import { ServerDb } from './db';

const port = Number(process.env.PORT ?? 8080);
const dataDir = resolve(process.env.DATA_DIR ?? 'data');
const staticDir = resolve(process.env.STATIC_DIR ?? 'dist');
const allowedOrigins = (process.env.OPENTHINGS_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const publicUrlEnv = process.env.OPENTHINGS_PUBLIC_URL?.trim() || '';
const publicUrl = publicUrlEnv ? (parsePairCode(publicUrlEnv) ?? undefined) : undefined;
if (publicUrlEnv && !publicUrl) console.warn(`Ignoring OPENTHINGS_PUBLIC_URL=${publicUrlEnv}: not an http(s) URL`);

mkdirSync(dataDir, { recursive: true });
const db = new ServerDb(join(dataDir, 'openthings.sqlite'));
const fetch = createApp({ db, staticDir, version: pkg.version, allowedOrigins, publicUrl });

const server = Bun.serve({ port, fetch, maxRequestBodySize: 64 * 1024 * 1024 });
console.log(`OpenThings ${pkg.version} on http://localhost:${server.port}${publicUrl ? ` (devices use ${publicUrl})` : ''} · data ${dataDir} · device ${db.device} · ${db.opCount()} ops`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.stop();
    db.close();
    process.exit(0);
  });
}
