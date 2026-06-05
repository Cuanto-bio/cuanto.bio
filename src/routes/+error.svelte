<script lang="ts">
import { page } from '$app/state';
import { Button } from '$lib/components/ui/button/index.js';
import * as Card from '$lib/components/ui/card';

// SvelteKit renders this for any uncaught error that bubbles up to a route,
// including the OAuth callback failing (expired state, PDS unreachable). It
// replaces the framework's bare fallback page.
const isNotFound = $derived(page.status === 404);

const title = $derived(isNotFound ? 'Page not found' : 'Something went wrong');

const description = $derived(
  isNotFound
    ? "We couldn't find the page you were looking for."
    : page.status >= 500
      ? "We hit an unexpected error. This isn't your fault. Try again, and if " +
        'it keeps happening, let us know.'
      : (page.error?.message ?? 'An unexpected error occurred.'),
);
</script>

<div class="flex-1 flex items-center justify-center">
  <Card.Root class="w-96">
    <Card.Header>
      <Card.Title>{title}</Card.Title>
      <Card.Description>{description}</Card.Description>
    </Card.Header>
    <Card.Footer class="flex flex-col gap-2">
      {#if !isNotFound && page.status >= 500}
        <Button class="w-full" onclick={() => location.reload()}>
          Try again
        </Button>
      {/if}
      <Button variant="outline" class="w-full" href="/">Go home</Button>
    </Card.Footer>
  </Card.Root>
</div>
