import { expect, vi } from 'vitest';
import { recheckConnectivity, useOnline } from './online.svelte';

// Connectivity is module-level state in online.svelte.ts, shared by every test
// in a file, so tests that change it go through these and always restore it.

/** Puts the connectivity state where a failed ping leaves it. */
export function markServerUnreachable() {
  vi.stubGlobal('navigator', { onLine: false });
  // With navigator.onLine false this settles synchronously, no ping needed.
  recheckConnectivity();
  vi.unstubAllGlobals();
}

/** Puts the connectivity state back to reachable. Call from afterEach. */
export async function restoreConnectivity() {
  vi.useRealTimers();
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  recheckConnectivity();
  await vi.waitFor(() => expect(useOnline().value).toBe(true));
  vi.unstubAllGlobals();
}
