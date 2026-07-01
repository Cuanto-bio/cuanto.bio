<script lang="ts">
import type { SubmitFunction } from '@sveltejs/kit';
import Autocomplete from '$lib/components/Autocomplete.svelte';
import Button from '$lib/components/Button.svelte';
import Form from '$lib/components/Form.svelte';
import * as Alert from '$lib/components/ui/alert';
import * as Card from '$lib/components/ui/card';
import { isLikelyIdentifier, sanitizeHandleInput } from '$lib/handle';
import type { ActionData } from './$types';

interface Actor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

let { form }: { form: ActionData } = $props();

// Repopulate the field with what the user submitted so a failed attempt
// doesn't wipe their input. We deliberately seed from `form` only on first
// render (it matters for the no-JS fallback, where the page re-renders fresh;
// with JS, enhance preserves the typed value).
// svelte-ignore state_referenced_locally -- intentional: seed from server action for no-JS fallback
let handle = $state(form?.handle ?? '');
let suggestions = $state<Actor[]>([]);

// Selecting a suggestion sets `handle` to the picked actor's full handle,
// which would otherwise re-trigger the search effect below and pop the
// dropdown right back open over the field the user just finished with.
// Plain (non-reactive) flag: it must not itself be a dependency of the
// effect, or resetting it would retrigger the effect a second time, by
// which point the flag is already consumed and the search runs anyway.
let skipNextSearch = false;

// Error shown beneath the field: either a client-side catch (before we waste a
// round trip) or the server's response. clientError is reset at the start of
// each submit; the server message is replaced on the next attempt.
let clientError = $state('');
const error = $derived(clientError || form?.message);

const onEnhance: SubmitFunction = ({ formData, cancel }) => {
  const normalized = sanitizeHandleInput(String(formData.get('handle') ?? ''));
  if (!isLikelyIdentifier(normalized)) {
    clientError =
      "That doesn't look like an Atmosphere handle. Use your full handle, " +
      'e.g. you.bsky.social.';
    cancel();
    return;
  }
  clientError = '';
  // Send the cleaned handle so the server resolves the same thing we validated.
  formData.set('handle', normalized);
};

// Could also use public.api.bsky.app, but this replacement includes handles
// that might be excluded from the bsky index for reasons other than bad
// behavior. One downside is that the index doesn't include accounts that
// have been inactive since the index was made. See
// https://typeahead.waow.tech/docs
const TYPEAHEAD_URL = 'typeahead.waow.tech';
// const TYPEAHEAD_URL = 'public.api.bsky.app';

$effect(() => {
  if (skipNextSearch) {
    skipNextSearch = false;
    suggestions = [];
    return;
  }
  if (handle.length < 2) {
    suggestions = [];
    return;
  }
  const url = new URL(
    `https://${TYPEAHEAD_URL}/xrpc/app.bsky.actor.searchActorsTypeahead`,
  );
  url.searchParams.set('q', handle);
  url.searchParams.set('limit', '5');
  const timer = setTimeout(async () => {
    const resp = await fetch(url, {
      headers: { 'X-Client': 'Cuanto.bio' },
    });
    if (!resp.ok) return;
    const data = await resp.json();
    suggestions = data.actors ?? [];
  }, 200);
  return () => clearTimeout(timer);
});
</script>

<div class="flex-1 flex items-center justify-center">
  <Card.Root class="w-96">
    <Card.Header>
      <Card.Title>Sign in</Card.Title>
      <Card.Description>Enter your Atmosphere handle to continue.</Card.Description>
    </Card.Header>
    <Card.Content>
      <Form method="POST" {onEnhance} class="flex flex-col gap-4">
        {#if error}
          <Alert.Root variant="destructive">
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        {/if}
        <Autocomplete
          type="text"
          name="handle"
          placeholder="E.g. you.bsky.social"
          autocomplete="username"
          required
          bind:value={handle}
          items={suggestions}
          onselect={(actor) => {
            skipNextSearch = true;
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
      </Form>
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
</div>
