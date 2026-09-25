/**
 * Porta del servizio → nome. Pensato per un NAS domestico: estendi liberamente.
 * La porta è sempre quella lato server della connessione (orig.dport).
 */
const TCP: Record<number, string> = {
  20: 'ftp', 21: 'ftp', 22: 'ssh', 25: 'smtp', 53: 'dns', 80: 'http', 110: 'pop3',
  111: 'rpc', 139: 'smb', 143: 'imap', 443: 'https', 445: 'smb', 465: 'smtp', 548: 'afp',
  587: 'smtp', 631: 'ipp', 853: 'dns', 873: 'rsync', 993: 'imap', 995: 'pop3',
  1883: 'mqtt', 2049: 'nfs', 3000: 'web', 3306: 'mysql', 3389: 'rdp', 5000: 'web',
  5001: 'web', 5432: 'postgres', 5900: 'vnc', 6379: 'redis', 8080: 'http', 8096: 'jellyfin',
  8123: 'homeassistant', 8443: 'https', 8920: 'jellyfin', 9000: 'web', 9091: 'torrent',
  32400: 'plex', 51413: 'torrent',
};

const UDP: Record<number, string> = {
  53: 'dns', 67: 'dhcp', 68: 'dhcp', 111: 'rpc', 123: 'ntp', 137: 'netbios', 138: 'netbios',
  443: 'quic', 500: 'ipsec', 1194: 'openvpn', 1900: 'ssdp', 2049: 'nfs', 3478: 'stun',
  4500: 'ipsec', 5353: 'mdns', 5355: 'llmnr', 41641: 'tailscale', 51413: 'torrent',
  51820: 'wireguard',
};

export function classify(l4: string, port: number): string {
  if (l4 === 'icmp' || l4 === 'icmpv6') return 'icmp';
  const table = l4 === 'tcp' ? TCP : l4 === 'udp' ? UDP : undefined;
  return table?.[port] ?? l4;
}
