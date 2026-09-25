import type { CtEntry, CtEventType } from '../sources/parse.js';
import type { Direction, FlowInfo, Rate, Throughput, TickMsg } from '../protocol.js';
import { classify } from './classify.js';

export interface FlowTableOptions {
  isLocal: (ip: string) => boolean;
  isExcluded: (ip: string) => boolean;
  isLan: (ip: string) => boolean;
  anonymize: (ip: string) => string;
  maxFlows: number;
  maxNewPerTick: number;
}

interface Flow {
  info: FlowInfo;
  ctId: string;
  /** true se nel conntrack la direzione original corrisponde al traffico in uscita dal NAS */
  origIsOut: boolean;
  announced: boolean;
  lastIn: number;
  lastOut: number;
  lastSampleAt: number;
  rateIn: number;
  rateOut: number;
}

/** Quanto ricordare un flusso chiuso, per ignorarlo se ricompare in un dump già in corso. */
const TOMBSTONE_MS = 15_000;

/**
 * Converte le voci di conntrack (contatori cumulativi, prospettiva initiator/responder)
 * in flussi dal punto di vista del NAS (in/out, peer remoto, rate in byte/s).
 */
export class FlowTable {
  private flows = new Map<string, Flow>();
  private tombstones = new Map<string, number>();
  private nextId = 1;
  private initialized = false;

  // novità accumulate fino al prossimo drain()
  private pendingNew: Flow[] = [];
  private pendingEnd: number[] = [];
  private ratesDirty = false;

  constructor(private opts: FlowTableOptions) {}

  get size(): number {
    return this.flows.size;
  }

  /** Evento NEW/DESTROY da `conntrack -E`. */
  onEvent(type: CtEventType, entry: CtEntry, now: number): void {
    if (type === 'NEW') {
      if (!this.tombstones.has(entry.ctId)) this.upsert(entry, now, true);
      return;
    }
    this.remove(entry.ctId, now);
  }

  /**
   * Dump completo da `conntrack -L`: aggiorna contatori e rate, e rimuove i flussi
   * spariti (rete di sicurezza se abbiamo perso un DESTROY).
   * `startedAt` è l'istante in cui è partito il dump: i flussi nati dopo non possono esserci.
   */
  sync(entries: CtEntry[], startedAt: number, now: number): void {
    for (const [id, t] of this.tombstones) if (now - t > TOMBSTONE_MS) this.tombstones.delete(id);

    const seen = new Set<string>();
    for (const e of entries) {
      if (this.tombstones.has(e.ctId)) continue;
      seen.add(e.ctId);
      // le connessioni già aperte al primo dump non sono "nuove": niente impulso
      this.upsert(e, now, this.initialized);
    }
    for (const [ctId, f] of this.flows) {
      if (!seen.has(ctId) && f.info.t0 < startedAt) this.remove(ctId, now);
    }
    this.initialized = true;
    this.ratesDirty = true;
  }

  /** Somma dei rate di tutti i flussi (fallback se /proc/net/dev non è disponibile). */
  sumRates(): Throughput {
    let i = 0;
    let o = 0;
    for (const f of this.flows.values()) {
      i += f.rateIn;
      o += f.rateOut;
    }
    return { in: Math.round(i), out: Math.round(o) };
  }

  /** Restituisce le novità dall'ultimo drain, oppure null se non c'è nulla da inviare. */
  drain(now: number): TickMsg | null {
    const msg: TickMsg = { type: 'tick', t: now };

    if (this.pendingNew.length > 0) {
      const batch = this.pendingNew.splice(0, this.opts.maxNewPerTick);
      for (const f of batch) f.announced = true;
      msg.new = batch.map(f => f.info);
    }
    if (this.pendingEnd.length > 0) {
      msg.end = this.pendingEnd;
      this.pendingEnd = [];
    }
    if (this.ratesDirty) {
      // calcolati qui e non in sync(): un DESTROY arrivato nel frattempo ha già tolto il flusso
      const { rates, other } = this.computeRates();
      msg.rates = rates;
      msg.other = other;
      this.ratesDirty = false;
    }
    return msg.new || msg.end || msg.rates ? msg : null;
  }

  private upsert(e: CtEntry, now: number, fresh: boolean): void {
    const existing = this.flows.get(e.ctId);
    if (existing) {
      this.sample(existing, e, now);
      return;
    }

    const resolved = this.resolve(e);
    if (!resolved) return;
    const { dir, peerIp } = resolved;
    const port = e.orig.dport;
    const origIsOut = dir === 'out';

    const f: Flow = {
      ctId: e.ctId,
      info: {
        id: this.nextId++,
        peer: this.opts.anonymize(peerIp),
        lan: this.opts.isLan(peerIp),
        dir,
        l4: e.l4,
        port,
        svc: classify(e.l4, port),
        fresh,
        t0: now,
      },
      origIsOut,
      announced: false,
      lastIn: origIsOut ? e.reply.bytes : e.orig.bytes,
      lastOut: origIsOut ? e.orig.bytes : e.reply.bytes,
      lastSampleAt: now,
      rateIn: 0,
      rateOut: 0,
    };
    this.flows.set(e.ctId, f);
    this.pendingNew.push(f);
  }

  private sample(f: Flow, e: CtEntry, now: number): void {
    const bytesIn = f.origIsOut ? e.reply.bytes : e.orig.bytes;
    const bytesOut = f.origIsOut ? e.orig.bytes : e.reply.bytes;
    const dt = (now - f.lastSampleAt) / 1000;
    if (dt <= 0) return;
    // max(0): i contatori possono ripartire se l'accounting viene riattivato
    f.rateIn = Math.max(0, bytesIn - f.lastIn) / dt;
    f.rateOut = Math.max(0, bytesOut - f.lastOut) / dt;
    f.lastIn = bytesIn;
    f.lastOut = bytesOut;
    f.lastSampleAt = now;
  }

  private remove(ctId: string, now: number): void {
    this.tombstones.set(ctId, now);
    const f = this.flows.get(ctId);
    if (!f) return;
    this.flows.delete(ctId);
    if (f.announced) {
      this.pendingEnd.push(f.info.id);
    } else {
      // mai annunciato al client: basta toglierlo dalla coda
      const i = this.pendingNew.indexOf(f);
      if (i >= 0) this.pendingNew.splice(i, 1);
    }
  }

  /** Stabilisce chi è il peer remoto e il verso della connessione rispetto al NAS. */
  private resolve(e: CtEntry): { dir: Direction; peerIp: string } | null {
    const { isLocal, isExcluded } = this.opts;
    const { orig, reply } = e;
    let dir: Direction;
    let peerIp: string;

    // reply.dst locale copre il masquerade: container → Internet esce con l'IP del NAS
    if (isLocal(orig.src) || isLocal(reply.dst)) {
      dir = 'out';
      peerIp = orig.dst;
    } else if (isLocal(orig.dst) || isLocal(reply.src)) {
      // orig.dst locale copre anche le porte pubblicate dei container (DNAT)
      dir = 'in';
      peerIp = orig.src;
    } else {
      return null; // traffico inoltrato che non riguarda il NAS
    }
    if (!peerIp || isLocal(peerIp) || isExcluded(peerIp)) return null;
    return { dir, peerIp };
  }

  private computeRates(): { rates: Rate[]; other: Throughput } {
    const active: Flow[] = [];
    const other = { in: 0, out: 0 };
    for (const f of this.flows.values()) {
      if (f.rateIn + f.rateOut <= 0) continue;
      if (f.announced) {
        active.push(f);
      } else {
        other.in += f.rateIn;
        other.out += f.rateOut;
      }
    }
    active.sort((a, b) => b.rateIn + b.rateOut - (a.rateIn + a.rateOut));
    for (const f of active.slice(this.opts.maxFlows)) {
      other.in += f.rateIn;
      other.out += f.rateOut;
    }
    return {
      rates: active
        .slice(0, this.opts.maxFlows)
        .map(f => [f.info.id, Math.round(f.rateIn), Math.round(f.rateOut)] as Rate),
      other: { in: Math.round(other.in), out: Math.round(other.out) },
    };
  }
}
