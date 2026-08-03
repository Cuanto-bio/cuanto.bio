import type { Page } from '@playwright/test';

/**
 * A recorded Capacitor plugin call, readable from a test via readCapCalls().
 * `options` is whatever the app passed the plugin method (e.g. Browser.open's
 * `{ url }`, or App.addListener's `{ eventName }`).
 */
export interface CapCall {
  pluginName: string;
  methodName: string;
  options?: { url?: string; eventName?: string } & Record<string, unknown>;
}

/**
 * Runs in the page before any app script. It makes Capacitor report a native
 * platform and routes every plugin call through an in-page recorder, so the
 * isNative()-gated web code runs exactly as it does in the wrapper while the
 * test captures Browser.open() and can fire the appUrlOpen deep-link callback
 * on demand.
 *
 * This is faithful to how a real device dispatches: a plugin method with a
 * PluginHeader goes through cap.nativePromise / cap.nativeCallback (see
 * @capacitor/core's createCapacitor), which on a device the native runtime
 * provides and here we provide. It is deliberately not a mock of our own code:
 * the real native.ts, platform.ts and hooks.client run unchanged.
 */
function bridgeInit(): void {
  const w = window as unknown as {
    __capCalls: CapCall[];
    __capFireAppUrlOpen: (url: string) => void;
    Capacitor: unknown;
    androidBridge: unknown;
  };
  const calls: CapCall[] = [];
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  w.__capCalls = calls;
  w.__capFireAppUrlOpen = (url: string) => {
    for (const cb of listeners['App:appUrlOpen'] ?? []) cb({ url });
  };
  const promiseMethod = (name: string) => ({ name, rtype: 'promise' });
  w.Capacitor = {
    PluginHeaders: [
      {
        name: 'App',
        methods: [
          { name: 'addListener', rtype: 'callback' },
          promiseMethod('removeListener'),
          promiseMethod('getLaunchUrl'),
        ],
      },
      {
        name: 'Browser',
        methods: [promiseMethod('open'), promiseMethod('close')],
      },
      {
        name: 'Haptics',
        methods: [promiseMethod('impact'), promiseMethod('vibrate')],
      },
    ],
    nativePromise: (
      pluginName: string,
      methodName: string,
      options: unknown,
    ) => {
      calls.push({
        pluginName,
        methodName,
        options: options as CapCall['options'],
      });
      if (pluginName === 'App' && methodName === 'getLaunchUrl') {
        return Promise.resolve({ url: '' });
      }
      return Promise.resolve({});
    },
    nativeCallback: (
      pluginName: string,
      methodName: string,
      options: { eventName?: string } | undefined,
      callback: (data: unknown) => void,
    ) => {
      calls.push({ pluginName, methodName, options });
      if (methodName === 'addListener' && options?.eventName) {
        const key = `${pluginName}:${options.eventName}`;
        listeners[key] ??= [];
        listeners[key].push(callback);
      }
      return `cb-${Math.random().toString(36).slice(2)}`;
    },
  };
  // getPlatformId() keys native detection off this global. A truthy stub is
  // enough: all plugin dispatch goes through the functions above, never a real
  // postMessage bridge.
  w.androidBridge = { postMessage() {} };
}

/** Installs the fake native bridge. Must be called before page.goto(). */
export async function installNativeBridge(page: Page): Promise<void> {
  await page.addInitScript(bridgeInit);
}

/** Every Capacitor plugin call the app has made so far, in order. */
export async function readCapCalls(page: Page): Promise<CapCall[]> {
  return page.evaluate(
    () => (window as unknown as { __capCalls: CapCall[] }).__capCalls,
  );
}

/**
 * Delivers a deep-link URL to the app's appUrlOpen listener, the way iOS routes
 * the `bio.cuanto.app://auth?code=…` callback back into the app.
 */
export async function fireAppUrlOpen(page: Page, url: string): Promise<void> {
  await page.evaluate(
    (u) =>
      (
        window as unknown as { __capFireAppUrlOpen: (url: string) => void }
      ).__capFireAppUrlOpen(u),
    url,
  );
}
