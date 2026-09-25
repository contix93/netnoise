import { createHmac, randomBytes } from 'node:crypto';
import type { AnonMode } from '../config.js';

/**
 * Trasforma l'IP del peer in un identificatore da inviare al browser.
 * 'hash': HMAC con salt, stabile finché il salt resta lo stesso (usa ANON_SALT per
 * mantenerlo tra i riavvii). Il frontend può comunque usarlo per posizionare i nodi.
 */
export function makeAnonymizer(mode: AnonMode, salt: string): (ip: string) => string {
  if (mode === 'none') return ip => ip;
  const key = salt || randomBytes(32).toString('hex');
  const cache = new Map<string, string>();
  return ip => {
    let h = cache.get(ip);
    if (!h) {
      h = createHmac('sha256', key).update(ip).digest('base64url').slice(0, 12);
      if (cache.size > 50_000) cache.clear();
      cache.set(ip, h);
    }
    return h;
  };
}
