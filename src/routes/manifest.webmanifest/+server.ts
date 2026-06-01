import { env as publicEnv } from '$env/dynamic/public';
import type { RequestHandler } from './$types';

// The web app manifest is served from a route (not static/) so the absolute URL
// in `related_applications` follows the serving domain. That entry is the only
// field that *must* be absolute: `getInstalledRelatedApps()` (Android Chromium)
// matches an installed app by its manifest URL, so a hardcoded domain would only
// ever detect installs on that one domain. We derive it from PUBLIC_URL (one
// domain per deployment, matching how auth.ts pins the OAuth domain), falling
// back to the request origin if PUBLIC_URL is unset.
export const GET: RequestHandler = ({ url }) => {
  const origin = publicEnv.PUBLIC_URL ?? url.origin;
  const body = {
    name: 'Cuanto.bio',
    short_name: 'Cuanto',
    description: 'Participatory biological surveys',
    id: '/app/',
    theme_color: '#ffffff',
    background_color: '#ffffff',
    start_url: '/app/',
    display: 'standalone',
    prefer_related_applications: false,
    related_applications: [
      { platform: 'webapp', url: `${origin}/manifest.webmanifest` },
    ],
    icons: [
      { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      {
        src: 'maskable-icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/manifest+json' },
  });
};
