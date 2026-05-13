<script lang="ts">
import CloudUploadIcon from '@lucide/svelte/icons/cloud-upload';
import Loader2Icon from '@lucide/svelte/icons/loader-2';
import Trash2Icon from '@lucide/svelte/icons/trash-2';
import WifiOffIcon from '@lucide/svelte/icons/wifi-off';
import { onMount } from 'svelte';
import * as Alert from '$lib/components/alert';
import SurveyCard from '$lib/components/SurveyCard.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import { Badge } from '$lib/components/ui/badge';
import { Button } from '$lib/components/ui/button';
import { useOnline } from '$lib/composables/online.svelte';
import type { PendingSurvey } from '$lib/offline/db';
import { deletePendingSurvey, getPendingSurveys } from '$lib/offline/db';
import { uploadAllPending } from '$lib/offline/upload';
import { hasUnresolvedIncidentals } from '$lib/surveys';

let { data } = $props();

let allPendingSurveys = $state<PendingSurvey[]>([]);
let uploading = $state(false);
let deleteTargetId = $state<number | null>(null);
const online = useOnline();

const inProgressSurveys = $derived(
  allPendingSurveys.filter((s) => !s.complete),
);
const needsAttentionSurveys = $derived(
  allPendingSurveys.filter(
    (s) => s.complete && hasUnresolvedIncidentals(s.incidentals ?? []),
  ),
);
const readyToUpload = $derived(
  allPendingSurveys.filter(
    (s) => s.complete && !hasUnresolvedIncidentals(s.incidentals ?? []),
  ),
);

onMount(() => {
  getPendingSurveys().then(async (pending) => {
    allPendingSurveys = pending;
    if (navigator.onLine && pending.some((s) => s.complete)) {
      await tryUpload();
    }
  });
});

async function tryUpload() {
  uploading = true;
  try {
    await uploadAllPending();
    allPendingSurveys = await getPendingSurveys();
  } finally {
    uploading = false;
  }
}

async function confirmDelete() {
  if (deleteTargetId == null) return;
  await deletePendingSurvey(deleteTargetId);
  allPendingSurveys = allPendingSurveys.filter((s) => s.id !== deleteTargetId);
  deleteTargetId = null;
}
</script>

<main class="mx-auto max-w-2xl px-4 pb-8">
  <h1 class="mb-6 text-2xl font-semibold">Your Surveys</h1>

  {#if inProgressSurveys.length > 0}
    <section class="mb-6">
      <Alert.Root class="border-yellow-500 bg-yellow-50 dark:bg-yellow-950 mb-4">
        <Alert.Title class="flex flex-row gap-2 justify-between items-center">
          <div class="flex items-center gap-2">
            In progress
            <Badge variant="outline">{inProgressSurveys.length}</Badge>
          </div>
        </Alert.Title>
        <Alert.Description>
          <ul class="flex flex-col gap-3 mt-4 mb-2">
            {#each inProgressSurveys as survey (survey.id)}
              {#if survey.id != null}
              <li class="flex items-center gap-2">
                <a
                  href="/app/surveys/new/{survey.protocolRkey}?resumeId={survey.id}"
                  class="min-w-0 flex-1"
                >
                  <SurveyCard {survey} />
                </a>
                <div class="flex flex-col gap-2 justify-between">
                  <a href="/app/surveys/new/{survey.protocolRkey}?resumeId={survey.id}">
                    <Button
                      variant="outline"
                    >
                      Resume
                    </Button>
                  </a>
                  <Button
                    variant="ghost"
                    aria-label="Delete survey"
                    onclick={() => (deleteTargetId = survey.id ?? null)}
                  >
                    <Trash2Icon size={16} />
                    Delete
                  </Button>
                </div>
              </li>
              {/if}
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    </section>
  {/if}

  {#if needsAttentionSurveys.length > 0}
    <section class="mb-6">
      <Alert.Root class="border-yellow-500 bg-yellow-50 dark:bg-yellow-950 mb-4">
        <Alert.Title class="flex flex-row gap-2 justify-between items-center">
          <div class="flex items-center gap-2">
            Needs attention
            <Badge variant="outline">{needsAttentionSurveys.length}</Badge>
          </div>
        </Alert.Title>
        <Alert.Description>
          <p class="text-sm mt-1 mb-3">
            {needsAttentionSurveys.length === 1 ? 'This survey has' : 'These surveys have'} incidentals without taxa and cannot be uploaded until resolved.
          </p>
          <ul class="flex flex-col gap-3 mb-2">
            {#each needsAttentionSurveys as survey (survey.id)}
              {#if survey.id != null}
              <li class="flex items-center gap-2">
                <a
                  href="/app/surveys/new/{survey.protocolRkey}?resumeId={survey.id}"
                  class="min-w-0 flex-1"
                >
                  <SurveyCard {survey} />
                </a>
                <div class="flex flex-col gap-2 justify-between">
                  <a href="/app/surveys/new/{survey.protocolRkey}?resumeId={survey.id}">
                    <Button variant="outline">
                      Resolve
                    </Button>
                  </a>
                  <Button
                    variant="ghost"
                    aria-label="Delete survey"
                    onclick={() => (deleteTargetId = survey.id ?? null)}
                  >
                    <Trash2Icon size={16} />
                    Delete
                  </Button>
                </div>
              </li>
              {/if}
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    </section>
  {/if}

  {#if readyToUpload.length > 0}
    <section class="mb-6">
      <Alert.Root class="border-primary bg-primary/10 text-primary-foreground mb-4">
        <Alert.Title class="flex flex-row gap-2 justify-between">
          <div class="flex items-center gap-2">
            Pending upload
            <Badge>{readyToUpload.length}</Badge>
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
            {readyToUpload.length}
            {readyToUpload.length === 1 ? 'survey' : 'surveys'} waiting to upload
          {/if}

          <ul class="flex flex-col gap-3 mt-4 mb-2">
            {#each readyToUpload as survey (survey.id)}
              <li class="flex items-start gap-2">
                <div class="min-w-0 flex-1">
                  <SurveyCard {survey} />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  class="text-muted-foreground hover:text-destructive shrink-0 mt-1"
                  aria-label="Delete survey"
                  onclick={() => (deleteTargetId = survey.id ?? null)}
                >
                  <Trash2Icon size={16} />
                </Button>
              </li>
            {/each}
          </ul>
        </Alert.Description>
      </Alert.Root>
    </section>
  {/if}

  {#if data.surveys.length === 0 && inProgressSurveys.length === 0 && needsAttentionSurveys.length === 0 && readyToUpload.length === 0}
    <p class="text-muted-foreground text-sm">No surveys yet.</p>
  {:else if data.surveys.length > 0}
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

<AlertDialog.Root
  open={deleteTargetId != null}
  onOpenChange={(open) => { if (!open) deleteTargetId = null; }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete this survey?</AlertDialog.Title>
      <AlertDialog.Description>
        This will permanently remove the survey. This cannot be undone.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Keep it</AlertDialog.Cancel>
      <AlertDialog.Action
        variant="destructive"
        onclick={confirmDelete}
      >
        Delete
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

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
