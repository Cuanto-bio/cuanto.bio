<script lang="ts">
import * as Card from '$lib/components/ui/card';

let { data } = $props();
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <h1 class="mb-6 text-2xl font-semibold">Protocols</h1>

  {#if data.protocols.length === 0}
    <p class="text-muted-foreground text-sm">No protocols yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.protocols as protocol (protocol.at_uri)}
        <li>
          <a href="/protocols/{protocol.handle}/{protocol.rkey}">
            <Card.Root class="hover:bg-muted transition-colors">
              <Card.Header>
                <Card.Title>{protocol.title}</Card.Title>
                <Card.Description>{protocol.description}</Card.Description>
              </Card.Header>
              <Card.Content>
                <div class="text-muted-foreground flex gap-4 text-sm">
                  <span>by @{protocol.handle}</span>
                  <span>
                    {protocol.target_count}
                    {protocol.target_count === 1 ? 'target' : 'targets'}
                  </span>
                </div>
              </Card.Content>
            </Card.Root>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
