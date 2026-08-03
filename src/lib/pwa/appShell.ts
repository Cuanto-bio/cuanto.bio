/**
 * Rewrites the prerendered `/app/` shell so it works when served for *any*
 * `/app/*` URL rather than only the exact path it was prerendered at.
 *
 * Two fixes, both about the shell no longer sitting at the URL it assumes:
 *
 * 1. `new URL(".", location)` resolves the *serving directory* as SvelteKit's
 *    base, which breaks routing when the same HTML is served for, say,
 *    `/app/protocols/following`. `new URL("/", location)` always yields
 *    `base = ""`.
 * 2. `"./_app/"` asset references are relative to the serving directory too,
 *    so at `/app/protocols/` they resolve to `/app/protocols/_app/`. Making
 *    them root-relative fixes them at any depth.
 *
 * Used by `src/service-worker.ts`, which caches the shell for offline use — on
 * the web PWA and, in the wrapper, in the native app-bound webview alike, since
 * both run the same service worker.
 *
 * Pure and string-in/string-out so it can be tested without a browser.
 */
export function rewriteAppShell(html: string): string {
  return html
    .replace('new URL(".", location)', 'new URL("/", location)')
    .replaceAll('"./_app/', '"/_app/');
}
