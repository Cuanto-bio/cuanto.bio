<script lang="ts">
import { onMount } from 'svelte';
import { toast } from 'svelte-sonner';
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

let migrating = $state(false);
let migrationDone = $state(false);

const showMigrationBanner = $derived(
  !migrationDone && page.data.needsLexiconMigration === true,
);

// The migration runs in the background on the server; poll /api/me until the
// needs_lexicon_migration flag clears (or give up after ~5 minutes).
async function pollUntilMigrated() {
  for (let i = 0; i < 75; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const res = await fetch('/api/me');
      if (res.ok) {
        const me = (await res.json()) as { needsLexiconMigration?: boolean };
        if (!me.needsLexiconMigration) {
          migrationDone = true;
          toast.success('Your records have been updated.');
          return;
        }
      }
    } catch {
      // transient network error — keep polling
    }
  }
  toast.info('Still updating your records. This may take a few minutes.');
}

async function migrateRecords() {
  migrating = true;
  try {
    const res = await fetch('/api/migrate-lexicons', { method: 'POST' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 401 && body.error === 'pds_session_expired') {
        toast.error('Your session expired. Please sign in again to update.');
        return;
      }
      throw new Error(`Update failed (${res.status})`);
    }
    // 202: started in the background. Poll until the server clears the flag.
    await pollUntilMigrated();
  } catch (err) {
    toast.error(String(err));
  } finally {
    migrating = false;
  }
}
</script>

{#if showMigrationBanner}
  <div class="mx-4 my-2">
    <Alert.Root class="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
      <Alert.Title
        class="flex items-center justify-between gap-2 text-yellow-800 dark:text-yellow-200"
      >
        <span>Some of your records use an outdated format.</span>
        <button
          type="button"
          class="font-medium underline disabled:opacity-50"
          onclick={migrateRecords}
          disabled={migrating}
        >
          {migrating ? 'Updating…' : 'Update now'}
        </button>
      </Alert.Title>
    </Alert.Root>
  </div>
{/if}

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
