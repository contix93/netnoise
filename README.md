# netnoise

Visualizzazione in tempo reale del traffico di rete del NAS.

| Cartella | Cosa contiene |
| --- | --- |
| [collector/](collector) | Servizio Node che legge i flussi da conntrack e li trasmette via WebSocket. Installazione sul NAS (Armbian, Volta, pm2) nel [README](collector/README.md). |
| [web/](web) | Frontend Nuxt 4 che si collega al WebSocket e mostra i messaggi in tempo reale. Sviluppo e deploy nel [README](web/README.md). |

## In breve

1. Sul NAS: prepara conntrack e i permessi, clona il repo in `/opt/netnoise`, compila il
   collector e avvialo con pm2 ([collector/README.md](collector/README.md)).
2. Sul Mac: `cd web && npm install && npm run dev`, con `NUXT_PUBLIC_WS_URL` che punta al NAS.
3. Per usarlo senza Mac: compila `web/` sul NAS e imposta `STATIC_DIR` nel file env del collector.

Aggiornare tutto sul NAS:

```bash
cd /opt/netnoise && git pull
cd collector && npm ci && npm run build
cd ../web && npm ci && npm run build
pm2 restart netnoise
```
