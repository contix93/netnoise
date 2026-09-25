import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FlowTable } from '../src/flows/FlowTable.js';
import { CidrSet, LAN_CIDRS } from '../src/flows/netmatch.js';
import type { CtEntry } from '../src/sources/parse.js';

const NAS = '192.168.1.5';
const lan = new CidrSet(LAN_CIDRS);
const excluded = new CidrSet(['127.0.0.0/8']);

function makeTable() {
  return new FlowTable({
    isLocal: ip => ip === NAS || ip === '172.17.0.1',
    isExcluded: ip => excluded.has(ip),
    isLan: ip => lan.has(ip),
    anonymize: ip => ip,
    maxFlows: 10,
    maxNewPerTick: 100,
  });
}

function entry(ctId: string, src: string, dst: string, dport: number, origBytes = 0, replyBytes = 0, replyDst = src): CtEntry {
  return {
    ctId, family: 'ipv4', l4: 'tcp', state: 'ESTABLISHED',
    orig: { src, dst, sport: 50000, dport, packets: 1, bytes: origBytes },
    reply: { src: dst, dst: replyDst, sport: dport, dport: 50000, packets: 1, bytes: replyBytes },
  };
}

test('connessione in ingresso: SMB dal PC al NAS', () => {
  const t = makeTable();
  t.onEvent('NEW', entry('1', '192.168.1.20', NAS, 445), 1000);
  const msg = t.drain(1000);
  assert.equal(msg?.new?.length, 1);
  const f = msg!.new![0]!;
  assert.equal(f.dir, 'in');
  assert.equal(f.peer, '192.168.1.20');
  assert.equal(f.svc, 'smb');
  assert.equal(f.lan, true);
  assert.equal(f.fresh, true);
});

test('connessione in uscita e rate dal punto di vista del NAS', () => {
  const t = makeTable();
  t.onEvent('NEW', entry('1', NAS, '8.8.8.8', 443), 0);
  t.drain(0);
  // in 1 s il NAS ha inviato 1000 byte (orig) e ricevuto 50000 byte (reply)
  t.sync([entry('1', NAS, '8.8.8.8', 443, 1000, 50000)], 900, 1000);
  const msg = t.drain(1000);
  assert.deepEqual(msg?.rates, [[1, 50000, 1000]]);
});

test('container dietro masquerade conta come traffico in uscita del NAS', () => {
  const t = makeTable();
  // orig.src è l'IP del container, reply.dst è l'IP del NAS dopo il NAT
  t.onEvent('NEW', entry('1', '172.17.0.2', '1.1.1.1', 443, 0, 0, NAS), 0);
  const f = t.drain(0)!.new![0]!;
  assert.equal(f.dir, 'out');
  assert.equal(f.peer, '1.1.1.1');
});

test('flussi esclusi, interni o inoltrati vengono ignorati', () => {
  const t = makeTable();
  t.onEvent('NEW', entry('1', NAS, '127.0.0.1', 80), 0);
  t.onEvent('NEW', entry('2', NAS, NAS, 80), 0);
  t.onEvent('NEW', entry('3', '10.0.0.1', '10.0.0.2', 80), 0);
  assert.equal(t.drain(0), null);
  assert.equal(t.size, 0);
});

test('il primo dump non genera impulsi; un DESTROY in ritardo non resuscita il flusso', () => {
  const t = makeTable();
  t.sync([entry('1', '192.168.1.20', NAS, 22)], 0, 10);
  assert.equal(t.drain(10)?.new?.[0]?.fresh, false);

  t.onEvent('DESTROY', entry('1', '192.168.1.20', NAS, 22), 20);
  assert.deepEqual(t.drain(20)?.end, [1]);
  // un dump partito prima del DESTROY contiene ancora il flusso
  t.sync([entry('1', '192.168.1.20', NAS, 22)], 15, 30);
  assert.equal(t.size, 0);
  assert.equal(t.drain(30)?.new, undefined);
});

test('un DESTROY tra dump e invio non lascia rate orfani', () => {
  const t = makeTable();
  t.onEvent('NEW', entry('1', NAS, '8.8.8.8', 443), 0);
  t.drain(0);
  t.sync([entry('1', NAS, '8.8.8.8', 443, 1000, 1000)], 900, 1000);
  t.onEvent('DESTROY', entry('1', NAS, '8.8.8.8', 443), 1010);
  const msg = t.drain(1020);
  assert.deepEqual(msg?.end, [1]);
  assert.deepEqual(msg?.rates, []);
});

test('flussi spariti dal dump vengono chiusi', () => {
  const t = makeTable();
  t.onEvent('NEW', entry('1', NAS, '8.8.8.8', 443), 0);
  t.drain(0);
  t.sync([], 100, 110);
  assert.deepEqual(t.drain(110)?.end, [1]);
});

test('un flusso nato e morto prima di essere annunciato non arriva al client', () => {
  const t = makeTable();
  t.onEvent('NEW', entry('1', NAS, '8.8.8.8', 53), 0);
  t.onEvent('DESTROY', entry('1', NAS, '8.8.8.8', 53), 5);
  assert.equal(t.drain(10), null);
});
