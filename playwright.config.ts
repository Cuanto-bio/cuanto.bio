import { defineConfig } from '@playwright/test';

const PORT = 5174;

export default defineConfig({
  globalSetup: './tests/global-setup.ts',
  workers: 1,
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test',
      PDS_MOCK: 'true',
      // Pinned here rather than read from .env so tests that post tap events to
      // /api/tap/webhook don't depend on a developer's local password.
      TAP_ADMIN_PASSWORD: 'devpassword',
    },
  },
  testMatch: '**/*.spec.{ts,js}',
  testIgnore: '**/*.pwa.spec.{ts,js}',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
});
