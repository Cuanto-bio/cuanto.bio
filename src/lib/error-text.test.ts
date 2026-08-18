import { describe, expect, test } from 'vitest';
import { errorText } from './error-text';

const ONLINE = { offline: false, native: false };

describe('errorText', () => {
  test('names the connection when a load fails offline', () => {
    // The reported bug: /surveys is server-rendered and uncached, so offline
    // its load rejects and the error boundary blamed the app instead of the
    // connection. https://tangled.org/cuanto.bio/cuanto.bio/issues/54
    const copy = errorText({ status: 500, offline: true, native: true });
    expect(copy.title).toBe("You're offline");
    expect(copy.description).toMatch(/connection/i);
    // Re-running the load in place, not a hard reload: offline there is nothing
    // to serve the document for an uncached route, so reloading drops the user
    // onto the browser's own network error page and out of the app.
    expect(copy.retry).toBe('revalidate');
  });

  test('sends "Go home" somewhere the service worker has cached when offline', () => {
    // `/` is cached by nothing, so offline the escape hatch would land on the
    // browser's own network error page. `/app/` is the one shell the service
    // worker caches.
    expect(
      errorText({ status: 500, offline: true, native: false }).homeHref,
    ).toBe('/app');
  });

  test('sends "Go home" to /app in the native shell, whose bundle has no /', () => {
    expect(
      errorText({ status: 500, offline: false, native: true }).homeHref,
    ).toBe('/app');
  });

  test('sends "Go home" to / on the online web', () => {
    expect(errorText({ status: 500, ...ONLINE }).homeHref).toBe('/');
  });

  test('still reports a 404 as a 404 while offline', () => {
    // A cached shell can resolve a route that does not exist client-side, so a
    // 404 offline is a real 404 rather than a connection failure.
    const copy = errorText({ status: 404, offline: true, native: true });
    expect(copy.title).toBe('Page not found');
    expect(copy.retry).toBeNull();
  });

  test('keeps the generic copy for a server error while online', () => {
    const copy = errorText({ status: 500, ...ONLINE });
    expect(copy.title).toBe('Something went wrong');
    expect(copy.description).toMatch(/unexpected error/i);
    expect(copy.retry).toBe('reload');
  });

  test('surfaces the error message for a client error while online', () => {
    const copy = errorText({
      status: 403,
      message: 'Not your survey',
      ...ONLINE,
    });
    expect(copy.description).toBe('Not your survey');
    expect(copy.retry).toBeNull();
  });

  test('falls back to generic text when a client error carries no message', () => {
    const copy = errorText({ status: 403, ...ONLINE });
    expect(copy.description).toBe('An unexpected error occurred.');
  });
});
