import type { CtEntry, CtEventType } from './parse.js';

/** Interfaccia comune tra conntrack reale e mock. */
export interface FlowSource {
  /** Avvia l'ascolto degli eventi di apertura/chiusura. */
  start(onEvent: (type: CtEventType, entry: CtEntry) => void): void;
  /** Legge la tabella completa con i contatori cumulativi. Lancia un errore se fallisce. */
  dump(): Promise<CtEntry[]>;
  /** IP locali forzati (solo mock); null = rilevali dalle interfacce. */
  localIps(): Set<string> | null;
  stop(): void;
}
