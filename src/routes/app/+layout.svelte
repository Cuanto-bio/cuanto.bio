<script lang="ts">
import { onMount } from 'svelte';
import { afterNavigate } from '$app/navigation';
import { page } from '$app/state';
import * as Alert from '$lib/components/alert';
import type { PendingSurvey } from '$lib/offline/db';
import { getPendingSurveys } from '$lib/offline/db';

let { children } = $props();

let inProgressSurveys = $state<PendingSurvey[]>([]);

async function refresh() {
  const all = await getPendingSurveys();
  inProgressSurveys = all.filter((s) => !s.complete);
}

onMount(refresh);
afterNavigate(refresh);

const showBanner = $derived(
  inProgressSurveys.length > 0 &&
    !page.url.pathname.startsWith('/app/surveys/new/') &&
    page.url.pathname !== '/app/surveys',
);

const resumeHref = $derived(
  inProgressSurveys.length === 1
    ? `/app/surveys/new/${inProgressSurveys[0].protocolRkey}?resumeId=${inProgressSurveys[0].id}`
    : '/app/surveys',
);
</script>

{#if showBanner}
  <div class="mx-4 my-2">
    <Alert.Root class="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
      <Alert.Title class="flex items-center justify-between text-yellow-800 dark:text-yellow-200">
        <span>
          {inProgressSurveys.length === 1
            ? 'You have a survey in progress'
            : `You have ${inProgressSurveys.length} surveys in progress`}
        </span>
        <a href={resumeHref} class="font-medium underline">
          {inProgressSurveys.length === 1 ? 'Resume' : 'View surveys'}
        </a>
      </Alert.Title>
    </Alert.Root>
  </div>
{/if}

{@render children()}
