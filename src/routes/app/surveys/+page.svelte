<script lang="ts">
import CloudUploadIcon from '@lucide/svelte/icons/cloud-upload';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import WifiOffIcon from '@lucide/svelte/icons/wifi-off';
import { onMount } from 'svelte';
import SurveyCard from '$lib/components/SurveyCard.svelte';
import * as Alert from '$lib/components/ui/alert';
import { Badge } from '$lib/components/ui/badge';
import { Button } from '$lib/components/ui/button';
import { Separator } from '$lib/components/ui/separator';
import { useOnline } from '$lib/composables/online.svelte';
import type { PendingSurvey } from '$lib/offline/db';
import { getPendingSurveys } from '$lib/offline/db';
import { uploadAllPending } from '$lib/offline/upload';

let { data } = $props();

let pendingSurveys = $state<PendingSurvey[]>([]);
let uploading = $state(false);
const online = useOnline();

onMount(() => {
  getPendingSurveys().then(async (pending) => {
    pendingSurveys = pending;
    if (navigator.onLine && pending.length > 0) {
      await tryUpload();
    }
  });
});

async function tryUpload() {
  uploading = true;
  try {
    await uploadAllPending();
    pendingSurveys = await getPendingSurveys();
  } finally {
    uploading = false;
  }
}
</script>

<main class="mx-auto max-w-2xl px-4 pb-8">
  <h1 class="mb-6 text-2xl font-semibold">Your Surveys</h1>

  {#if pendingSurveys.length > 0}
    <section class="mb-6">
      <Alert.Root class="border-primary bg-primary/10 text-primary-foreground mb-4">
        <Alert.Title class="flex flex-row gap-2 justify-between">
          <div class="flex items-center gap-2">
            Pending upload
            <Badge>{pendingSurveys.length}</Badge>
          </div>
          {#if online.value}
            <Button
              onclick={tryUpload}
              disabled={uploading}
              size="sm"
              variant="outline"
              class="shrink-0 border-primary/40 text-primary-foreground hover:bg-primary/20"
            >
              <span class:nudge={!uploading}>
                {#if uploading}
                  <Loader2Icon class="spin" />
                {:else}
                  <CloudUploadIcon />
                {/if}
              </span>
              {uploading ? 'Uploading…' : 'Upload all'}
            </Button>
          {/if}
        </Alert.Title>
        <Alert.Description class="text-primary-foreground/80">
          {#if !online.value}
            <span class="inline-flex items-center gap-1">
              <WifiOffIcon size={12} />
              Offline — will sync when you reconnect
            </span>
          {:else}
            {pendingSurveys.length}
            {pendingSurveys.length === 1 ? 'survey' : 'surveys'} waiting to upload
          {/if}

          <ul class="flex flex-col gap-3 mt-4 mb-2">
            {#each pendingSurveys as survey (survey.id)}
              <li>
                <SurveyCard survey={survey} />
              </li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    </section>
  {/if}

  {#if data.surveys.length === 0}
    <p class="text-muted-foreground text-sm">No surveys yet.</p>
  {:else}
    <ul class="flex flex-col gap-3">
      {#each data.surveys as survey (survey.atUri)}
        <li>
          <a href="/app/surveys/{survey.handle}/{survey.rkey}">
            <SurveyCard survey={survey} />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .nudge {
    animation: nudge 2.4s ease-in-out infinite;
    display: inline-flex;
  }

  :global(.spin) {
    animation: spin 0.9s linear infinite;
  }

  @keyframes nudge {
    0%, 100% { transform: translateY(0); }
    40%       { transform: translateY(-3px); }
    60%       { transform: translateY(-1px); }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
