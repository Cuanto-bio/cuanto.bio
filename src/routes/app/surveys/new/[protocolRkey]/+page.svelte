<script lang="ts">
import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
import { onMount } from 'svelte';
import { toast } from 'svelte-sonner';
import { beforeNavigate, goto, replaceState } from '$app/navigation';
import { page } from '$app/state';
import Button from '$lib/components/Button.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import * as Command from '$lib/components/ui/command';
import * as Dialog from '$lib/components/ui/dialog';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as Popover from '$lib/components/ui/popover';
import * as Sheet from '$lib/components/ui/sheet';
import type { Main as AtgeoPlaceMain } from '$lib/lexicons/org/atgeo/place.defs';
import {
  type CachedProtocol,
  deletePendingSurvey,
  getCachedProtocolByRkey,
  getPendingSurveyById,
  savePendingSurvey,
  type Target,
  updatePendingSurvey,
} from '$lib/offline/db';
import { uploadPendingSurvey } from '$lib/offline/upload';
import { LOCATION_COMBOBOX_THRESHOLD } from '$lib/places';
import {
  buildSurveyTiming,
  calcElapsed,
  formatElapsed,
  validatePastTiming,
} from '$lib/surveys';

let protocol = $state<CachedProtocol | null>(null);
let notFound = $state(false);

const mode = $derived(
  page.url.searchParams.get('past') === '1' ? 'past' : 'now',
);
let startedAt = $state(0);
let elapsedSeconds = $state(0);
let pastDate = $state('');
let pastDurationMinutes = $state('');
let pastDateError = $state<string | null>(null);
let pastDurationError = $state<string | null>(null);
let organismQuantities = $state<Record<string, string>>({});
let latitude = $state<string | null>(null);
let longitude = $state<string | null>(null);
let locationName = $state('');
let submitting = $state(false);
let locationError = $state<string | null>(null);
let locationFieldEl = $state<HTMLElement | null>(null);
let gpsLoading = $state(false);
let locationPickerOpen = $state(false);

let sheetOpen = $state(false);
let selectedTarget = $state<Target | null>(null);
let editingQuantity = $state('');
let isWide = $state(false);
let filterQuery = $state('');
let cancelDialogOpen = $state(false);
let finishDialogOpen = $state(false);

// IDB id of the auto-saved draft for this session; null until first auto-save
let pendingSurveyId = $state<number | null>(null);
// prevents beforeNavigate from firing when finish()/confirmCancel() navigates away
let navigatingAway = $state(false);
// prevents concurrent autoSave() calls from both inserting a new IDB record
let saving = false;

const filteredTargets = $derived(
  (protocol?.targets ?? []).filter((t) => {
    if (!filterQuery.trim()) return true;
    const label = targetLabel(t.record.scope);
    return label.toLowerCase().includes(filterQuery.toLowerCase());
  }),
);

const nonZeroOccurrences = $derived(
  Object.values(organismQuantities).filter((q) => q && q !== '0').length,
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

  const saveInterval = setInterval(() => autoSave(), 10_000);

  const onUnload = () => {
    autoSave();
  };
  window.addEventListener('beforeunload', onUnload);

  const rkey = page.params.protocolRkey ?? '';
  const resumeId = page.url.searchParams.get('resumeId');

  getCachedProtocolByRkey(rkey).then(async (cached) => {
    if (cached) {
      protocol = cached;
      if (resumeId != null) {
        const saved = await getPendingSurveyById(parseInt(resumeId, 10));
        if (saved) {
          pendingSurveyId = saved.id ?? null;
          locationName = saved.locationName;
          latitude = saved.latitude;
          longitude = saved.longitude;
          if (saved.eventDate) startedAt = new Date(saved.eventDate).getTime();
          for (const occ of saved.occurrences) {
            if (occ.organismQuantity && occ.organismQuantity !== '0') {
              organismQuantities[occ.surveyTargetUri] = occ.organismQuantity;
            }
          }
        }
      }
    } else {
      notFound = true;
    }
  });

  return () => {
    clearInterval(id);
    clearInterval(saveInterval);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('beforeunload', onUnload);
    mq.removeEventListener('change', onMqChange);
  };
});

beforeNavigate(() => {
  if (navigatingAway || !protocol || !startedAt) return;
  // Don't cancel — let navigation proceed. The IDB write is fast enough to
  // complete before the new page's JS runs, and the toast renders via the
  // global Toaster in the layout (survives navigation).
  autoSave().then(
    () => toast.info('Survey saved — resume from Surveys'),
    () => toast.error('Could not save survey draft'),
  );
});

function buildSurveyPayload(p: CachedProtocol, complete: boolean) {
  const occurrences = p.targets.map((t) => ({
    surveyTargetUri: t.atUri,
    taxonID: targetTaxonID(t.record.scope),
    organismQuantity: organismQuantities[t.atUri] || '0',
  }));
  return {
    protocolUri: p.atUri,
    protocolRkey: p.rkey,
    protocolTitle: p.record.title,
    locationName: locationName.trim(),
    latitude,
    longitude,
    eventDate: new Date(startedAt).toISOString(),
    eventDurationValue: complete
      ? Math.max(1, Math.round(elapsedSeconds / 60))
      : null,
    eventDurationUnit: complete ? 'minutes' : null,
    occurrences,
    createdAt: Date.now(),
    complete,
  };
}

async function autoSave() {
  if (!protocol || saving) return;
  saving = true;
  try {
    const survey = buildSurveyPayload(protocol, false);
    if (pendingSurveyId != null) {
      await updatePendingSurvey({ ...survey, id: pendingSurveyId });
    } else {
      pendingSurveyId = await savePendingSurvey(survey);
      // Stamp the draft ID into the URL so that if the user navigates back
      // to this page via browser history, the existing draft is loaded rather
      // than starting a new one.
      replaceState(`?resumeId=${pendingSurveyId}`, {});
    }
  } finally {
    saving = false;
  }
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
  locationError = null;
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
    locationError = 'Location name is required';
    locationFieldEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    finishDialogOpen = false;
    return;
  }
  if (mode === 'past') {
    const { dateError, durationError } = validatePastTiming(
      pastDate,
      pastDurationMinutes,
    );
    if (dateError || durationError) {
      pastDateError = dateError;
      pastDurationError = durationError;
      return;
    }
  }
  submitting = true;
  locationError = null;
  finishDialogOpen = false;
  pastDateError = null;
  pastDurationError = null;

  const occurrences = protocol.targets.map((t) => ({
    surveyTargetUri: t.atUri,
    taxonID: targetTaxonID(t.record.scope),
    organismQuantity: organismQuantities[t.atUri] || '0',
  }));

  const { eventDate, eventDurationValue } = buildSurveyTiming(
    mode,
    startedAt,
    elapsedSeconds,
    pastDate,
    pastDurationMinutes,
  );

  const survey = buildSurveyPayload(protocol, true);

  // Persist as complete before attempting upload so data is safe if upload fails
  if (pendingSurveyId != null) {
    await updatePendingSurvey({ ...survey, id: pendingSurveyId });
  } else {
    pendingSurveyId = await savePendingSurvey(survey);
  }

  if (navigator.onLine) {
    try {
      const { surveyUri, handle } = await uploadPendingSurvey(survey);
      if (pendingSurveyId != null) await deletePendingSurvey(pendingSurveyId);
      const rkey = surveyUri.split('/').at(-1) ?? '';
      navigatingAway = true;
      await goto(`/app/surveys/${handle}/${rkey}`);
      return;
    } catch {
      // fall through — survey is already saved as complete in IDB
    }
  }

  navigatingAway = true;
  await goto('/app/surveys');
}

function cancel() {
  cancelDialogOpen = true;
}

async function confirmCancel() {
  if (!protocol) return;
  if (pendingSurveyId != null) await deletePendingSurvey(pendingSurveyId);
  navigatingAway = true;
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
{:else if !protocol}
  <main class="mx-auto max-w-2xl px-4 pb-8">
    <p class="text-muted-foreground text-sm">Loading…</p>
  </main>
{:else}
  <main class="mx-auto max-w-2xl px-4">
    <div class="flex min-h-dvh flex-col pt-8">
    <div class="mb-6 flex items-start justify-between">
      <div>
        <h1 class="text-xl font-semibold">{protocol.record.title}</h1>
      </div>
      {#if mode === 'now'}
        <div class="font-mono text-3xl tabular-nums">{formatElapsed(elapsedSeconds)}</div>
      {/if}
    </div>
    {#if mode === 'past'}
      <div class="mb-6 flex flex-col gap-4">
        <div class="flex flex-col gap-2">
          <Label for="pastDate">Survey date &amp; time</Label>
          <Input
            id="pastDate"
            type="datetime-local"
            bind:value={pastDate}
            max={new Date().toISOString().slice(0, 16)}
            oninput={() => (pastDateError = null)}
            aria-invalid={pastDateError ? 'true' : undefined}
            aria-describedby={pastDateError ? 'past-date-error' : undefined}
          />
          {#if pastDateError}
            <p id="past-date-error" class="text-destructive text-sm">{pastDateError}</p>
          {/if}
        </div>
        <div class="flex flex-col gap-2">
          <Label for="pastDuration">Duration (minutes)</Label>
          <Input
            id="pastDuration"
            type="number"
            min="1"
            bind:value={pastDurationMinutes}
            placeholder="e.g. 45"
            oninput={() => (pastDurationError = null)}
            aria-invalid={pastDurationError ? 'true' : undefined}
            aria-describedby={pastDurationError ? 'past-duration-error' : undefined}
          />
          {#if pastDurationError}
            <p id="past-duration-error" class="text-destructive text-sm">{pastDurationError}</p>
          {/if}
        </div>
      </div>
    {/if}

    <div class="mb-6 flex flex-col gap-2" bind:this={locationFieldEl}>
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
          oninput={() => (locationError = null)}
          aria-invalid={locationError ? 'true' : undefined}
          aria-describedby={locationError ? 'location-error' : undefined}
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
      {#if locationError}
        <p id="location-error" class="text-destructive text-sm">{locationError}</p>
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

    <div class="sticky bottom-0 -mx-4 border-t bg-background px-4 py-4 sm:mx-0">
      <div class="flex gap-2">
        <Button variant="outline" class="flex-1" onclick={cancel}>Cancel Survey</Button>
        <Button class="flex-1" onclick={() => (finishDialogOpen = true)} disabled={submitting}>
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

  <AlertDialog.Root bind:open={finishDialogOpen}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Finish survey?</AlertDialog.Title>
        <AlertDialog.Description>
          {protocol.record.title} · {locationName || 'no location set'} ·
          {formatElapsed(elapsedSeconds)} ·
          {nonZeroOccurrences}
          {nonZeroOccurrences === 1 ? 'observation' : 'observations'}
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>Keep going</AlertDialog.Cancel>
        <AlertDialog.Action onclick={finish}>Finish</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>

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
