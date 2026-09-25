import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry, parseEvent } from '../src/sources/parse.js';

test('dump TCP con contatori', () => {
  const e = parseEntry(
    'ipv4     2 tcp      6 431999 ESTABLISHED src=192.168.1.20 dst=192.168.1.5 sport=51234 dport=445 ' +
      'packets=812 bytes=90211 src=192.168.1.5 dst=192.168.1.20 sport=445 dport=51234 packets=40210 ' +
      'bytes=58112044 [ASSURED] mark=0 use=1 id=3021547',
  );
  assert.ok(e);
  assert.equal(e.ctId, '3021547');
  assert.equal(e.family, 'ipv4');
  assert.equal(e.l4, 'tcp');
  assert.equal(e.state, 'ESTABLISHED');
  assert.deepEqual(e.orig, { src: '192.168.1.20', dst: '192.168.1.5', sport: 51234, dport: 445, packets: 812, bytes: 90211 });
  assert.equal(e.reply.bytes, 58112044);
});

test('UDP senza stato e con [UNREPLIED]', () => {
  const e = parseEntry(
    'ipv4     2 udp      17 29 src=192.168.1.5 dst=1.1.1.1 sport=40000 dport=53 packets=1 bytes=72 ' +
      '[UNREPLIED] src=1.1.1.1 dst=192.168.1.5 sport=53 dport=40000 packets=0 bytes=0 mark=0 use=1 id=77',
  );
  assert.ok(e);
  assert.equal(e.l4, 'udp');
  assert.equal(e.state, null);
  assert.equal(e.orig.dport, 53);
  assert.equal(e.ctId, '77');
});

test('ICMP: l\'id della connessione è l\'ultimo id=', () => {
  const e = parseEntry(
    'ipv4     2 icmp     1 29 src=192.168.1.1 dst=192.168.1.5 type=8 code=0 id=4242 packets=3 bytes=252 ' +
      'src=192.168.1.5 dst=192.168.1.1 type=0 code=0 id=4242 packets=3 bytes=252 mark=0 use=1 id=999',
  );
  assert.ok(e);
  assert.equal(e.ctId, '999');
  assert.equal(e.orig.bytes, 252);
});

test('IPv6', () => {
  const e = parseEntry(
    'ipv6     10 tcp      6 300 ESTABLISHED src=2001:db8::5 dst=2606:4700::1111 sport=55000 dport=443 ' +
      'packets=10 bytes=1500 src=2606:4700::1111 dst=2001:db8::5 sport=443 dport=55000 packets=12 bytes=9000 ' +
      '[ASSURED] mark=0 use=1 id=5',
  );
  assert.ok(e);
  assert.equal(e.family, 'ipv6');
  assert.equal(e.orig.dst, '2606:4700::1111');
});

test('eventi NEW e DESTROY', () => {
  const n = parseEvent(
    '    [NEW] ipv4     2 tcp      6 120 SYN_SENT src=192.168.1.5 dst=8.8.8.8 sport=1 dport=443 ' +
      '[UNREPLIED] src=8.8.8.8 dst=192.168.1.5 sport=443 dport=1 id=12',
  );
  assert.equal(n?.type, 'NEW');
  assert.equal(n?.entry.ctId, '12');
  assert.equal(n?.entry.state, 'SYN_SENT');

  const d = parseEvent(
    ' [DESTROY] ipv4     2 udp      17 src=192.168.1.5 dst=1.1.1.1 sport=40000 dport=53 packets=1 bytes=72 ' +
      'src=1.1.1.1 dst=192.168.1.5 sport=53 dport=40000 packets=1 bytes=120 id=77',
  );
  assert.equal(d?.type, 'DESTROY');
  assert.equal(d?.entry.reply.bytes, 120);
});

test('righe non valide', () => {
  assert.equal(parseEntry(''), null);
  assert.equal(parseEntry('conntrack v1.4.7 (conntrack-tools): 12 flow entries have been shown.'), null);
  assert.equal(parseEvent('[UPDATE] ipv4 2 tcp 6 src=a dst=b id=1'), null);
});
