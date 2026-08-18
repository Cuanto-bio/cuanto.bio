import { afterEach, describe, expect, test, vi } from 'vitest';
import { captureClientDiagnostics } from './errors';
import { logDiagnostic } from './log';

vi.mock('./log', () => ({ logDiagnostic: vi.fn() }));

const logged = vi.mocked(logDiagnostic);

// Captures the listeners the module registers so a test can fire them, and
// counts what is still registered so a leak on teardown is observable. window
// and document get separate registries deliberately: `visibilitychange` fires
// on document and the other two on window, and sharing one registry would hide
// a handler attached to the wrong target.
function stubBrowserEnv(visibilityState = 'visible') {
  const window = new Map<string, EventListener>();
  const document = new Map<string, EventListener>();
  const target = (listeners: Map<string, EventListener>) => ({
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
  });
  vi.stubGlobal('window', target(window));
  vi.stubGlobal('document', { ...target(document), visibilityState });
  return {
    get registered() {
      return window.size + document.size;
    },
    dispatch(type: string, event: unknown) {
      (window.get(type) ?? document.get(type))?.(event as Event);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  logged.mockClear();
});

describe('captureClientDiagnostics', () => {
  test('records an uncaught error with where it came from', () => {
    const env = stubBrowserEnv();
    captureClientDiagnostics();

    env.dispatch('error', {
      message: 'boom',
      filename: 'https://cuanto.bio/app.js',
      lineno: 12,
      colno: 3,
    });

    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'error',
      'boom (https://cuanto.bio/app.js:12:3)',
    );
  });

  test('records an unhandled rejection', () => {
    const env = stubBrowserEnv();
    captureClientDiagnostics();

    env.dispatch('unhandledrejection', { reason: new Error('nope') });

    // With the stack, not just the message: for a defect nobody can reproduce
    // on demand, where it was thrown from is the whole diagnostic.
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'rejection',
      expect.stringContaining('errors.test.ts'),
    );
  });

  test('records a rejected non-Error value rather than [object Object]', () => {
    const env = stubBrowserEnv();
    captureClientDiagnostics();

    env.dispatch('unhandledrejection', { reason: { status: 401 } });

    expect(logged).toHaveBeenCalledExactlyOnceWith(
      'rejection',
      expect.stringContaining('401'),
    );
  });

  test('records backgrounding, the transition every other breadcrumb is read against', () => {
    const env = stubBrowserEnv('hidden');
    captureClientDiagnostics();

    env.dispatch('visibilitychange', {});

    expect(logged).toHaveBeenCalledExactlyOnceWith('visibility', 'hidden');
  });

  test('stops listening when torn down', () => {
    const env = stubBrowserEnv();
    const stop = captureClientDiagnostics();

    stop();

    expect(env.registered).toBe(0);
  });
});
