import { fileURLToPath } from 'node:url';

export default defineNuxtConfig({
  compatibilityDate: '2026-09-25',

  // SPA pura: `nuxt generate` produce file statici che il collector può servire con STATIC_DIR
  ssr: false,

  alias: {
    // tipi e FlowState condivisi con il collector (file senza dipendenze)
    '#protocol': fileURLToPath(new URL('../collector/src/protocol.ts', import.meta.url)),
  },

  css: ['~/assets/main.css'],

  app: {
    head: {
      title: 'netnoise',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },

  runtimeConfig: {
    public: {
      // es. ws://192.168.1.10:8081/ws — vuoto = stesso host della pagina (quando la serve il collector)
      wsUrl: '',
    },
  },

  devtools: { enabled: false },
});
