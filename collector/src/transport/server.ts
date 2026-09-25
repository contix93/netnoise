import { existsSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { Hub } from './hub.js';

export interface ServerOptions {
  logLevel: string;
  token: string;
  staticDir: string;
  health: () => Record<string, unknown>;
}

function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createServer(opts: ServerOptions): { app: FastifyInstance; attach: (hub: Hub) => Promise<void> } {
  const app = Fastify({ logger: { level: opts.logLevel }, disableRequestLogging: true });

  const attach = async (hub: Hub) => {
    await app.register(fastifyWebsocket, { options: { maxPayload: 64 * 1024 } });

    app.get('/ws', { websocket: true }, (socket, req) => {
      if (opts.token && !tokenMatches(opts.token, (req.query as Record<string, unknown>).token)) {
        socket.close(4401, 'unauthorized');
        return;
      }
      hub.add(socket);
    });

    app.get('/api/health', async (req, reply) => {
      if (opts.token && !tokenMatches(opts.token, (req.query as Record<string, unknown>).token)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      return { ...opts.health(), clients: hub.clientCount };
    });

    const staticDir = opts.staticDir ? path.resolve(opts.staticDir) : '';
    if (staticDir && existsSync(staticDir)) {
      await app.register(fastifyStatic, { root: staticDir });
      app.log.info(`servo il frontend da ${staticDir}`);
    } else {
      app.get('/', async () => 'netnoise collector attivo: WebSocket su /ws, stato su /api/health\n');
    }
  };

  return { app, attach };
}
