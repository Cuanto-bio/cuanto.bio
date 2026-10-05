import { afterEach, expect, test, vi } from 'vitest';

vi.mock('$lib/offline/db', () => ({
  getCachedSurveys: vi.fn().mockResolvedValue([]),
  cacheSurvey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/logger', () => ({
  default: {
    child: vi.fn().mockReturnValue({ error: vi.fn(), warn: vi.fn() }),
  },
}));

import { UNREACHABLE_TIMEOUT_MS } from '$lib/composables/online.svelte';
import {
  markServerUnreachable,
  restoreConnectivity,
} from '$lib/composables/onlineTestUtils';
import { load } from './+page';

afterEach(restoreConnectivity);

// https://tangled.org/cuanto.bio/cuanto.bio/issues/83
test('returns an empty list after a short wait on an unreachable server', async () => {
  markServerUnreachable();
  vi.useFakeTimers();
  // A server that's down behind a proxy hangs rather than refusing the
  // connection, so this would otherwise wait for the OS connect timeout.
  const fetchFn = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      }),
  );

  const promise = load({ fetch: fetchFn } as unknown as Parameters<
    typeof load
  >[0]);
  await vi.advanceTimersByTimeAsync(UNREACHABLE_TIMEOUT_MS);

  await expect(promise).resolves.toEqual({ surveys: [] });
});

test('still loads surveys when the server came back since the last ping', async () => {
  // The ping can be up to one poll interval stale; an empty list here would
  // stick until the user navigated away and back.
  markServerUnreachable();
  const surveys = [{ rkey: 'abc', handle: 'dana' }];
  const fetchFn = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(surveys), { status: 200 }));

  await expect(
    load({ fetch: fetchFn } as unknown as Parameters<typeof load>[0]),
  ).resolves.toEqual({ surveys });
});
