<script setup lang="ts">
import type { FlowRow } from '~/composables/useNetnoiseSocket';

const props = defineProps<{ rows: FlowRow[] }>();

/** Oltre questo numero di righe il browser rallenta: si mostrano le prime. */
const MAX_ROWS = 500;
/** Per quanto una connessione nuova resta evidenziata. */
const FRESH_MS = 3000;

type SortKey = 'total' | 'rateIn' | 'rateOut' | 'age' | 'id' | 'peer' | 'svc' | 'port' | 'dir';

const sortKey = ref<SortKey>('total');
const sortDesc = ref(true);
const query = ref('');
const onlyActive = ref(false);

const columns: { key: SortKey; label: string; num?: boolean; title?: string }[] = [
  { key: 'id', label: 'id', num: true },
  { key: 'peer', label: 'peer' },
  { key: 'dir', label: 'verso', title: "chi ha aperto la connessione: in = dall'esterno verso il NAS, out = dal NAS" },
  { key: 'svc', label: 'servizio' },
  { key: 'port', label: 'porta', num: true },
  { key: 'rateIn', label: 'ricevuti', num: true, title: 'byte/s ricevuti dal NAS' },
  { key: 'rateOut', label: 'inviati', num: true, title: 'byte/s inviati dal NAS' },
  { key: 'total', label: 'totale', num: true },
  { key: 'age', label: 'età', num: true, title: 'da quanto il collector vede la connessione' },
];

function sortValue(r: FlowRow, key: SortKey): number | string {
  switch (key) {
    case 'total': return r.rateIn + r.rateOut;
    case 'age': return -r.t0; // più vecchia = età maggiore
    default: return r[key];
  }
}

function sortBy(key: SortKey): void {
  if (sortKey.value === key) {
    sortDesc.value = !sortDesc.value;
  } else {
    sortKey.value = key;
    // numeri e velocità partono dal più grande, i testi in ordine alfabetico
    sortDesc.value = !['peer', 'svc', 'dir'].includes(key);
  }
}

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.rows.filter(r => {
    if (onlyActive.value && r.rateIn + r.rateOut === 0) return false;
    if (!q) return true;
    return r.peer.toLowerCase().includes(q) || r.svc.includes(q) || String(r.port) === q || r.l4 === q;
  });
});

const sorted = computed(() => {
  const key = sortKey.value;
  const dir = sortDesc.value ? -1 : 1;
  return filtered.value.slice().sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === vb) return b.id - a.id;
    return (va < vb ? -1 : 1) * dir;
  });
});

const visibleRows = computed(() => sorted.value.slice(0, MAX_ROWS));
const activeCount = computed(() => props.rows.filter(r => r.rateIn + r.rateOut > 0).length);
const maxTotal = computed(() => Math.max(1, ...props.rows.map(r => r.rateIn + r.rateOut)));

function rate(n: number): string {
  return n > 0 ? `${formatBytes(n)}/s` : '—';
}

function age(t0: number): string {
  const s = Math.max(0, Math.round((Date.now() - t0) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86_400)} g`;
}
</script>

<template>
  <section class="flows">
    <div class="flows-bar">
      <input v-model="query" type="search" placeholder="filtra: peer, servizio, porta, tcp/udp" spellcheck="false">
      <label><input v-model="onlyActive" type="checkbox"> solo con traffico</label>
      <span class="count">
        {{ activeCount }} attive su {{ rows.length }}
        <template v-if="sorted.length > MAX_ROWS"> · mostrate le prime {{ MAX_ROWS }}</template>
      </span>
    </div>

    <div class="flows-scroll">
      <table>
        <thead>
          <tr>
            <th
              v-for="c in columns"
              :key="c.key"
              :class="{ num: c.num, sorted: sortKey === c.key }"
              :title="c.title"
              :aria-sort="sortKey === c.key ? (sortDesc ? 'descending' : 'ascending') : undefined"
              @click="sortBy(c.key)"
            >
              {{ c.label }}<span v-if="sortKey === c.key" class="arrow">{{ sortDesc ? '↓' : '↑' }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in visibleRows" :key="r.id" :class="{ fresh: Date.now() - r.t0 < FRESH_MS, idle: r.rateIn + r.rateOut === 0 }">
            <td class="num muted">{{ r.id }}</td>
            <td class="peer">{{ r.peer }}<span v-if="r.lan" class="tag">LAN</span></td>
            <td><span class="dir" :data-dir="r.dir">{{ r.dir }}</span></td>
            <td>{{ r.svc }}</td>
            <td class="num">{{ r.port }}<span class="muted">/{{ r.l4 }}</span></td>
            <td class="num">{{ rate(r.rateIn) }}</td>
            <td class="num">{{ rate(r.rateOut) }}</td>
            <td class="num total">
              <span class="bar" :style="{ width: `${((r.rateIn + r.rateOut) / maxTotal) * 100}%` }" />
              <span class="val">{{ rate(r.rateIn + r.rateOut) }}</span>
            </td>
            <td class="num muted">{{ age(r.t0) }}</td>
          </tr>
          <tr v-if="visibleRows.length === 0">
            <td :colspan="columns.length" class="empty">nessuna connessione</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.flows {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.flows-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.flows-bar input[type="search"] { flex: 1 1 220px; min-width: 0; }
.flows-bar label { display: flex; align-items: center; gap: 4px; color: var(--muted); }
.flows-bar .count { margin-left: auto; color: var(--muted); font-family: var(--mono); font-size: 12px; }

.flows-scroll { flex: 1; min-height: 0; overflow: auto; }

table { width: 100%; border-collapse: collapse; font: 12px/1.4 var(--mono); font-variant-numeric: tabular-nums; }

th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 6px 10px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  color: var(--muted);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
th:hover, th.sorted { color: var(--text); }
th .arrow { margin-left: 3px; }

td { padding: 3px 10px; white-space: nowrap; border-bottom: 1px solid var(--row-border); }
tbody tr:hover { background: var(--active); }
tr.idle td { opacity: .55; }
tr.fresh { animation: fresh 3s ease-out; }
@keyframes fresh { from { background: var(--fresh); } to { background: transparent; } }

.num { text-align: right; }
th.num { text-align: right; }
.muted { color: var(--muted); }

.peer .tag {
  margin-left: 6px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--muted);
  font-size: 10px;
}

.dir[data-dir="in"] { color: var(--accent); }
.dir[data-dir="out"] { color: var(--j-num); }

.total { position: relative; min-width: 110px; }
.total .bar {
  position: absolute;
  top: 3px;
  bottom: 3px;
  right: 0;
  background: var(--bar);
  border-radius: 2px;
}
.total .val { position: relative; }

.empty { padding: 12px; color: var(--muted); text-align: center; }
</style>
