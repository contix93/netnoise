/**
 * Parser delle righe di `conntrack -o extended,id`, sia da `-L` che da `-E`.
 *
 *   ipv4 2 tcp 6 431999 ESTABLISHED src=A dst=B sport=1 dport=2 packets=3 bytes=4
 *     src=B dst=A sport=2 dport=1 packets=5 bytes=6 [ASSURED] mark=0 use=1 id=123
 *
 * Il primo gruppo src/dst/... è la direzione "original" (chi ha aperto la connessione),
 * il secondo la direzione "reply". Gli eventi hanno in più un prefisso `[NEW]`/`[DESTROY]`.
 */

export interface CtTuple {
  src: string;
  dst: string;
  sport: number;
  dport: number;
  packets: number;
  bytes: number;
}

export interface CtEntry {
  ctId: string;
  family: 'ipv4' | 'ipv6' | 'unknown';
  l4: string;
  state: string | null;
  orig: CtTuple;
  reply: CtTuple;
}

export type CtEventType = 'NEW' | 'DESTROY';

const STATES = new Set([
  'NONE', 'SYN_SENT', 'SYN_RECV', 'ESTABLISHED', 'FIN_WAIT', 'CLOSE_WAIT',
  'LAST_ACK', 'TIME_WAIT', 'CLOSE', 'LISTEN', 'SYN_SENT2',
]);

function emptyTuple(): CtTuple {
  return { src: '', dst: '', sport: 0, dport: 0, packets: 0, bytes: 0 };
}

export function parseEntry(line: string): CtEntry | null {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 4) return null;

  let i = 0;
  let family: CtEntry['family'] = 'unknown';
  if (tokens[0] === 'ipv4' || tokens[0] === 'ipv6') {
    family = tokens[0];
    i = 2; // salta "ipv4 2"
  }
  const l4 = tokens[i] ?? 'unknown';

  let state: string | null = null;
  const tuples = [emptyTuple(), emptyTuple()];
  let dir = -1;
  let ctId = '';

  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq < 0) {
      if (state === null && STATES.has(t)) state = t;
      continue;
    }
    const k = t.slice(0, eq);
    const v = t.slice(eq + 1);
    // l'id della connessione è l'ULTIMO id= della riga
    // (ICMP ha anche un id= dentro le tuple, che viene sovrascritto)
    if (k === 'id') { ctId = v; continue; }
    if (k === 'src') dir++;
    if (dir < 0 || dir > 1) continue;
    const tup = tuples[dir]!;
    switch (k) {
      case 'src': tup.src = v; break;
      case 'dst': tup.dst = v; break;
      case 'sport': tup.sport = Number(v); break;
      case 'dport': tup.dport = Number(v); break;
      case 'packets': tup.packets = Number(v); break;
      case 'bytes': tup.bytes = Number(v); break;
    }
  }

  if (!ctId || dir < 1) return null;
  if (family === 'unknown') family = tuples[0]!.src.includes(':') ? 'ipv6' : 'ipv4';
  return { ctId, family, l4, state, orig: tuples[0]!, reply: tuples[1]! };
}

export function parseEvent(line: string): { type: CtEventType; entry: CtEntry } | null {
  const m = /^\s*\[(NEW|DESTROY)\]\s+(.*)$/.exec(line);
  if (!m) return null;
  const entry = parseEntry(m[2]!);
  return entry ? { type: m[1] as CtEventType, entry } : null;
}
