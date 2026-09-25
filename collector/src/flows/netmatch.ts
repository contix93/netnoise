import net from 'node:net';

/** Insieme di reti CIDR, per IPv4 e IPv6 (basato su net.BlockList). */
export class CidrSet {
  private list = new net.BlockList();

  constructor(cidrs: string[]) {
    for (const c of cidrs) this.add(c);
  }

  add(cidr: string): void {
    const [addr, prefixStr] = cidr.split('/');
    const family = net.isIP(addr ?? '');
    if (!addr || !family) throw new Error(`CIDR non valido: "${cidr}"`);
    const prefix = prefixStr === undefined ? (family === 4 ? 32 : 128) : Number(prefixStr);
    this.list.addSubnet(addr, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }

  has(ip: string): boolean {
    const family = net.isIP(ip);
    if (!family) return false;
    return this.list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
  }
}

/** Reti private, link-local, CGNAT (Tailscale), multicast e broadcast: tutto ciò che è "casa". */
export const LAN_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '100.64.0.0/10',
  '224.0.0.0/4',
  '255.255.255.255/32',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
];
