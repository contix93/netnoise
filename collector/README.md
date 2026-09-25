# netnoise collector

Legge i flussi di rete dalla tabella **conntrack** del NAS e li trasmette in tempo reale
via WebSocket, già aggregati e pronti per la visualizzazione.

```
conntrack -E  (NEW/DESTROY) ──┐
conntrack -L  (ogni 500 ms) ──┼─► FlowTable ──► Hub ──► ws://nas:PORT/ws
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
# sul NAS: aggiungi RECORD_FILE al file env e riavvia
echo 'RECORD_FILE=/opt/netnoise/rec.ndjson' >> /opt/netnoise/netnoise.env
pm2 restart netnoise
# ...dopo qualche minuto togli la riga e riavvia di nuovo, poi copia il file sul laptop
npm run replay -- rec.ndjson          # SPEED=4 per accelerare
```

## Installazione sul NAS (Armbian/Debian, Node gestito con Volta, pm2)

Tutti i comandi vanno eseguiti **sul NAS** con il proprio utente; `sudo` solo dove indicato.
Negli esempi il NAS è `192.168.1.10`, il collector ascolta sulla porta `3100` e il codice
sta in `/opt/netnoise` (va bene qualsiasi cartella, basta adattare i percorsi).

### 1. Pacchetti di sistema

```bash
sudo apt update
sudo apt install -y conntrack git
node --version        # Node >= 20 (qui il Node di Volta)
```

### 2. Kernel: conntrack e contatori di byte

```bash
# modulo conntrack ora e a ogni avvio (altrimenti il sysctl sotto si perde al riavvio)
sudo modprobe nf_conntrack
echo nf_conntrack | sudo tee /etc/modules-load.d/netnoise.conf

# contatori di byte e pacchetti per flusso
sudo cp deploy/90-netnoise-conntrack.conf /etc/sysctl.d/   # oppure:
# echo 'net.netfilter.nf_conntrack_acct = 1' | sudo tee /etc/sysctl.d/90-netnoise-conntrack.conf
sudo sysctl --system

# verifica: devono comparire righe con packets= e bytes=
sudo conntrack -L -o extended | head
```

Le connessioni aperte prima di attivare i contatori non hanno `bytes=`: è normale e sparisce
man mano che si chiudono.

> **Tabella vuota?** Sui kernel recenti conntrack traccia le connessioni solo se una regola
> firewall lo usa. Con Docker è già attivo. Altrimenti aggiungi a `/etc/nftables.conf`,
> nella chain `input`, una regola come `ct state established,related accept`.

### 3. Permesso di leggere conntrack senza root

Leggere conntrack richiede `CAP_NET_ADMIN`. La si assegna al binario `conntrack`,
eseguibile solo dal gruppo `netnoise` (con quella capability si può anche svuotare la tabella):

```bash
sudo groupadd --system netnoise
sudo usermod -aG netnoise $USER

sudo chgrp netnoise /usr/sbin/conntrack
sudo chmod 750 /usr/sbin/conntrack
sudo setcap cap_net_admin+ep /usr/sbin/conntrack
```

**Esci dall'ssh e rientra**, poi verifica (`groups` deve elencare `netnoise`):

```bash
/usr/sbin/conntrack -L -o extended | head     # senza sudo
```

Serve il percorso completo: `/usr/sbin` non è nel PATH degli utenti normali, quindi
`conntrack` da solo dà "comando non trovato" anche se i permessi sono giusti.

Se un aggiornamento del pacchetto `conntrack` sostituisce il binario, vanno ripetuti
`chgrp`, `chmod` e `setcap`.

### 4. Codice e build

```bash
sudo mkdir -p /opt/netnoise
sudo chown $USER:$USER /opt/netnoise
git clone https://github.com/contix93/netnoise.git /opt/netnoise

cd /opt/netnoise/collector
npm ci
npm run build          # crea dist/index.js
```

Se il repo è privato, alla richiesta della password va usato un personal access token
di GitHub (oppure `gh auth login`).

### 5. Configurazione

```bash
cp /opt/netnoise/collector/deploy/netnoise.env.example /opt/netnoise/netnoise.env
chmod 600 /opt/netnoise/netnoise.env
nano /opt/netnoise/netnoise.env
```

Valori da impostare:

```bash
BIND=192.168.1.10                  # IP del NAS in LAN:  hostname -I
PORT=3100                          # una porta libera:   sudo ss -ltnp | grep ':3100'
TOKEN=...                          # openssl rand -hex 16
ANON_SALT=...                      # openssl rand -hex 32
IFACES=eth0                        # interfaccia dopo "dev" in:  ip route | grep default
CONNTRACK_BIN=/usr/sbin/conntrack  # percorso completo, vedi punto 3
```

### 6. Avvio con pm2

pm2 non legge file env: li carica Node con `--env-file`.

```bash
volta install pm2
cd /opt/netnoise/collector
pm2 start dist/index.js --name netnoise --node-args="--env-file=/opt/netnoise/netnoise.env"
pm2 logs netnoise

pm2 save
pm2 startup      # stampa un comando "sudo env PATH=...": copialo ed eseguilo
```

L'avviso "impossibile leggere net.netfilter.nf_conntrack_acct" si può ignorare
(`sysctl` sta in `/usr/sbin`, fuori dal PATH dell'utente).

### 7. Verifica

Da un altro PC in LAN:

```bash
curl "http://192.168.1.10:3100/api/health?token=IL_TUO_TOKEN"
```

Il WebSocket è su `ws://192.168.1.10:3100/ws?token=IL_TUO_TOKEN`.

### Aggiornamenti

```bash
cd /opt/netnoise && git pull
cd collector && npm ci && npm run build
pm2 restart netnoise
```

### Problemi già incontrati

| Errore | Causa e soluzione |
| --- | --- |
| `conntrack: comando non trovato` | `/usr/sbin` non è nel PATH: usa `/usr/sbin/conntrack` e `CONNTRACK_BIN` nel file env. |
| `permessi insufficienti per conntrack` | Ripeti il punto 3 e rientra dall'ssh. |
| `spawn /usr/sbin/conntrack EACCES` | Il demone pm2 era partito prima che l'utente entrasse nel gruppo `netnoise` e ha i gruppi vecchi. Da una shell nuova: `pm2 kill`, poi di nuovo `pm2 start ...` e `pm2 save` (`pm2 kill` ferma anche le altre app gestite da pm2). |
| `listen EADDRINUSE ...:8080` | La porta è occupata da un'altra app: scegli un'altra `PORT` nel file env e `pm2 restart netnoise`. Chi la usa: `sudo ss -ltnp \| grep ':8080'`. |
| Nessun flusso | Tabella conntrack vuota: vedi la nota al punto 2. |

### Alternativa: servizio systemd

Con un Node di sistema in `/usr/bin/node` (non quello di Volta, che sta nella home e non è
visibile al servizio) si può usare [deploy/netnoise.service](deploy/netnoise.service) al posto
di pm2 e del punto 3: gira con un utente effimero (`DynamicUser`) con la sola `CAP_NET_ADMIN`,
più isolato di pm2.

```bash
sudo cp deploy/netnoise.env.example /etc/netnoise.env && sudo nano /etc/netnoise.env
sudo cp deploy/netnoise.service /etc/systemd/system/   # WorkingDirectory punta a /opt/netnoise/collector
sudo systemctl daemon-reload && sudo systemctl enable --now netnoise
journalctl -u netnoise -f
```

## Frontend

Il frontend in [../web](../web) si collega al WebSocket e mostra i messaggi in tempo reale.
Il collector può servirlo sulla stessa porta: vedi `STATIC_DIR` nel [README del web](../web/README.md).

## Protocollo

I tipi sono in [src/protocol.ts](src/protocol.ts), un file senza dipendenze da
importare nel frontend insieme alla classe `FlowState`, che ricostruisce lo stato.

- Alla connessione arriva un `hello` con tutti i flussi. **A ogni `hello` il client azzera lo stato.**
- Poi arrivano `tick` con `new` (flussi nuovi; `fresh: true` → impulso), `end` (flussi chiusi),
  `rates` (elenco completo dei top-N in byte/s: chi non c'è ha rate 0) e `total` (throughput dell'interfaccia).
- `dir` è rispetto al NAS: `in` = connessione aperta da un client verso il NAS, `out` = aperta dal NAS.
  I rate `[id, in, out]` sono invece i byte ricevuti e inviati dal NAS, indipendentemente da chi ha aperto.
- Il client può inviare `{"type":"resync"}` per ricevere un nuovo `hello`.
- Se il token è sbagliato il server chiude il WebSocket con codice `4401`.

## Configurazione

Tutte le variabili sono in [deploy/netnoise.env.example](deploy/netnoise.env.example).
Le principali sono `BIND`, `PORT`, `TOKEN`, `CONNTRACK_BIN`, `EXCLUDE_CIDRS` (es. per nascondere
le reti Docker), `ANON`/`ANON_SALT`, `MAX_FLOWS` e `STATIC_DIR`.
