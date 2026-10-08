import type { Direction, Throughput } from '#protocol';
import type { FlowRow } from '~/composables/useNetnoiseSocket';
import { formatBytes } from './format';
import { num, type FamilyKey, type RhythmLane, type Style, type Voice } from './styles';

/**
 * Trasforma lo stato del traffico in codice Strudel, nello stile scelto (styles.ts).
 *
 * Regole della composizione, uguali per tutti gli stili:
 *  - servizio/protocollo → strumento (una "famiglia" per tipo di traffico, lo strumento lo decide lo stile)
 *  - verso (chi ha aperto la connessione) → registro e panorama: in = un'ottava sotto e a sinistra, out = sopra e a destra
 *  - peso (byte/s) → quante note per ciclo e volume
 *  - peer e porta → le note: ogni flusso ha il suo grado della scala, stabile finché vive
 *  - ricevuti vs inviati in totale → modo della scala (ogni stile ne ha tre)
 *  - throughput totale → ritmo e bordone
 *  - connessioni appena nate → campanelli per un ciclo
 */

interface Family {
  key: FamilyKey;
  label: string;
  color: string;       // colore nella visualizzazione (e `.color()` nel codice)
}

const FAMILIES: Family[] = [
  { key: 'web', label: 'web', color: '#3b82f6' },
  { key: 'file', label: 'file', color: '#ef4444' },
  { key: 'stream', label: 'streaming', color: '#a855f7' },
  { key: 'ctrl', label: 'controllo', color: '#14b8a6' },
  { key: 'tunnel', label: 'tunnel', color: '#f59e0b' },
  { key: 'data', label: 'posta e db', color: '#22c55e' },
  { key: 'p2p', label: 'p2p', color: '#ec4899' },
  { key: 'ping', label: 'ping', color: '#06b6d4' },
  { key: 'other', label: 'altro', color: '#94a3b8' },
];

const FAMILY_OF_SVC: Record<string, FamilyKey> = {
  http: 'web', https: 'web', quic: 'web', web: 'web', homeassistant: 'web',
  smb: 'file', nfs: 'file', afp: 'file', rsync: 'file', ftp: 'file',
  plex: 'stream', jellyfin: 'stream',
  dns: 'ctrl', mdns: 'ctrl', ntp: 'ctrl', dhcp: 'ctrl', ssdp: 'ctrl', netbios: 'ctrl', llmnr: 'ctrl',
  stun: 'ctrl', rpc: 'ctrl', ipp: 'ctrl',
  ssh: 'tunnel', wireguard: 'tunnel', tailscale: 'tunnel', openvpn: 'tunnel', ipsec: 'tunnel', vnc: 'tunnel', rdp: 'tunnel',
  smtp: 'data', imap: 'data', pop3: 'data', mysql: 'data', postgres: 'data', redis: 'data', mqtt: 'data',
  torrent: 'p2p',
  icmp: 'ping',
};

/** Corsie fisse della visualizzazione oltre alle famiglie: ritmo, bordone e campanelli. */
const RHYTHM_LANES: Record<RhythmLane, { label: string; color: string }> = {
  kick: { label: 'ritmo · ricevuti', color: '#f97316' },
  snare: { label: 'ritmo · inviati', color: '#eab308' },
  hat: { label: 'piatti · totale', color: '#b45309' },
  drone: { label: 'bordone · totale', color: '#64748b' },
};
const CHIME = { label: 'nuove connessioni', color: '#84cc16' };

export interface Lane { key: string; label: string; color: string }

export const LANES: Lane[] = [
  ...FAMILIES.map(f => ({ key: f.key, label: f.label, color: f.color })),
  ...Object.entries(RHYTHM_LANES).map(([key, l]) => ({ key, ...l })),
  { key: 'chime', ...CHIME },
];

export interface Layer {
  id: string;          // etichetta nel codice, es. web_in
  family: FamilyKey;
  label: string;
  instrument: string;
  color: string;
  dir: Direction;
  services: string[];
  flows: number;
  rate: number;        // byte/s (ricevuti + inviati)
  level: number;       // 0..1
  pattern: string;     // mininotation generata
}

export interface ComposeOptions {
  style: Style;
  root: string;        // tonica, es. "C" o "F#"
  bpm: number;
}

export interface Composition {
  code: string;
  layers: Layer[];
  mode: string;
  /** livelli 0..1 per i segnali live (netIn, netOut, netTotal) */
  levels: { in: number; out: number; total: number };
}

export const familyOf = (svc: string): FamilyKey => FAMILY_OF_SVC[svc] ?? 'other';

/** Peso in scala logaritmica: 100 B/s → 0, 10 MB/s → 1. */
export function level(bps: number): number {
  return Math.min(1, Math.max(0, (Math.log10(bps + 1) - 2) / 5));
}

/** FNV-1a: stesso flusso → stesso numero, a ogni rigenerazione. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Posizioni di `pulses` colpi distribuiti in modo uniforme su `steps` (euclideo), ruotate di `rot`. */
function euclid(pulses: number, steps: number, rot: number): number[] {
  const hits: number[] = [];
  for (let i = 0; i < steps; i++) if ((i * pulses) % steps < pulses) hits.push((i + rot) % steps);
  return hits.sort((a, b) => a - b);
}

const flowKey = (f: FlowRow) => `${f.peer}|${f.port}|${f.l4}`;
const degreeOf = (f: FlowRow) => hash(flowKey(f)) % 8;

/**
 * Almeno `count` gradi dai flussi (al massimo 16): il primo giro è il grado di ciascun flusso,
 * i giri successivi si muovono di poco attorno a quel grado. Così anche un solo flusso fa una melodia.
 */
function motif(flows: FlowRow[], count: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < Math.max(count, flows.length); k++) {
    const f = flows[k % flows.length]!;
    const round = Math.floor(k / flows.length);
    out.push(round === 0 ? degreeOf(f) : degreeOf(f) + (hash(`${flowKey(f)}#${round}`) % 5) - 2);
  }
  return out;
}

/** Sequenza su `steps` passi: ogni colpo suona il grado di un flusso, a cicli alterni quelli successivi (<a b>). */
function melody(flows: FlowRow[], pulses: number, steps: number, rot: number, chord?: number[]): string {
  const degrees = motif(flows, pulses);
  const slots = Array<string>(steps).fill('~');
  const note = (d: number) => (chord ? `[${chord.map(c => d + c).join(',')}]` : String(d));
  euclid(pulses, steps, rot).forEach((pos, i) => {
    const alts: number[] = [];
    for (let j = i; j < degrees.length && alts.length < 4; j += pulses) alts.push(degrees[j]!);
    slots[pos] = new Set(alts).size > 1 ? `<${alts.map(note).join(' ')}>` : note(alts[0]!);
  });
  return slots.join(' ');
}

function buildLayer(fam: Family, voice: Voice, dir: Direction, flows: FlowRow[], scale: (oct: number) => string): { layer: Layer; line: string } {
  const sorted = flows.slice().sort((a, b) => b.rateIn + b.rateOut - (a.rateIn + a.rateOut));
  const rate = sorted.reduce((s, f) => s + f.rateIn + f.rateOut, 0);
  const lvl = level(rate);
  const id = `${fam.key}_${dir}`;
  const gain = num(Math.round(voice.gain * (0.35 + 0.65 * lvl) * 20) / 20);
  const pan = dir === 'in' ? '.3' : '.7';
  const octave = voice.octave + (dir === 'out' ? 1 : 0);
  const steps = voice.steps;
  const maxPulses = voice.maxPulses ?? steps;
  const pulses = 1 + Math.round(lvl * (maxPulses - 1));
  const rot = voice.kind === 'chord' ? 0 : hash(id) % steps;

  let pattern: string;
  let line: string;
  if (voice.kind === 'perc') {
    pattern = `${voice.sound}(${pulses},${steps},${rot})`;
    line = `s("${voice.sound}").euclidRot(${pulses},${steps},${rot})`;
  } else {
    pattern = melody(sorted.slice(0, 16), pulses, steps, rot, voice.kind === 'chord' ? voice.chord ?? [0, 2, 4] : undefined);
    line = `n("${pattern}").scale("${scale(octave)}")`;
  }
  line += `${voice.tail(lvl, dir)}.gain(${gain}).pan(${pan}).color("${fam.color}")`;

  const services = [...new Set(sorted.map(f => f.svc))];
  const arrow = dir === 'in' ? '↘ in' : '↗ out';
  const comment = `// ${fam.label} ${arrow} · ${services.slice(0, 4).join(', ')}${services.length > 4 ? '…' : ''}`
    + ` · ${flows.length} ${flows.length === 1 ? 'flusso' : 'flussi'} · ${formatBytes(Math.round(rate))}/s → ${voice.instrument}`;

  return {
    layer: {
      id, family: fam.key, label: fam.label, instrument: voice.instrument, color: fam.color, dir,
      services, flows: flows.length, rate, level: lvl, pattern,
    },
    line: `${comment}\n${id}: ${line}`,
  };
}

/**
 * `fresh` sono i flussi comparsi dall'ultima composizione: suonano un campanello ciascuno, per un ciclo.
 */
export function compose(flows: FlowRow[], total: Throughput | null, fresh: FlowRow[], opts: ComposeOptions): Composition {
  const { style } = opts;
  const totIn = total?.in ?? flows.reduce((s, f) => s + f.rateIn, 0);
  const totOut = total?.out ?? flows.reduce((s, f) => s + f.rateOut, 0);
  const levels = { in: level(totIn), out: level(totOut), total: level(totIn + totOut) };

  // si riceve di più / in equilibrio / si invia di più → i tre modi dello stile
  const share = totIn + totOut > 0 ? totIn / (totIn + totOut) : 0.5;
  const scaleName = style.modes[share > 0.6 ? 0 : share < 0.4 ? 2 : 1];
  const scale = (oct: number) => `${opts.root}${oct}:${scaleName}`;
  const mode = scaleName.replaceAll(':', ' ');

  // solo i flussi con traffico: quelli fermi resterebbero a suonare all'infinito
  const groups = new Map<string, FlowRow[]>();
  for (const f of flows) {
    if (f.rateIn + f.rateOut === 0) continue;
    const key = `${familyOf(f.svc)}_${f.dir}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  const built = FAMILIES.flatMap(fam =>
    (['in', 'out'] as const).flatMap(dir => {
      const g = groups.get(`${fam.key}_${dir}`);
      return g ? [buildLayer(fam, style.voices[fam.key], dir, g, scale)] : [];
    }),
  );

  const lines: string[] = [
    `// netnoise · ${style.label} · ricevuti ${formatBytes(Math.round(totIn))}/s · inviati ${formatBytes(Math.round(totOut))}/s`
      + ` · ${built.reduce((s, b) => s + b.layer.flows, 0)} flussi con traffico`,
    `// ${share > 0.6 ? 'si riceve più di quanto si invia' : share < 0.4 ? 'si invia più di quanto si riceve' : 'traffico in equilibrio'} → ${mode}`,
    `setcpm(${opts.bpm}/4)`,
    '',
    ...style.rhythm({
      ...levels,
      scale,
      color: Object.fromEntries(Object.entries(RHYTHM_LANES).map(([k, l]) => [k, l.color])) as Record<RhythmLane, string>,
    }),
  ];

  for (const b of built) lines.push('', b.line);

  if (fresh.length) {
    const degrees = fresh.slice(0, 8).map(degreeOf);
    const slots = Array<string>(8).fill('~');
    degrees.forEach((d, i) => { slots[Math.floor((i * 8) / degrees.length)] = String(d); });
    lines.push(
      '',
      `// ${fresh.length} ${fresh.length === 1 ? 'nuova connessione' : 'nuove connessioni'}: ${fresh.slice(0, 4).map(f => f.svc).join(', ')}${fresh.length > 4 ? '…' : ''}`,
      `chime: n("${slots.join(' ')}").scale("${scale(style.chime.octave)}")${style.chime.tail}.color("${CHIME.color}")`,
    );
  }

  return { code: `${lines.join('\n')}\n`, layers: built.map(b => b.layer), mode, levels };
}
