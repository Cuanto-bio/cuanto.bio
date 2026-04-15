<script lang="ts">
import { onMount } from 'svelte';
import { Button } from '$lib/components/ui/button';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';

let { data } = $props();

let startedAt = $state(0);
let elapsedSeconds = $state(0);
let counts = $state<Record<string, number>>({});
let latitude = $state<string | null>(null);
let longitude = $state<string | null>(null);

onMount(() => {
  startedAt = Date.now();

  const id = setInterval(() => {
    elapsedSeconds++;
  }, 1000);

  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        latitude = String(pos.coords.latitude);
        longitude = String(pos.coords.longitude);
      },
      () => {},
    );
  }

  return () => clearInterval(id);
});

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

function targetLabel(scope: unknown[]): string {
  const first = scope[0] as Record<string, string> | undefined;
  if (!first) return 'Unknown target';
  if (first.$type?.endsWith('#taxonScope'))
    return first.scientificName ?? 'Unknown';
  if (first.$type?.endsWith('#verbatimScope'))
    return first.verbatimTargetScope ?? 'Unknown';
  return 'Unknown target';
}

function targetTaxonID(scope: unknown[]): string | undefined {
  const first = scope[0] as Record<string, string> | undefined;
  if (first?.$type?.endsWith('#taxonScope')) return first.taxonID;
  return undefined;
}

function increment(uri: string) {
  counts[uri] = (counts[uri] ?? 0) + 1;
}

function decrement(uri: string) {
  counts[uri] = Math.max(0, (counts[uri] ?? 0) - 1);
}

function occurrencesJson(): string {
  return JSON.stringify(
    data.targets.map((t) => ({
      surveyTargetUri: t.at_uri,
      taxonID: targetTaxonID(t.scope as unknown[]),
      count: counts[t.at_uri] ?? 0,
    })),
  );
}
</script>

<main class="mx-auto max-w-2xl px-4 py-8">
  <div class="mb-6 flex items-start justify-between">
    <div>
      <h1 class="text-xl font-semibold">{data.protocol.title}</h1>
      <a
        href="/protocols/{data.protocol.handle}/{data.protocol.rkey}"
        class="text-muted-foreground text-sm underline"
      >← Protocol</a>
    </div>
    <div class="font-mono text-3xl tabular-nums">{formatElapsed(elapsedSeconds)}</div>
  </div>

  <form method="POST">
    <div class="mb-6 flex flex-col gap-2">
      <Label for="locationName">Location</Label>
      <Input
        id="locationName"
        name="locationName"
        required
        placeholder="e.g. Mission Dolores Park"
      />
    </div>

    {#if data.targets.length === 0}
      <p class="text-muted-foreground mb-6 text-sm">No targets defined for this protocol.</p>
    {:else}
      <ul class="mb-6 flex flex-col gap-2">
        {#each data.targets as target (target.at_uri)}
          <li class="flex items-center justify-between rounded border px-4 py-3">
            <span class="text-sm">{targetLabel(target.scope as unknown[])}</span>
            <div class="flex items-center gap-3">
              <button
                type="button"
                onclick={() => decrement(target.at_uri)}
                disabled={(counts[target.at_uri] ?? 0) === 0}
                class="flex h-8 w-8 items-center justify-center rounded-full border text-lg font-semibold disabled:opacity-40"
                aria-label="Decrease count"
              >−</button>
              <span class="w-8 text-center tabular-nums">{counts[target.at_uri] ?? 0}</span>
              <button
                type="button"
                onclick={() => increment(target.at_uri)}
                class="flex h-8 w-8 items-center justify-center rounded-full border text-lg font-semibold"
                aria-label="Increase count"
              >+</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <input type="hidden" name="latitude" value={latitude ?? ''} />
    <input type="hidden" name="longitude" value={longitude ?? ''} />
    <input
      type="hidden"
      name="eventDate"
      value={startedAt ? new Date(startedAt).toISOString() : ''}
    />
    <input
      type="hidden"
      name="eventDurationValue"
      value={Math.max(1, Math.round(elapsedSeconds / 60))}
    />
    <input type="hidden" name="occurrences" value={occurrencesJson()} />

    <Button type="submit" class="w-full">Finish Survey</Button>
  </form>
</main>
