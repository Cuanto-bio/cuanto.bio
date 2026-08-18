/**
 * What the error boundary should say, given what actually went wrong.
 *
 * Split out of `+error.svelte` because the interesting part is the choice of
 * message rather than the markup, and because the offline case is easy to get
 * subtly wrong — see https://tangled.org/cuanto.bio/cuanto.bio/issues/54, where
 * a navigation that failed for want of a connection was reported as an
 * unexpected error, on the same screen as an "You're offline" banner.
 */
/**
 * How the retry button should retry, or null when retrying cannot help.
 *
 * `revalidate` re-runs the route's loads in place. That is the only safe retry
 * offline: a hard reload of a route the service worker does not cache has
 * nothing to serve the document, so it lands on the browser's own network error
 * page and takes the user out of the app.
 */
export type RetryMode = 'reload' | 'revalidate' | null;

export type ErrorText = {
  title: string;
  description: string;
  retry: RetryMode;
  /** Where "Go home" points. */
  homeHref: string;
};

export type ErrorContext = {
  status: number;
  message?: string | null;
  offline: boolean;
  native: boolean;
};

/**
 * `/app/` is the one shell the service worker caches (see service-worker.ts), so
 * it is the only home that survives a dead connection — and the only one the
 * native bundle contains at all.
 */
const APP_HOME = '/app';

export function errorText({
  status,
  message,
  offline,
  native,
}: ErrorContext): ErrorText {
  const homeHref = offline || native ? APP_HOME : '/';

  // A 404 stays a 404 even offline: the cached shell can resolve a route that
  // does not exist client-side, and no amount of connection would find it.
  if (status === 404) {
    return {
      title: 'Page not found',
      description: "We couldn't find the page you were looking for.",
      retry: null,
      homeHref,
    };
  }

  if (offline) {
    return {
      title: "You're offline",
      description:
        "This page needs an Internet connection and isn't available offline. Try " +
        "again when you're online.",
      retry: 'revalidate',
      homeHref,
    };
  }

  if (status >= 500) {
    return {
      title: 'Something went wrong',
      description:
        "We hit an unexpected error. This isn't your fault. Try again, and if " +
        'it keeps happening, let us know.',
      retry: 'reload',
      homeHref,
    };
  }

  return {
    title: 'Something went wrong',
    description: message ?? 'An unexpected error occurred.',
    retry: null,
    homeHref,
  };
}
