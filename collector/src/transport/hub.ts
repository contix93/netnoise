import type { WebSocket } from 'ws';
import { FlowState, PROTOCOL_VERSION, type HelloMsg, type ServerMsg } from '../protocol.js';

/** Oltre questa coda di invio il client è considerato lento: salta i frame e poi si risincronizza. */
const MAX_BUFFERED = 1024 * 1024;
const HEARTBEAT_MS = 30_000;

interface Client {
  ws: WebSocket;
  alive: boolean;
  stale: boolean;
}

/**
 * Distribuisce i messaggi a tutti i client e mantiene lo stato corrente,
 * così chi si connette (o resta indietro) riceve subito un `hello` completo.
 */
export class Hub {
  readonly state = new FlowState();
  private clients = new Set<Client>();
  private listeners: ((msg: ServerMsg) => void)[] = [];
  private heartbeat: NodeJS.Timeout;

  constructor(node: string, pollMs: number) {
    this.state.apply({
      type: 'hello', v: PROTOCOL_VERSION, t: Date.now(), node, pollMs, flows: [], rates: [], total: null,
    });
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Viene chiamato per ogni messaggio pubblicato (es. per registrarlo su file). */
  onPublish(fn: (msg: ServerMsg) => void): void {
    this.listeners.push(fn);
  }

  add(ws: WebSocket): void {
    const c: Client = { ws, alive: true, stale: false };
    this.clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('close', () => this.clients.delete(c));
    ws.on('error', () => ws.terminate());
    // i client possono chiedere un resync esplicito inviando {"type":"resync"}
    ws.on('message', data => {
      try {
        if (JSON.parse(String(data)).type === 'resync') this.sendRaw(c, JSON.stringify(this.state.toHello()));
      } catch { /* messaggio non valido: ignora */ }
    });
    this.sendRaw(c, JSON.stringify(this.state.toHello()));
  }

  publish(msg: ServerMsg): void {
    this.state.apply(msg);
    for (const fn of this.listeners) fn(msg);

    const data = JSON.stringify(msg);
    let hello: string | null = null;
    for (const c of this.clients) {
      if (c.ws.bufferedAmount > MAX_BUFFERED) {
        c.stale = true;
        continue;
      }
      if (c.stale) {
        // è rimasto indietro: invece dei delta persi, lo stato completo
        hello ??= JSON.stringify(this.state.toHello());
        c.stale = false;
        this.sendRaw(c, hello);
        continue;
      }
      this.sendRaw(c, data);
    }
  }

  /** Sostituisce l'intero stato (usato dal replay a ogni ripartenza). */
  reset(hello: HelloMsg): void {
    this.publish(hello);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const c of this.clients) c.ws.close(1001, 'server shutdown');
  }

  private sendRaw(c: Client, data: string): void {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }

  private ping(): void {
    for (const c of this.clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
}
