import { defineConfig, devices } from '@playwright/test';

// Port dédié aux tests E2E. Le serveur est lancé en « dev-mock » : on vide
// VITE_FIREBASE_API_KEY (les vars d'env priment sur .env.local) →
// isFirebaseConfigured=false → fixtures déterministes ET bypass du login.
// Aucune modif de l'app : c'est exactement le mode dev-mock manuel.
const PORT = 5199;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Langue ÉPINGLÉE : l'i18n suit navigator.language — sans ça les tests
    // seraient verts en France et rouges sur un Chromium anglophone / en CI.
    locale: 'fr-FR',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `VITE_FIREBASE_API_KEY= npx vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
