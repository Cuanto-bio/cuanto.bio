<script lang="ts">
import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
import { onMount, tick } from 'svelte';
import { toast } from 'svelte-sonner';
import { beforeNavigate, goto, replaceState } from '$app/navigation';
import * as Alert from '$lib/components/alert';
import Button from '$lib/components/Button.svelte';
import TargetFilterControls from '$lib/components/TargetFilterControls.svelte';
import Taxon from '$lib/components/Taxon.svelte';
import TaxonAutocomplete, {
  type TaxonResult,
} from '$lib/components/TaxonAutocomplete.svelte';
import * as AlertDialog from '$lib/components/ui/alert-dialog';
import * as Command from '$lib/components/ui/command';
import * as Dialog from '$lib/components/ui/dialog';
import * as Field from '$lib/components/ui/field';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import * as Popover from '$lib/components/ui/popover';
import * as Sheet from '$lib/components/ui/sheet';
import { useOnline } from '$lib/composables/online.svelte';
import type { Main as AtgeoPlaceMain } from '$lib/lexicons/org/atgeo/place.defs';
import {
  type CachedProtocol,
  deletePendingSurvey,
  type PendingSurvey,
  type Survey,
  savePendingSurvey,
  type Target,
  type TaxonScope,
  updatePendingSurvey,
  type VerbatimScope,
} from '$lib/offline/db';
import {
  PdsSessionExpiredError,
  uploadPendingSurvey,
} from '$lib/offline/upload';
import { LOCATION_COMBOBOX_THRESHOLD } from '$lib/places';
import {
  buildSurveyTiming,
  calcElapsed,
  formatElapsed,
  hasUnresolvedIncidentals,
  type IncidentalOccurrence,
  validatePastTiming,
  validateSurveyorCount,
} from '$lib/surveys';
import {
  createTargetFilter,
  targetLabel,
  targetTaxonID,
} from '$lib/targets.svelte';

interface Props {
  protocol: CachedProtocol;
  survey?: Survey; // when provided: edit mode
  defaultMode?: 'now' | 'past'; // new mode only; ignored in edit
  initialPendingSurveyId?: number | null;
  initialResumeState?: PendingSurvey; // resume from IDB draft (new mode)
}

let {
  protocol,
  survey,
  defaultMode = 'now',
  initialPendingSurveyId = null,
  initialResumeState,
}: Props = $props();

// svelte-ignore state_referenced_locally -- intentional: survey prop won't change
const isEdit = !!survey;
// svelte-ignore state_referenced_locally -- safe cast: sv only used in isEdit-guarded branches
const sv = survey as Survey;
const online = useOnline();

// ─── helpers ────────────────────────────────────────────────────────────────

function toDatetimeLocal(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

// Build initial organism quantities from existing survey occurrences (edit)
function buildQuantitiesFromSurvey(s: Survey): Record<string, string> {
  const map: Record<string, string> = {};
  for (const occ of s.occurrences) {
    if (occ.record.surveyTargetID && occ.record.organismQuantity) {
      map[occ.record.surveyTargetID] = String(occ.record.organismQuantity);
    }
  }
  return map;
}

// Build incidentals from existing incidental occurrences (edit)
function buildIncidentalsFromSurvey(s: Survey): IncidentalOccurrence[] {
  return s.occurrences
    .filter((o) => !o.record.surveyTargetID)
    .map((o) => ({
      localId: o.atUri,
      taxonID: o.record.taxonID as string | undefined,
      scientificName: o.identification?.scientificName,
      vernacularName: o.identification?.vernacularName,
      organismQuantity: o.record.organismQuantity as string | undefined,
    }));
}

// Maps surveyTargetID → existing occurrence atUri (edit only)
// svelte-ignore state_referenced_locally -- intentional: initialize from props
const existingOccurrenceUris: Record<string, string> = isEdit
  ? Object.fromEntries(
      (sv.occurrences ?? [])
        .filter((o) => o.record.surveyTargetID)
        .map((o) => [String(o.record.surveyTargetID), o.atUri]),
    )
  : {};

// Maps incidental localId (= atUri) → atUri (edit only)
// svelte-ignore state_referenced_locally -- intentional: initialize from props
const existingIncidentalUris: Record<string, string> = isEdit
  ? Object.fromEntries(
      (sv.occurrences ?? [])
        .filter((o) => !o.record.surveyTargetID)
        .map((o) => [o.atUri, o.atUri]),
    )
  : {};

// ─── form state ─────────────────────────────────────────────────────────────

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let modeOverride = $state<'now' | 'past' | null>(
  isEdit
    ? 'past'
    : initialResumeState?.complete
      ? 'past'
      : defaultMode !== 'now'
        ? defaultMode
        : null,
);

// In edit mode the mode is always 'past'; in new mode it follows modeOverride or the URL param.
const mode = $derived(modeOverride ?? defaultMode);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let resumingComplete = $state(!!initialResumeState?.complete && !isEdit);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let startedAt = $state(
  initialResumeState?.eventDate && !isEdit
    ? new Date(initialResumeState.eventDate).getTime()
    : Date.now(),
);
let elapsedSeconds = $state(0);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let pastDate = $state(
  isEdit
    ? toDatetimeLocal(sv.record.eventDate)
    : initialResumeState?.complete
      ? toDatetimeLocal(initialResumeState.eventDate)
      : '',
);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let pastDurationMinutes = $state(
  isEdit
    ? sv.record.eventDurationValue != null
      ? String(sv.record.eventDurationValue)
      : ''
    : initialResumeState?.complete &&
        initialResumeState.eventDurationValue != null
      ? String(initialResumeState.eventDurationValue)
      : '',
);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let surveyorCountStr = $state(
  isEdit
    ? sv.record.surveyorCount != null
      ? String(sv.record.surveyorCount)
      : ''
    : initialResumeState?.surveyorCount != null
      ? String(initialResumeState.surveyorCount)
      : '',
);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let locationName = $state(
  isEdit
    ? (sv.record.location?.name ?? '')
    : (initialResumeState?.locationName ?? ''),
);

function extractGeoFromSurvey(s: Survey): {
  lat: string | null;
  lon: string | null;
} {
  const entry = s.record.location?.locations?.find(
    (l) => (l as { $type?: string }).$type === 'community.lexicon.location.geo',
  ) as { latitude?: string; longitude?: string } | undefined;
  return {
    lat: entry?.latitude ? String(entry.latitude) || null : null,
    lon: entry?.longitude ? String(entry.longitude) || null : null,
  };
}

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let latitude = $state<string | null>(
  isEdit
    ? extractGeoFromSurvey(sv).lat
    : (initialResumeState?.latitude ?? null),
);
// svelte-ignore state_referenced_locally -- intentional: initialize from props
let longitude = $state<string | null>(
  isEdit
    ? extractGeoFromSurvey(sv).lon
    : (initialResumeState?.longitude ?? null),
);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let organismQuantities = $state<Record<string, string>>(
  isEdit
    ? buildQuantitiesFromSurvey(sv)
    : (() => {
        const m: Record<string, string> = {};
        for (const occ of initialResumeState?.occurrences ?? []) {
          if (occ.organismQuantity && occ.organismQuantity !== '0') {
            m[occ.surveyTargetUri] = occ.organismQuantity;
          }
        }
        return m;
      })(),
);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let incidentals = $state<IncidentalOccurrence[]>(
  isEdit
    ? buildIncidentalsFromSurvey(sv)
    : (initialResumeState?.incidentals ?? []),
);

// svelte-ignore state_referenced_locally -- intentional: initialize from props
let pendingSurveyId = $state<number | null>(initialPendingSurveyId ?? null);
let navigatingAway = $state(false);
let sessionExpired = $state(false);
let saving = false;
let submitting = $state(false);

let pastDateError = $state<string | null>(null);
let pastDurationError = $state<string | null>(null);
let surveyorCountError = $state<string | null>(null);
let locationError = $state<string | null>(null);
let locationFieldEl = $state<HTMLElement | null>(null);
let gpsLoading = $state(false);
let locationPickerOpen = $state(false);

let sheetOpen = $state(false);
let selectedTarget = $state<Target | null>(null);
let editingQuantity = $state('');
let isWide = $state(false);
let flashingTargets = $state<Record<string, number>>({});
let flashingIncidentals = $state<Record<string, number>>({});

let cancelDialogOpen = $state(false);
let finishDialogOpen = $state(false);

let incidentals_sheetOpen = $state(false);
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

// ─── derived ────────────────────────────────────────────────────────────────

const targetFilter = createTargetFilter(
  () => protocol?.targets ?? [],
  (t) => {
    const qty = parseInt(organismQuantities[t.atUri] ?? '0', 10);
    return !Number.isNaN(qty) && qty > 0;
  },
);

const nonZeroOccurrences = $derived(
  Object.values(organismQuantities).filter((q) => q && q !== '0').length,
);

// ─── lifecycle (new mode only) ───────────────────────────────────────────────

onMount(() => {
  const mq = window.matchMedia('(min-width: 768px)');
  isWide = mq.matches;
  const onMqChange = (e: MediaQueryListEvent) => {
    isWide = e.matches;
  };
  mq.addEventListener('change', onMqChange);

  if (isEdit) {
    return () => {
      mq.removeEventListener('change', onMqChange);
    };
  }

  // If we weren't given a startedAt from resume state, reset to now
  if (!initialResumeState?.eventDate) startedAt = Date.now();

  const tick = () => {
    elapsedSeconds = calcElapsed(startedAt);
  };
  const id = setInterval(tick, 1000);

  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', onVisible);

  const saveInterval = setInterval(() => autoSave(), 10_000);

  const onUnload = () => {
    autoSave();
  };
  window.addEventListener('beforeunload', onUnload);

  return () => {
    clearInterval(id);
    clearInterval(saveInterval);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('beforeunload', onUnload);
    mq.removeEventListener('change', onMqChange);
  };
});

// Only register beforeNavigate in new mode
beforeNavigate(() => {
  if (isEdit) return;
  if (navigatingAway || !startedAt) return;
  autoSave().then(
    () => toast.info('Survey saved. Resume from Surveys'),
    () => toast.error('Could not save survey draft'),
  );
});

// ─── auto-save (new mode only) ───────────────────────────────────────────────

function buildNewSurveyPayload(complete: boolean): PendingSurvey {
  const occurrences = protocol.targets.map((t) => ({
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
    protocolUri: protocol.atUri,
    protocolRkey: protocol.rkey,
    protocolTitle: protocol.record.title,
    locationName: locationName.trim(),
    latitude,
    longitude,
    eventDate,
    eventDurationValue,
    eventDurationUnit: complete ? 'minutes' : null,
    surveyorCount: surveyorCountStr ? parseInt(surveyorCountStr, 10) : null,
    occurrences,
    incidentals: $state.snapshot(incidentals),
    createdAt: Date.now(),
    complete,
  };
}

async function autoSave() {
  if (saving || navigatingAway) return;
  saving = true;
  try {
    const payload = buildNewSurveyPayload(resumingComplete);
    if (pendingSurveyId != null) {
      await updatePendingSurvey({ ...payload, id: pendingSurveyId });
    } else {
      pendingSurveyId = await savePendingSurvey(payload);
      replaceState(`?resumeId=${pendingSurveyId}`, {});
    }
  } finally {
    saving = false;
  }
}

// ─── edit payload builder ────────────────────────────────────────────────────

function buildEditPayload() {
  const { eventDate, eventDurationValue } = buildSurveyTiming(
    'past',
    startedAt,
    elapsedSeconds,
    pastDate,
    pastDurationMinutes,
  );
  return {
    eventDate,
    eventDurationValue,
    surveyorCount: surveyorCountStr ? parseInt(surveyorCountStr, 10) : null,
    locationName: locationName.trim(),
    latitude,
    longitude,
    occurrences: protocol.targets.map((t) => ({
      atUri: existingOccurrenceUris[t.atUri],
      surveyTargetUri: t.atUri,
      taxonID: targetTaxonID(t.record.scope),
      organismQuantity: organismQuantities[t.atUri] || '0',
    })),
    incidentals: incidentals.map((inc) => ({
      ...inc,
      atUri: existingIncidentalUris[inc.localId],
    })),
  };
}

// ─── actions ────────────────────────────────────────────────────────────────

async function finish() {
  if (!locationName.trim()) {
    locationError = 'Location name is required';
    finishDialogOpen = false;
    await tick();
    locationFieldEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      finishDialogOpen = false;
      return;
    }
  }
  const surveyorCountErr = validateSurveyorCount(
    protocol.record.requiredFields,
    surveyorCountStr,
  );
  if (surveyorCountErr) {
    surveyorCountError = surveyorCountErr;
    finishDialogOpen = false;
    return;
  }

  submitting = true;
  locationError = null;
  finishDialogOpen = false;
  pastDateError = null;
  pastDurationError = null;
  surveyorCountError = null;

  if (isEdit) {
    const payload = buildEditPayload();
    try {
      const res = await fetch(`/api/surveys/${sv.handle}/${sv.rkey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Error ${res.status}`);
      }
      navigatingAway = true;
      await goto(`/app/surveys/${sv.handle}/${sv.rkey}?updated=1`);
    } catch (err) {
      toast.error(String(err));
      submitting = false;
    }
    return;
  }

  // New mode: save to IDB then upload
  const payload = buildNewSurveyPayload(true);

  if (pendingSurveyId != null) {
    await updatePendingSurvey({ ...payload, id: pendingSurveyId });
  } else {
    pendingSurveyId = await savePendingSurvey(payload);
  }

  if (
    navigator.onLine &&
    !hasUnresolvedIncidentals(payload.incidentals ?? [])
  ) {
    try {
      const { surveyUri, handle } = await uploadPendingSurvey(payload);
      if (pendingSurveyId != null) await deletePendingSurvey(pendingSurveyId);
      const rkey = surveyUri.split('/').at(-1) ?? '';
      navigatingAway = true;
      await goto(`/app/surveys/${handle}/${rkey}`);
      return;
    } catch (err) {
      if (err instanceof PdsSessionExpiredError) {
        sessionExpired = true;
        return;
      }
      // fall through — survey is saved in IDB as complete
    }
  }

  navigatingAway = true;
  await goto('/app/surveys');
}

function cancel() {
  cancelDialogOpen = true;
}

async function confirmCancel() {
  if (isEdit) {
    navigatingAway = true;
    await goto(`/app/surveys/${sv.handle}/${sv.rkey}`);
    return;
  }
  if (pendingSurveyId != null) await deletePendingSurvey(pendingSurveyId);
  navigatingAway = true;
  await goto(`/app/protocols/${protocol.handle}/${protocol.rkey}`);
}

// ─── location helpers ────────────────────────────────────────────────────────

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

// ─── target sheet helpers ────────────────────────────────────────────────────

function liFlash(node: HTMLElement, count: number) {
  function restart() {
    if (count === 0) return;
    node.classList.remove('li-flash');
    void node.offsetWidth;
    node.classList.add('li-flash');
  }
  restart();
  return {
    update(newCount: number) {
      count = newCount;
      restart();
    },
  };
}

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate(10);
}

function flashItem(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function increment(uri: string) {
  haptic();
  flashItem(flashingTargets, uri);
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

// ─── incidental sheet helpers ────────────────────────────────────────────────

function openAddIncidentalSheet() {
  editingIncidentalId = null;
  selectedTaxon = null;
  incidentalOrganismQty = '';
  incidentalPlaceholder = '';
  incidentals_sheetOpen = true;
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
  incidentals_sheetOpen = true;
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
  incidentals_sheetOpen = false;
}

function deleteIncidental() {
  if (editingIncidentalId == null) return;
  incidentals = incidentals.filter((i) => i.localId !== editingIncidentalId);
  incidentals_sheetOpen = false;
}

function incrementIncidental(localId: string) {
  haptic();
  flashItem(flashingIncidentals, localId);
  const idx = incidentals.findIndex((i) => i.localId === localId);
  if (idx < 0) return;
  const current = parseInt(incidentals[idx].organismQuantity ?? '0', 10);
  incidentals[idx] = {
    ...incidentals[idx],
    organismQuantity: String(Number.isNaN(current) ? 1 : current + 1),
  };
}

function displayCount(qty: undefined | string | number) {
  if (qty === undefined) return 0;
  if (typeof qty === 'number') return qty.toLocaleString();
  const num = parseInt(qty, 10);
  const val = Number.isNaN(num) ? qty : num;
  return val.toLocaleString();
}
</script>

<main>
  <div class="flex min-h-dvh flex-col pt-8">

  {#if sessionExpired}
    <Alert.Root class="mb-6 border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
      <Alert.Title>Session expired</Alert.Title>
      <Alert.Description>
        Your connection to the AT Protocol network has expired. Your survey is saved.
        Sign in again to upload it.
        <a href="/auth/signin?returnTo=/app/surveys" class="underline font-medium ml-1">
          Sign in
        </a>
      </Alert.Description>
    </Alert.Root>
  {/if}

  <div class="mb-6 flex items-start justify-between">
    <div>
      <h1 class="text-xl font-semibold">{protocol.record.title}</h1>
      {#if isEdit}
        <p class="text-muted-foreground text-sm">Edit survey</p>
      {/if}
    </div>
    {#if mode === 'now' && !isEdit}
      <div class="font-mono text-3xl tabular-nums">{formatElapsed(elapsedSeconds)}</div>
    {/if}
  </div>

  {#if mode === 'past' || isEdit}
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
    </div>
  {/if}

  <div class="flex gap-4">
    {#if mode === 'past' || isEdit}
      <Field.Field data-invalid={pastDurationError ? true : undefined}>
        <Field.Label for="pastDuration">Duration (minutes)</Field.Label>
        <Input
          id="pastDuration"
          type="text"
          inputmode="numeric"
          placeholder="e.g. 45"
          bind:value={pastDurationMinutes}
          oninput={() => {
            if (pastDurationMinutes) {
              const dur = parseInt(pastDurationMinutes, 10);
              pastDurationError =
                Number.isNaN(dur) || dur < 1
                  ? 'Duration must be at least 1 minute'
                  : null;
            } else {
              pastDurationError = null;
            }
          }}
          aria-invalid={pastDurationError ? 'true' : undefined}
          aria-describedby="past-duration-description"
        />
        <Field.Description
          id="past-duration-description"
          aria-live="polite"
          class={pastDurationError ? 'text-destructive! min-h-5' : 'min-h-5'}
        >
          {pastDurationError ?? 'Duration of the survey in minutes'}
        </Field.Description>
      </Field.Field>
    {/if}
    <Field.Field class="mb-6" data-invalid={surveyorCountError ? true : undefined}>
      <Field.Label for="surveyorCount" class="line-clamp-1">
        <span class="sr-only md:not-sr-only">Number of surveyors</span>
        <span class="md:hidden" aria-hidden="true"># surveyors</span>
        {#if !protocol.record.requiredFields?.includes('surveyorCount')}
          <span class="text-muted-foreground font-normal">(optional)</span>
        {/if}
      </Field.Label>
      <Input
        id="surveyorCount"
        type="text"
        inputmode="numeric"
        placeholder="e.g. 3"
        required={protocol.record.requiredFields?.includes('surveyorCount')}
        bind:value={surveyorCountStr}
        oninput={() => {
          surveyorCountError = validateSurveyorCount(undefined, surveyorCountStr);
        }}
        aria-invalid={surveyorCountError ? 'true' : undefined}
        aria-describedby="surveyor-count-description"
      />
      <Field.Description
        id="surveyor-count-description"
        aria-live="polite"
        class={surveyorCountError ? 'text-destructive! min-h-5' : 'min-h-5'}
      >
        {surveyorCountError ?? 'Total number of people conducting the survey'}
      </Field.Description>
    </Field.Field>
  </div>

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
            <input
              type="radio"
              name="locationOption"
              value={option.name}
              checked={locationName === option.name}
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

  <div>
    {#if protocol.targets.length === 0}
      <p class="text-muted-foreground mb-6 text-sm">No targets defined for this protocol.</p>
    {:else}
      <div class="sticky top-0 z-10 -mx-4 bg-background px-4 py-2 sm:mx-0">
        <TargetFilterControls filter={targetFilter} />
      </div>
      {#if targetFilter.filtered.length === 0}
        <p class="text-muted-foreground mb-6 mt-2 text-sm">No targets match "{targetFilter.filterQuery}".</p>
      {:else}
        <ul class="-mx-4 mb-6 divide-y border-y sm:mx-0 sm:rounded-lg sm:border">
          {#each targetFilter.filtered as target (target.atUri)}
            {@const qty = organismQuantities[target.atUri]}
            {@const hasCount = qty !== undefined && qty !== '' && qty !== '0'}
            {@const first = target.record.scope[0]}
            <li use:liFlash={flashingTargets[target.atUri] ?? 0} class="flex items-center p-2">
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
                class="mr-3 flex min-h-11 min-w-11 p-2 items-center justify-center rounded-full text-sm font-bold tabular-nums active:scale-120 transition-transform
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
      {#if targetFilter.filterQuery.trim() || targetFilter.onlyObserved}
        <Button variant="ghost" class="w-full mb-4" onclick={() => targetFilter.reset()}>
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
          <li use:liFlash={flashingIncidentals[incidental.localId] ?? 0} class="flex items-center p-2">
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
              class="mr-3 flex min-h-11 min-w-11 items-center justify-center rounded-full p-2 text-sm font-bold tabular-nums active:scale-120 transition-transform
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
      <Button variant="outline" class="flex-1" onclick={cancel}>
        {isEdit ? 'Cancel' : 'Cancel Survey'}
      </Button>
      <Button
        class="flex-1"
        onclick={() => (finishDialogOpen = true)}
        disabled={submitting}
      >
        {#if submitting}
          Saving…
        {:else if isEdit}
          Save Survey
        {:else}
          Finish Survey
        {/if}
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
            onclick={() => {selectedTaxon = null;}}
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
      <Dialog.Title>{isEdit ? 'Cancel editing?' : 'Cancel survey?'}</Dialog.Title>
      <Dialog.Description>
        {isEdit ? 'Your changes will not be saved.' : 'Your progress will be lost.'}
      </Dialog.Description>
    </Dialog.Header>
    <div class="flex gap-2">
      <Button variant="outline" class="flex-1" onclick={() => (cancelDialogOpen = false)}>
        {isEdit ? 'Keep editing' : 'Keep surveying'}
      </Button>
      <Button variant="destructive" class="flex-1" onclick={confirmCancel}>
        {isEdit ? 'Discard changes' : 'Cancel survey'}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={finishDialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{isEdit ? 'Save survey?' : 'Finish survey?'}</AlertDialog.Title>
      <AlertDialog.Description>
        {protocol.record.title} · {locationName || 'no location set'} ·
        {mode === 'past' ? `${pastDurationMinutes} min` : formatElapsed(elapsedSeconds)} ·
        {nonZeroOccurrences}
        {nonZeroOccurrences === 1 ? 'observation' : 'observations'}
      </AlertDialog.Description>
      {#if !isEdit && hasUnresolvedIncidentals(incidentals)}
        {@const unresolvedCount = incidentals.filter((i) => !i.taxonID).length}
        <p class="text-sm text-yellow-700 dark:text-yellow-400 mt-1">
          {unresolvedCount} incidental{unresolvedCount === 1 ? '' : 's'} without taxa. You can resolve them before uploading.
        </p>
      {/if}
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>
        {isEdit ? 'Keep editing' : resumingComplete ? 'Keep editing' : 'Keep going'}
      </AlertDialog.Cancel>
      <AlertDialog.Action onclick={finish}>
        {isEdit ? 'Save' : 'Finish'}
      </AlertDialog.Action>
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
  <Dialog.Root bind:open={incidentals_sheetOpen}>
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
  <Sheet.Root bind:open={incidentals_sheetOpen}>
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

<style>
  @keyframes li-flash {
    from {
      transform: translateY(-50%) scale(0);
      opacity: 0.6;
    }
    to {
      transform: translateY(-50%) scale(16);
      opacity: 0;
    }
  }

  :global(.li-flash) {
    position: relative;
    overflow: hidden;
  }

  :global(.li-flash::after) {
    content: "";
    position: absolute;
    pointer-events: none;
    border-radius: 50%;
    background: oklch(0.85 0.2 91.936);
    width: 3rem;
    height: 3rem;
    top: 50%;
    right: 0.625rem;
    animation: li-flash 500ms ease-out forwards;
  }
</style>
