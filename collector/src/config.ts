import os from 'node:os';

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} deve essere un numero, ricevuto "${v}"`);
  return n;
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function list(name: string, def: string[]): string[] {
  const v = process.env[name];
  if (v === undefined) return def;
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

export type AnonMode = 'hash' | 'none';

export const config = {
  /** conntrack reale oppure generatore sintetico per sviluppare senza NAS */
  source: str('SOURCE', 'conntrack') as 'conntrack' | 'mock',

  host: str('BIND', '127.0.0.1'),
  port: num('PORT', 8080),
  /** se impostato, il WebSocket richiede ?token=... */
  token: str('TOKEN', ''),
  /** cartella del frontend compilato da servire (vuoto = non servire nulla) */
  staticDir: str('STATIC_DIR', ''),

  conntrackBin: str('CONNTRACK_BIN', 'conntrack'),
  ipv6: bool('IPV6', true),
  /** intervallo di lettura dei contatori (ms) */
  pollMs: num('POLL_MS', 500),
  /** intervallo massimo di invio di new/end ai client (ms) */
  tickMs: num('TICK_MS', 100),

  /** quanti flussi al massimo inviare con il loro rate; il resto finisce in `other` */
  maxFlows: num('MAX_FLOWS', 400),
  /** quante nuove connessioni annunciare per tick (protezione da scansioni/flood) */
  maxNewPerTick: num('MAX_NEW_PER_TICK', 100),

  /** peer da ignorare (CIDR separati da virgola) */
  excludeCidrs: list('EXCLUDE_CIDRS', ['127.0.0.0/8', '::1/128']),
  /** interfacce per il throughput totale; vuoto = quella/e della default route */
  ifaces: list('IFACES', []),

  anon: str('ANON', 'hash') as AnonMode,
  /** salt fisso per avere hash stabili tra i riavvii; vuoto = casuale a ogni avvio */
  anonSalt: str('ANON_SALT', ''),

  /** se impostato, registra ogni messaggio su questo file NDJSON */
  recordFile: str('RECORD_FILE', ''),

  nodeName: str('NODE_NAME', os.hostname()),
  logLevel: str('LOG_LEVEL', 'info'),
};

export type Config = typeof config;
