/**
 * Riproduce una registrazione NDJSON con gli stessi tempi e lo stesso protocollo del
 * collector vero. Utile per sviluppare il frontend sul laptop con dati reali del NAS.
 *
 *   npm run replay -- registrazione.ndjson
 *   SPEED=4 PORT=8081 npm run replay -- registrazione.ndjson
 */
import { readFile } from 'node:fs/promises';
import type { HelloMsg, ServerMsg } from '../protocol.js';
import { Hub } from '../transport/hub.js';
import { createServer } from '../transport/server.js';

const file = process.argv[2];
if (!file) {
  console.error('uso: npm run replay -- <file.ndjson>');
  process.exit(1);
}
const speed = Number(process.env.SPEED ?? 1) || 1;
const port = Number(process.env.PORT ?? 8080);
const host = process.env.BIND ?? '127.0.0.1';

const messages: ServerMsg[] = (await readFile(file, 'utf8'))
  .split('\n')
  .filter(Boolean)
  .map(l => JSON.parse(l) as ServerMsg);

const first = messages[0];
if (!first || first.type !== 'hello') {
  console.error('la registrazione deve iniziare con un messaggio hello');
  process.exit(1);
}
const hello: HelloMsg = first;
const ticks = messages.slice(1);
const durationS = ((ticks.at(-1)?.t ?? hello.t) - hello.t) / 1000;

const hub = new Hub(hello.node, hello.pollMs);
let loops = 0;
const { app, attach } = createServer({
  logLevel: process.env.LOG_LEVEL ?? 'info',
  token: process.env.TOKEN ?? '',
  staticDir: process.env.STATIC_DIR ?? '',
  health: () => ({ mode: 'replay', file, speed, loops, flows: hub.state.flows.size }),
});
await attach(hub);
await app.listen({ host, port });
app.log.info(`replay di ${ticks.length} messaggi (${durationS.toFixed(0)} s) a velocità ${speed}x`);

function play(): void {
  // ogni giro riparte dallo stato iniziale; i timestamp vengono riportati al presente
  const startWall = Date.now();
  hub.reset({ ...hello, t: startWall });
  let i = 0;
  const step = () => {
    const elapsed = (Date.now() - startWall) * speed;
    while (i < ticks.length && ticks[i]!.t - hello.t <= elapsed) {
      const m = ticks[i++]!;
      hub.publish({ ...m, t: Math.round(startWall + (m.t - hello.t) / speed) });
    }
    if (i >= ticks.length) {
      loops++;
      setTimeout(play, 1000);
      return;
    }
    setTimeout(step, 20);
  };
  step();
}
play();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    hub.close();
    await app.close();
    process.exit(0);
  });
}
