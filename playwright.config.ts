import { defineConfig } from '@playwright/test';

export default defineConfig({
  workers: 1,
  webServer: {
    command: 'pnpm dev --port 5174',
    port: 5174,
    reuseExistingServer: true,
    env: {
      DATABASE_URL: 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test',
      PDS_MOCK: 'true',
    },
  },
  testMatch: '**/*.spec.{ts,js}',
  use: {
    baseURL: 'http://localhost:5174',
  },
});
