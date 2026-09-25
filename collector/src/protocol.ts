/**
 * Protocollo WebSocket tra collector e frontend.
 * Questo file non ha dipendenze: puoi copiarlo (o importarlo) così com'è nel frontend.
 *
 * Regole:
 *  - Alla connessione il server invia un `hello` con lo stato completo.
 *  - Poi arrivano solo `tick` incrementali.
 *  - Un nuovo `hello` può arrivare in qualsiasi momento (resync, riavvio del replay):
 *    il client deve SCARTARE il suo stato e ripartire da quello.
 *  - `rates` presente  ⇒ elenco completo dei flussi attivi (top-N); i flussi assenti hanno rate 0.
 *    `rates` assente   ⇒ nessuna novità sui byte, mantieni i valori precedenti.
 */

export const PROTOCOL_VERSION = 1;

export type Direction = 'in' | 'out'; // rispetto al NAS: chi ha aperto la connessione

export interface FlowInfo {
  id: number;          // id sequenziale, stabile per la vita del flusso
  peer: string;        // endpoint remoto (hash anonimo o IP, a seconda di ANON)
  lan: boolean;        // peer in rete privata/locale
  dir: Direction;      // 'in' = aperta da fuori verso il NAS, 'out' = aperta dal NAS
  l4: string;          // tcp | udp | icmp | ...
  port: number;        // porta del servizio (lato server della connessione)
  svc: string;         // servizio dedotto: smb, https, dns, ssh, ...
  fresh: boolean;      // true = connessione appena nata (genera l'impulso visivo)
  t0: number;          // epoch ms in cui il collector l'ha vista la prima volta
}

/** [id, bytes/s in ingresso al NAS, bytes/s in uscita dal NAS] */
export type Rate = [id: number, inBps: number, outBps: number];

export interface Throughput {
  in: number;  // bytes/s
  out: number; // bytes/s
}

export interface HelloMsg {
  type: 'hello';
  v: number;
  t: number;
  node: string;        // hostname del NAS
  pollMs: number;      // ogni quanto arrivano i rate
  flows: FlowInfo[];
  rates: Rate[];
  total: Throughput | null;
}

export interface TickMsg {
  type: 'tick';
  t: number;
  new?: FlowInfo[];
  end?: number[];
  rates?: Rate[];
  other?: Throughput;  // traffico dei flussi esclusi dal top-N
  total?: Throughput;  // throughput reale dell'interfaccia (o somma dei flussi)
}

export type ServerMsg = HelloMsg | TickMsg;

/**
 * Stato ricostruito dai messaggi. Lo usa il server (per il `hello` ai nuovi client)
 * e può usarlo il frontend così com'è.
 */
export class FlowState {
  flows = new Map<number, FlowInfo>();
  rates = new Map<number, Rate>();
  total: Throughput | null = null;
  node = '';
  pollMs = 0;

  apply(msg: ServerMsg): void {
    if (msg.type === 'hello') {
      this.flows = new Map(msg.flows.map(f => [f.id, f]));
      this.rates = new Map(msg.rates.map(r => [r[0], r]));
      this.total = msg.total;
      this.node = msg.node;
      this.pollMs = msg.pollMs;
      return;
    }
    for (const f of msg.new ?? []) this.flows.set(f.id, f);
    for (const id of msg.end ?? []) {
      this.flows.delete(id);
      this.rates.delete(id);
    }
    if (msg.rates) this.rates = new Map(msg.rates.map(r => [r[0], r]));
    if (msg.total) this.total = msg.total;
  }

  toHello(t = Date.now()): HelloMsg {
    return {
      type: 'hello',
      v: PROTOCOL_VERSION,
      t,
      node: this.node,
      pollMs: this.pollMs,
      // in un hello nessun flusso è "fresco": il client non deve far partire mille impulsi
      flows: [...this.flows.values()].map(f => ({ ...f, fresh: false })),
      rates: [...this.rates.values()],
      total: this.total,
    };
  }
}
