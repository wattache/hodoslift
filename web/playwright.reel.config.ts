import { defineConfig, devices } from '@playwright/test';

/** E2E qui traversent POUR DE VRAI : navigateur → eitri → brokkr → Postgres.
 *
 *  À ne pas confondre avec `playwright.config.ts`, qui fait tourner les 77 specs
 *  du dev-mock. Celles-là couvrent la navigation et l'affichage ; **elles ne
 *  peuvent rien dire de la persistance**, puisqu'un seul booléen y commande à la
 *  fois le bypass du login et les 15 court-circuits d'écriture de l'éditeur.
 *  C'est cet angle mort qui a laissé passer trois défauts de contrat.
 *
 *  PRÉREQUIS, à lancer avant (cf. `docs/e2e-reel.md`) :
 *    1. l'émulateur Auth       npx firebase emulators:start --only auth
 *    2. brokkr sur le bac à sable, AVEC `FIREBASE_AUTH_EMULATOR_HOST`
 *    3. le compte de test importé + `scripts/seed_e2e.sql` joué
 *
 *  ⚠️ Ces tests ÉCRIVENT dans `ff-training`. Ils créent leurs propres objets
 *  sous le programme `e2e-program` et les suppriment ensuite — ils ne touchent
 *  JAMAIS aux 55 programmes réels : un objet créé se supprime, une donnée réelle
 *  modifiée ne se « dé-modifie » pas.
 */
const BROKKR = process.env.E2E_BROKKR_URL ?? 'http://127.0.0.1:8082';
const SINDRI = process.env.E2E_SINDRI_URL ?? 'http://127.0.0.1:8083';
const EMULATEUR = process.env.E2E_AUTH_EMULATOR ?? '127.0.0.1:9099';

export default defineConfig({
  testDir: './e2e-reel',
  fullyParallel: false,          // ils partagent une base : l'ordre compte
  workers: 1,
  // Et une seule CAMPAGNE à la fois, pour la même raison (cf. `e2e-reel/verrou.ts`).
  globalSetup: './e2e-reel/verrou.ts',
  globalTeardown: './e2e-reel/verrou-teardown.ts',
  timeout: 30_000,
  // `list`, jamais le rapport HTML par défaut : celui-ci SERT le rapport après
  // un échec et bloque le terminal — mortel pour un script ou une CI.
  reporter: 'list',
  // `localhost` et non `127.0.0.1` : Vite n'écoute que sur l'un des deux
  // (résolution IPv6), et l'autre ne répond pas.
  // Langue ÉPINGLÉE, comme dans la config du dev-mock : l'i18n suit
  // navigator.language, et Chromium parle en-US par défaut. Sans ça, les specs
  // ne tiennent que sur les libellés codés en dur en français — ceux qui
  // passent par i18n (« Rép. réelles ») deviennent introuvables.
  use: { baseURL: 'http://localhost:5200', locale: 'fr-FR', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Une config Firebase COMPLÈTE (donc pas de mode mock) mais pointée sur
    // l'émulateur : la clé n'a pas besoin d'être vraie, l'émulateur ne la lit pas.
    command: 'npx vite --port 5200 --strictPort',
    url: 'http://localhost:5200',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_FIREBASE_API_KEY: 'fake-api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'french-forge-600.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'french-forge-600',
      VITE_AUTH_EMULATOR_HOST: EMULATEUR,
      VITE_BROKKR_URL: BROKKR,
      VITE_SINDRI_URL: SINDRI,
      // ⚠️ PAS DE BOUTON GIS DANS LE HARNAIS. `VITE_GOOGLE_CLIENT_ID` vit dans
      // `.env.local` et fait rendre le bouton Google Identity Services — qui
      // parle au VRAI Google, dans un test censé être hermétique. Deux dégâts :
      // l'écran cesse d'être déterministe (le libellé du bouton de repli change
      // selon que le script GIS a rendu ou non), et un chemin de connexion
      // inutilisable en test s'ajoute à côté de celui qu'on veut éprouver.
      //
      // Vide, donc `gisRendu` reste faux et l'écran n'offre que la popup — le
      // chemin que ces specs traversent réellement.
      VITE_GOOGLE_CLIENT_ID: '',
    },
  },
});
