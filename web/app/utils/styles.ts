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

// --- rock: chitarre distorte, basso, batteria in levare --------------------------

const ROCK_KICK = ['bd ~ ~ ~ ~ ~ ~ ~', 'bd ~ ~ ~ bd ~ ~ ~', 'bd ~ ~ bd ~ ~ bd ~', 'bd ~ bd ~ bd ~ bd bd'];
const ROCK_SNARE = ['~ ~ sd ~', '~ sd ~ sd', '~ sd ~ [sd sd]', '~ sd ~ [sd sd sd sd]'];

const rock: Style = {
  key: 'rock',
  label: 'Rock',
  description: 'power chord di chitarra distorta, basso elettrico, organo e batteria con rullante in levare',
  bpm: 124,
  modes: ['minor:pentatonic', 'dorian', 'mixolydian'],
  voices: {
    web: { instrument: 'chitarra distorta (power chord)', kind: 'melody', octave: 2, gain: 0.8, steps: 8,
      tail: () => '.superimpose(x => x.transpose(7)).s("gm_distortion_guitar").clip(.9)' },
    file: { instrument: 'basso elettrico', kind: 'melody', octave: 1, gain: 0.9, steps: 8,
      tail: () => '.s("gm_electric_bass_pick").clip(.9)' },
    stream: { instrument: 'organo rock', kind: 'chord', octave: 3, gain: 0.5, steps: 2,
      tail: () => '.s("gm_rock_organ").room(.3)' },
    ctrl: { instrument: 'charleston', kind: 'perc', sound: 'hh', octave: 0, gain: 0.45, steps: 8,
      tail: (_, d) => (d === 'in' ? '' : '.speed(1.2)') },
    tunnel: { instrument: 'chitarra solista', kind: 'melody', octave: 4, gain: 0.6, steps: 8, maxPulses: 6,
      tail: () => '.s("gm_overdriven_guitar").delay(.2)' },
    data: { instrument: 'chitarra stoppata', kind: 'melody', octave: 3, gain: 0.6, steps: 16, maxPulses: 10,
      tail: () => '.s("gm_electric_guitar_muted")' },
    p2p: { instrument: 'piatto crash', kind: 'perc', sound: 'cr', octave: 0, gain: 0.35, steps: 8, maxPulses: 2,
      tail: () => '' },
    ping: { instrument: 'ride', kind: 'perc', sound: 'rd', octave: 0, gain: 0.3, steps: 8, maxPulses: 4,
      tail: () => '' },
    other: { instrument: 'chitarra pulita', kind: 'melody', octave: 3, gain: 0.5, steps: 8,
      tail: () => '.s("gm_electric_guitar_clean").room(.2)' },
  },
  rhythm: c => {
    const lines = [
      '// giro di accordi i–i–VI–VII: il volume segue il traffico totale (netTotal 0..1)',
      `drone: n("<0 0 -3 -2>").scale("${c.scale(2)}").superimpose(x => x.transpose(7))`
        + `.s("gm_overdriven_guitar").gain(netTotal.range(.1, .5)).color("${c.color.drone}")`,
    ];
    if (c.total === 0) return lines;
    lines.push('', '// batteria: cassa più fitta con più byte ricevuti, rullante più fitto con più byte inviati');
    lines.push(`kick: s("${pick(ROCK_KICK, c.in)}").gain(.85).color("${c.color.kick}")`);
    lines.push(`snare: s("${pick(ROCK_SNARE, c.out)}").gain(.6).color("${c.color.snare}")`);
    if (c.total > 0.5) lines.push(`crash: s("<cr ~ ~ ~>").gain(.35).color("${c.color.hat}")`);
    return lines;
  },
  chime: { octave: 4, tail: '.s("gm_electric_guitar_clean").delay(.3).gain(.5)' },
};

// --- melodico: ballata con pianoforte e archi ----------------------------------

const melodic: Style = {
  key: 'melodico',
  label: 'Melodico',
  description: 'ballata lenta: pianoforte, archi, vibrafono e carillon su un giro I–vi–IV–V',
  bpm: 76,
  modes: ['minor', 'major', 'lydian'],
  voices: {
    web: { instrument: 'pianoforte', kind: 'melody', octave: 4, gain: 0.75, steps: 8, maxPulses: 6,
      tail: () => '.s("piano").room(.5)' },
    file: { instrument: 'contrabbasso', kind: 'melody', octave: 2, gain: 0.8, steps: 4,
      tail: () => '.s("gm_acoustic_bass")' },
    stream: { instrument: 'archi', kind: 'chord', octave: 3, gain: 0.5, steps: 1,
      tail: () => '.s("gm_string_ensemble_1").attack(.5).release(2).room(.5)' },
    // il campione "sh" di uzu-drumkit è un wav float32 che Chrome non sempre decodifica: shaker sintetico
    ctrl: { instrument: 'shaker', kind: 'perc', sound: 'white', octave: 0, gain: 0.2, steps: 16, maxPulses: 8,
      tail: () => '.decay(.04).sustain(0).hpf(5000)' },
    tunnel: { instrument: 'vibrafono', kind: 'melody', octave: 2, gain: 0.55, steps: 8, maxPulses: 5,
      tail: () => '.s("gm_vibraphone").room(.4)' },
    data: { instrument: 'carillon', kind: 'melody', octave: 4, gain: 0.5, steps: 8, maxPulses: 5,
      tail: () => '.s("gm_music_box").room(.5)' },
    p2p: { instrument: 'kalimba', kind: 'melody', octave: 4, gain: 0.5, steps: 8, maxPulses: 6,
      tail: () => '.s("gm_kalimba")' },
    ping: { instrument: 'glockenspiel', kind: 'melody', octave: 4, gain: 0.4, steps: 4, maxPulses: 2,
      tail: () => '.s("gm_glockenspiel").delay(.4)' },
    other: { instrument: 'piano elettrico', kind: 'melody', octave: 3, gain: 0.55, steps: 8, maxPulses: 5,
      tail: () => '.s("gm_epiano1").room(.3)' },
  },
  rhythm: c => {
    const lines = [
      '// giro I–vi–IV–V di pad: il volume segue il traffico totale (netTotal 0..1)',
      `drone: n("<[0,2,4] [5,7,9] [3,5,7] [4,6,8]>").scale("${c.scale(3)}").s("gm_pad_warm")`
        + `.attack(.6).release(2).gain(netTotal.range(.15, .5)).color("${c.color.drone}")`,
    ];
    if (c.in > 0.1) lines.push('', '// cassa morbida = byte ricevuti, rimshot = byte inviati',
      `kick: s("${c.in > 0.6 ? 'bd ~ ~ bd ~ ~ bd ~' : 'bd ~ ~ ~ ~ ~ bd ~'}").gain(${num(0.3 + c.in * 0.3)}).lpf(800).color("${c.color.kick}")`);
    if (c.out > 0.1) lines.push(`rim: s("~ rim").gain(${num(0.2 + c.out * 0.25)}).room(.4).color("${c.color.snare}")`);
    return lines;
  },
  chime: { octave: 5, tail: '.s("gm_celesta").room(.5).gain(.5)' },
};

// --- lirico: orchestra e coro ---------------------------------------------------

const lyric: Style = {
  key: 'lirico',
  label: 'Lirico',
  description: "coro e orchestra: voci, archi, corni, arpa e timpani, in un'aria lenta",
  bpm: 66,
  modes: ['harmonic:minor', 'minor', 'major'],
  voices: {
    web: { instrument: 'coro (soprani)', kind: 'melody', octave: 4, gain: 0.8, steps: 4,
      tail: () => '.s("gm_choir_aahs").attack(.15).release(.8).room(.7)' },
    file: { instrument: 'violoncelli', kind: 'melody', octave: 2, gain: 0.75, steps: 4,
      tail: () => '.s("gm_cello").attack(.1).release(.6).room(.5)' },
    stream: { instrument: 'archi', kind: 'chord', octave: 3, gain: 0.55, steps: 1,
      tail: () => '.s("gm_string_ensemble_1").attack(.8).release(2).room(.7)' },
    ctrl: { instrument: 'archi pizzicati', kind: 'melody', octave: 4, gain: 0.5, steps: 8, maxPulses: 6,
      tail: () => '.s("gm_pizzicato_strings").room(.4)' },
    tunnel: { instrument: 'corni', kind: 'melody', octave: 3, gain: 0.6, steps: 2,
      tail: () => '.s("gm_french_horn").attack(.1).room(.6)' },
    data: { instrument: 'flauto', kind: 'melody', octave: 5, gain: 0.55, steps: 8, maxPulses: 5,
      tail: () => '.s("gm_flute").room(.5)' },
    p2p: { instrument: 'arpa', kind: 'chord', octave: 4, gain: 0.5, steps: 2,
      tail: () => '.arp("0 1 2 1 0 1 2 1").s("gm_orchestral_harp").room(.5)' },
    ping: { instrument: 'campane tubolari', kind: 'melody', octave: 3, gain: 0.4, steps: 2, maxPulses: 1,
      tail: () => '.s("gm_tubular_bells").room(.8)' },
    other: { instrument: 'oboe', kind: 'melody', octave: 4, gain: 0.5, steps: 4,
      tail: () => '.s("gm_oboe").room(.5)' },
  },
  rhythm: c => {
    const lines = [
      '// coro di sottofondo, giro i–iv–V–i: il volume segue il traffico totale (netTotal 0..1)',
      `drone: n("<[0,2,4] [3,5,7] [4,6,8] [0,2,4]>").scale("${c.scale(3)}").s("gm_voice_oohs")`
        + `.attack(.8).release(2).room(.8).gain(netTotal.range(.15, .5)).color("${c.color.drone}")`,
    ];
    const timp = Math.round(c.in * 4);
    if (timp || c.out > 0.4) lines.push('', '// timpani = byte ricevuti, piatti = byte inviati');
    if (timp) lines.push(`timpani: n("0").euclid(${timp},8).scale("${c.scale(2)}").s("gm_timpani").gain(.7).room(.5).color("${c.color.kick}")`);
    if (c.out > 0.4) lines.push(`piatti: s("<~ ~ ~ cr>").gain(${num(0.2 + c.out * 0.2)}).room(.8).color("${c.color.snare}")`);
    return lines;
  },
  chime: { octave: 5, tail: '.s("gm_celesta").room(.7).gain(.5)' },
};

// --- ambient: niente batteria, solo pad, eco e riverbero -----------------------------

const ambient: Style = {
  key: 'ambient',
  label: 'Ambient',
  description: 'niente batteria: pad lunghi, campane di vetro, eco e tanto riverbero',
  bpm: 60,
  modes: ['dorian', 'major', 'lydian'],
  voices: {
    web: { instrument: 'pad halo', kind: 'melody', octave: 4, gain: 0.5, steps: 2,
      tail: () => '.s("gm_pad_halo").attack(.8).release(3).room(1)' },
    file: { instrument: 'sub sine', kind: 'melody', octave: 2, gain: 0.6, steps: 2,
      tail: () => '.s("sine").attack(.5).release(2)' },
    stream: { instrument: 'pad caldo', kind: 'chord', octave: 3, gain: 0.45, steps: 1,
      tail: () => '.s("gm_pad_warm").attack(1.5).release(3).room(1)' },
    ctrl: { instrument: 'cristalli', kind: 'melody', octave: 3, gain: 0.3, steps: 4,
      tail: () => '.s("gm_fx_crystal").room(1)' },
    tunnel: { instrument: 'pad sweep', kind: 'melody', octave: 3, gain: 0.4, steps: 1,
      tail: () => '.s("gm_pad_sweep").attack(1).release(3).room(1)' },
    data: { instrument: 'campanelle', kind: 'melody', octave: 5, gain: 0.35, steps: 4,
      tail: () => '.s("sine").decay(.6).sustain(0).delay(.6).delayfeedback(.6).room(1)' },
    p2p: { instrument: 'pioggia', kind: 'perc', sound: 'pink', octave: 0, gain: 0.15, steps: 4, maxPulses: 2,
      tail: () => '.attack(1).release(2).lpf(1200).room(1)' },
    ping: { instrument: 'eco lontana', kind: 'melody', octave: 6, gain: 0.25, steps: 2, maxPulses: 1,
      tail: () => '.s("sine").decay(1).sustain(0).delay(.7).delayfeedback(.7).room(1)' },
    other: { instrument: 'triangle morbido', kind: 'melody', octave: 4, gain: 0.35, steps: 2,
      tail: () => '.s("triangle").attack(.4).release(2).room(1)' },
  },
  rhythm: c => [
    '// bordone che respira con il traffico (netIn apre il filtro, netTotal alza il volume)',
    `drone: n("<[0,4] [-1,3]>/2").scale("${c.scale(2)}").s("sawtooth").attack(2).release(4)`
      + `.lpf(netIn.range(200, 1400)).gain(netTotal.range(.08, .3)).room(1).color("${c.color.drone}")`,
  ],
  chime: { octave: 6, tail: '.s("sine").decay(.8).sustain(0).delay(.6).delayfeedback(.6).room(1).gain(.25)' },
};

export const STYLES: Style[] = [synth, chip, techno, rock, melodic, lyric, ambient];

export const styleByKey = (key: string): Style => STYLES.find(s => s.key === key) ?? synth;
