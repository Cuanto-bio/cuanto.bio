<script lang="ts">
import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/state';
import { Button } from '$lib/components/ui/button';
import * as Command from '$lib/components/ui/command';
import * as Dialog from '$lib/components/ui/dialog';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as Popover from '$lib/components/ui/popover';
import * as Sheet from '$lib/components/ui/sheet';
import type { Main as AtgeoPlaceMain } from '$lib/lexicons/org/atgeo/place.defs';
import {
  type CachedProtocol,
  getCachedProtocolByRkey,
  savePendingSurvey,
  type Target,
} from '$lib/offline/db';
import { uploadPendingSurvey } from '$lib/offline/upload';
import { LOCATION_COMBOBOX_THRESHOLD } from '$lib/places';
import { calcElapsed, formatElapsed } from '$lib/surveys';

let protocol = $state<CachedProtocol | null>(null);
let notFound = $state(false);

let startedAt = $state(0);
let elapsedSeconds = $state(0);
let organismQuantities = $state<Record<string, string>>({});
let latitude = $state<string | null>(null);
let longitude = $state<string | null>(null);
let locationName = $state('');
let submitting = $state(false);
let error = $state<string | null>(null);
let gpsLoading = $state(false);
let locationPickerOpen = $state(false);

let sheetOpen = $state(false);
let selectedTarget = $state<Target | null>(null);
let editingQuantity = $state('');
let isWide = $state(false);
let filterQuery = $state('');
let cancelDialogOpen = $state(false);
const filteredTargets = $derived(
  (protocol?.targets ?? []).filter((t) => {
    if (!filterQuery.trim()) return true;
    const label = targetLabel(t.record.scope);
    return label.toLowerCase().includes(filterQuery.toLowerCase());
  }),
);

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

  const mq = window.matchMedia('(min-width: 768px)');
  isWide = mq.matches;
  const onMqChange = (e: MediaQueryListEvent) => {
    isWide = e.matches;
  };
  mq.addEventListener('change', onMqChange);

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
    mq.removeEventListener('change', onMqChange);
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

// for now this assumes organismQuantityType is always individuals-count and
// not something categorical like '1-5'. We'll need to update that if we
// support other quantity types
function increment(uri: string) {
  const current = parseInt(organismQuantities[uri] ?? '0', 10);
  organismQuantities[uri] = String(Number.isNaN(current) ? 1 : current + 1);
}

function openTargetSheet(target: Target) {
  selectedTarget = target;
  editingQuantity = organismQuantities[target.atUri] ?? '';
  sheetOpen = true;
}

function saveSheet() {
  if (!selectedTarget) return;
  const trimmed = editingQuantity.trim();
  if (trimmed) {
    organismQuantities[selectedTarget.atUri] = trimmed;
  } else {
    delete organismQuantities[selectedTarget.atUri];
  }
  sheetOpen = false;
}

function resetTarget() {
  if (!selectedTarget) return;
  delete organismQuantities[selectedTarget.atUri];
  editingQuantity = '';
  sheetOpen = false;
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
    organismQuantity: organismQuantities[t.atUri] || '0',
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

function cancel() {
  cancelDialogOpen = true;
}

function confirmCancel() {
  if (!protocol) return;
  goto(`/app/protocols/${protocol.handle}/${protocol.rkey}`);
}

function displayCount(qty: undefined | string | number) {
  if (qty === undefined) return 0;
  if (typeof qty === 'number') return qty.toLocaleString();
  const num = parseInt(qty, 10);
  const val = Number.isNaN(num) ? qty : num;
  return val.toLocaleString();
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
  <main class="mx-auto max-w-2xl px-4">
    <div class="flex min-h-dvh flex-col pt-8">
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

    <div class="flex-1">
      {#if protocol.targets.length === 0}
        <p class="text-muted-foreground mb-6 text-sm">No targets defined for this protocol.</p>
      {:else}
        <div class="sticky top-0 z-10 -mx-4 bg-background px-4 py-2 sm:mx-0">
          <Input
            type="search"
            placeholder="Search targets…"
            bind:value={filterQuery}
          />
        </div>
        {#if filteredTargets.length === 0}
          <p class="text-muted-foreground mb-6 mt-2 text-sm">No targets match "{filterQuery}".</p>
        {:else}
          <ul class="-mx-4 mb-6 divide-y border-y sm:mx-0 sm:rounded-lg sm:border">
            {#each filteredTargets as target (target.atUri)}
              {@const qty = organismQuantities[target.atUri]}
              {@const hasCount = qty !== undefined && qty !== '' && qty !== '0'}
              <li class="flex items-center p-2">
                <button
                  type="button"
                  class="flex flex-1 items-center gap-2 px-4 py-3 text-left"
                  onclick={() => openTargetSheet(target)}
                >
                  <span class="flex-1 text-sm font-medium">{targetLabel(target.record.scope)}</span>
                </button>
                <button
                  type="button"
                  class="mr-3 flex min-h-11 min-w-11 p-2 items-center justify-center rounded-full text-sm font-bold tabular-nums transition-colors
                    {hasCount
                      ? 'bg-primary text-primary-foreground'
                      : 'border-2 border-border text-muted-foreground hover:border-primary hover:text-foreground'}"
                  onclick={() => increment(target.atUri)}
                  aria-label="Increase count"
                >
                  {displayCount(qty)}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>

    {#if error}
      <p class="text-destructive mb-2 text-sm">{error}</p>
    {/if}

    <div class="sticky bottom-0 -mx-4 border-t bg-background px-4 py-4 sm:mx-0">
      <div class="flex gap-2">
        <Button variant="outline" class="flex-1" onclick={cancel}>Cancel Survey</Button>
        <Button class="flex-1" onclick={finish} disabled={submitting}>
          {submitting ? 'Saving…' : 'Finish Survey'}
        </Button>
      </div>
    </div>
    </div>
  </main>

  {#snippet occurrenceForm()}
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <Label for="organism-qty">Organism quantity</Label>
        <Input
          id="organism-qty"
          type="number"
          bind:value={
            // editingQuantity is a string to match the lexicon which supports
            // different quantity types, but the input is a number (for now)
            // to ensure the user only enters numbers... until the UI
            // supports alternative quantity types too
            () => editingQuantity,
            (newVal) => editingQuantity = String(newVal)
          }
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              e.preventDefault();
              saveSheet();
              return false;
            }
          }}
        />
      </div>
      <div class="flex gap-2">
        <Button variant="outline" class="flex-1" onclick={resetTarget}>Reset</Button>
        <Button class="flex-1" onclick={saveSheet}>Done</Button>
      </div>
    </div>
  {/snippet}

  <Dialog.Root bind:open={cancelDialogOpen}>
    <Dialog.Content>
      <Dialog.Header>
        <Dialog.Title>Cancel survey?</Dialog.Title>
        <Dialog.Description>Your progress will be lost.</Dialog.Description>
      </Dialog.Header>
      <div class="flex gap-2">
        <Button variant="outline" class="flex-1" onclick={() => (cancelDialogOpen = false)}>
          Keep surveying
        </Button>
        <Button variant="destructive" class="flex-1" onclick={confirmCancel}>
          Cancel survey
        </Button>
      </div>
    </Dialog.Content>
  </Dialog.Root>

  {#if isWide}
    <Dialog.Root bind:open={sheetOpen}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            {selectedTarget ? targetLabel(selectedTarget.record.scope) : 'Details'}
          </Dialog.Title>
          <Dialog.Description>Edit occurrence details</Dialog.Description>
        </Dialog.Header>
        {@render occurrenceForm()}
      </Dialog.Content>
    </Dialog.Root>
  {:else}
    <Sheet.Root bind:open={sheetOpen}>
      <Sheet.Content side="bottom">
        <Sheet.Header>
          <Sheet.Title>
            {selectedTarget ? targetLabel(selectedTarget.record.scope) : 'Details'}
          </Sheet.Title>
          <Sheet.Description>Edit occurrence details</Sheet.Description>
        </Sheet.Header>
        <div class="px-6 pb-6">
          {@render occurrenceForm()}
        </div>
      </Sheet.Content>
    </Sheet.Root>
  {/if}
{/if}
