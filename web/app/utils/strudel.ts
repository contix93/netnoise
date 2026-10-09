/**
 * Editor Strudel (StrudelMirror) con uscita audio WebAudio.
 * I moduli si caricano solo quando si apre la scheda Suono.
 */

/** Una nota appena programmata dallo scheduler, per la visualizzazione. */
export interface PlayedNote {
  at: number;      // performance.now() in cui suona
  dur: number;     // ms
  color: string;   // `.color()` del pattern, '' se assente
  midi: number | null;
  gain: number;
  pan: number;
}

export interface StrudelState {
  started: boolean;
  error: string;
}

export interface StrudelHandle {
  getCode(): string;
  /** sostituisce il codice; se sta suonando lo valuta subito, senza il lampo dell'editor */
  update(code: string): Promise<void>;
  play(): Promise<void>;
  stop(): void;
  /** posizione corrente in cicli */
  cycle(): number;
  /** livelli 0..1 letti dai segnali netIn, netOut, netTotal */
  levels: { in: number; out: number; total: number };
  destroy(): void;
}

export interface StrudelOptions {
  root: HTMLElement;
  code: string;
  dark: boolean;
  onNote: (n: PlayedNote) => void;
  onState: (s: StrudelState) => void;
  onWarning: (msg: string) => void;
}

// campioni: pianoforte e batteria (bd, cp, hh, …). Servono internet, come i soundfont: senza, suonano solo i sintetizzatori
const SAMPLES = [
  'https://raw.githubusercontent.com/felixroos/dough-samples/main/piano.json',
  'https://raw.githubusercontent.com/tidalcycles/uzu-drumkit/main/strudel.json',
];

export async function createStrudel(opts: StrudelOptions): Promise<StrudelHandle> {
  const [core, cm, webaudio, { transpiler }] = await Promise.all([
    import('@strudel/core'),
    import('@strudel/codemirror'),
    import('@strudel/webaudio'),
    import('@strudel/transpiler'),
  ]);

  // fuori da https/localhost il browser non espone audioWorklet: supersaw, crush, shape, coarse, distort restano muti
  if (!window.isSecureContext) {
    opts.onWarning('pagina non in https: supersaw ed effetti crush/shape/distort non suonano (servono https o localhost)');
  }
  webaudio.initAudioOnFirstClick();

  const levels = { in: 0, out: 0, total: 0 };
  // segnali continui usabili nel codice: .lpf(netIn.range(200, 4000))
  Object.assign(globalThis, {
    netIn: core.signal(() => levels.in),
    netOut: core.signal(() => levels.out),
    netTotal: core.signal(() => levels.total),
  });

  const prebake = async () => {
    await core.evalScope(core, import('@strudel/mini'), import('@strudel/tonal'), webaudio, cm);
    await Promise.all([
      webaudio.registerSynthSounds(),
      webaudio.registerZZFXSounds(),
      ...SAMPLES.map(url => webaudio.samples(url).catch(() => opts.onWarning(`campioni non disponibili: ${url}`))),
      // strumenti General MIDI (gm_piano, gm_violin, …): ognuno si scarica la prima volta che suona
      import('@strudel/soundfonts').then(m => m.registerSoundfonts())
        .catch(() => opts.onWarning('strumenti General MIDI non disponibili')),
    ]);
  };

  const output = (hap: any, deadline: number, duration: number, cps: number, t: number) => {
    const v = hap.value ?? {};
    let midi: number | null = null;
    if (v.note !== undefined || v.freq !== undefined) {
      try { midi = core.valueToMidi(v); } catch { /* senza altezza */ }
    }
    const ctx = webaudio.getAudioContext();
    opts.onNote({
      at: performance.now() + (t - ctx.currentTime) * 1000,
      dur: duration * 1000,
      color: typeof v.color === 'string' ? v.color : '',
      midi,
      gain: typeof v.gain === 'number' ? v.gain : 1,
      pan: typeof v.pan === 'number' ? v.pan : 0.5,
    });
    return webaudio.webaudioOutput(hap, deadline, duration, cps, t);
  };

  const mirror = new cm.StrudelMirror({
    root: opts.root,
    initialCode: opts.code,
    defaultOutput: output,
    getTime: () => webaudio.getAudioContext().currentTime,
    transpiler,
    prebake,
    // un canvas staccato: le funzioni di disegno di Strudel (pianoroll…) non coprono la pagina
    drawContext: document.createElement('canvas').getContext('2d'),
    onUpdateState: (s: any) => opts.onState({ started: !!s.started, error: s.error ? String(s.error.message ?? s.error) : '' }),
  });
  mirror.updateSettings({
    ...cm.codemirrorSettings.get(),
    theme: opts.dark ? 'strudelTheme' : 'githubLight',
    fontSize: 13,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    isLineWrappingEnabled: false,
    isLineNumbersDisplayed: true,
    isPatternHighlightingEnabled: true,
  });

  return {
    levels,
    getCode: () => mirror.code,
    async update(code) {
      if (code === mirror.code) return;
      mirror.setCode(code);
      if (mirror.repl.scheduler.started) await mirror.repl.evaluate(code);
    },
    async play() {
      // i worklet (supersaw, effetti…) devono essere pronti prima delle prime note
      await webaudio.initAudio();
      await mirror.evaluate();
    },
    stop: () => mirror.stop(),
    cycle: () => (mirror.repl.scheduler.started ? mirror.repl.scheduler.now() : 0),
    destroy() {
      mirror.stop();
      mirror.clear();
      mirror.editor.destroy();
    },
  };
}
