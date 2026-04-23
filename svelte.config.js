import adapter from '@sveltejs/adapter-auto';
import 'dotenv/config';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
    runes: ({ filename }) =>
      filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
  },
  kit: {
    // adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
    // If your environment is not supported, or you settled on a specific environment, switch out the adapter.
    // See https://svelte.dev/docs/kit/adapters for more information about adapters.
    adapter: adapter(),

    csrf: {
      trustedOrigins: [
        // SvelteKit's CSRF protection will block POST requests when serving
        // the app from behind a reverse proxy unless we tell it what the
        // proxy URL is
        process.env.PUBLIC_URL,
      ],
    },

    // Registration is handled in src/routes/+layout.svelte so the SW is
    // always registered at the correct absolute path (/service-worker.js)
    // and can use the right module type for dev vs production.
    serviceWorker: { register: false },
  },
};

export default config;
