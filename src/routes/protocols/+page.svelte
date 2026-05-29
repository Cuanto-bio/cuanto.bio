<script lang="ts">
import ProtocolCard from '$lib/components/ProtocolCard.svelte';
import { Button } from '$lib/components/ui/button/index.js';

let { data } = $props();
</script>

<main>
  <div class="flex justify-between">
    <h1 class="mb-6 text-2xl font-semibold">Protocols</h1>
    <Button href="/protocols/new">
      New Protocol
    </Button>
  </div>

  {#if data.protocols.length === 0}
    <p class="text-muted-foreground text-sm">No protocols yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.protocols as protocol (protocol.atUri)}
        <li>
          <a href="/protocols/{protocol.handle}/{protocol.rkey}">
            <ProtocolCard protocol={protocol} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
