const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** JSON indentato con classi per chiavi, stringhe, numeri e booleani. */
export function highlightJson(value: unknown): string {
  const json = escapeHtml(JSON.stringify(value, null, 2) ?? '')
    // array di soli valori semplici (es. i rate [id, in, out]) su una riga
    .replace(/\[\s*([^[\]{}]*?)\s*\]/g, (_, inner: string) => `[${inner.replace(/\s*\n\s*/g, ' ')}]`);
  return json.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    (match, str: string | undefined, colon: string | undefined, lit: string | undefined) => {
      if (str) return colon ? `<span class="j-key">${str}</span>${colon}` : `<span class="j-str">${str}</span>`;
      if (lit) return `<span class="j-lit">${lit}</span>`;
      return `<span class="j-num">${match}</span>`;
    },
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleTimeString('it-IT', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}
