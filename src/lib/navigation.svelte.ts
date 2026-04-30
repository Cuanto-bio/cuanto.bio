import { browser } from '$app/environment';

// Tracks the in-app navigation history so mobile UI can show a contextual back
// link. SvelteKit's client-side router never reloads the page, so this module
// is imported once and stays alive in the browser tab's JS heap for the entire
// session — giving us a place to accumulate history across navigations.
//
// The stack is NOT persisted to localStorage, sessionStorage, or any cookie.
// It starts empty on every fresh page load, which means the back link only
// appears after the user has navigated within the app during the current
// session. Direct links and refreshes intentionally show no back link.
//
// On the server, ES modules are singletons shared across all concurrent
// requests in the same Node process. The `browser` guards below ensure reads
// always return null and writes are no-ops during SSR, so no state leaks
// between requests.
class Navigation {
  private _stack = $state<string[]>([]);

  get previousUrl(): string | null {
    if (!browser) return null;
    return this._stack.length > 0 ? this._stack[this._stack.length - 1] : null;
  }

  // Called after every client-side navigation. If `toHref` matches the top of
  // the stack the user is going back (via our back link), so we pop. Otherwise
  // we push `fromHref`, extending the history trail.
  navigate(fromHref: string, toHref: string) {
    if (!browser) return;
    if (this.previousUrl === toHref) {
      this._stack.pop();
    } else {
      this._stack.push(fromHref);
    }
  }
}

export const nav = new Navigation();
