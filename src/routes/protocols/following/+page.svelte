<script lang="ts">
import * as Card from '$lib/components/ui/card';

let { data } = $props();
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <h1 class="mb-6 text-2xl font-semibold">Following</h1>

  {#if data.follows.length === 0}
    <p class="text-muted-foreground text-sm">You haven't followed any protocols yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.follows as follow (follow.at_uri)}
        <li>
          <a href="/protocols/{follow.handle}/{follow.protocol_rkey}">
            <Card.Root class="hover:bg-muted transition-colors">
              <Card.Header>
                <Card.Title>{follow.protocol_title}</Card.Title>
                <Card.Description>{follow.protocol_description}</Card.Description>
              </Card.Header>
              <Card.Content>
                <div class="text-muted-foreground text-sm">
                  <span>by @{follow.handle}</span>
                </div>
              </Card.Content>
            </Card.Root>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>
