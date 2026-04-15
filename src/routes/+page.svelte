<script lang="ts">
import * as Card from '$lib/components/ui/card';

let { data } = $props();
</script>

<main class="flex items-center justify-center py-16">
  <Card.Root class="w-96">
    <Card.Header>
      <Card.Title>Cuanto.bio</Card.Title>
      <Card.Description>Count organisms. Do science.</Card.Description>
    </Card.Header>
    <Card.Content>
      <p class="text-muted-foreground text-sm">
        A tool for participatory biological surveys. Researchers create protocols; volunteers
        complete surveys.
      </p>
    </Card.Content>
  </Card.Root>
</main>
