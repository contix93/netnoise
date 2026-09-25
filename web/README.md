# netnoise web

Frontend Nuxt 4 (SPA) che si collega al WebSocket del collector e mostra in tempo reale
i messaggi `hello`/`tick` e lo stato ricostruito con `FlowState`
(importato da [../collector/src/protocol.ts](../collector/src/protocol.ts) tramite l'alias `#protocol`).

- **In alto**: stato della connessione, nome del NAS, flussi attivi, throughput in/out, messaggi/s.
- **A sinistra**: gli ultimi 300 messaggi, il più recente in alto, con un riassunto.
- **A destra**: il JSON del messaggio selezionato; con "segui l'ultimo" si aggiorna da solo.
- **Pausa** blocca l'elenco (i contatori continuano), **Resync** chiede un nuovo `hello`,
  **Svuota** pulisce l'elenco; filtro per tipo e "nascondi tick vuoti".
- Se la connessione cade riprova da sola (fino a 30 s tra un tentativo e l'altro);
  con token sbagliato (codice `4401`) si ferma e lo segnala.

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
