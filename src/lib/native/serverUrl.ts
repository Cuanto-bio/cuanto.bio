/**
 * Resolve the origin the Capacitor native wrapper should load, from PUBLIC_URL,
 * the same public origin the SvelteKit app is served from.
 *
 * The wrapper loads the site live over the network (server.url), so it needs a
 * publicly reachable HTTPS domain. The dev default (http://127.0.0.1:5173) and
 * any loopback, IP-literal, or plain-http URL cannot load in the WKWebView and
 * would give the service worker no secure context, so throw and fail the native
 * build rather than sync an app that shows a blank screen.
 */
export function nativeServerOrigin(publicUrl: string | undefined): string {
  if (!publicUrl) {
    throw new Error(
      'PUBLIC_URL is not set. The native wrapper loads it over the network, ' +
        'so set it to the public HTTPS origin the app is served from.',
    );
  }

  let url: URL;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new Error(`PUBLIC_URL is not a valid URL: ${publicUrl}`);
  }

  const host = url.hostname;
  const isIpLiteral =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[');
  if (url.protocol !== 'https:' || host === 'localhost' || isIpLiteral) {
    throw new Error(
      `PUBLIC_URL=${publicUrl} will not work in the native wrapper. It needs ` +
        'a public HTTPS domain (e.g. https://cuanto.bio or a Tailscale ' +
        'funnel), not http, localhost, or an IP address. Set PUBLIC_URL in ' +
        '.env before running a native build.',
    );
  }

  return url.origin;
}
