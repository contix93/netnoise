import type { CtEntry, CtEventType, CtTuple } from './parse.js';
import type { FlowSource } from './source.js';

/**
 * Generatore sintetico che imita un NAS domestico: SMB dal PC, streaming verso la TV,
 * HTTPS/DNS verso Internet, qualche scansione dall'esterno.
 * Produce le stesse CtEntry del conntrack reale, così tutta la pipeline è identica.
 */

const NAS_IP = '192.168.1.5';

interface Profile {
  name: string;
  l4: 'tcp' | 'udp' | 'icmp';
  /** true = il peer apre la connessione verso il NAS */
  inbound: boolean;
  port: () => number;
  peer: () => string;
  /** nuove connessioni al secondo (media) */
  spawnPerSec: number;
  lifetimeMs: [number, number];
  /** bytes/s medi: [dal peer al NAS, dal NAS al peer] */
  bps: [number, number];
  /** periodo delle oscillazioni di traffico (ms) */
  burstMs: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;
const wanIp = () =>
  `${pick([1, 8, 13, 34, 52, 104, 142, 151, 172, 185, 212])}.${Math.floor(rnd(0, 255))}.${Math.floor(rnd(0, 255))}.${Math.floor(rnd(1, 254))}`;
// un piccolo insieme di server "ricorrenti", così i nodi remoti si ripetono
const cdnPool = Array.from({ length: 25 }, wanIp);

const PROFILES: Profile[] = [
  { name: 'smb', l4: 'tcp', inbound: true, port: () => 445, peer: () => pick(['192.168.1.20', '192.168.1.21']),
    spawnPerSec: 0.05, lifetimeMs: [30_000, 180_000], bps: [2e6, 40e6], burstMs: 8000 },
  { name: 'jellyfin', l4: 'tcp', inbound: true, port: () => 8096, peer: () => '192.168.1.30',
    spawnPerSec: 0.03, lifetimeMs: [60_000, 300_000], bps: [20e3, 3e6], burstMs: 4000 },
  { name: 'ssh', l4: 'tcp', inbound: true, port: () => 22, peer: () => '192.168.1.20',
    spawnPerSec: 0.01, lifetimeMs: [60_000, 600_000], bps: [300, 2e3], burstMs: 3000 },
  { name: 'https', l4: 'tcp', inbound: false, port: () => 443, peer: () => (Math.random() < 0.7 ? pick(cdnPool) : wanIp()),
    spawnPerSec: 1.5, lifetimeMs: [1_000, 45_000], bps: [80e3, 8e3], burstMs: 2000 },
  { name: 'quic', l4: 'udp', inbound: false, port: () => 443, peer: () => pick(cdnPool),
    spawnPerSec: 0.3, lifetimeMs: [5_000, 60_000], bps: [300e3, 20e3], burstMs: 2500 },
  { name: 'dns', l4: 'udp', inbound: false, port: () => 53, peer: () => pick(['192.168.1.1', '1.1.1.1', '9.9.9.9']),
    spawnPerSec: 2, lifetimeMs: [200, 2_000], bps: [400, 150], burstMs: 500 },
  { name: 'ntp', l4: 'udp', inbound: false, port: () => 123, peer: () => pick(cdnPool),
    spawnPerSec: 0.02, lifetimeMs: [200, 1_000], bps: [200, 200], burstMs: 500 },
  { name: 'apt', l4: 'tcp', inbound: false, port: () => 80, peer: () => pick(['151.101.2.132', '199.232.190.132']),
    spawnPerSec: 0.02, lifetimeMs: [5_000, 30_000], bps: [4e6, 30e3], burstMs: 3000 },
  { name: 'mdns', l4: 'udp', inbound: false, port: () => 5353, peer: () => '224.0.0.251',
    spawnPerSec: 0.1, lifetimeMs: [500, 2_000], bps: [0, 500], burstMs: 500 },
  { name: 'scan', l4: 'tcp', inbound: true, port: () => pick([23, 3389, 8080, 5900, 6379, 9200]), peer: wanIp,
    spawnPerSec: 0.2, lifetimeMs: [100, 3_000], bps: [120, 60], burstMs: 500 },
  { name: 'ping', l4: 'icmp', inbound: true, port: () => 0, peer: () => '192.168.1.1',
    spawnPerSec: 0.05, lifetimeMs: [1_000, 10_000], bps: [84, 84], burstMs: 1000 },
];

interface SimFlow {
  entry: CtEntry;
  profile: Profile;
  endsAt: number;
  phase: number;
  scale: number;
  lastAdvance: number;
}

export class MockSource implements FlowSource {
  private flows = new Map<string, SimFlow>();
  private nextId = 1;
  private timer: NodeJS.Timeout | null = null;

  localIps(): Set<string> {
    return new Set([NAS_IP, '127.0.0.1', '::1']);
  }

  start(onEvent: (type: CtEventType, entry: CtEntry) => void): void {
    // qualche flusso già esistente all'avvio, come su un NAS vero
    const now = Date.now();
    for (const p of PROFILES) if (p.lifetimeMs[1] > 30_000) this.spawn(p, now);

    let last = now;
    this.timer = setInterval(() => {
      const t = Date.now();
      const dt = (t - last) / 1000;
      last = t;
      for (const p of PROFILES) {
        if (Math.random() < p.spawnPerSec * dt) onEvent('NEW', structuredClone(this.spawn(p, t).entry));
      }
      for (const [id, f] of this.flows) {
        if (t >= f.endsAt) {
          this.advance(f, t);
          this.flows.delete(id);
          onEvent('DESTROY', structuredClone(f.entry));
        }
      }
    }, 50);
  }

  async dump(): Promise<CtEntry[]> {
    const t = Date.now();
    return [...this.flows.values()].map(f => {
      this.advance(f, t);
      return structuredClone(f.entry);
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private spawn(p: Profile, now: number): SimFlow {
    const peer = p.peer();
    const port = p.port();
    const eph = Math.floor(rnd(32768, 60999));
    const [client, server] = p.inbound ? [peer, NAS_IP] : [NAS_IP, peer];
    const tuple = (src: string, dst: string, sport: number, dport: number): CtTuple =>
      ({ src, dst, sport, dport, packets: 1, bytes: 60 });
    const entry: CtEntry = {
      ctId: String(this.nextId++),
      family: 'ipv4',
      l4: p.l4,
      state: p.l4 === 'tcp' ? 'ESTABLISHED' : null,
      orig: tuple(client, server, eph, port),
      reply: tuple(server, client, port, eph),
    };
    const f: SimFlow = {
      entry,
      profile: p,
      endsAt: now + rnd(...p.lifetimeMs),
      phase: Math.random() * Math.PI * 2,
      scale: rnd(0.3, 1.5),
      lastAdvance: now,
    };
    this.flows.set(entry.ctId, f);
    return f;
  }

  /** Fa crescere i contatori cumulativi in base al tempo trascorso. */
  private advance(f: SimFlow, t: number): void {
    const dt = (t - f.lastAdvance) / 1000;
    if (dt <= 0) return;
    f.lastAdvance = t;
    const wave = 0.15 + 0.85 * Math.abs(Math.sin(t / f.profile.burstMs + f.phase)) ** 2;
    const k = wave * f.scale * rnd(0.8, 1.2) * dt;
    const [fromPeer, toPeer] = f.profile.bps;
    // original = chi ha aperto; per le connessioni in ingresso è il peer
    const origBps = f.profile.inbound ? fromPeer : toPeer;
    const replyBps = f.profile.inbound ? toPeer : fromPeer;
    const addO = Math.round(origBps * k);
    const addR = Math.round(replyBps * k);
    f.entry.orig.bytes += addO;
    f.entry.reply.bytes += addR;
    f.entry.orig.packets += Math.ceil(addO / 1400);
    f.entry.reply.packets += Math.ceil(addR / 1400);
  }
}
