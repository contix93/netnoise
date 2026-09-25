import { config } from './config.js';
import { FlowTable } from './flows/FlowTable.js';
import { CidrSet, LAN_CIDRS } from './flows/netmatch.js';
import { makeAnonymizer } from './flows/anonymize.js';
import { ConntrackSource, checkConntrack } from './sources/conntrack.js';
import { MockSource } from './sources/mock.js';
import type { FlowSource } from './sources/source.js';
import { defaultRouteIfaces, detectLocalIps, readIfaceCounters, type IfaceCounters } from './sources/system.js';
import type { Throughput } from './protocol.js';
import { Hub } from './transport/hub.js';
import { createServer } from './transport/server.js';
import { startRecording } from './dev/recorder.js';

const stats = {
  source: config.source,
  startedAt: Date.now(),
  lastPoll: { at: 0, ms: 0, entries: 0 },
  pollErrors: 0,
  lastError: '',
  flows: 0,
  ifaces: [] as string[],
};

const hub = new Hub(config.nodeName, config.pollMs);
const { app, attach } = createServer({
  logLevel: config.logLevel,
  token: config.token,
  staticDir: config.staticDir,
  health: () => ({ node: config.nodeName, ...stats, uptimeS: Math.round((Date.now() - stats.startedAt) / 1000) }),
});
const log = app.log;

// --- sorgente dati ---------------------------------------------------------

let source: FlowSource;
if (config.source === 'mock') {
  source = new MockSource();
  log.info('sorgente: MOCK (traffico sintetico)');
} else {
  await checkConntrack(config.conntrackBin, log);
  source = new ConntrackSource(config.conntrackBin, config.ipv6, log);
  log.info('sorgente: conntrack');
}

let localIps = source.localIps() ?? detectLocalIps();
const refreshLocalIps = setInterval(() => {
  localIps = source.localIps() ?? detectLocalIps(); // DHCP, interfacce Docker che vanno e vengono
}, 30_000);

const excluded = new CidrSet(config.excludeCidrs);
const lan = new CidrSet(LAN_CIDRS);

const table = new FlowTable({
  isLocal: ip => localIps.has(ip),
  isExcluded: ip => excluded.has(ip),
  isLan: ip => lan.has(ip),
  anonymize: makeAnonymizer(config.anon, config.anonSalt),
  maxFlows: config.maxFlows,
  maxNewPerTick: config.maxNewPerTick,
});

source.start((type, entry) => {
  if (!config.ipv6 && entry.family === 'ipv6') return;
  table.onEvent(type, entry, Date.now());
});

// --- polling dei contatori -------------------------------------------------

stats.ifaces = config.ifaces.length > 0 ? config.ifaces : await defaultRouteIfaces();
if (config.source === 'conntrack') {
  if (stats.ifaces.length > 0) log.info(`throughput totale da: ${stats.ifaces.join(', ')}`);
  else log.warn('nessuna interfaccia per il throughput totale: userò la somma dei flussi');
}

let prevIface: { at: number; c: IfaceCounters } | null = null;
let pendingTotal: Throughput | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let stopping = false;

async function computeTotal(now: number): Promise<Throughput> {
  const c = config.source === 'conntrack' ? await readIfaceCounters(stats.ifaces) : null;
  if (!c) return table.sumRates();
  const prev = prevIface;
  prevIface = { at: now, c };
  if (!prev) return table.sumRates();
  const dt = (now - prev.at) / 1000;
  return {
    in: Math.max(0, Math.round((c.rx - prev.c.rx) / dt)),
    out: Math.max(0, Math.round((c.tx - prev.c.tx) / dt)),
  };
}

async function poll(): Promise<void> {
  const startedAt = Date.now();
  try {
    const entries = await source.dump();
    const now = Date.now();
    table.sync(config.ipv6 ? entries : entries.filter(e => e.family !== 'ipv6'), startedAt, now);
    pendingTotal = await computeTotal(now);
    stats.lastPoll = { at: now, ms: now - startedAt, entries: entries.length };
    stats.flows = table.size;
  } catch (err) {
    stats.pollErrors++;
    stats.lastError = (err as Error).message;
    // evita di riempire il journal: logga il primo errore e poi uno ogni 100
    if (stats.pollErrors % 100 === 1) log.error(`poll fallito: ${stats.lastError}`);
  }
  if (stopping) return;
  // pianifica il prossimo mantenendo la cadenza, senza mai sovrapporre due dump
  const elapsed = Date.now() - startedAt;
  pollTimer = setTimeout(poll, Math.max(50, config.pollMs - elapsed));
}
await poll();

// --- invio ai client -------------------------------------------------------

const tickTimer = setInterval(() => {
  const now = Date.now();
  let msg = table.drain(now);
  if (pendingTotal) {
    msg ??= { type: 'tick', t: now };
    msg.total = pendingTotal;
    pendingTotal = null;
  }
  if (msg) hub.publish(msg);
}, config.tickMs);

const stopRecording = config.recordFile ? startRecording(hub, config.recordFile) : null;
if (config.recordFile) log.info(`registrazione su ${config.recordFile}`);

await attach(hub);
await app.listen({ host: config.host, port: config.port });
if (config.host === '0.0.0.0' || config.host === '::') {
  log.warn('in ascolto su tutte le interfacce: assicurati che la porta non sia esposta su Internet');
}

// --- arresto pulito --------------------------------------------------------

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    log.info(`${sig}: arresto in corso`);
    stopping = true;
    clearInterval(tickTimer);
    clearInterval(refreshLocalIps);
    if (pollTimer) clearTimeout(pollTimer);
    source.stop();
    stopRecording?.();
    hub.close();
    await app.close();
    process.exit(0);
  });
}
