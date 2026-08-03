import 'dotenv/config';
import type { CapacitorConfig } from '@capacitor/cli';
import { nativeServerOrigin } from './src/lib/native/serverUrl';

// The wrapper loads cuanto.bio live over the network instead of bundling it, so
// a web deploy reaches app users with no App Store round trip. The host it
// loads is PUBLIC_URL, the same public origin the SvelteKit app is served from:
// cuanto.bio in production, a Tailscale funnel to a local server during
// development. Must match WKAppBoundDomains in ios/App/App/Info.plist, or
// App-Bound mode blocks the very page it loads.
//
// nativeServerOrigin fails the native build if PUBLIC_URL is a loopback,
// IP-literal, or plain-http URL (like the dev default http://127.0.0.1:5173),
// since none of those can load in the WKWebView.
const origin = nativeServerOrigin(process.env.PUBLIC_URL);

const config: CapacitorConfig = {
  appId: 'bio.cuanto.app',
  appName: 'Cuanto',
  // Ignored because server.url is set, but Capacitor requires it to exist.
  webDir: 'www',
  server: {
    // Load /app on launch, not the marketing home page. /app is the signed-in
    // experience; its layout guard bounces an unauthed native user into the
    // native sign-in flow (system browser → bearer token). Without this the app
    // lands on the home page and the native flow is never entered — the user
    // ends up doing a plain web sign-in with no way back into the app.
    //
    // The path goes in `url`, not in `appStartPath`: appStartPath additionally
    // requires a matching *local* file (public/app) to exist, which a remote
    // wrapper has no reason to ship. Putting it in `url` loads the remote /app
    // while Capacitor's local guard just checks that public/ exists.
    url: `${origin}/app`,
  },
  ios: {
    // Opts the WKWebView into App-Bound mode, which is what lets the site's
    // service worker run (offline launch). The Stage A spike confirmed on
    // device that this does not block cross-origin fetch, and the 10-domain cap
    // never bites: the webview only navigates to cuanto.bio, and sign-in is in
    // the system browser. See docs/2026-07-22-capacitor-wrapper-spike.md.
    limitsNavigationsToAppBoundDomains: true,
  },
};

export default config;
