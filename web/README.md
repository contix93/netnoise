# netnoise web

Frontend Nuxt 4 (SPA) che si collega al WebSocket del collector e mostra in tempo reale
i messaggi `hello`/`tick` e lo stato ricostruito con `FlowState`
(importato da [../collector/src/protocol.ts](../collector/src/protocol.ts) tramite l'alias `#protocol`).

## Sviluppo

```bash
npm install
cp .env.example .env      # imposta NUXT_PUBLIC_WS_URL con IP e porta del NAS
npm run dev               # http://localhost:3000/?token=IL_TUO_TOKEN
```

Senza NAS: avvia il collector con `npm run dev:mock` (in `collector/`) e usa
`NUXT_PUBLIC_WS_URL=ws://127.0.0.1:8080/ws`.

Il token si inserisce nella pagina oppure si passa come `?token=` nell'indirizzo;
indirizzo e token restano salvati nel browser.

## Servirlo dal collector

```bash
npm ci && npm run build   # genera .output/public
```

Poi nel file env del collector:

```bash
STATIC_DIR=/percorso/netnoise/web/.output/public
```

e riavvia il collector: la pagina sarà su `http://IP-NAS:PORTA/?token=...` e si collega
da sola al WebSocket sulla stessa porta.
