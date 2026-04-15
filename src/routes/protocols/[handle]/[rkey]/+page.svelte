<script lang="ts">
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';

let { data } = $props();

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <div class="mb-6 flex justify-end">
    <Button href="/surveys/new/{data.protocol.at_uri.split('/').at(-1)}">Start Survey</Button>
  </div>

  <Card.Root class="mb-6">
    <Card.Header>
      <Card.Title>{data.protocol.title}</Card.Title>
      <Card.Description>{data.protocol.description}</Card.Description>
    </Card.Header>
    <Card.Content class="space-y-2 text-sm">
      <div>
        <span class="text-muted-foreground font-medium">AT URI:</span>
        <span class="font-mono ml-2">{data.protocol.at_uri}</span>
      </div>
      <div>
        <span class="text-muted-foreground font-medium">Created:</span>
        <span class="ml-2">{formatDate(data.protocol.created_at)}</span>
      </div>
      {#if data.protocol.required_fields.length > 0}
        <div>
          <span class="text-muted-foreground font-medium">Required fields:</span>
          <ul class="ml-4 mt-1 list-disc">
            {#each data.protocol.required_fields as field}
              <li>{field}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <h2 class="mb-3 text-lg font-semibold">
    Targets ({data.targets.length})
  </h2>

  {#if data.targets.length === 0}
    <p class="text-muted-foreground text-sm">No targets.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.targets as target (target.at_uri)}
        <li>
          <Card.Root>
            <Card.Content class="pt-4 text-sm space-y-2">
              <div>
                <span class="text-muted-foreground font-medium">AT URI:</span>
                <span class="font-mono ml-2">{target.at_uri}</span>
              </div>
              <div>
                <span class="text-muted-foreground font-medium">Scope:</span>
                <pre class="bg-muted mt-1 rounded p-2 text-xs overflow-auto">{JSON.stringify(target.scope, null, 2)}</pre>
              </div>
            </Card.Content>
          </Card.Root>
        </li>
      {/each}
    </ul>
  {/if}
</main>
