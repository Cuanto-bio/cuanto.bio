<script lang="ts">
import { onMount } from 'svelte';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { useOnline } from '$lib/composables/online.svelte';
import type { PendingSurvey } from '$lib/offline/db';
import { getPendingSurveys } from '$lib/offline/db';
import { uploadAllPending } from '$lib/offline/upload';

let surveys = $state<PendingSurvey[]>([]);
let uploading = $state(false);
const online = useOnline();

onMount(() => {
  getPendingSurveys().then(async (pending) => {
    surveys = pending;
    if (navigator.onLine && pending.length > 0) {
      await tryUpload();
    }
  });
});

async function tryUpload() {
  uploading = true;
  try {
    await uploadAllPending();
    surveys = await getPendingSurveys();
  } finally {
    uploading = false;
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <div class="mb-6 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">Pending Surveys</h1>
    {#if online.value && surveys.length > 0}
      <Button onclick={tryUpload} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload all'}
      </Button>
    {/if}
  </div>

  {#if surveys.length === 0}
    <p class="text-muted-foreground text-sm">No pending surveys.</p>
  {:else}
    {#if !online.value}
      <p class="text-muted-foreground mb-4 text-sm">
        You're offline. Surveys will upload when you reconnect.
      </p>
    {/if}
    <ul class="flex flex-col gap-3">
      {#each surveys as survey (survey.id)}
        <li>
          <Card.Root>
            <Card.Header>
              <Card.Title>{survey.locationName}</Card.Title>
              <Card.Description>{formatDate(survey.createdAt)}</Card.Description>
            </Card.Header>
            <Card.Content class="text-muted-foreground text-sm">
              <span>{survey.occurrences.length} target(s) recorded</span>
            </Card.Content>
          </Card.Root>
        </li>
      {/each}
    </ul>
  {/if}
</main>
