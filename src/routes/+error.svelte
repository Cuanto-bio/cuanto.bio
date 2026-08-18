<script lang="ts">
import { invalidateAll } from '$app/navigation';
import { page } from '$app/state';
import { Button } from '$lib/components/ui/button/index.js';
import * as Card from '$lib/components/ui/card';
import { useOnline } from '$lib/composables/online.svelte';
import { errorText } from '$lib/error-text';
import { isNative } from '$lib/platform';

// SvelteKit renders this for any uncaught error that bubbles up to a route,
// including the OAuth callback failing (expired state, PDS unreachable) and any
// navigation to a route the service worker has not cached while offline. It
// replaces the framework's bare fallback page.

// The same signal the layout's "You're offline" banner uses, rather than
// navigator.onLine: it polls /api/ping, so it is also false on a network that
// is connected but cannot reach us — the shape of the failure in issue #53.
const online = useOnline();

const copy = $derived(
  errorText({
    status: page.status,
    message: page.error?.message,
    offline: !online.value,
    native: isNative(),
  }),
);
</script>

<div class="flex-1 flex items-center justify-center">
  <Card.Root class="w-96">
    <Card.Header>
      <Card.Title>{copy.title}</Card.Title>
      <Card.Description>{copy.description}</Card.Description>
    </Card.Header>
    <Card.Footer class="flex flex-col gap-2">
      {#if copy.retry}
        <Button
          class="w-full"
          onclick={() =>
            copy.retry === 'revalidate' ? invalidateAll() : location.reload()}
        >
          Try again
        </Button>
      {/if}
      <Button variant="outline" class="w-full" href={copy.homeHref}>
        Go home
      </Button>
    </Card.Footer>
  </Card.Root>
</div>
