<script lang="ts">
import * as Card from '$lib/components/ui/card';
import type { Protocol } from '$lib/offline/db';
import Handle from './handle.svelte';

let { protocol }: { protocol: Protocol } = $props();
</script>

<Card.Root class="hover:bg-muted transition-colors">
  <Card.Header>
    <Card.Title>{protocol.record.title}</Card.Title>
  </Card.Header>
  <Card.Content>
    <Card.Description>{protocol.record.description}</Card.Description>
  </Card.Content>
  <Card.Footer class="flex flex-row justify-between">
    <Handle handle={protocol.handle} avatarUrl={protocol.avatarUrl} />
    <div class="text-muted-foreground">
      {protocol.targets.length} targets
    </div>
  </Card.Footer>
</Card.Root>
