<script lang="ts">
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import HomeHero from '$lib/components/HomeHero.svelte';

// Signed in: /app is just a landing spot, send them to their real home.
// Signed out: /app is the wrapper's launch target and the one route the
// service worker caches for offline launch (see +layout.ts, service-worker.ts),
// so it renders the same content as `/` instead of forcing a redirect to
// /app/signin — sign-in stays reachable from the nav.
onMount(() => {
  if (page.data.did) {
    goto('/app/protocols/following', { replaceState: true });
  }
});
</script>

{#if !page.data.did}
  <HomeHero />
{/if}
