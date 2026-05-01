<script lang="ts">
import Handle from '$lib/components/handle.svelte';
import ProtocolCard from '$lib/components/ProtocolCard.svelte';
import * as Card from '$lib/components/ui/card';

let { data } = $props();
</script>

<main class="mx-auto max-w-2xl px-4 pb-8">
  <h1 class="mb-6 text-2xl font-semibold">Followed Protocols</h1>

  {#if data.follows.length === 0}
    <p class="text-muted-foreground text-sm">You haven't followed any protocols yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.follows as protocol (protocol.atUri)}
        <li>
          <a href="/app/protocols/{protocol.handle}/{protocol.rkey}">
            <ProtocolCard protocol={protocol} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
