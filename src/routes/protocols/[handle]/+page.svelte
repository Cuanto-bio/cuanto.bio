<script lang="ts">
import ProtocolCard from '$lib/components/ProtocolCard.svelte';

let { data } = $props();
</script>

<main class="mx-auto max-w-2xl px-4 pb-8">
  <h1 class="mb-6 text-2xl font-semibold">@{data.handle}'s Protocols</h1>

  {#if data.protocols.length === 0}
    <p class="text-muted-foreground text-sm">No protocols yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.protocols as protocol (protocol.atUri)}
        <li>
          <a href="/protocols/{data.handle}/{protocol.rkey}">
            <ProtocolCard protocol={protocol} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
