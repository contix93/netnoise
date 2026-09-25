<script setup lang="ts">
import type { ServerMsg } from '#protocol';

const STORAGE_KEY = 'netnoise:conn';

const config = useRuntimeConfig();
const socket = useNetnoiseSocket();
const { status, error, paused, messages, flows, summary, msgPerSec, bytesPerSec } = socket;

type View = 'messages' | 'flows';
// la scheda si può aprire dall'indirizzo: http://nas:3100/#connessioni
const view = ref<View>(location.hash === '#connessioni' ? 'flows' : 'messages');
watch(view, v => history.replaceState(null, '', v === 'flows' ? '#connessioni' : location.pathname + location.search));

// --- indirizzo e token -------------------------------------------------------

function defaultUrl(): string {
  if (config.public.wsUrl) return config.public.wsUrl as string;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** `base` è l'indirizzo predefinito al momento del salvataggio. */
function loadSaved(): { url?: string; token?: string; base?: string } {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const saved = loadSaved();
// l'indirizzo salvato vale solo finché non cambia quello predefinito (NUXT_PUBLIC_WS_URL o host della pagina)
const wsUrl = ref((saved.base === defaultUrl() && saved.url) || defaultUrl());
// il token può arrivare dall'indirizzo della pagina: http://nas:3100/?token=...
const token = ref(new URLSearchParams(location.search).get('token') ?? saved.token ?? '');

function fullUrl(): string {
  const u = new URL(wsUrl.value);
  if (token.value) u.searchParams.set('token', token.value);
  return u.toString();
}

function connect(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ url: wsUrl.value, token: token.value, base: defaultUrl() }));
  } catch { /* storage non disponibile */ }
  try {
    socket.connect(fullUrl());
  } catch (e) {
    error.value = `URL non valido: ${(e as Error).message}`;
  }
}

onMounted(() => {
  if (wsUrl.value) connect();
});

// --- elenco e selezione ------------------------------------------------------

type Filter = 'all' | 'hello' | 'tick';
const filter = ref<Filter>('all');
const hideEmpty = ref(true);
const follow = ref(true);
const selectedSeq = ref<number | null>(null);

function isEmptyTick(m: ServerMsg): boolean {
  return m.type === 'tick' && !m.new?.length && !m.end?.length && !m.rates && !m.total && !m.other;
}

const visible = computed(() =>
  messages.value.filter(l =>
    (filter.value === 'all' || l.msg.type === filter.value) && !(hideEmpty.value && isEmptyTick(l.msg)),
  ),
);

// il più recente in alto
const rows = computed(() => visible.value.slice().reverse());

const selected = computed(() => {
  if (follow.value || selectedSeq.value === null) return visible.value.at(-1) ?? null;
  return messages.value.find(l => l.seq === selectedSeq.value) ?? null;
});

const selectedHtml = computed(() => (selected.value ? highlightJson(selected.value.msg) : ''));

function select(seq: number): void {
  selectedSeq.value = seq;
  follow.value = false;
}

function describe(m: ServerMsg): string {
  if (m.type === 'hello') return `${m.flows.length} flussi · ${m.rates.length} rate`;
  const parts: string[] = [];
  if (m.new?.length) parts.push(`+${m.new.length} new`);
  if (m.end?.length) parts.push(`−${m.end.length} end`);
  if (m.rates) parts.push(`${m.rates.length} rate`);
  if (m.total) parts.push('total');
  return parts.join(' · ') || 'vuoto';
}

const statusLabel: Record<string, string> = {
  idle: 'disconnesso',
  connecting: 'connessione…',
  open: 'connesso',
  closed: 'chiuso',
};

const perSec = (n: number) => `${formatBytes(n)}/s`;
</script>

<template>
  <div class="app">
    <header class="top">
      <h1>netnoise</h1>
      <span class="status" :data-status="status">{{ statusLabel[status] }}</span>
      <dl class="stats">
        <div><dt>nodo</dt><dd>{{ summary.node || '—' }}</dd></div>
        <div><dt>flussi</dt><dd>{{ summary.flows }}</dd></div>
        <div><dt>in</dt><dd>{{ summary.total ? perSec(summary.total.in) : '—' }}</dd></div>
        <div><dt>out</dt><dd>{{ summary.total ? perSec(summary.total.out) : '—' }}</dd></div>
        <div><dt>ws</dt><dd>{{ msgPerSec }} msg/s · {{ perSec(bytesPerSec) }}</dd></div>
      </dl>
    </header>

    <form class="conn" @submit.prevent="connect">
      <input v-model="wsUrl" class="url" placeholder="ws://192.168.1.10:8081/ws" spellcheck="false">
      <input v-model="token" type="password" placeholder="token" autocomplete="off">
      <button type="submit">{{ status === 'open' ? 'Riconnetti' : 'Connetti' }}</button>
      <button v-if="status !== 'idle'" type="button" @click="socket.disconnect()">Disconnetti</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="toolbar">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" :aria-selected="view === 'messages'" @click="view = 'messages'">Messaggi</button>
        <button type="button" role="tab" :aria-selected="view === 'flows'" @click="view = 'flows'">Connessioni ({{ flows.length }})</button>
      </div>
      <button type="button" @click="paused = !paused">{{ paused ? 'Riprendi' : 'Pausa' }}</button>
      <button type="button" :disabled="status !== 'open'" @click="socket.resync()">Resync</button>
      <template v-if="view === 'messages'">
        <button type="button" @click="socket.clear()">Svuota</button>
        <select v-model="filter">
          <option value="all">tutti</option>
          <option value="hello">hello</option>
          <option value="tick">tick</option>
        </select>
        <label><input v-model="hideEmpty" type="checkbox"> nascondi tick vuoti</label>
        <label><input v-model="follow" type="checkbox"> segui l'ultimo</label>
        <span class="count">{{ visible.length }} / {{ messages.length }}</span>
      </template>
    </div>

    <FlowTable v-if="view === 'flows'" :rows="flows" />

    <main v-else class="panes">
      <ol class="list">
        <li
          v-for="l in rows"
          :key="l.seq"
          :class="{ active: selected?.seq === l.seq }"
          @click="select(l.seq)"
        >
          <span class="time">{{ formatTime(l.at) }}</span>
          <span class="type" :data-type="l.msg.type">{{ l.msg.type }}</span>
          <span class="desc">{{ describe(l.msg) }}</span>
          <span class="size">{{ formatBytes(l.bytes) }}</span>
        </li>
        <li v-if="rows.length === 0" class="empty">nessun messaggio</li>
      </ol>

      <section class="detail">
        <header v-if="selected">
          #{{ selected.seq }} · {{ selected.msg.type }} · {{ formatTime(selected.at) }} · {{ formatBytes(selected.bytes) }}
        </header>
        <!-- eslint-disable-next-line vue/no-v-html — contenuto già escapato in highlightJson -->
        <pre v-if="selected" v-html="selectedHtml" />
        <p v-else class="empty">seleziona un messaggio</p>
      </section>
    </main>
  </div>
</template>
