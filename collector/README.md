# netnoise collector

Legge i flussi di rete dalla tabella **conntrack** del NAS e li trasmette in tempo reale
via WebSocket, già aggregati e pronti per la visualizzazione.

```
conntrack -E  (NEW/DESTROY) ──┐
conntrack -L  (ogni 500 ms) ──┼─► FlowTable ──► Hub ──► ws://nas:8080/ws
/proc/net/dev (throughput)  ──┘   in/out, rate    stato + resync
```

## Sviluppo (anche su macOS)

```bash
npm install
npm run dev:mock        # traffico sintetico su ws://127.0.0.1:8080/ws
npm test
```

Registrare traffico vero sul NAS e riprodurlo sul laptop:

```bash
# sul NAS (o via RECORD_FILE nel file env del servizio)
RECORD_FILE=/tmp/rec.ndjson sudo -E node dist/index.js
# sul laptop
npm run replay -- rec.ndjson          # SPEED=4 per accelerare
```

## Installazione sul NAS Debian

```bash
# 1. Node >= 20 (Debian 12 ha la 18: usa NodeSource) e conntrack
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs conntrack

# 2. contatori di byte per flusso
sudo cp deploy/90-netnoise-conntrack.conf /etc/sysctl.d/
sudo sysctl --system

# 3. verifica: devono comparire righe con packets= e bytes=
sudo conntrack -L -o extended | head
```

> **Tabella vuota?** Sui kernel recenti conntrack traccia le connessioni solo se una regola
> firewall lo usa. Con Docker è già attivo. Altrimenti aggiungi a `/etc/nftables.conf`,
> nella chain `input`, una regola come `ct state established,related accept`.

```bash
# 4. codice e build
sudo mkdir -p /opt/netnoise && sudo cp -r . /opt/netnoise/collector
cd /opt/netnoise/collector && sudo npm ci && sudo npm run build && sudo npm prune --omit=dev

# 5. configurazione e servizio
sudo cp deploy/netnoise.env.example /etc/netnoise.env && sudo nano /etc/netnoise.env
sudo cp deploy/netnoise.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now netnoise
journalctl -u netnoise -f
curl "http://192.168.1.5:8080/api/health?token=..."
```

Il servizio non gira come root: usa un utente effimero (`DynamicUser`) con la sola
capability `CAP_NET_ADMIN`, necessaria per leggere conntrack.

## Protocollo

I tipi sono in [src/protocol.ts](src/protocol.ts), un file senza dipendenze da
importare nel frontend insieme alla classe `FlowState`, che ricostruisce lo stato.

- Alla connessione arriva un `hello` con tutti i flussi. **A ogni `hello` il client azzera lo stato.**
- Poi arrivano `tick` con `new` (flussi nuovi; `fresh: true` → impulso), `end` (flussi chiusi),
  `rates` (elenco completo dei top-N in byte/s: chi non c'è ha rate 0) e `total` (throughput dell'interfaccia).
- `dir` è rispetto al NAS: `in` = connessione aperta da un client verso il NAS, `out` = aperta dal NAS.
  I rate `[id, in, out]` sono invece i byte ricevuti e inviati dal NAS, indipendentemente da chi ha aperto.
- Il client può inviare `{"type":"resync"}` per ricevere un nuovo `hello`.

## Configurazione

Tutte le variabili sono in [deploy/netnoise.env.example](deploy/netnoise.env.example).
Le principali sono `BIND`, `TOKEN`, `EXCLUDE_CIDRS` (es. per nascondere le reti Docker),
`ANON`/`ANON_SALT` e `MAX_FLOWS`.
