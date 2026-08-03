import adapter from '@sveltejs/adapter-node';
import 'dotenv/config';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  compilerOptions: {
    // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
    runes: ({ filename }) =>
      filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
  },
  kit: {
    adapter: adapter(),

    csrf: {
      trustedOrigins: [
        // SvelteKit's CSRF protection will block POST requests when serving
        // the app from behind a reverse proxy unless we tell it what the
        // proxy URL is. In production (adapter-node), set the ORIGIN env var
        // instead — it's read at runtime and doesn't require a build-time value.
        process.env.PUBLIC_URL,
      ].filter(Boolean),
      // The native wrapper loads the site same-origin, so its POSTs already
      // pass this check with no special-casing.
    },

    // Registration is handled in src/routes/+layout.svelte so the SW is
    // always registered at the correct absolute path (/service-worker.js)
    // and can use the right module type for dev vs production.
    serviceWorker: { register: false },
  },
};

export default config;
