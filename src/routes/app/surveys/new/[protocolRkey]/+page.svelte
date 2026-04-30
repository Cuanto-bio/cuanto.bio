<script lang="ts">
import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { Button } from '$lib/components/ui/button';
import * as Command from '$lib/components/ui/command';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as Popover from '$lib/components/ui/popover';
import type { Main as AtgeoPlaceMain } from '$lib/lexicons/org/atgeo/place.defs';
import {
  type CachedProtocol,
  getCachedProtocolByRkey,
  savePendingSurvey,
} from '$lib/offline/db';
import { uploadPendingSurvey } from '$lib/offline/upload';
import { LOCATION_COMBOBOX_THRESHOLD } from '$lib/places';
import { calcElapsed, formatElapsed } from '$lib/surveys';

let protocol = $state<CachedProtocol | null>(null);
let notFound = $state(false);

let startedAt = $state(0);
let elapsedSeconds = $state(0);
let counts = $state<Record<string, number>>({});
let latitude = $state<string | null>(null);
let longitude = $state<string | null>(null);
let locationName = $state('');
let submitting = $state(false);
let error = $state<string | null>(null);
let gpsLoading = $state(false);
let locationPickerOpen = $state(false);

onMount(() => {
  startedAt = Date.now();

  const tick = () => {
    elapsedSeconds = calcElapsed(startedAt);
  };
  const id = setInterval(tick, 1000);

  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', onVisible);

  const rkey = page.params.protocolRkey ?? '';
  getCachedProtocolByRkey(rkey).then((cached) => {
    if (cached) {
      protocol = cached;
    } else {
      notFound = true;
    }
  });

  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
});

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

function requestGps() {
  if (!('geolocation' in navigator)) return;
  gpsLoading = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      latitude = String(pos.coords.latitude);
      longitude = String(pos.coords.longitude);
      gpsLoading = false;
    },
    () => {
      gpsLoading = false;
    },
  );
}

function selectLocation(option: AtgeoPlaceMain) {
  locationName = option.name;
  latitude = null;
  longitude = null;
  const geo = option.locations?.find(
    (
      l,
    ): l is {
      $type: 'community.lexicon.location.geo';
      latitude: string;
      longitude: string;
    } => (l as { $type?: string }).$type === 'community.lexicon.location.geo',
  );
  if (geo) {
    latitude = geo.latitude;
    longitude = geo.longitude;
  }
}

async function finish() {
  if (!protocol) return;
  if (!locationName.trim()) {
    error = 'Location name is required';
    return;
  }
  submitting = true;
  error = null;

  const occurrences = protocol.targets.map((t) => ({
    surveyTargetUri: t.atUri,
    taxonID: targetTaxonID(t.record.scope),
    count: counts[t.atUri] ?? 0,
  }));

  const survey = {
    protocolUri: protocol.atUri,
    protocolRkey: protocol.rkey,
    protocolTitle: protocol.record.title,
    locationName: locationName.trim(),
    latitude,
    longitude,
    eventDate: new Date(startedAt).toISOString(),
    eventDurationValue: Math.max(1, Math.round(elapsedSeconds / 60)),
    eventDurationUnit: 'minutes',
    occurrences,
    createdAt: Date.now(),
  };

  if (navigator.onLine) {
    try {
      const { surveyUri, handle } = await uploadPendingSurvey(survey);
      const rkey = surveyUri.split('/').at(-1) ?? '';
      await goto(`/app/surveys/${handle}/${rkey}`);
      return;
    } catch {
      // fall through to save pending
    }
  }

  await savePendingSurvey(survey);
  await goto('/app/surveys');
}
</script>

{#if notFound}
  <main class="mx-auto max-w-2xl px-4 py-8">
    <p class="text-muted-foreground text-sm">
      Protocol not cached. Visit the protocol page while online to enable offline surveys.
    </p>
  </main>
{:else if !protocol}
  <main class="mx-auto max-w-2xl px-4 py-8">
    <p class="text-muted-foreground text-sm">Loading…</p>
  </main>
{:else}
  <main class="mx-auto max-w-2xl px-4 py-8">
    <div class="mb-6 flex items-start justify-between">
      <div>
        <h1 class="text-xl font-semibold">{protocol.record.title}</h1>
        <a href="/app/protocols/{protocol.handle}/{protocol.rkey}" class="text-muted-foreground text-sm underline">
          ← Protocol
        </a>
      </div>
      <div class="font-mono text-3xl tabular-nums">{formatElapsed(elapsedSeconds)}</div>
    </div>

    <div class="mb-6 flex flex-col gap-2">
      {#if (protocol.record.locationOptions?.length ?? 0) > LOCATION_COMBOBOX_THRESHOLD}
        <div class="flex flex-col gap-2">
          <Label>Location</Label>
          <Popover.Root bind:open={locationPickerOpen}>
            <Popover.Trigger>
              {#snippet child({ props })}
                <Button
                  variant="outline"
                  class="w-full justify-between font-normal"
                  {...props}
                >
                  {locationName || 'Select a location…'}
                  <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              {/snippet}
            </Popover.Trigger>
            <Popover.Content class="w-full p-0">
              <Command.Root>
                <Command.Input placeholder="Search locations…" />
                <Command.List>
                  <Command.Empty>No locations found.</Command.Empty>
                  <Command.Group>
                    {#each protocol.record.locationOptions ?? [] as option}
                      <Command.Item
                        value={option.name}
                        onSelect={() => {
                          selectLocation(option);
                          locationPickerOpen = false;
                        }}
                      >
                        {option.name}
                      </Command.Item>
                    {/each}
                  </Command.Group>
                </Command.List>
              </Command.Root>
            </Popover.Content>
          </Popover.Root>
        </div>
      {:else if protocol.record.locationOptions?.length}
        <fieldset class="flex flex-col gap-2">
          <legend class="text-sm font-medium leading-none">Location</legend>
          {#each protocol.record.locationOptions as option}
            <label class="flex items-center gap-2 text-sm">
              <!-- required has no effect here; finish() enforces selection -->
              <input
                type="radio"
                name="locationOption"
                value={option.name}
                onchange={() => selectLocation(option)}
                required
              />
              {option.name}
            </label>
          {/each}
        </fieldset>
      {:else}
        <Label for="locationName">Location</Label>
        <Input
          id="locationName"
          bind:value={locationName}
          required
          placeholder="e.g. Mission Dolores Park"
        />
        <div class="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onclick={requestGps} disabled={gpsLoading}>
            {gpsLoading ? 'Getting GPS…' : 'Add GPS location'}
          </Button>
          {#if latitude && longitude}
            <span class="text-muted-foreground text-xs">{latitude}, {longitude}</span>
          {/if}
        </div>
      {/if}
    </div>

    {#if protocol.targets.length === 0}
      <p class="text-muted-foreground mb-6 text-sm">No targets defined for this protocol.</p>
    {:else}
      <ul class="mb-6 flex flex-col gap-2">
        {#each protocol.targets as target (target.atUri)}
          <li class="flex items-center justify-between rounded border px-4 py-3">
            <span class="text-sm">{targetLabel(target.record.scope)}</span>
            <div class="flex items-center gap-3">
              <button
                type="button"
                onclick={() => decrement(target.atUri)}
                disabled={(counts[target.atUri] ?? 0) === 0}
                class="flex h-8 w-8 items-center justify-center rounded-full border text-lg font-semibold disabled:opacity-40"
                aria-label="Decrease count"
              >−</button>
              <span class="w-8 text-center tabular-nums">{counts[target.atUri] ?? 0}</span>
              <button
                type="button"
                onclick={() => increment(target.atUri)}
                class="flex h-8 w-8 items-center justify-center rounded-full border text-lg font-semibold"
                aria-label="Increase count"
              >+</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if error}
      <p class="text-destructive mb-4 text-sm">{error}</p>
    {/if}

    <Button onclick={finish} disabled={submitting} class="w-full">
      {submitting ? 'Saving…' : 'Finish Survey'}
    </Button>
  </main>
{/if}
