<script lang="ts">
import * as Card from '$lib/components/ui/card';
import { useOnline } from '$lib/composables/online.svelte';

let { data } = $props();
const online = useOnline();
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
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
      {#each data.protocols as protocol (protocol.at_uri)}
        <li>
          <a href="/app/protocols/{protocol.handle}/{protocol.rkey}">
            <Card.Root class="hover:bg-muted transition-colors">
              <Card.Header>
                <Card.Title>{protocol.title}</Card.Title>
                <Card.Description>{protocol.description}</Card.Description>
              </Card.Header>
              <Card.Content>
                <div class="text-muted-foreground flex gap-4 text-sm">
                  <span>by @{protocol.handle}</span>
                </div>
              </Card.Content>
            </Card.Root>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
