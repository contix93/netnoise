# netnoise web

Frontend Nuxt 4 (SPA) che si collega al WebSocket del collector e mostra in tempo reale
i messaggi `hello`/`tick` e lo stato ricostruito con `FlowState`
(importato da [../collector/src/protocol.ts](../collector/src/protocol.ts) tramite l'alias `#protocol`).

- **In alto**: stato della connessione, nome del NAS, flussi attivi, throughput in/out, messaggi/s.
- **Scheda Messaggi**: a sinistra gli ultimi 300 messaggi, il più recente in alto, con un riassunto;
  a destra il JSON del messaggio selezionato (con "segui l'ultimo" si aggiorna da solo).
  **Svuota** pulisce l'elenco; filtro per tipo e "nascondi tick vuoti".
- **Scheda Connessioni** (`/#connessioni`): una riga per ogni flusso aperto con peer, verso,
  servizio, porta, byte/s ricevuti e inviati dal NAS, totale ed età. Ordinabile cliccando le
  intestazioni (di default per totale, come `rates`), filtrabile per testo o "solo con traffico".
  Le connessioni appena nate lampeggiano, quelle senza traffico sono attenuate.
- **Scheda Suono** (`/#suono`): il traffico diventa musica con [Strudel](https://strudel.cc).
  A sinistra l'editor Strudel con il codice generato, a destra le note che stanno suonando
  (una corsia per strumento, pieno = in, contorno = out) e gli strati attivi.
  **▶ Suona** avvia l'audio (serve un clic: il browser non lo permette da solo).
  Dettagli sotto.
- **Pausa** congela elenco e tabella (i contatori in alto continuano), **Resync** chiede un nuovo `hello`.
- Se la connessione cade riprova da sola (fino a 30 s tra un tentativo e l'altro);
  con token sbagliato (codice `4401`) si ferma e lo segnala.

## Suono

A ogni ciclo (una battuta) [app/utils/compose.ts](app/utils/compose.ts) riscrive il codice Strudel
dallo stato dei flussi e l'editor lo valuta. Solo i flussi con traffico suonano; quelli con lo
stesso tipo di servizio e verso formano uno strato (`web_out:`, `file_in:`, …).

Le regole sono le stesse in ogni stile:

| Cosa | Diventa |
| --- | --- |
| servizio | strumento, scelto dallo stile per ogni famiglia: web, file (smb, nfs, afp, rsync), streaming (plex, jellyfin), controllo (dns, mdns, ntp…), tunnel (ssh, vpn), posta e db, p2p (torrent), ping (icmp), altro |
| verso | `in` un'ottava sotto e a sinistra, `out` un'ottava sopra e a destra |
| byte/s | note per battuta e volume (scala logaritmica: 100 B/s → minimo, 10 MB/s → massimo) |
| peer e porta | le note: ogni flusso ha un grado della scala stabile finché vive |
| ricevuti vs inviati | modo della scala: ogni stile ne ha tre (si riceve di più / equilibrio / si invia di più) |
| totale | ritmo e bordone, scritti dallo stile |
| connessioni nuove | un campanello ciascuna, per una battuta |

Gli stili sono in [app/utils/styles.ts](app/utils/styles.ts) e si scelgono dalla select **stile**:

| Stile | bpm | Suono |
| --- | --- | --- |
| Synth | 110 | il primo: pianoforte, basso sawtooth, pad supersaw, cassa e clap |
| 8bit | 140 | chiptune: onde quadre, basso triangolo, rumore sgranato, arpeggi |
| Techno | 128 | cassa in quattro, basso acid, stab, charleston in sedicesimi, modo frigio quando si scarica |
| Rock | 124 | power chord distorti, basso elettrico, organo, batteria che si infittisce col traffico, pentatonica |
| Melodico | 76 | ballata: pianoforte, archi, vibrafono, carillon su un giro I–vi–IV–V |
| Lirico | 66 | coro, violoncelli, archi, corni, arpa e timpani, minore armonica |
| Ambient | 60 | niente batteria: pad lunghi, eco, riverbero |

Cambiando stile il bpm torna a quello dello stile; stile, tonalità e bpm restano salvati nel browser.
Per aggiungere uno stile basta un nuovo oggetto `Style` in `STYLES`. Gli strumenti `gm_*`
(soundfont General MIDI) hanno un'estensione limitata: sopra non suonano o danno
`Unable to decode audio data`, quindi tieni bassa l'ottava (vedi il commento su `octave`).

Scrivere nell'editor ferma la composizione automatica: da lì suona il tuo codice
(Ctrl+Invio per valutarlo, Ctrl+. per fermarlo) e **Riprendi dal traffico** torna al codice generato.
Nel tuo codice puoi usare i segnali `netIn`, `netOut` e `netTotal` (0..1, aggiornati di continuo):

```js
note("c2 eb2 g2").s("sawtooth").lpf(netIn.range(200, 4000)).gain(netTotal.range(.2, .8))
```

La musica continua anche nelle altre schede. Pianoforte, batteria e strumenti `gm_*` si scaricano
da GitHub al primo uso (le prime note di uno strumento nuovo possono mancare):
senza internet suonano solo i sintetizzatori.
Strudel è AGPL-3.0: tenerlo per uso personale sul NAS va bene, ridistribuire la build no senza i sorgenti.

## Sviluppo (sul Mac)

```bash
npm install
cp .env.example .env      # NUXT_PUBLIC_WS_URL=ws://192.168.1.10:3100/ws (IP e porta del NAS)
npm run dev               # http://localhost:3000/?token=IL_TUO_TOKEN
```

Il token si inserisce nella pagina oppure si passa come `?token=` nell'indirizzo;
indirizzo e token restano salvati nel browser. Non va messo nel `.env`: finirebbe nella build.

Senza NAS: avvia il collector con `npm run dev:mock` (in `collector/`) e usa
`NUXT_PUBLIC_WS_URL=ws://127.0.0.1:8080/ws`.

Controlli:

```bash
npm run typecheck         # vue-tsc (TypeScript fissato alla 5: la 7 non è supportata da vue-tsc)
npm run build             # genera .output/public
```

## Servirlo dal collector sul NAS

Il collector serve i file statici sulla stessa porta del WebSocket, così non serve tenere
acceso il Mac. Sul NAS, dopo aver fatto push delle modifiche:

```bash
cd /opt/netnoise && git pull
cd web && npm ci && npm run build
```

Nel file env del collector (`/opt/netnoise/netnoise.env`):

```bash
STATIC_DIR=/opt/netnoise/web/.output/public
```

Poi `pm2 restart netnoise`. La pagina è su `http://192.168.1.10:3100/?token=IL_TUO_TOKEN`
e, senza `NUXT_PUBLIC_WS_URL`, si collega da sola a `/ws` sullo stesso host e porta.
