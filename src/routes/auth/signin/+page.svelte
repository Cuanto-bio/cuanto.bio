<script lang="ts">
import Autocomplete from '$lib/components/Autocomplete.svelte';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';

interface Actor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

let handle = $state('');
let suggestions = $state<Actor[]>([]);

$effect(() => {
  if (handle.length < 2) {
    suggestions = [];
    return;
  }
  const url = new URL(
    'https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead',
  );
  url.searchParams.set('q', handle);
  url.searchParams.set('limit', '5');
  const timer = setTimeout(async () => {
    const resp = await fetch(url);
    if (!resp.ok) return;
    const data = await resp.json();
    suggestions = data.actors ?? [];
  }, 200);
  return () => clearTimeout(timer);
});
</script>

<main class="flex min-h-screen items-center justify-center">
  <Card.Root class="w-96">
    <Card.Header>
      <Card.Title>Sign in</Card.Title>
      <Card.Description>Enter your Atmosphere handle to continue.</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="POST" class="flex flex-col gap-4">
        <Autocomplete
          type="text"
          name="handle"
          placeholder="E.g. you.bsky.social"
          autocomplete="username"
          required
          bind:value={handle}
          items={suggestions}
          onselect={(actor) => {
            handle = actor.handle;
          }}
        >
          {#snippet item(actor, isActive)}
            {#if actor.avatar}
              <img src={actor.avatar} alt="" class="h-6 w-6 rounded-full" />
            {:else}
              <div class="h-6 w-6 rounded-full bg-muted"></div>
            {/if}
            <div class="flex flex-col items-start">
              <span class="text-muted-foreground">@{actor.handle}</span>
              {#if actor.displayName}
                <span class="font-medium">{actor.displayName}</span>
              {/if}
            </div>
          {/snippet}
        </Autocomplete>
        <Button type="submit">Sign in</Button>
      </form>
    </Card.Content>
    <Card.Footer>
      <Card.Description>
        Not in the Atmosphere? Sign up for an account with
        <a href="https://blacksky.app/account">Blacksky</a>,
        <a href="https://portal.eurosky.tech/create-account">Eurosky</a>,
        <a href="https://bsky.app">Bluesky</a>, or another place to store your data in the Atmosphere!
      </Card.Description>
    </Card.Footer>
  </Card.Root>
</main>
