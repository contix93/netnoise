import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { parseEntry, parseEvent, type CtEntry, type CtEventType } from './parse.js';
import type { FlowSource } from './source.js';

const execFileAsync = promisify(execFile);

interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export class ConntrackSource implements FlowSource {
  private events: ChildProcess | null = null;
  private stopped = false;
  private restartDelay = 1000;

  constructor(
    private bin: string,
    private ipv6: boolean,
    private log: Logger,
  ) {}

  localIps(): null {
    return null;
  }

  start(onEvent: (type: CtEventType, entry: CtEntry) => void): void {
    if (this.stopped) return;

    const args = ['-E', '-e', 'NEW,DESTROY', '-o', 'extended,id', '-b', String(4 * 1024 * 1024)];
    // conntrack scrive su una pipe: stdbuf forza il flush riga per riga
    const useStdbuf = existsSync('/usr/bin/stdbuf');
    const child = useStdbuf
      ? spawn('/usr/bin/stdbuf', ['-oL', this.bin, ...args])
      : spawn(this.bin, args);
    this.events = child;

    const startedAt = Date.now();
    createInterface({ input: child.stdout! }).on('line', line => {
      const ev = parseEvent(line);
      if (ev) onEvent(ev.type, ev.entry);
    });
    createInterface({ input: child.stderr! }).on('line', line => {
      if (!/flow events have been shown/.test(line)) this.log.warn(`conntrack -E: ${line}`);
    });
    child.on('error', err => this.log.error(`impossibile avviare conntrack: ${err.message}`));
    child.on('exit', code => {
      this.events = null;
      if (this.stopped) return;
      // se è rimasto su a lungo era un errore occasionale (es. ENOBUFS): riparti subito
      if (Date.now() - startedAt > 30_000) this.restartDelay = 1000;
      this.log.warn(`conntrack -E terminato (code ${code}), riavvio tra ${this.restartDelay} ms`);
      setTimeout(() => this.start(onEvent), this.restartDelay);
      this.restartDelay = Math.min(this.restartDelay * 2, 30_000);
    });
  }

  async dump(): Promise<CtEntry[]> {
    const families = this.ipv6 ? ['ipv4', 'ipv6'] : ['ipv4'];
    const outputs = await Promise.all(
      families.map(f =>
        execFileAsync(this.bin, ['-L', '-f', f, '-o', 'extended,id'], {
          maxBuffer: 64 * 1024 * 1024,
          timeout: 5000,
        }),
      ),
    );
    const entries: CtEntry[] = [];
    for (const { stdout } of outputs) {
      for (const line of stdout.split('\n')) {
        const e = parseEntry(line);
        if (e) entries.push(e);
      }
    }
    return entries;
  }

  stop(): void {
    this.stopped = true;
    this.events?.kill('SIGTERM');
  }
}

/** Controllo all'avvio: conntrack esiste, abbiamo i permessi, l'accounting è attivo? */
export async function checkConntrack(bin: string, log: Logger): Promise<void> {
  try {
    await execFileAsync(bin, ['-L', '-f', 'ipv4', '-o', 'extended,id'], { timeout: 5000 });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      throw new Error(`"${bin}" non trovato: installa con "sudo apt install conntrack"`);
    }
    if (/not permitted|Permission denied/i.test(e.stderr ?? '')) {
      throw new Error(
        'permessi insufficienti per conntrack: avvia con CAP_NET_ADMIN ' +
          '(vedi deploy/netnoise.service) oppure, solo per provare, con sudo',
      );
    }
    throw new Error(`conntrack -L fallito: ${e.stderr?.trim() || e.message}`);
  }

  try {
    const { stdout } = await execFileAsync('sysctl', ['-n', 'net.netfilter.nf_conntrack_acct']);
    if (stdout.trim() !== '1') {
      log.warn(
        'net.netfilter.nf_conntrack_acct = 0: i flussi non avranno contatori di byte. ' +
          'Attiva con: sudo sysctl -w net.netfilter.nf_conntrack_acct=1',
      );
    }
  } catch {
    log.warn('impossibile leggere net.netfilter.nf_conntrack_acct');
  }
}
