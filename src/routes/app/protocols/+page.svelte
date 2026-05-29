<script lang="ts">
import ProtocolCard from '$lib/components/ProtocolCard.svelte';
import { useOnline } from '$lib/composables/online.svelte';

let { data } = $props();
const online = useOnline();
</script>

<main>
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">Protocols</h1>
    {#if online.value}
      <a href="/protocols/new" class="text-primary text-sm underline">New protocol</a>
    {/if}
  </div>

  {#if data.protocols.length === 0}
    <p class="text-muted-foreground text-sm">No protocols yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.protocols as protocol (protocol.atUri)}
        <li>
          <a href="/app/protocols/{protocol.handle}/{protocol.rkey}">
            <ProtocolCard protocol={protocol} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
