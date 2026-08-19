import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defaultClientConditions } from 'vite';
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
          // scripts/ holds build tooling that runs in Node, not in the app —
          // app-version.js is imported by svelte.config.js, so it needs
          // covering here rather than in either app-facing project.
          include: [
            'src/**/*.{test,spec}.{js,ts}',
            'scripts/**/*.{test,spec}.{js,ts}',
          ],
          exclude: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
      {
        extends: './vite.config.ts',
        // Without the browser condition, `svelte` resolves to its server entry,
        // where `flushSync` is a no-op and effects are never flushed — so an
        // effect-driven test passes or fails for reasons that have nothing to do
        // with the code under test. Added to the defaults rather than replacing
        // them, or dependencies here resolve to different entry points than the
        // ones the app actually ships.
        resolve: { conditions: ['browser', ...defaultClientConditions] },
        test: {
          // Runes that schedule effects need the *client* build of Svelte, which
          // vitest only compiles for a browser-like environment: under `node`
          // the same module compiles for SSR, where effects never run at all.
          // Anything asserting on effects belongs here.
          name: 'client',
          environment: 'jsdom',
          include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
        },
      },
    ],
  },
});
