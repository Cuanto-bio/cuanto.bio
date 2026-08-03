<script lang="ts">
import ProtocolCard from '$lib/components/ProtocolCard.svelte';
import { useOnline } from '$lib/composables/online.svelte';
import type { Protocol } from '$lib/offline/db';

let { data } = $props();
const online = useOnline();

// Render the cached list immediately, then swap in the fresh one when the
// network fetch settles. Resolves to undefined when the fetch failed, in which
// case the cached list stands. The `current` guard matches the protocol detail
// route: this component is reused across navigations, so a slow fetch from a
// previous visit must not overwrite the list we're on now.
let fresh = $state<Protocol[] | undefined>(undefined);

$effect(() => {
  const next = data.freshProtocols;
  fresh = undefined;
  let current = true;
  next.then((value) => {
    if (!current) return;
    fresh = value;
  });
  return () => {
    current = false;
  };
});

const protocols = $derived(fresh ?? data.protocols);
</script>

<main>
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">Protocols</h1>
    {#if online.value}
      <a href="/protocols/new" class="text-primary text-sm underline">New protocol</a>
    {/if}
  </div>

  {#if protocols.length === 0}
    <p class="text-muted-foreground text-sm">No protocols yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each protocols as protocol (protocol.atUri)}
        <li>
          <a href="/app/protocols/{protocol.handle}/{protocol.rkey}">
            <ProtocolCard protocol={protocol} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
