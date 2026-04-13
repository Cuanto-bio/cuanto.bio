<script lang="ts">
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';

let { data } = $props();
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">Your Protocols</h1>
    <Button href="/protocols/new">New Protocol</Button>
  </div>

  {#if data.protocols.length === 0}
    <p class="text-muted-foreground text-sm">
      No protocols yet. <a href="/protocols/new" class="text-primary underline">Create one.</a>
    </p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.protocols as protocol (protocol.at_uri)}
        {@const rkey = protocol.at_uri.split('/').at(-1)}
        <li>
          <a href="/protocols/{rkey}">
            <Card.Root class="hover:bg-muted transition-colors">
              <Card.Header>
                <Card.Title>{protocol.title}</Card.Title>
                <Card.Description>{protocol.description}</Card.Description>
              </Card.Header>
              <Card.Content>
                <p class="text-muted-foreground text-sm">
                  {protocol.target_count}
                  {protocol.target_count === 1 ? 'target' : 'targets'}
                </p>
              </Card.Content>
            </Card.Root>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
