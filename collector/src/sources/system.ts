import os from 'node:os';
import { readFile } from 'node:fs/promises';

/** Tutti gli IP assegnati alle interfacce del NAS (incluse docker0, wg0, ecc.). */
export function detectLocalIps(): Set<string> {
  const ips = new Set<string>();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) ips.add(a.address.replace(/%.*$/, '')); // via lo scope id IPv6
  }
  return ips;
}

/** Interfacce della default route IPv4, lette da /proc/net/route. */
export async function defaultRouteIfaces(): Promise<string[]> {
  try {
    const text = await readFile('/proc/net/route', 'utf8');
    const ifaces = new Set<string>();
    for (const line of text.split('\n').slice(1)) {
      const [iface, dest] = line.trim().split(/\s+/);
      if (iface && dest === '00000000') ifaces.add(iface);
    }
    return [...ifaces];
  } catch {
    return [];
  }
}

export interface IfaceCounters {
  rx: number;
  tx: number;
}

/** Somma dei byte rx/tx delle interfacce indicate, da /proc/net/dev. null se non disponibile. */
export async function readIfaceCounters(ifaces: string[]): Promise<IfaceCounters | null> {
  if (ifaces.length === 0) return null;
  let text: string;
  try {
    text = await readFile('/proc/net/dev', 'utf8');
  } catch {
    return null;
  }
  const wanted = new Set(ifaces);
  let rx = 0;
  let tx = 0;
  let found = false;
  for (const line of text.split('\n').slice(2)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    if (!wanted.has(name)) continue;
    const cols = line.slice(colon + 1).trim().split(/\s+/).map(Number);
    rx += cols[0] ?? 0; // byte ricevuti
    tx += cols[8] ?? 0; // byte trasmessi
    found = true;
  }
  return found ? { rx, tx } : null;
}
