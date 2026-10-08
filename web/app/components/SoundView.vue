<script setup lang="ts">
import type { Throughput } from '#protocol';
import type { FlowRow } from '~/composables/useNetnoiseSocket';
import { compose, level, LANES, type Composition } from '~/utils/compose';
import { STYLES, styleByKey } from '~/utils/styles';
import { createStrudel, type PlayedNote, type StrudelHandle } from '~/utils/strudel';

const props = defineProps<{ flows: FlowRow[]; total: Throughput | null }>();

const STORAGE_KEY = 'netnoise:suono';
const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** Quando arriva a meno di questa frazione dalla fine del ciclo, si prepara il successivo. */
const LOOKAHEAD_CYCLES = 0.15;
/** A riproduzione ferma il codice nell'editor si aggiorna comunque, ogni tanto. */
const PREVIEW_MS = 2000;

function loadSaved(): { style?: string; root?: string; bpm?: number } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}
const saved = loadSaved();

const styleKey = ref(styleByKey(saved.style ?? '').key);
const style = computed(() => styleByKey(styleKey.value));
const root = ref(ROOTS.includes(saved.root ?? '') ? saved.root! : 'C');
const bpm = ref(saved.bpm && saved.bpm >= 40 && saved.bpm <= 200 ? saved.bpm : style.value.bpm);
// ogni stile ha il suo tempo: cambiandolo si riparte da quello (poi si può spostare)
watch(styleKey, () => { bpm.value = style.value.bpm; });
watch([styleKey, root, bpm], () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ style: styleKey.value, root: root.value, bpm: bpm.value }));
  } catch { /* storage non disponibile */ }
});

const auto = ref(true);
const loading = ref(true);
const started = ref(false);
const evalError = ref('');
const warnings = ref<string[]>([]);
const composition = shallowRef<Composition | null>(null);

const editorEl = ref<HTMLElement>();
const roll = ref<{ add: (n: PlayedNote) => void }>();
let strudel: StrudelHandle | null = null;

// --- connessioni nuove -----------------------------------------------------------

// i flussi visti finora: quelli che compaiono dopo (e sono `fresh`) suonano un campanello
let seen: Set<number> | null = null;
let fresh: FlowRow[] = [];

watch(() => props.flows, rows => {
  if (seen) {
    for (const r of rows) if (r.fresh && !seen.has(r.id)) fresh.push(r);
    if (fresh.length > 32) fresh = fresh.slice(-32);
  }
  // alla prima lettura nessun campanello: sono connessioni già aperte
  seen = new Set(rows.map(r => r.id));
}, { immediate: true });

// i segnali live seguono il traffico in continuo, non solo a ogni ciclo
watch(() => props.total, t => {
  if (!strudel || !t) return;
  strudel.levels.in = level(t.in);
  strudel.levels.out = level(t.out);
  strudel.levels.total = level(t.in + t.out);
});

// --- composizione ----------------------------------------------------------------

function recompose(): Composition {
  const c = compose(props.flows, props.total, fresh, { style: style.value, root: root.value, bpm: bpm.value });
  fresh = [];
  composition.value = c;
  if (strudel) Object.assign(strudel.levels, c.levels);
  return c;
}

let lastCycle = -1;
let lastPreview = 0;

const loop = setInterval(() => {
  if (!strudel || !auto.value) return;
  if (started.value) {
    // si rigenera poco prima dell'inizio di ogni ciclo
    const next = Math.floor(strudel.cycle() + LOOKAHEAD_CYCLES);
    if (next === lastCycle) return;
    lastCycle = next;
    void strudel.update(recompose().code);
  } else if (performance.now() - lastPreview > PREVIEW_MS) {
    lastPreview = performance.now();
    void strudel.update(recompose().code);
  }
}, 100);

watch([style, root, bpm], () => {
  if (strudel && auto.value) void strudel.update(recompose().code);
});

function resumeAuto(): void {
  auto.value = true;
  lastCycle = -1;
  if (strudel) void strudel.update(recompose().code);
}

// scrivere nell'editor ferma la composizione automatica, altrimenti il codice verrebbe sovrascritto
function onEditorInput(): void {
  auto.value = false;
}

async function play(): Promise<void> {
  if (!strudel) return;
  if (auto.value) {
    lastCycle = -1;
    await strudel.update(recompose().code);
  }
  await strudel.play();
}

function stop(): void {
  strudel?.stop();
}

onMounted(async () => {
  try {
    strudel = await createStrudel({
      root: editorEl.value!,
      code: recompose().code,
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      onNote: n => roll.value?.add(n),
      onState: s => {
        started.value = s.started;
        evalError.value = s.error;
      },
      onWarning: msg => { warnings.value = [...warnings.value, msg]; },
    });
  } catch (e) {
    evalError.value = `Strudel non si è caricato: ${(e as Error).message}`;
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  clearInterval(loop);
  strudel?.destroy();
  strudel = null;
});

const perSec = (n: number) => `${formatBytes(Math.round(n))}/s`;
</script>

<template>
  <section class="sound">
    <div class="sound-bar">
      <button v-if="!started" type="button" class="play" :disabled="loading" @click="play">▶ Suona</button>
      <button v-else type="button" class="play" @click="stop">■ Ferma</button>
      <label :title="style.description">
        stile
        <select v-model="styleKey" class="style">
          <option v-for="s in STYLES" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </label>
      <label title="tonica della scala">
        tonalità
        <select v-model="root">
          <option v-for="r in ROOTS" :key="r" :value="r">{{ r }}</option>
        </select>
      </label>
      <label>
        bpm
        <input v-model.number="bpm" type="range" min="50" max="170" step="2">
        <span class="num">{{ bpm }}</span>
      </label>
      <span v-if="auto" class="hint">{{ style.description }} · il codice si riscrive a ogni battuta dal traffico, scrivi nell'editor per prenderne il controllo</span>
      <span v-else class="hint manual">
        composizione automatica in pausa: suoni il tuo codice (Ctrl+Invio per valutarlo)
        <button type="button" @click="resumeAuto">Riprendi dal traffico</button>
      </span>
      <span v-if="composition" class="mode">modo <b>{{ composition.mode }}</b></span>
    </div>
    <p v-if="loading" class="note">carico Strudel…</p>
    <p v-if="evalError" class="error">{{ evalError }}</p>
    <p v-for="w in warnings" :key="w" class="note">{{ w }}</p>

    <div class="sound-panes">
      <div class="editor" @beforeinput="onEditorInput">
        <div ref="editorEl" class="cm-host" />
      </div>

      <div class="side">
        <div class="roll-box">
          <NoteRoll ref="roll" :lanes="LANES" />
        </div>

        <div class="layers">
          <table>
            <thead>
              <tr>
                <th>strato</th>
                <th>servizi</th>
                <th class="num">flussi</th>
                <th class="num">peso</th>
                <th>strumento</th>
                <th>note</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in composition?.layers ?? []" :key="l.id">
                <td><span class="dot" :style="{ background: l.color }" />{{ l.label }} <span class="dir" :data-dir="l.dir">{{ l.dir }}</span></td>
                <td class="svc">{{ l.services.join(', ') }}</td>
                <td class="num">{{ l.flows }}</td>
                <td class="num weight">
                  <span class="bar" :style="{ width: `${l.level * 100}%`, background: l.color }" />
                  <span class="val">{{ perSec(l.rate) }}</span>
                </td>
                <td>{{ l.instrument }}</td>
                <td class="pattern" :title="l.pattern">{{ l.pattern }}</td>
              </tr>
              <tr v-if="!composition?.layers.length">
                <td colspan="6" class="empty">nessun flusso con traffico: suonano solo bordone e ritmo</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.sound { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }

.sound-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.sound-bar label { display: flex; align-items: center; gap: 6px; color: var(--muted); }
.sound-bar input[type="range"] { padding: 0; width: 110px; }
.sound-bar select.style { font-weight: 600; }
.sound-bar .num { font-family: var(--mono); color: var(--text); min-width: 3ch; }
.sound-bar .play { min-width: 92px; background: var(--accent); border-color: var(--accent); color: #fff; }
.sound-bar .hint { color: var(--muted); font-size: 12px; }
.sound-bar .hint.manual { color: var(--warn); display: flex; align-items: center; gap: 8px; }
.sound-bar .mode { margin-left: auto; color: var(--muted); font-family: var(--mono); }
.sound-bar .mode b { color: var(--text); font-weight: 600; }

.note { margin: 0; color: var(--muted); font-size: 12px; }

.sound-panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}

.editor {
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--background, var(--panel));
}
.cm-host { min-height: 100%; }
.cm-host :deep(.cm-editor) { min-height: 100%; }
.cm-host :deep(.cm-editor.cm-focused) { outline: none; }

.side { min-height: 0; display: grid; grid-template-rows: minmax(220px, 3fr) minmax(0, 2fr); gap: 10px; }

.roll-box, .layers {
  min-height: 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.roll-box { padding: 6px 8px; }
.layers { overflow: auto; }

table { width: 100%; border-collapse: collapse; font: 12px/1.4 var(--mono); font-variant-numeric: tabular-nums; }
th {
  position: sticky;
  top: 0;
  padding: 6px 10px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}
td { padding: 3px 10px; white-space: nowrap; border-bottom: 1px solid var(--row-border); }
.num { text-align: right; }
.dot { display: inline-block; width: 8px; height: 8px; margin-right: 6px; border-radius: 50%; }
.dir { color: var(--muted); }
.dir[data-dir="in"] { color: var(--accent); }
.dir[data-dir="out"] { color: var(--j-num); }
.svc { max-width: 160px; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
.weight { position: relative; min-width: 100px; }
.weight .bar { position: absolute; top: 3px; bottom: 3px; right: 0; opacity: .18; border-radius: 2px; }
.weight .val { position: relative; }
.pattern { max-width: 220px; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
.empty { padding: 12px; color: var(--muted); text-align: center; }

@media (max-width: 900px) {
  .sound-panes { grid-template-columns: 1fr; grid-template-rows: minmax(260px, 1fr) auto; }
  .side { grid-template-rows: 260px auto; }
  .sound-bar .mode { margin-left: 0; }
}
</style>
