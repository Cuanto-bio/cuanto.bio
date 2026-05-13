<script lang="ts">
import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
import MoreVertical from '@lucide/svelte/icons/more-vertical';
import { onMount } from 'svelte';
import { toast } from 'svelte-sonner';
import { beforeNavigate, goto, replaceState } from '$app/navigation';
import { page } from '$app/state';
import Button from '$lib/components/Button.svelte';
import Taxon from '$lib/components/Taxon.svelte';
import TaxonAutocomplete, {
  type TaxonResult,
} from '$lib/components/TaxonAutocomplete.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import * as Command from '$lib/components/ui/command';
import * as Dialog from '$lib/components/ui/dialog';
import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as Popover from '$lib/components/ui/popover';
import * as Sheet from '$lib/components/ui/sheet';
import { useOnline } from '$lib/composables/online.svelte';
import type { Main as AtgeoPlaceMain } from '$lib/lexicons/org/atgeo/place.defs';
import {
  type CachedProtocol,
  deletePendingSurvey,
  getCachedProtocolByRkey,
  getPendingSurveyById,
  savePendingSurvey,
  type Target,
  type TaxonScope,
  updatePendingSurvey,
  type VerbatimScope,
} from '$lib/offline/db';
import { uploadPendingSurvey } from '$lib/offline/upload';
import { LOCATION_COMBOBOX_THRESHOLD } from '$lib/places';
import {
  buildSurveyTiming,
  calcElapsed,
  formatElapsed,
  hasUnresolvedIncidentals,
  type IncidentalOccurrence,
  validatePastTiming,
} from '$lib/surveys';

let protocol = $state<CachedProtocol | null>(null);
let notFound = $state(false);

let modeOverride = $state<'now' | 'past' | null>(null);
const mode = $derived(
  modeOverride ?? (page.url.searchParams.get('past') === '1' ? 'past' : 'now'),
);
let resumingComplete = $state(false);
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
type TargetSort = 'default' | 'scientific' | 'common';
let targetSort = $state<TargetSort>('default');
let onlyObserved = $state(false);
let cancelDialogOpen = $state(false);
let finishDialogOpen = $state(false);

const online = useOnline();

let incidentals = $state<IncidentalOccurrence[]>([]);
let incidentalSheetOpen = $state(false);
let editingIncidentalId = $state<string | null>(null);
let selectedTaxon = $state<TaxonResult | null>(null);
let incidentalOrganismQty = $state('');
let incidentalPlaceholder = $state('');
let incidentalDialogContentRef = $state<HTMLElement | null>(null);
let incidentalSheetContentRef = $state<HTMLElement | null>(null);
const incidentalPortalTarget = $derived(
  (isWide ? incidentalDialogContentRef : incidentalSheetContentRef) ??
    undefined,
);

// IDB id of the auto-saved draft for this session; null until first auto-save
let pendingSurveyId = $state<number | null>(null);
// prevents beforeNavigate from firing when finish()/confirmCancel() navigates away
let navigatingAway = $state(false);
// prevents concurrent autoSave() calls from both inserting a new IDB record
let saving = false;

const filteredTargets = $derived.by(() => {
  // Filter by search query and "only observed" toggle
  const filtered = (protocol?.targets ?? []).filter((t) => {
    if (onlyObserved) {
      const qty = parseInt(organismQuantities[t.atUri] ?? '0', 10);
      if (Number.isNaN(qty) || qty <= 0) return false;
    }
    if (!filterQuery.trim()) return true;
    const label = targetLabel(t.record.scope);
    return label.toLowerCase().includes(filterQuery.toLowerCase());
  });
  if (targetSort === 'default') return filtered;
  return [...filtered].sort((a, b) => {
    // Support sorting by sci name or ver name, but with support for verbatim
    // targets too
    const af = a.record.scope[0] as Record<string, string> | undefined;
    const bf = b.record.scope[0] as Record<string, string> | undefined;
    const aVal =
      targetSort === 'scientific'
        ? isTaxonScope(af)
          ? (af?.scientificName ?? '')
          : (af?.verbatimTargetScope ?? '')
        : isTaxonScope(af)
          ? (af?.vernacularName ?? '')
          : (af?.verbatimTargetScope ?? '');
    const bVal =
      targetSort === 'scientific'
        ? isTaxonScope(bf)
          ? (bf?.scientificName ?? '')
          : (bf?.verbatimTargetScope ?? '')
        : isTaxonScope(bf)
          ? (bf?.vernacularName ?? '')
          : (bf?.verbatimTargetScope ?? '');
    if (!aVal && !bVal) return 0;
    if (!aVal) return 1;
    if (!bVal) return -1;
    return aVal.localeCompare(bVal);
  });
});

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
          incidentals = saved.incidentals ?? [];
          if (saved.complete) {
            resumingComplete = true;
            modeOverride = 'past';
            if (saved.eventDate) pastDate = toDatetimeLocal(saved.eventDate);
            if (saved.eventDurationValue != null) {
              pastDurationMinutes = String(saved.eventDurationValue);
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
  const { eventDate, eventDurationValue } = complete
    ? buildSurveyTiming(
        mode,
        startedAt,
        elapsedSeconds,
        pastDate,
        pastDurationMinutes,
      )
    : {
        eventDate: new Date(startedAt).toISOString(),
        eventDurationValue: null,
      };
  return {
    protocolUri: p.atUri,
    protocolRkey: p.rkey,
    protocolTitle: p.record.title,
    locationName: locationName.trim(),
    latitude,
    longitude,
    eventDate,
    eventDurationValue,
    eventDurationUnit: complete ? 'minutes' : null,
    occurrences,
    incidentals: $state.snapshot(incidentals),
    createdAt: Date.now(),
    complete,
  };
}

function toDatetimeLocal(isoString: string): string {
  const dt = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

async function autoSave() {
  if (!protocol || saving) return;
  saving = true;
  try {
    const survey = buildSurveyPayload(protocol, resumingComplete);
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

function isTaxonScope(s: Record<string, string> | undefined): boolean {
  return !!s?.$type?.endsWith('#taxonScope');
}

function targetLabel(scope: (TaxonScope | VerbatimScope | unknown)[]): string {
  const first = scope[0] as Record<string, string> | undefined;
  if (!first) return 'Unknown target';
  if (first.$type?.endsWith('#taxonScope')) {
    return first.vernacularName
      ? `${first.vernacularName} (${first.scientificName})`
      : (first.scientificName ?? 'Unknown');
  }
  if (first.$type?.endsWith('#verbatimScope'))
    return first.verbatimTargetScope ?? 'Unknown';
  return 'Unknown target';
}

function targetTaxonID(
  scope: (TaxonScope | VerbatimScope | unknown)[],
): string | undefined {
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

function openAddIncidentalSheet() {
  editingIncidentalId = null;
  selectedTaxon = null;
  incidentalOrganismQty = '';
  incidentalPlaceholder = '';
  incidentalSheetOpen = true;
}

function openEditIncidentalSheet(incidental: IncidentalOccurrence) {
  editingIncidentalId = incidental.localId;
  incidentalOrganismQty = incidental.organismQuantity ?? '';
  incidentalPlaceholder = incidental.placeholder ?? '';
  selectedTaxon =
    incidental.taxonID && incidental.scientificName
      ? {
          inatId: 0,
          scientificName: incidental.scientificName,
          taxonRank: incidental.taxonRank ?? '',
          commonName: incidental.vernacularName ?? null,
          kingdom: incidental.kingdom ?? null,
          taxonID: incidental.taxonID,
        }
      : null;
  incidentalSheetOpen = true;
}

function saveIncidentalSheet() {
  const localId = editingIncidentalId ?? crypto.randomUUID();
  const base: IncidentalOccurrence = { localId };
  let saved: IncidentalOccurrence;
  if (selectedTaxon) {
    saved = {
      ...base,
      taxonID: selectedTaxon.taxonID,
      scientificName: selectedTaxon.scientificName,
      taxonRank: selectedTaxon.taxonRank,
      vernacularName: selectedTaxon.commonName ?? undefined,
      kingdom: selectedTaxon.kingdom ?? undefined,
      organismQuantity: incidentalOrganismQty.trim() || undefined,
    };
  } else {
    saved = {
      ...base,
      placeholder: incidentalPlaceholder.trim() || undefined,
      organismQuantity: incidentalOrganismQty.trim() || undefined,
    };
  }

  if (editingIncidentalId != null) {
    const idx = incidentals.findIndex((i) => i.localId === editingIncidentalId);
    if (idx >= 0) incidentals[idx] = saved;
  } else {
    incidentals.push(saved);
  }

  incidentalSheetOpen = false;
}

function deleteIncidental() {
  if (editingIncidentalId == null) return;
  incidentals = incidentals.filter((i) => i.localId !== editingIncidentalId);
  incidentalSheetOpen = false;
}

function incrementIncidental(localId: string) {
  const idx = incidentals.findIndex((i) => i.localId === localId);
  if (idx < 0) return;
  const current = parseInt(incidentals[idx].organismQuantity ?? '0', 10);
  incidentals[idx] = {
    ...incidentals[idx],
    organismQuantity: String(Number.isNaN(current) ? 1 : current + 1),
  };
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

  const survey = buildSurveyPayload(protocol, true);

  // Persist as complete before attempting upload so data is safe if upload fails
  if (pendingSurveyId != null) {
    await updatePendingSurvey({ ...survey, id: pendingSurveyId });
  } else {
    pendingSurveyId = await savePendingSurvey(survey);
  }

  if (navigator.onLine && !hasUnresolvedIncidentals(survey.incidentals ?? [])) {
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

    <div class="">
      {#if protocol.targets.length === 0}
        <p class="text-muted-foreground mb-6 text-sm">No targets defined for this protocol.</p>
      {:else}
        <div class="sticky top-0 z-10 -mx-4 bg-background px-4 py-2 sm:mx-0 flex gap-2">
          <Input
            type="search"
            placeholder="Search targets…"
            bind:value={filterQuery}
            class="flex-1"
          />
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              {#snippet child({ props })}
                <Button variant="outline" size="icon" aria-label="Sort and filter" {...props}>
                  <MoreVertical class="size-4" />
                </Button>
              {/snippet}
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Label>Sort</DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                value={targetSort}
                onValueChange={(v) => (targetSort = v as TargetSort)}
              >
                <DropdownMenu.RadioItem value="default">Default</DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="scientific">Scientific name</DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="common">Common name</DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator />
              <DropdownMenu.Label>Filter</DropdownMenu.Label>
              <DropdownMenu.CheckboxItem bind:checked={onlyObserved}>
                Only observed
              </DropdownMenu.CheckboxItem>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </div>
        {#if filteredTargets.length === 0}
          <p class="text-muted-foreground mb-6 mt-2 text-sm">No targets match "{filterQuery}".</p>
        {:else}
          <ul class="-mx-4 mb-6 divide-y border-y sm:mx-0 sm:rounded-lg sm:border">
            {#each filteredTargets as target (target.atUri)}
              {@const qty = organismQuantities[target.atUri]}
              {@const hasCount = qty !== undefined && qty !== '' && qty !== '0'}
              {@const first = target.record.scope[0]}
              <li class="flex items-center p-2">
                <button
                  type="button"
                  class="flex flex-1 items-center gap-2 px-4 py-3 text-left"
                  onclick={() => openTargetSheet(target)}
                >
                  <span class="flex-1 text-sm font-medium">
                    {#if first?.$type?.endsWith('#taxonScope')}
                      <Taxon taxon={first as TaxonScope} />
                    {:else if first?.$type?.endsWith('#verbatimScope')}
                      {(first as VerbatimScope).verbatimTargetScope ?? 'Unknown'}
                    {/if}
                  </span>
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
        {#if filterQuery.trim() || onlyObserved}
          <Button
            variant="ghost"
            class="w-full mb-4"
            onclick={() => { filterQuery = ''; onlyObserved = false; targetSort = 'default'; }}
          >
            Show all targets
          </Button>
        {/if}
      {/if}
    </div>

    <div class="flex-1 mt-6">
      <h2 class="mb-2 text-sm font-semibold">Incidentals</h2>
      {#if incidentals.length > 0}
        <ul class="-mx-4 mb-4 divide-y border-y sm:mx-0 sm:rounded-lg sm:border">
          {#each incidentals as incidental (incidental.localId)}
            {@const resolved = !!incidental.taxonID}
            <li class="flex items-center p-2">
              <button
                type="button"
                class="flex flex-1 items-center gap-2 px-4 py-3 text-left"
                onclick={() => openEditIncidentalSheet(incidental)}
              >
                <span class="flex-1 text-sm">
                  {#if resolved}
                    <Taxon
                      taxon={{
                        ...incidental,
                        scientificName: incidental.scientificName ?? 'Unknown',
                        taxonRank: incidental.taxonRank ?? 'unknown rank'
                      }}
                    />
                  {:else}
                    <span class="text-muted-foreground italic">
                      Placeholder: {incidental.placeholder ?? 'Unknown'}
                    </span>
                  {/if}
                </span>
              </button>
              <button
                type="button"
                class="mr-3 flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-sm font-bold tabular-nums transition-colors
                  {incidental.organismQuantity && Number(incidental.organismQuantity) > 0
                    ? 'bg-primary text-primary-foreground'
                    : 'border-2 border-border text-muted-foreground hover:border-primary hover:text-foreground'}"
                onclick={() => incrementIncidental(incidental.localId)}
                aria-label="Increase incidental count"
              >
                {displayCount(incidental.organismQuantity)}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <Button variant="outline" class="w-full mb-4" onclick={openAddIncidentalSheet}>
        Add incidental
      </Button>
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

  {#snippet incidentalForm()}
    <div class="flex flex-col gap-4">
      {#if online.value}
        {#if selectedTaxon}
          <div class="flex gap-2 justify-between items-center">
            <span>
              <Taxon
                taxon={{
                  scientificName: selectedTaxon.scientificName,
                  vernacularName: selectedTaxon.commonName!,
                  taxonRank: selectedTaxon.taxonRank
                }} />
            </span>
            <Button
              variant="outline"
              onclick={() => {selectedTaxon = null}}
            >
              Edit
            </Button>
          </div>
        {:else}
          <TaxonAutocomplete
            placeholder="Search taxa…"
            onSelectTaxon={(r) => (selectedTaxon = r)}
            portalTarget={incidentalPortalTarget}
            initialValue={incidentalPlaceholder || undefined}
          />
        {/if}
      {:else}
        <div class="flex flex-col gap-2">
          <Label for="incidental-verbatim">What did you see?</Label>
          <Input
            id="incidental-verbatim"
            bind:value={incidentalPlaceholder}
            placeholder="e.g. small brown bird"
          />
        </div>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="incidental-qty">Organism quantity</Label>
        <Input
          id="incidental-qty"
          type="number"
          bind:value={
            () => incidentalOrganismQty,
            (v) => (incidentalOrganismQty = String(v))
          }
        />
      </div>
      <div class="flex gap-2">
        {#if editingIncidentalId != null}
          <Button variant="destructive" class="flex-1" onclick={deleteIncidental}>Delete</Button>
        {/if}
        <Button
          class="flex-1"
          onclick={saveIncidentalSheet}
          disabled={!selectedTaxon && !incidentalPlaceholder.trim()}
        >
          {editingIncidentalId != null ? 'Save' : 'Add'}
        </Button>
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
          {mode === 'past' ? `${pastDurationMinutes} min` : formatElapsed(elapsedSeconds)} ·
          {nonZeroOccurrences}
          {nonZeroOccurrences === 1 ? 'observation' : 'observations'}
        </AlertDialog.Description>
        {#if hasUnresolvedIncidentals(incidentals)}
          {@const unresolvedCount = incidentals.filter((i) => !i.taxonID).length}
          <p class="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
            {unresolvedCount} incidental{unresolvedCount === 1 ? '' : 's'} without taxa — you can resolve them before uploading.
          </p>
        {/if}
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>{resumingComplete ? 'Keep editing' : 'Keep going'}</AlertDialog.Cancel>
        <AlertDialog.Action onclick={finish}>Finish</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>

  {#if isWide}
    <Dialog.Root bind:open={sheetOpen}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>
            {#if selectedTarget}
              {@const taxonScope = selectedTarget.record.scope.find(s => s.$type?.endsWith('#taxonScope'))}
              {#if taxonScope}
                <Taxon taxon={taxonScope as TaxonScope} />
              {/if}
              {@const verbatimScope = selectedTarget.record.scope.find(s => s.$type?.endsWith('#verbatimScope'))}
              {#if verbatimScope}
                {(verbatimScope as VerbatimScope).verbatimTargetScope}
              {/if}
            {:else}
              Details
            {/if}
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

  {#if isWide}
    <Dialog.Root bind:open={incidentalSheetOpen}>
      <Dialog.Content bind:ref={incidentalDialogContentRef}>
        <Dialog.Header>
          <Dialog.Title>
            {editingIncidentalId != null ? 'Edit incidental' : 'Add incidental'}
          </Dialog.Title>
          <Dialog.Description>Record an incidental observation</Dialog.Description>
        </Dialog.Header>
        {@render incidentalForm()}
      </Dialog.Content>
    </Dialog.Root>
  {:else}
    <Sheet.Root bind:open={incidentalSheetOpen}>
      <Sheet.Content side="bottom" bind:ref={incidentalSheetContentRef}>
        <Sheet.Header>
          <Sheet.Title>
            {editingIncidentalId != null ? 'Edit incidental' : 'Add incidental'}
          </Sheet.Title>
          <Sheet.Description>Record an incidental observation</Sheet.Description>
        </Sheet.Header>
        <div class="px-6 pb-6">
          {@render incidentalForm()}
        </div>
      </Sheet.Content>
    </Sheet.Root>
  {/if}
{/if}
