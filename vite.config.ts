import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import 'dotenv/config';

// Vite and svelte need to be told what hosts can connect to them, so for
// local dev that probably means docker containers and reverse proxies for
// testing
const allowedHosts = ['host.docker.internal'];
if (process.env.PUBLIC_URL) {
  allowedHosts.push(process.env.PUBLIC_URL.replace(/https?:\/\//, ''));
}

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: '127.0.0.1',
    allowedHosts,
  },
  preview: {
    allowedHosts,
  },
  test: {
    expect: { requireAssertions: true },
    projects: [
      {
        extends: './vite.config.ts',
        test: {
          name: 'server',
          environment: 'node',
          include: ['src/**/*.{test,spec}.{js,ts}'],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
