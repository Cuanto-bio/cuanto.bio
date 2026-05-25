<script lang="ts">
import { onMount } from 'svelte';
import { page } from '$app/state';
import SurveyForm from '$lib/components/SurveyForm.svelte';
import {
  type CachedProtocol,
  getCachedProtocolByRkey,
  getPendingSurveyById,
  type PendingSurvey,
} from '$lib/offline/db';

let protocol = $state<CachedProtocol | null>(null);
let notFound = $state(false);
let resumeState = $state<PendingSurvey | undefined>(undefined);
let resumeId = $state<number | null>(null);
let ready = $state(false);
const defaultMode = $derived(
  page.url.searchParams.get('past') === '1'
    ? ('past' as const)
    : ('now' as const),
);

onMount(() => {
  const rkey = page.params.protocolRkey ?? '';
  const resumeIdParam = page.url.searchParams.get('resumeId');

  getCachedProtocolByRkey(rkey).then(async (cached) => {
    if (cached) {
      protocol = cached;
      if (resumeIdParam != null) {
        const saved = await getPendingSurveyById(parseInt(resumeIdParam, 10));
        if (saved) {
          resumeId = saved.id ?? null;
          resumeState = saved;
        }
      }
    } else {
      notFound = true;
    }
    ready = true;
  });
});
</script>

{#if notFound}
  <main class="mx-auto max-w-2xl px-4 pb-8">
    {#if page.url.searchParams.get('resumeId')}
      <p class="text-muted-foreground text-sm">
        This survey's protocol is no longer cached.
        <a href="/app/surveys" class="text-primary underline">Go to Your Surveys</a>
        to delete the draft.
      </p>
    {:else}
      <p class="text-muted-foreground text-sm">
        Protocol not cached. Visit the protocol page while online to enable offline surveys.
      </p>
    {/if}
  </main>
{:else if !ready || !protocol}
  <main class="mx-auto max-w-2xl px-4 pb-8">
    <p class="text-muted-foreground text-sm">Loading…</p>
  </main>
{:else}
  <SurveyForm
    {protocol}
    {defaultMode}
    initialPendingSurveyId={resumeId}
    initialResumeState={resumeState}
  />
{/if}
