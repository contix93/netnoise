import { FlowState, type FlowInfo, type ServerMsg, type Throughput } from '#protocol';

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface LoggedMsg {
  seq: number;
  at: number;    // epoch ms di ricezione
  bytes: number; // dimensione del frame
  msg: ServerMsg;
}

/** Un flusso con le sue velocità correnti (byte/s, rispetto al NAS). */
export interface FlowRow extends FlowInfo {
  rateIn: number;
  rateOut: number;
}

/** Ogni quanto al massimo si ricostruisce la tabella delle connessioni. */
const ROWS_THROTTLE_MS = 250;

export interface Summary {
  node: string;
  flows: number;
  total: Throughput | null;
}

/**
 * Connessione al WebSocket del collector con riconnessione automatica.
 * Tiene gli ultimi `max` messaggi, lo stato ricostruito con FlowState
 * e la tabella delle connessioni con le velocità correnti.
 */
export function useNetnoiseSocket(max = 300) {
  const status = ref<ConnStatus>('idle');
  const error = ref('');
  const paused = ref(false);
  const messages = shallowRef<LoggedMsg[]>([]);
  const flows = shallowRef<FlowRow[]>([]);
  const summary = shallowRef<Summary>({ node: '', flows: 0, total: null });
  const msgPerSec = ref(0);
  const bytesPerSec = ref(0);

  const state = new FlowState();
  let ws: WebSocket | null = null;
  let url = '';
  let manualClose = false;
  let retryMs = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let seq = 0;
  let windowMsgs = 0;
  let windowBytes = 0;
  let rowsTimer: ReturnType<typeof setTimeout> | undefined;

  const meter = setInterval(() => {
    msgPerSec.value = windowMsgs;
    bytesPerSec.value = windowBytes;
    windowMsgs = 0;
    windowBytes = 0;
  }, 1000);

  // i messaggi arrivano ogni 100 ms: la tabella si ricostruisce al massimo ogni ROWS_THROTTLE_MS
  function scheduleRows(): void {
    if (rowsTimer) return;
    rowsTimer = setTimeout(() => {
      rowsTimer = undefined;
      const rows: FlowRow[] = [];
      for (const f of state.flows.values()) {
        const r = state.rates.get(f.id);
        rows.push({ ...f, rateIn: r?.[1] ?? 0, rateOut: r?.[2] ?? 0 });
      }
      flows.value = rows;
    }, ROWS_THROTTLE_MS);
  }

  function connect(target: string): void {
    url = target;
    manualClose = false;
    retryMs = 1000;
    open();
  }

  function disconnect(): void {
    manualClose = true;
    clearTimeout(retryTimer);
    ws?.close(1000);
    ws = null;
    status.value = 'idle';
  }

  function open(): void {
    clearTimeout(retryTimer);
    ws?.close(1000);
    status.value = 'connecting';

    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch (e) {
      status.value = 'closed';
      error.value = `URL non valido: ${(e as Error).message}`;
      return;
    }
    ws = sock;

    sock.onopen = () => {
      status.value = 'open';
      error.value = '';
      retryMs = 1000;
    };

    sock.onmessage = ev => {
      const raw = String(ev.data);
      windowMsgs++;
      windowBytes += raw.length;

      let msg: ServerMsg;
      try {
        msg = JSON.parse(raw);
      } catch {
        error.value = 'ricevuto un messaggio non JSON';
        return;
      }

      state.apply(msg);
      summary.value = { node: state.node, flows: state.flows.size, total: state.total };

      if (paused.value) return;
      scheduleRows();
      const next = messages.value.length >= max ? messages.value.slice(1) : messages.value.slice();
      next.push({ seq: ++seq, at: Date.now(), bytes: raw.length, msg });
      messages.value = next;
    };

    sock.onclose = ev => {
      if (ws !== sock) return; // socket vecchio, già sostituito
      ws = null;
      status.value = 'closed';
      if (ev.code === 4401) {
        error.value = 'token non valido';
        return;
      }
      if (manualClose) return;
      error.value = `connessione chiusa (codice ${ev.code}), riprovo tra ${retryMs / 1000} s`;
      retryTimer = setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    };
  }

  function resync(): void {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resync' }));
  }

  function clear(): void {
    messages.value = [];
  }

  onScopeDispose(() => {
    clearInterval(meter);
    clearTimeout(rowsTimer);
    disconnect();
  });

  return {
    status, error, paused, messages, flows, summary, msgPerSec, bytesPerSec,
    connect, disconnect, resync, clear,
  };
}
