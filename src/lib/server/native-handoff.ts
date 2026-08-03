import { NATIVE_REDIRECT_SCHEME } from '$lib/server/native-auth';

/**
 * The page that hands the exchange code back to the native app.
 *
 * It has to be a page with a link the user taps, not a 302. The sign-in runs in
 * SFSafariViewController, and Apple documents that it "will sometimes ignore
 * redirects to non-https URLs if no user interaction occurs"
 * (https://developer.apple.com/forums/thread/747921). An OAuth callback is
 * exactly that case — a redirect, no tap, a custom scheme — so the redirect is
 * dropped, the app never hears that sign-in succeeded, and the user returns to
 * a sign-in screen having just signed in.
 *
 * A tap is user interaction, so the same URL opens the app reliably.
 *
 * The alternative is `ASWebAuthenticationSession`, which is built for this and
 * needs no tap, but requires native code. This costs one tap on an action that
 * happens once per device, and no Swift.
 *
 * Deliberately not attempting a scripted redirect first: without user
 * interaction it would be ignored anyway, and a page that silently tries and
 * fails before showing the button is harder to reason about than one that just
 * shows the button.
 */
export function nativeHandoffPage(code: string): Response {
  // The code goes into an href. It is base64url from randomBytes, so it has no
  // HTML-significant characters, but escaping is not conditional on today's
  // encoding staying the same.
  const href =
    `${NATIVE_REDIRECT_SCHEME}://auth?code=${encodeURIComponent(code)}`
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signed in</title>
    <style>
      body {
        font-family: -apple-system, system-ui, sans-serif;
        display: flex;
        min-height: 100vh;
        margin: 0;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 1.5rem;
        padding: 2rem;
        text-align: center;
        color: #111;
        background: #fff;
      }
      h1 { font-size: 1.25rem; margin: 0; }
      p { margin: 0; color: #555; font-size: 0.9rem; max-width: 22rem; }
      a.btn {
        display: block;
        width: 100%;
        max-width: 20rem;
        padding: 0.9rem 1rem;
        border-radius: 999px;
        background: #f5c518;
        color: #111;
        font-weight: 600;
        text-decoration: none;
      }
      @media (prefers-color-scheme: dark) {
        body { color: #eee; background: #111; }
        p { color: #aaa; }
      }
    </style>
  </head>
  <body>
    <h1>You're signed in</h1>
    <p>Tap below to return to Cuanto and finish setting up this device.</p>
    <a class="btn" href="${href}">Return to Cuanto</a>
  </body>
</html>
`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}
