import { defineConfig } from '@playwright/test';

const PORT = 5174;

export default defineConfig({
  workers: 1,
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test',
      PDS_MOCK: 'true',
    },
  },
  testMatch: '**/*.spec.{ts,js}',
  testIgnore: '**/*.pwa.spec.{ts,js}',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
});
