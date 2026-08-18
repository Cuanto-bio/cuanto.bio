<script lang="ts">
import { onMount } from 'svelte';
import { toast } from 'svelte-sonner';
import { Badge } from '$lib/components/ui/badge';
import { Button } from '$lib/components/ui/button';
import {
  clearDiagnostics,
  type DiagnosticEntry,
  getDiagnostics,
} from '$lib/offline/db';

const title = 'Log';

// null while the first read is in flight, which is not the same as an empty log
// — "nothing recorded" is the good news this page exists to deliver, so it must
// not flash before we know it.
let entries = $state<DiagnosticEntry[] | null>(null);

async function load() {
  // Newest first: whatever just went wrong is what someone came here to read.
  entries = (await getDiagnostics()).reverse();
}

onMount(load);

async function clear() {
  await clearDiagnostics();
  await load();
}

async function copy() {
  const text = (entries ?? [])
    .map((e) => `${new Date(e.at).toISOString()}\t${e.kind}\t${e.message}`)
    .join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied. Paste it into an issue or a message.');
  } catch {
    // Denied permission, or an insecure context. Nothing is broken; the log is
    // still on screen to read.
    toast.error('Could not copy. The log is still readable below.');
  }
}
</script>

<svelte:head>
  <title>{title}</title>
</svelte:head>

<main class="mx-auto max-w-2xl px-4 py-8">
  <h1>{title}</h1>
  <p class="text-muted-foreground">
    Debugging info. Sign out to clear.
  </p>

  {#if entries === null}
    <p class="text-muted-foreground mt-6 text-sm">Reading the log…</p>
  {:else if entries.length === 0}
    <p class="mt-6">Nothing recorded, which is what you want to see here.</p>
  {:else}
    <div class="mt-6 flex gap-2">
      <Button variant="outline" size="sm" onclick={copy}>Copy</Button>
      <Button variant="outline" size="sm" onclick={clear}>Clear</Button>
    </div>
    <ul class="mt-4">
      {#each entries as entry (entry.id)}
        <li class="border-t py-3">
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant={entry.kind === 'visibility' ? 'secondary' : 'destructive'}>
              {entry.kind}
            </Badge>
            <time class="text-muted-foreground text-xs" datetime={new Date(entry.at).toISOString()}>
              {new Date(entry.at).toLocaleString()}
            </time>
          </div>
          <p class="mt-1 font-mono text-xs whitespace-pre-wrap break-words">{entry.message}</p>
        </li>
      {/each}
    </ul>
  {/if}
</main>
