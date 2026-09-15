<script lang="ts">
import { Badge } from '$lib/components/ui/badge';
import * as Card from '$lib/components/ui/card';
import type { Protocol } from '$lib/offline/db';
import { stripHtml } from '$lib/sanitize';
import Handle from './handle.svelte';

let { protocol }: { protocol: Protocol } = $props();
</script>

<Card.Root class="hover:bg-muted transition-colors">
  <Card.Header>
    <Card.Title class="flex items-center gap-2">
      {protocol.record.title}
      {#if protocol.deletedAt}
        <Badge variant="gone">Deleted</Badge>
      {/if}
    </Card.Title>
  </Card.Header>
  {#if !protocol.deletedAt}
    <Card.Content>
      <Card.Description>{stripHtml(protocol.record.description ?? '')}</Card.Description>
    </Card.Content>
  {/if}
  <Card.Footer class="flex flex-row justify-between">
    <Handle handle={protocol.handle} avatarUrl={protocol.avatarUrl} />
    <div class="text-muted-foreground">
      {protocol.targets.length} targets
    </div>
  </Card.Footer>
</Card.Root>
