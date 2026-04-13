<script lang="ts">
import * as Card from '$lib/components/ui/card';

let { data } = $props();
</script>

<main class="flex min-h-screen items-center justify-center">
  <Card.Root class="w-96">
    <Card.Header>
      <Card.Title>Cuanto.bio</Card.Title>
      <Card.Description>Count organisms. Do science.</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if data.did}
        <p class="text-sm">Signed in as <span class="font-mono">{data.did}</span></p>
        <div class="mt-4">
          <a href="/protocols" class="text-primary text-sm underline">Your protocols</a>
        </div>
      {:else}
        <p class="text-muted-foreground text-sm">
          A tool for participatory biological surveys. Researchers create protocols; volunteers
          complete surveys.
        </p>
        <div class="mt-4">
          <a href="/auth/signin" class="text-primary text-sm underline">Sign in</a>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
