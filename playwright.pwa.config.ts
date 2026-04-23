import { defineConfig } from '@playwright/test';

const PORT = 5175;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  workers: 1,
  webServer: {
    // Build with 127.0.0.1 (not localhost) to satisfy OAuth client-metadata
    // validation, then serve the compiled output with vite preview.
    command: `pnpm build && pnpm preview --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      DATABASE_URL: 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test',
      PDS_MOCK: 'true',
      PUBLIC_URL: BASE_URL,
    },
  },
  testMatch: '**/*.pwa.spec.{ts,js}',
  use: {
    baseURL: BASE_URL,
  },
});
