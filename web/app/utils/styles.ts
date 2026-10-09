import type { Direction } from '#protocol';

/**
 * Stili musicali: per ogni tipo di traffico (famiglia) uno strumento, più una sezione ritmica
 * e un bordone che seguono il traffico totale. Le regole che legano traffico e note
 * (peso → densità e volume, verso → ottava e panorama, flusso → grado della scala)
 * sono le stesse per tutti gli stili: sono in compose.ts.
 */

export type FamilyKey = 'web' | 'file' | 'stream' | 'ctrl' | 'tunnel' | 'data' | 'p2p' | 'ping' | 'other';

export interface Voice {
  instrument: string;  // descrizione per la legenda
  /**
   * melody = una nota per colpo · chord = accordi (gradi `chord` sopra la nota)
   * perc = un campione senza altezza (`sound`)
   */
  kind: 'melody' | 'chord' | 'perc';
  /**
   * ottava per il verso `in`; `out` suona un'ottava sopra. Con tonica B e il grado più alto una melodia
   * arriva a midi 12 × ottava + 51 (accordi + 57): i soundfont gm_* sopra la loro estensione non suonano
   * o non si decodificano (vibrafono < 84, cristalli < 92, campane tubolari < 96).
   */
  octave: number;
  gain: number;        // volume massimo
  steps: number;       // passi per ciclo
  maxPulses?: number;  // colpi per ciclo col traffico al massimo (default: tutti i passi)
  chord?: number[];    // per kind chord, default [0, 2, 4]
  sound?: string;      // per kind perc
  /** strumento ed effetti dopo le note; `level` è il peso 0..1 */
  tail: (level: number, dir: Direction) => string;
}

/** Cosa serve allo stile per scrivere ritmo e bordone. */
export interface RhythmCtx {
  in: number;          // livello 0..1 dei byte ricevuti
  out: number;         // livello 0..1 dei byte inviati
  total: number;
  scale: (octave: number) => string;
  color: Record<RhythmLane, string>;
}

export type RhythmLane = 'kick' | 'snare' | 'hat' | 'drone';

export interface Style {
  key: string;
  label: string;
  description: string;
  bpm: number;
  /** tonica di default (C, C#, … B): cambiando stile si riparte da questa */
  root: string;
  /** modo della scala quando si riceve di più, in equilibrio, quando si invia di più (nomi tonal, ':' al posto degli spazi) */
  modes: [string, string, string];
  voices: Record<FamilyKey, Voice>;
  /** righe di codice per ritmo e bordone (con i loro commenti) */
  rhythm: (c: RhythmCtx) => string[];
  /** strumento dei campanelli per le connessioni nuove */
  chime: { octave: number; tail: string };
}

/** Numero con al massimo due decimali e senza lo zero iniziale, come si scrive in Strudel: 0.55 → .55 */
export function num(x: number): string {
  return String(Number(x.toFixed(2))).replace(/^0\./, '.');
}

/** Sceglie l'elemento di `list` in proporzione a `level` 0..1. */
const pick = <T>(list: T[], level: number): T => list[Math.min(list.length - 1, Math.floor(level * list.length))]!;

// --- synth: il primo stile, sintetizzatori e pianoforte ----------------------------

const synth: Style = {
  key: 'synth',
  label: 'Synth',
  description: 'pianoforte, basso sawtooth e pad supersaw su cassa e clap',
  bpm: 110,
  root: 'C',
  modes: ['minor', 'dorian', 'major'],
  voices: {
    web: { instrument: 'pianoforte', kind: 'melody', octave: 3, gain: 0.7, steps: 8, tail: () => '.s("piano").room(.3)' },
    file: { instrument: 'basso sawtooth', kind: 'melody', octave: 1, gain: 0.6, steps: 8,
      tail: l => `.s("sawtooth").lpf(${Math.round(2 + l * 24) * 100}).lpq(6).decay(.2).sustain(.3)` },
    stream: { instrument: 'pad supersaw', kind: 'chord', octave: 3, gain: 0.45, steps: 4,
      tail: () => '.s("supersaw").attack(.4).release(1.2).lpf(1800)' },
    ctrl: { instrument: 'charleston', kind: 'perc', sound: 'hh', octave: 0, gain: 0.5, steps: 16, maxPulses: 10,
      tail: (_, d) => `.speed(${d === 'in' ? 1 : 1.6})` },
    tunnel: { instrument: 'bleep square', kind: 'melody', octave: 4, gain: 0.35, steps: 8,
      tail: () => '.s("square").decay(.08).sustain(0).lpf(2400)' },
    data: { instrument: 'pizzicato triangle', kind: 'melody', octave: 4, gain: 0.5, steps: 8,
      tail: () => '.s("triangle").decay(.25).sustain(0).delay(.3)' },
    p2p: { instrument: 'sawtooth sgranato', kind: 'melody', octave: 3, gain: 0.35, steps: 8,
      tail: () => '.s("sawtooth").decay(.06).sustain(0).crush(5).lpf(3000)' },
    ping: { instrument: 'sine con eco', kind: 'melody', octave: 5, gain: 0.4, steps: 8,
      tail: () => '.s("sine").decay(.4).sustain(0).delay(.5).delayfeedback(.5)' },
    other: { instrument: 'triangle', kind: 'melody', octave: 3, gain: 0.4, steps: 8,
      tail: () => '.s("triangle").decay(.15).sustain(.2)' },
  },
  rhythm: c => {
    const lines = [
      '// bordone: segue il traffico totale con i segnali live (0..1): netIn, netOut, netTotal',
      `drone: n("<0 [0,4]>").scale("${c.scale(2)}").s("sawtooth").attack(.5).release(1.5)`
        + `.lpf(netTotal.range(150, 1200)).gain(netTotal.range(.05, .3)).color("${c.color.drone}")`,
      '',
      '// ritmo: cassa = byte ricevuti, clap = byte inviati',
    ];
    const kick = Math.round(c.in * 5);
    const clap = Math.round(c.out * 4);
    if (kick) lines.push(`kick: s("bd").euclid(${kick},8).gain(.8).color("${c.color.kick}")`);
    if (clap) lines.push(`clap: s("cp").euclidRot(${clap},8,2).gain(.45).color("${c.color.snare}")`);
    return lines;
  },
  chime: { octave: 5, tail: '.s("triangle").decay(.3).sustain(0).delay(.4).gain(.35)' },
};

// --- 8bit: chiptune, solo onde quadre, triangolo e rumore ------------------------

const chip: Style = {
  key: '8bit',
  label: '8bit',
  description: 'chiptune da console: onde quadre, basso triangolo, rumore sgranato, arpeggi veloci',
  bpm: 140,
  root: 'D',
  modes: ['minor', 'mixolydian', 'major'],
  voices: {
    web: { instrument: 'lead square', kind: 'melody', octave: 4, gain: 0.45, steps: 16, maxPulses: 12,
      tail: () => '.s("square").decay(.12).sustain(.3).crush(8)' },
    file: { instrument: 'basso triangolo', kind: 'melody', octave: 2, gain: 0.7, steps: 8,
      tail: () => '.s("triangle").decay(.15).sustain(.6)' },
    stream: { instrument: 'arpeggio pulse', kind: 'chord', octave: 4, gain: 0.35, steps: 2,
      tail: () => '.arp("0 1 2 1 0 1 2 1").s("pulse").decay(.08).sustain(.2)' },
    ctrl: { instrument: 'rumore bianco', kind: 'perc', sound: 'white', octave: 0, gain: 0.3, steps: 16, maxPulses: 10,
      tail: (_, d) => `.decay(${d === 'in' ? '.03' : '.06'}).sustain(0).crush(4)` },
    tunnel: { instrument: 'pulse corto', kind: 'melody', octave: 5, gain: 0.3, steps: 16, maxPulses: 8,
      tail: () => '.s("pulse").decay(.05).sustain(0)' },
    data: { instrument: 'blip triangolo', kind: 'melody', octave: 5, gain: 0.4, steps: 8,
      tail: () => '.s("triangle").decay(.1).sustain(0)' },
    p2p: { instrument: 'square distrutta', kind: 'melody', octave: 3, gain: 0.3, steps: 16, maxPulses: 8,
      tail: () => '.s("square").decay(.04).sustain(0).crush(3)' },
    ping: { instrument: 'eco square', kind: 'melody', octave: 6, gain: 0.25, steps: 8, maxPulses: 4,
      tail: () => '.s("square").decay(.15).sustain(0).delay(.375).delayfeedback(.4)' },
    other: { instrument: 'square', kind: 'melody', octave: 3, gain: 0.35, steps: 8,
      tail: () => '.s("square").decay(.1).sustain(.2)' },
  },
  rhythm: c => {
    const lines = [
      '// basso continuo: segue il traffico totale (netTotal 0..1)',
      `drone: n("<0 0 3 4>*2").scale("${c.scale(1)}").s("triangle").decay(.2).sustain(.5)`
        + `.gain(netTotal.range(.1, .5)).color("${c.color.drone}")`,
      '',
      '// batteria sgranata: cassa = ricevuti, rullante = inviati',
    ];
    const kick = Math.round(c.in * 5);
    const snare = Math.round(c.out * 3);
    if (kick) lines.push(`kick: s("bd").euclid(${kick},8).crush(4).gain(.7).color("${c.color.kick}")`);
    if (snare) lines.push(`snare: s("sd").euclidRot(${snare},8,2).crush(4).gain(.45).color("${c.color.snare}")`);
    return lines;
  },
  chime: { octave: 6, tail: '.s("square").decay(.08).sustain(0).gain(.3)' },
};

// --- techno: cassa dritta, acid, stab ------------------------------------------

const techno: Style = {
  key: 'techno',
  label: 'Techno',
  description: 'cassa in quattro, basso acid risonante, stab di supersaw, charleston in sedicesimi',
  bpm: 128,
  root: 'F',
  modes: ['phrygian', 'minor', 'dorian'],
  voices: {
    web: { instrument: 'stab supersaw', kind: 'chord', octave: 3, gain: 0.4, steps: 8, maxPulses: 4,
      tail: l => `.s("supersaw").decay(.15).sustain(0).lpf(${Math.round(8 + l * 32) * 100}).room(.4)` },
    file: { instrument: 'basso acid', kind: 'melody', octave: 1, gain: 0.55, steps: 16, maxPulses: 12,
      tail: l => `.s("sawtooth").lpf(${Math.round(3 + l * 15) * 100}).lpq(14).decay(.12).sustain(0).shape(.3)` },
    stream: { instrument: 'pad scuro', kind: 'chord', octave: 3, gain: 0.35, steps: 1,
      tail: () => '.s("sawtooth").attack(1).release(2).lpf(600).room(.8)' },
    ctrl: { instrument: 'charleston', kind: 'perc', sound: 'hh', octave: 0, gain: 0.45, steps: 16, maxPulses: 12,
      tail: (_, d) => `.speed(${d === 'in' ? 1 : 1.3}).hpf(4000)` },
    tunnel: { instrument: 'rimshot', kind: 'perc', sound: 'rim', octave: 0, gain: 0.4, steps: 16, maxPulses: 6,
      tail: () => '.delay(.25)' },
    data: { instrument: 'blip sine', kind: 'melody', octave: 5, gain: 0.35, steps: 16, maxPulses: 8,
      tail: () => '.s("sine").decay(.05).sustain(0).delay(.375).delayfeedback(.5)' },
    p2p: { instrument: 'rumore filtrato', kind: 'perc', sound: 'white', octave: 0, gain: 0.25, steps: 16, maxPulses: 8,
      tail: l => `.decay(.1).sustain(0).hpf(${Math.round(10 + l * 60) * 100})` },
    ping: { instrument: 'sine con eco', kind: 'melody', octave: 5, gain: 0.35, steps: 8, maxPulses: 3,
      tail: () => '.s("sine").decay(.3).sustain(0).delay(.5).delayfeedback(.6)' },
    other: { instrument: 'square corta', kind: 'melody', octave: 4, gain: 0.3, steps: 16, maxPulses: 6,
      tail: () => '.s("square").decay(.06).sustain(0).lpf(2000)' },
  },
  rhythm: c => {
    const lines = [
      '// sub: segue il traffico totale (netTotal 0..1)',
      `drone: n("~ 0 ~ 0 ~ 0 ~ <0 -2>").scale("${c.scale(1)}").s("sine").decay(.2).sustain(.4)`
        + `.gain(netTotal.range(.2, .6)).color("${c.color.drone}")`,
    ];
    if (c.total === 0) return lines;
    lines.push('', '// cassa dritta (più forte con più byte ricevuti), clap = inviati, open hat = totale');
    lines.push(`kick: s("bd*4").gain(${num(0.55 + c.in * 0.4)}).color("${c.color.kick}")`);
    if (c.out > 0.1) lines.push(`clap: s("${c.out > 0.7 ? '~ cp ~ [cp cp]' : '~ cp ~ cp'}").gain(${num(0.3 + c.out * 0.3)}).room(.3).color("${c.color.snare}")`);
    if (c.total > 0.3) lines.push(`openhat: s("[~ oh]*4").gain(${num(0.15 + c.total * 0.25)}).color("${c.color.hat}")`);
    return lines;
  },
  chime: { octave: 6, tail: '.s("sine").decay(.1).sustain(0).delay(.5).delayfeedback(.5).gain(.3)' },
};

// --- bass: sub sempre acceso, reese distorto che fa wobble, break spezzati a 100 ---------------

// due passi: cassa sull'1 e sul 3-e, rullante sul 2 e sul 4; con più traffico si aggiungono colpi fantasma
const BASS_KICK = [
  'bd ~ ~ ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~',
  'bd ~ bd ~ ~ ~ ~ ~ ~ ~ bd ~ ~ ~ ~ ~',
  'bd ~ bd ~ ~ ~ ~ ~ ~ bd bd ~ ~ ~ ~ bd',
];
const BASS_SNARE = [
  '~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ ~',
  '~ ~ ~ ~ sd ~ ~ sd ~ ~ ~ ~ sd ~ ~ ~',
  '~ ~ ~ ~ sd ~ ~ sd ~ sd ~ ~ sd ~ ~ sd',
];
// cicli di wobble per battuta: più traffico, più veloce
const BASS_WOBBLE = [1, 2, 4, 8];

const bass: Style = {
  key: 'bass',
  label: 'Bass',
  description: 'sub sempre acceso, basso reese distorto che fa wobble, break spezzati lenti, zap e blip FM',
  bpm: 100,
  root: 'G',
  modes: ['phrygian', 'minor', 'dorian'],
  voices: {
    web: { instrument: 'stab scuro', kind: 'chord', octave: 2, gain: 0.4, steps: 8, maxPulses: 3,
      tail: l => `.s("sawtooth").decay(.15).sustain(0).lpf(${Math.round(6 + l * 14) * 100}).shape(.3)` },
    file: { instrument: 'basso growl', kind: 'melody', octave: 1, gain: 0.6, steps: 16, maxPulses: 8,
      tail: l => `.s("sawtooth").lpf(sine.fast(8).range(200, ${Math.round(6 + l * 24) * 100})).lpq(10).decay(.12).sustain(.4).shape(.5)` },
    stream: { instrument: 'pad scuro', kind: 'chord', octave: 2, gain: 0.3, steps: 1,
      tail: () => '.s("sawtooth").attack(1).release(2).lpf(500).room(.6)' },
    ctrl: { instrument: 'charleston', kind: 'perc', sound: 'hh', octave: 0, gain: 0.35, steps: 16, maxPulses: 14,
      tail: (_, d) => `.speed(${d === 'in' ? 1.2 : 1.5}).hpf(7000)` },
    tunnel: { instrument: 'rimshot', kind: 'perc', sound: 'rim', octave: 0, gain: 0.4, steps: 16, maxPulses: 5,
      tail: () => '' },
    data: { instrument: 'blip FM', kind: 'melody', octave: 4, gain: 0.3, steps: 16, maxPulses: 6,
      tail: () => '.s("sine").fm(4).fmh(2.01).decay(.08).sustain(0)' },
    p2p: { instrument: 'rumore filtrato', kind: 'perc', sound: 'white', octave: 0, gain: 0.2, steps: 16, maxPulses: 8,
      tail: l => `.decay(.06).sustain(0).hpf(${Math.round(20 + l * 60) * 100})` },
    ping: { instrument: 'zap laser', kind: 'melody', octave: 4, gain: 0.3, steps: 4, maxPulses: 2,
      tail: () => '.s("square").penv(24).pdecay(.08).decay(.12).sustain(0).lpf(3000)' },
    other: { instrument: 'square corta', kind: 'melody', octave: 3, gain: 0.3, steps: 16, maxPulses: 6,
      tail: () => '.s("square").decay(.05).sustain(0).lpf(1500)' },
  },
  rhythm: c => {
    const lines = [
      '// sub: una nota lunga per battuta, sempre accesa, più forte col traffico totale (netTotal 0..1)',
      `drone: n("<0 0 -2 -3>").scale("${c.scale(1)}").s("sine").release(.1).lpf(180)`
        + `.gain(netTotal.range(.7, 1)).color("${c.color.drone}")`,
    ];
    if (c.total === 0) return lines;
    const wobble = pick(BASS_WOBBLE, c.total);
    const open = Math.round(8 + c.in * 22) * 100;
    lines.push(
      '',
      `// reese in sedicesimi: il filtro oscilla ${wobble} ${wobble === 1 ? 'volta' : 'volte'} per battuta (traffico totale), si apre fino a ${open} Hz (byte ricevuti)`,
      `reese: n("[0 0 ~ 0] [0 ~ 0 0] [<3 -2> <3 -2> ~ <3 -2>] [0 ~ 0 ~]").scale("${c.scale(1)}")`
        + `.s("supersaw").detune(.4).unison(4).lpf(sine.fast(${wobble}).range(150, ${open})).lpq(8)`
        + `.shape(.5).gain(1.3).color("${c.color.drone}")`,
      '',
      '// due passi: cassa più fitta con più byte ricevuti, rullante più fitto con più byte inviati',
      `kick: s("${pick(BASS_KICK, c.in)}").shape(.3).gain(.95).color("${c.color.kick}")`,
      `snare: s("${pick(BASS_SNARE, c.out)}").gain(.6).color("${c.color.snare}")`,
    );
    if (c.total > 0.3) {
      lines.push('', '// amen break tagliato in sedicesimi, sotto la batteria: più traffico, più forte');
      lines.push(`amen: s("brk").fit().chop(16).hpf(400).gain(${num(0.15 + c.total * 0.3)}).color("${c.color.hat}")`);
    }
    return lines;
  },
  chime: { octave: 5, tail: '.s("square").fm(2).fmh(3).decay(.1).sustain(0).lpf(3000).gain(.3)' },
};

// --- acid: basso 303 risonante che si apre col traffico, cassa in quattro, cowbell --------

const acid: Style = {
  key: 'acid',
  label: 'Acid',
  description: 'acid house: linea 303 risonante che si apre col traffico, cassa in quattro, clap e cowbell',
  bpm: 124,
  root: 'E',
  modes: ['phrygian', 'minor', 'mixolydian'],
  voices: {
    web: { instrument: 'lead acid', kind: 'melody', octave: 3, gain: 0.4, steps: 16, maxPulses: 10,
      tail: l => `.s("sawtooth").lpf(${Math.round(4 + l * 16) * 100}).lpq(18).lpenv(3).lpdecay(.12).decay(.15).sustain(.2).shape(.2)` },
    file: { instrument: 'basso square risonante', kind: 'melody', octave: 2, gain: 0.5, steps: 16, maxPulses: 8,
      tail: l => `.s("square").lpf(${Math.round(3 + l * 10) * 100}).lpq(15).lpenv(4).lpdecay(.1).decay(.12).sustain(0)` },
    stream: { instrument: 'stab di accordi', kind: 'chord', octave: 3, gain: 0.35, steps: 8, maxPulses: 3,
      tail: () => '.s("sawtooth").decay(.12).sustain(0).lpf(1600).room(.4)' },
    ctrl: { instrument: 'charleston', kind: 'perc', sound: 'hh', octave: 0, gain: 0.4, steps: 16, maxPulses: 12,
      tail: (_, d) => `.speed(${d === 'in' ? 1 : 1.3})` },
    tunnel: { instrument: 'cowbell', kind: 'perc', sound: 'cb', octave: 0, gain: 0.35, steps: 16, maxPulses: 4,
      tail: () => '' },
    data: { instrument: 'blip square', kind: 'melody', octave: 4, gain: 0.3, steps: 16, maxPulses: 6,
      tail: () => '.s("square").lpf(1200).lpq(12).lpenv(3).decay(.08).sustain(0)' },
    p2p: { instrument: 'rumore filtrato', kind: 'perc', sound: 'white', octave: 0, gain: 0.2, steps: 16, maxPulses: 8,
      tail: l => `.decay(.05).sustain(0).hpf(${Math.round(30 + l * 50) * 100})` },
    ping: { instrument: 'zap laser', kind: 'melody', octave: 4, gain: 0.3, steps: 4, maxPulses: 2,
      tail: () => '.s("square").penv(24).pdecay(.08).decay(.12).sustain(0).lpf(3000)' },
    other: { instrument: 'triangle corta', kind: 'melody', octave: 3, gain: 0.3, steps: 8,
      tail: () => '.s("triangle").decay(.1).sustain(0)' },
  },
  rhythm: c => {
    const lines = [
      '// linea 303: il filtro si apre con il traffico totale (netTotal 0..1), sempre accesa',
      `drone: n("0 ~ 0 7 ~ 0 3 ~ 0 ~ 5 0 ~ 7 0 ~").scale("${c.scale(1)}").s("sawtooth")`
        + `.lpf(netTotal.range(300, 2500)).lpq(20).lpenv(3).lpdecay(.12).decay(.15).sustain(.3).shape(.3)`
        + `.gain(.7).color("${c.color.drone}")`,
    ];
    if (c.total === 0) return lines;
    lines.push('', '// cassa in quattro (più forte con più byte ricevuti), clap = inviati, open hat = totale');
    lines.push(`kick: s("bd*4").gain(${num(0.55 + c.in * 0.4)}).color("${c.color.kick}")`);
    if (c.out > 0.1) lines.push(`clap: s("~ cp ~ cp").gain(${num(0.3 + c.out * 0.3)}).color("${c.color.snare}")`);
    if (c.total > 0.3) lines.push(`openhat: s("[~ oh]*4").gain(${num(0.15 + c.total * 0.25)}).color("${c.color.hat}")`);
    return lines;
  },
  chime: { octave: 5, tail: '.s("sawtooth").lpf(1500).lpq(15).lpenv(3).decay(.1).sustain(0).gain(.3)' },
};

// --- trance: basso in levare, accordi supersaw a sedicesimi che si aprono col traffico ---------

const trance: Style = {
  key: 'trance',
  label: 'Trance',
  description: 'basso in levare, accordi supersaw a sedicesimi che si aprono col traffico, arpeggi ed eco su giro i–VI–III–VII',
  bpm: 138,
  root: 'B',
  modes: ['minor', 'harmonic:minor', 'dorian'],
  voices: {
    web: { instrument: 'lead supersaw', kind: 'melody', octave: 4, gain: 0.4, steps: 16, maxPulses: 8,
      tail: l => `.s("supersaw").detune(.25).unison(5).lpf(${Math.round(20 + l * 40) * 100}).decay(.2).sustain(.3).delay(.375).delayfeedback(.4).room(.4)` },
    file: { instrument: 'pluck', kind: 'melody', octave: 4, gain: 0.4, steps: 16, maxPulses: 12,
      tail: l => `.s("sawtooth").lpf(${Math.round(8 + l * 20) * 100}).lpenv(4).lpdecay(.08).decay(.1).sustain(0).delay(.375).delayfeedback(.3)` },
    stream: { instrument: 'arpeggio', kind: 'chord', octave: 4, gain: 0.3, steps: 2,
      tail: () => '.arp("[0 1 2 1]*4").s("triangle").decay(.1).sustain(0).delay(.375).delayfeedback(.4).room(.4)' },
    ctrl: { instrument: 'charleston', kind: 'perc', sound: 'hh', octave: 0, gain: 0.35, steps: 16, maxPulses: 12,
      tail: (_, d) => `.speed(${d === 'in' ? 1 : 1.3})` },
    tunnel: { instrument: 'rullo di rullante', kind: 'perc', sound: 'sd', octave: 0, gain: 0.3, steps: 16, maxPulses: 8,
      tail: () => '.room(.3)' },
    data: { instrument: 'blip FM', kind: 'melody', octave: 5, gain: 0.25, steps: 16, maxPulses: 6,
      tail: () => '.s("sine").fm(4).fmh(2.01).decay(.08).sustain(0).delay(.375)' },
    p2p: { instrument: 'soffio di rumore', kind: 'perc', sound: 'white', octave: 0, gain: 0.15, steps: 4, maxPulses: 2,
      tail: l => `.attack(.3).release(.5).hpf(${Math.round(20 + l * 60) * 100}).room(.6)` },
    ping: { instrument: 'zap laser', kind: 'melody', octave: 4, gain: 0.3, steps: 4, maxPulses: 2,
      tail: () => '.s("square").penv(24).pdecay(.08).decay(.12).sustain(0).lpf(3000).room(.4)' },
    other: { instrument: 'pluck triangle', kind: 'melody', octave: 4, gain: 0.3, steps: 8,
      tail: () => '.s("triangle").decay(.12).sustain(0).delay(.375)' },
  },
  rhythm: c => {
    const lines = [
      '// basso in levare sul giro i–VI–III–VII: il filtro si apre con il traffico totale (netTotal 0..1)',
      `drone: n("[~ 0 0 0]*4").add("<0 -2 2 -1>").scale("${c.scale(1)}").s("sawtooth").decay(.1).sustain(.4)`
        + `.lpf(netTotal.range(300, 1500)).gain(.6).color("${c.color.drone}")`,
    ];
    if (c.total === 0) return lines;
    lines.push(
      '',
      '// accordi supersaw a sedicesimi: più traffico, filtro più aperto e più volume',
      `chords: n("<[0,2,4] [-2,0,2] [2,4,6] [-1,1,3]>").struct("x*16").scale("${c.scale(3)}")`
        + `.s("supersaw").detune(.3).unison(5).decay(.12).sustain(.2).lpf(netTotal.range(600, 5000)).room(.5)`
        + `.gain(${num(0.4 + c.total * 0.5)}).color("${c.color.drone}")`,
      '',
      '// cassa in quattro (più forte con più byte ricevuti), clap = inviati, open hat in levare',
      `kick: s("bd*4").gain(${num(0.6 + c.in * 0.35)}).color("${c.color.kick}")`,
      `openhat: s("[~ oh]*4").gain(${num(0.2 + c.total * 0.2)}).color("${c.color.hat}")`,
    );
    if (c.out > 0.1) lines.push(`clap: s("~ cp ~ cp").gain(${num(0.3 + c.out * 0.3)}).room(.3).color("${c.color.snare}")`);
    return lines;
  },
  chime: { octave: 5, tail: '.s("supersaw").decay(.15).sustain(0).lpf(4000).room(.6).gain(.25)' },
};

export const STYLES: Style[] = [synth, chip, techno, bass, acid, trance];

export const styleByKey = (key: string): Style => STYLES.find(s => s.key === key) ?? synth;
