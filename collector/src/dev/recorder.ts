import { createWriteStream } from 'node:fs';
import type { Hub } from '../transport/hub.js';

/**
 * Registra i messaggi su file NDJSON (una riga per messaggio).
 * La prima riga è sempre un `hello` con lo stato al momento dell'avvio della registrazione,
 * così il file è riproducibile da solo con `npm run replay`.
 */
export function startRecording(hub: Hub, file: string): () => void {
  const out = createWriteStream(file, { flags: 'w' });
  let open = true;
  out.write(JSON.stringify(hub.state.toHello()) + '\n');
  hub.onPublish(msg => {
    if (open) out.write(JSON.stringify(msg) + '\n');
  });
  return () => {
    open = false;
    out.end();
  };
}
