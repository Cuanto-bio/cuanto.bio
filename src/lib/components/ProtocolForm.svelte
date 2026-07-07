<script lang="ts">
import { l } from '@atproto/lex';
import { onDestroy, tick } from 'svelte';
import Button from '$lib/components/Button.svelte';
import Form from '$lib/components/Form.svelte';
import FormSection from '$lib/components/FormSection.svelte';
import GeoMap from '$lib/components/GeoMap.svelte';
import InatPlaceAutocomplete from '$lib/components/InatPlaceAutocomplete.svelte';
import TaxonAutocomplete, {
  type TaxonResult,
} from '$lib/components/TaxonAutocomplete.svelte';
import * as Alert from '$lib/components/ui/alert';
import { Badge } from '$lib/components/ui/badge';
import * as Card from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { Textarea } from '$lib/components/ui/textarea';
import { useOnline } from '$lib/composables/online.svelte';
import { INAT_SPECIES_PAGE_CAP } from '$lib/inat';
import {
  type TaxonScope,
  taxonScope as taxonScopeType,
  type VerbatimScope,
  verbatimScope as verbatimScopeType,
} from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import type { Main as AtAddress } from '$lib/lexicons/community/lexicon/location/address.defs';
import type { Main as AtGeo } from '$lib/lexicons/community/lexicon/location/geo.defs';
import type { Protocol } from '$lib/offline/db';
import type { InatPlace, PlaceResult } from '$lib/places';
import { partitionNewTaxa, targetTaxonID } from '$lib/targets.svelte';

interface Props {
  protocol?: Protocol;
  form?: { error?: string; sessionExpired?: boolean } | null;
}

let { protocol, form }: Props = $props();

const onlineState = useOnline();

// Not AtProtocolTarget: atUri is optional (new targets have none yet) and we don't
// track protocol or $type here — those are only needed when writing to the PDS.
// `key` is a client-only id (not persisted) used to key the target list and to
// flash a target when it's added, regardless of which of the several ways of
// adding a target (single search, bulk paste, iNat import) produced it.
type Target = {
  atUri?: string;
  key: string;
  scope: (l.$Typed<TaxonScope> | l.$Typed<VerbatimScope>)[];
};

type PlaceEntry = {
  name: string;
  geos: AtGeo[];
  addresses: AtAddress[];
};

type Draft = {
  title: string;
  description: string;
  requiredFieldDate: boolean;
  requiredFieldDuration: boolean;
  requiredFieldSurveyorCount: boolean;
  targets: Target[];
  places: PlaceEntry[];
  savedAt: number;
};

// A stashed draft older than this is treated as abandoned (e.g. the user
// clicked "Sign in" but never completed the round trip) rather than restored,
// so it doesn't resurface and silently overwrite an unrelated later visit to
// this form. Matches the return_to cookie's maxAge in auth/signin/+page.server.ts,
// since both are bridging the same reauth round trip.
const DRAFT_MAX_AGE_MS = 10 * 60 * 1000;

// Scoped to this specific protocol (or 'new') so drafts from different tabs/forms
// don't collide.
// svelte-ignore state_referenced_locally -- intentional: derived once from the prop this form was mounted with
const draftKey = protocol
  ? `protocol-draft:edit:${protocol.atUri}`
  : 'protocol-draft:new';

// svelte-ignore state_referenced_locally -- intentional: derived once from the prop this form was mounted with
const returnTo = protocol
  ? `/protocols/${protocol.handle}/${protocol.rkey}/edit`
  : '/protocols/new';

// Reads back a draft stashed just before navigating to sign back in after a PDS
// session expired (see the "Sign in" link below), so the user's in-progress
// entries survive the OAuth redirect round trip. Consumed once: cleared
// immediately so a stale draft can't leak into an unrelated future visit. Also
// discarded if too old, since an abandoned sign-in attempt (closed tab,
// cancelled auth, browsed away) would otherwise sit in sessionStorage for the
// rest of the browser tab's life and resurface unexpectedly on some later,
// unrelated visit to this same URL.
function readAndClearDraft(): Draft | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(draftKey);
  if (!raw) return null;
  sessionStorage.removeItem(draftKey);
  try {
    const draft = JSON.parse(raw) as Draft;
    if (Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) return null;
    return draft;
  } catch {
    return null;
  }
}

// svelte-ignore state_referenced_locally -- intentional: read once at init
const savedDraft = readAndClearDraft();

// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let title = $state(savedDraft?.title ?? protocol?.record?.title ?? '');
// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let description = $state(
  savedDraft?.description ?? protocol?.record?.description ?? '',
);

// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let requiredFieldDate = $state(
  savedDraft?.requiredFieldDate ??
    protocol?.record?.requiredFields?.includes('eventDate') ??
    false,
);
// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let requiredFieldDuration = $state(
  savedDraft?.requiredFieldDuration ??
    protocol?.record?.requiredFields?.includes('eventDuration') ??
    false,
);
// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let requiredFieldSurveyorCount = $state(
  savedDraft?.requiredFieldSurveyorCount ??
    protocol?.record?.requiredFields?.includes('surveyorCount') ??
    false,
);

// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let targets = $state<Target[]>(
  savedDraft?.targets ??
    (protocol?.targets || []).map((t) => ({
      atUri: t.atUri,
      // Persisted targets already have a stable, unique id in atUri; only
      // targets with no atUri yet (added below) need a generated one.
      key: t.atUri,
      scope: t.record.scope as (
        | l.$Typed<TaxonScope>
        | l.$Typed<VerbatimScope>
      )[],
    })),
);

// Keys of targets that were just added, so their row can flash. See Target.key.
let flashKeys = $state<Set<string>>(new Set());
const FLASH_DURATION_MS = 1000;
const flashTimeouts = new Set<ReturnType<typeof setTimeout>>();

function flashNewTargets(keys: string[]) {
  flashKeys = new Set([...flashKeys, ...keys]);
  const timeoutId = setTimeout(() => {
    flashTimeouts.delete(timeoutId);
    const next = new Set(flashKeys);
    for (const key of keys) next.delete(key);
    flashKeys = next;
  }, FLASH_DURATION_MS);
  flashTimeouts.add(timeoutId);
}

onDestroy(() => {
  for (const timeoutId of flashTimeouts) clearTimeout(timeoutId);
});

// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let places = $state<PlaceEntry[]>(
  savedDraft?.places ??
    (protocol?.record?.locationOptions ?? []).map((place) => ({
      name: place.name,
      geos: (place.locations ?? []).filter(
        (loc) => loc.$type === 'community.lexicon.location.geo',
      ) as AtGeo[],
      addresses: (place.locations ?? []).filter(
        (loc) => loc.$type === 'community.lexicon.location.address',
      ) as AtAddress[],
    })),
);

// Stashes the in-progress draft to sessionStorage before following the "Sign
// in" link, so it can be restored by readAndClearDraft() when the user lands
// back on this form after re-authenticating.
function stashDraft() {
  if (typeof sessionStorage === 'undefined') return;
  const draft: Draft = {
    title,
    description,
    requiredFieldDate,
    requiredFieldDuration,
    requiredFieldSurveyorCount,
    targets: $state.snapshot(targets),
    places: $state.snapshot(places),
    savedAt: Date.now(),
  };
  sessionStorage.setItem(draftKey, JSON.stringify(draft));
}

let placeQuery = $state('');
let placeResults = $state<PlaceResult[]>([]);
let searchingPlaces = $state(false);
let placeSearched = $state(false);

let bulkPasteOpen = $state(false);
let bulkPasteText = $state('');
let bulkMatching = $state(false);
let bulkProgress = $state<{ current: number; total: number } | null>(null);
let bulkUnmatched = $state<string[]>([]);

// "Import targets from iNaturalist observations" (issue #9): pick an iNat place
// (optionally a parent taxon), fetch the species observed there, and add each as
// a target, skipping taxa already present.
let inatImportOpen = $state(false);
let inatSelectedPlace = $state<InatPlace | null>(null);
let inatTaxon = $state<TaxonResult | null>(null);
let inatPlaceInputRef = $state<HTMLInputElement | null>(null);
let inatTaxonInputRef = $state<HTMLInputElement | null>(null);
let inatImportButtonRef = $state<HTMLElement | null>(null);
let inatImporting = $state(false);
let inatImportResult = $state<{ added: number; skipped: number } | null>(null);
let inatImportError = $state<string | null>(null);

// The button is disabled until both a place and a taxon are chosen, so wait a
// tick for that DOM update to land before focusing it (it may have just
// become enabled).
async function focusImportButton() {
  await tick();
  inatImportButtonRef?.focus();
}

// Both a place and a taxon are required before an import can run; referenced
// by the button's disabled state and by importFromInat's own guard so the
// requirement can't drift between the two.
const canImportFromInat = $derived(!!inatSelectedPlace && !!inatTaxon);

// Preview of how many species match the current place + taxon, fetched with
// per_page=0 (?count=true) so it's cheap to request on every selection change.
let inatCount = $state<number | null>(null);

$effect(() => {
  const place = inatSelectedPlace;
  const taxon = inatTaxon;
  inatCount = null;
  if (!place || !taxon || !onlineState.value) return;

  // Abort a superseded request outright (not just ignore its result) so a
  // rapid re-selection doesn't leave a discarded call to the iNat API running.
  const controller = new AbortController();
  const params = new URLSearchParams({
    place_id: String(place.id),
    taxon_id: String(taxon.inatId),
    count: 'true',
  });
  fetch(`/api/species-counts?${params}`, { signal: controller.signal })
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((data: { total?: number } | null) => {
      if (!controller.signal.aborted) inatCount = data?.total ?? null;
    })
    .catch(() => {
      if (!controller.signal.aborted) inatCount = null;
    });
  return () => controller.abort();
});

const importButtonLabel = $derived(
  inatImporting
    ? 'Importing…'
    : inatCount === null
      ? 'Import research-grade species'
      : inatCount > INAT_SPECIES_PAGE_CAP
        ? `Import first ${INAT_SPECIES_PAGE_CAP} of ${inatCount} species`
        : `Import ${inatCount} research-grade species`,
);

function targetsJson(): string {
  return JSON.stringify(
    targets.map((t) => ({ scope: t.scope, atUri: t.atUri })),
  );
}

function taxonTarget(result: TaxonResult): Target {
  return {
    key: crypto.randomUUID(),
    scope: [
      {
        $type: 'bio.cuanto.protocolTarget#taxonScope' as const,
        scientificName: result.scientificName,
        taxonRank: result.taxonRank,
        ...(result.taxonID ? { taxonID: result.taxonID as l.UriString } : {}),
        ...(result.kingdom ? { kingdom: result.kingdom } : {}),
        ...(result.commonName ? { vernacularName: result.commonName } : {}),
      },
    ],
  };
}

function addTaxon(result: TaxonResult) {
  const target = taxonTarget(result);
  targets = [...targets, target];
  flashNewTargets([target.key]);
}

function addVerbatim() {
  const target: Target = {
    key: crypto.randomUUID(),
    scope: [
      {
        $type: 'bio.cuanto.protocolTarget#verbatimScope' as const,
        verbatimTargetScope: '',
      },
    ],
  };
  targets = [...targets, target];
  flashNewTargets([target.key]);
}

function removeTarget(i: number) {
  targets = targets.filter((_, idx) => idx !== i);
}

function placesJson(): string {
  return JSON.stringify(
    places.map((p) => ({
      $type: 'org.atgeo.place',
      name: p.name,
      locations: [...p.geos, ...p.addresses],
    })),
  );
}

function addLocation() {
  places = [...places, { name: '', geos: [], addresses: [] }];
}

function removeLocation(i: number) {
  places = places.filter((_, idx) => idx !== i);
}

function addGeo(i: number) {
  places[i].geos = [
    ...places[i].geos,
    {
      $type: 'community.lexicon.location.geo',
      latitude: '',
      longitude: '',
    },
  ];
}

function removeGeo(i: number, j: number) {
  places[i].geos = places[i].geos.filter((_, idx) => idx !== j);
}

async function searchPlace() {
  if (placeQuery.trim().length < 2) return;
  searchingPlaces = true;
  try {
    const resp = await fetch(
      `/api/places?q=${encodeURIComponent(placeQuery.trim())}`,
    );
    const data = await resp.json();
    placeResults = data.results ?? [];
  } finally {
    searchingPlaces = false;
    placeSearched = true;
  }
}

function shortName(displayName: string): string {
  return displayName.split(',')[0].trim();
}

function addPlaceFromResult(result: PlaceResult) {
  const name = shortName(result.displayName);
  const hasAddress =
    result.address.countryCode ||
    result.address.region ||
    result.address.locality;
  places = [
    ...places,
    {
      name,
      geos: [
        {
          $type: 'community.lexicon.location.geo',
          latitude: result.lat,
          longitude: result.lon,
        },
      ],
      addresses: hasAddress
        ? [
            {
              $type: 'community.lexicon.location.address',
              country: result.address.countryCode ?? '',
              region: result.address.region ?? '',
              locality: result.address.locality ?? '',
              postalCode: result.address.postalCode ?? '',
              street: result.address.street ?? '',
            },
          ]
        : [],
    },
  ];
  placeQuery = '';
  placeResults = [];
}

async function matchBulkNames() {
  const lines = bulkPasteText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return;
  bulkMatching = true;
  bulkProgress = { current: 0, total: lines.length };
  bulkUnmatched = [];
  const unmatched: string[] = [];
  for (const name of lines) {
    try {
      const resp = await fetch(`/api/taxa?q=${encodeURIComponent(name)}`);
      const data = await resp.json();
      const results: TaxonResult[] = data.results ?? [];
      const match = results.find(
        (r) => r.scientificName.toLowerCase() === name.toLowerCase(),
      );
      if (match) {
        addTaxon(match);
      } else {
        unmatched.push(name);
      }
    } catch {
      unmatched.push(name);
    }
    bulkProgress = {
      current: (bulkProgress?.current ?? 0) + 1,
      total: lines.length,
    };
  }
  bulkUnmatched = unmatched;
  bulkMatching = false;
  bulkProgress = null;
  bulkPasteText = '';
}

async function importFromInat() {
  if (!canImportFromInat) return;
  // canImportFromInat just confirmed both are set.
  const place = inatSelectedPlace as InatPlace;
  const taxon = inatTaxon as TaxonResult;
  inatImporting = true;
  inatImportResult = null;
  inatImportError = null;
  try {
    const params = new URLSearchParams({
      place_id: String(place.id),
      taxon_id: String(taxon.inatId),
    });
    const resp = await fetch(`/api/species-counts?${params}`);
    if (!resp.ok) {
      inatImportError = 'Could not fetch species from iNaturalist.';
      return;
    }
    const data = (await resp.json()) as { results: TaxonResult[] };
    const existingIds = targets
      .map((t) => targetTaxonID(t.scope))
      .filter((id): id is string => !!id);
    const { toAdd, skipped } = partitionNewTaxa(
      existingIds,
      data.results ?? [],
    );
    const newTargets = toAdd.map(taxonTarget);
    targets = [...targets, ...newTargets];
    flashNewTargets(newTargets.map((t) => t.key));
    inatImportResult = { added: toAdd.length, skipped };
  } catch {
    inatImportError = 'Could not fetch species from iNaturalist.';
  } finally {
    inatImporting = false;
  }
}

function addAddress(i: number) {
  places[i].addresses = [
    ...places[i].addresses,
    {
      $type: 'community.lexicon.location.address',
      country: '',
      postalCode: '',
      region: '',
      locality: '',
      street: '',
    },
  ];
}

function removeAddress(i: number, j: number) {
  places[i].addresses = places[i].addresses.filter((_, idx) => idx !== j);
}
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>
      {protocol ? 'Edit Protocol' : 'New Protocol'}
    </Card.Title>
    <Card.Description>
      {
        protocol
          ? 'Update the protocol definition.'
          : 'Define what surveyors should look for.'
      }
    </Card.Description>
  </Card.Header>
  <Card.Content>
    {#if !onlineState.value}
      <p class="text-muted-foreground text-sm">
        Editing a protocol requires an internet connection. Please reconnect and try again.
      </p>
    {:else}
    <Form method="POST" class="flex flex-col gap-6">
      {#if form?.sessionExpired}
        <Alert.Root class="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
          <Alert.Title>Session expired</Alert.Title>
          <Alert.Description>
            Your connection to the AT Protocol network has expired. Your entries
            below are still here — sign in again to save them.
            <a
              href={`/auth/signin?returnTo=${encodeURIComponent(returnTo)}`}
              onclick={stashDraft}
              class="underline font-medium ml-1"
            >
              Sign in
            </a>
          </Alert.Description>
        </Alert.Root>
      {:else if form?.error}
        <Alert.Root variant="destructive">
          <Alert.Description>{form.error}</Alert.Description>
        </Alert.Root>
      {/if}
      <div class="flex flex-col gap-2">
        <Label for="title">Title</Label>
        <Input
          id="title"
          name="title"
          required
          placeholder="e.g. Urban Pollinator Survey"
          bind:value={title}
        />
      </div>

      <div class="flex flex-col gap-2">
        <Label for="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          required
          placeholder="Describe what participants should do and observe."
          rows={4}
          bind:value={description}
        />
      </div>

      <div class="flex flex-col gap-2">
        <Label>Required fields</Label>
        <div class="flex flex-col gap-1">
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="requiredFields"
              value="eventDate"
              bind:checked={requiredFieldDate}
            />
            Event date
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="requiredFields"
              value="eventDuration"
              bind:checked={requiredFieldDuration}
            />
            Event duration
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="requiredFields"
              value="surveyorCount"
              bind:checked={requiredFieldSurveyorCount}
            />
            Surveyor count
          </label>
        </div>
      </div>

      <FormSection title="SURVEY TARGETS">
        <div class="text-muted-foreground text-xs mb-4">
          Choose what surveyors will be looking for, either taxa or something custom.
        </div>

        {#if targets.length > 0}
          <ul class="flex flex-col gap-4">
            {#each targets as target, i (target.key)}
              {@const scope = target.scope[0]}
              <li
                class="flex items-start justify-between rounded-lg border p-4 text-sm bg-background {flashKeys.has(
                  target.key,
                )
                  ? 'animate-target-flash'
                  : ''}"
              >
                {#if scope && verbatimScopeType.isTypeOf(scope)}
                  <Input
                    placeholder="Describe what to look for…"
                    bind:value={scope.verbatimTargetScope}
                  />
                {:else if scope && taxonScopeType.isTypeOf(scope)}
                  <div class="flex flex-1 flex-col gap-2">
                    <div class="flex flex-row gap-2">
                      <div class="flex flex-col gap-2 grow">
                        <Label for={`target-sciname-${i}`}>Scientific name</Label>
                        <Input
                          disabled
                          value={scope.scientificName}
                          id={`target-sciname-${i}`}
                        />
                      </div>
                      <div class="flex flex-col gap-2">
                        <Label for={`target-rank-${i}`}>Rank</Label>
                        <Input
                          disabled
                          value={scope.taxonRank}
                          id={`target-rank-${i}`}
                        />
                      </div>
                    </div>
                    <Label for={`target-vername-${i}`}>Common name</Label>
                    <Input
                      id={`target-vername-${i}`}
                      placeholder="Common name (optional)"
                      value={scope.vernacularName ?? ''}
                      oninput={(e) => {
                        scope.vernacularName =
                          (e.target as HTMLInputElement).value || undefined;
                      }}
                    />
                    {#if scope.taxonID}
                      <div class="text-xs text-muted-foreground">
                        Source: <a href={scope.taxonID} target="_blank">{scope.taxonID}</a>
                      </div>
                    {/if}
                  </div>
                {:else}
                  <div>Unrecognized target scope: <code>{JSON.stringify(scope)}</code></div>
                {/if}
                <button
                  type="button"
                  onclick={() => removeTarget(i)}
                  class="text-muted-foreground hover:text-foreground ml-2"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="bg-background flex flex-col gap-2 rounded-lg border p-3 mt-4">
          <TaxonAutocomplete
            placeholder="Search iNaturalist taxa (e.g. Quercus)"
            onSelectTaxon={addTaxon}
          />
          <Button type="button" variant="outline" onclick={addVerbatim} class="w-fit text-xs">
            + Add custom target
          </Button>
          <div class="border-t pt-2">
            <button
              type="button"
              onclick={() => { bulkPasteOpen = !bulkPasteOpen; bulkUnmatched = []; }}
              class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {bulkPasteOpen ? '▾' : '▸'} Paste a list of scientific names
            </button>
            {#if bulkPasteOpen}
              <div class="flex flex-col gap-2 mt-2">
                <Textarea
                  placeholder="One scientific name per line, e.g.&#10;Quercus robur&#10;Bombus terrestris"
                  rows={5}
                  bind:value={bulkPasteText}
                  disabled={bulkMatching}
                />
                <Button
                  type="button"
                  variant="outline"
                  class="w-fit text-xs"
                  disabled={bulkMatching || !bulkPasteText.trim()}
                  onclick={matchBulkNames}
                >
                  {#if bulkMatching && bulkProgress}
                    Matching {bulkProgress.current} of {bulkProgress.total}…
                  {:else}
                    Match taxa
                  {/if}
                </Button>
                {#if bulkUnmatched.length > 0}
                  <div class="rounded border p-2 text-xs">
                    <p class="font-medium mb-1">
                      Not matched to any iNaturalist taxon ({bulkUnmatched.length}):
                    </p>
                    <ul class="list-disc pl-4 text-muted-foreground space-y-0.5">
                      {#each bulkUnmatched as name (name)}
                        <li>{name}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
          <div class="border-t pt-2">
            <button
              type="button"
              onclick={() => { inatImportOpen = !inatImportOpen; inatImportResult = null; inatImportError = null; }}
              class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {inatImportOpen ? '▾' : '▸'} Import taxa observed at an iNaturalist place
            </button>
            {#if inatImportOpen}
              <div class="flex flex-col gap-2 mt-2">
                <Label>Place</Label>
                {#if inatSelectedPlace}
                  <Badge variant="secondary" class="h-auto w-fit gap-1.5 py-1 pl-2.5 pr-1.5 text-sm">
                    {inatSelectedPlace.displayName}
                    <button
                      type="button"
                      onclick={() => { inatSelectedPlace = null; }}
                      class="text-muted-foreground hover:text-foreground"
                      aria-label="Clear place"
                    >
                      ✕
                    </button>
                  </Badge>
                {:else}
                  <InatPlaceAutocomplete
                    bind:ref={inatPlaceInputRef}
                    placeholder="Search iNaturalist places (e.g. California)"
                    onSelectPlace={(place) => {
                      inatSelectedPlace = place;
                      if (!inatTaxon) inatTaxonInputRef?.focus();
                      else focusImportButton();
                    }}
                  />
                {/if}

                <Label>Taxon filter</Label>
                {#if inatTaxon}
                  <Badge variant="secondary" class="h-auto w-fit gap-1.5 py-1 pl-2.5 pr-1.5 text-sm">
                    {inatTaxon.scientificName}
                    <button
                      type="button"
                      onclick={() => { inatTaxon = null; }}
                      class="text-muted-foreground hover:text-foreground"
                      aria-label="Clear taxon"
                    >
                      ✕
                    </button>
                  </Badge>
                {:else}
                  <TaxonAutocomplete
                    bind:ref={inatTaxonInputRef}
                    placeholder="Search iNaturalist taxa (e.g. Aves)"
                    onSelectTaxon={(r) => {
                      inatTaxon = r;
                      if (!inatSelectedPlace) inatPlaceInputRef?.focus();
                      else focusImportButton();
                    }}
                  />
                {/if}

                <Button
                  bind:ref={inatImportButtonRef}
                  type="button"
                  variant="outline"
                  class="w-fit text-xs"
                  disabled={inatImporting || !canImportFromInat}
                  onclick={importFromInat}
                >
                  {importButtonLabel}
                </Button>
                {#if inatImportResult}
                  <p class="text-xs text-muted-foreground">
                    Added {inatImportResult.added}
                    {inatImportResult.added === 1 ? 'target' : 'targets'}{inatImportResult.skipped > 0
                      ? `, skipped ${inatImportResult.skipped} already present`
                      : ''}.
                  </p>
                {/if}
                {#if inatImportError}
                  <p class="text-xs text-destructive">{inatImportError}</p>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      </FormSection>

      <FormSection title="LOCATION OPTIONS" optional>
        <div class="text-muted-foreground text-xs mb-4">
          Define a controlled list of locations surveyors must choose from. Leave empty to allow
          free-form location entry.
        </div>

        {#if places.length > 0}
          <ul class="flex flex-col gap-3">
            {#each places as location, i (i)}
              <li class="flex flex-col gap-2 rounded-lg border p-3">
                <div class="flex items-center gap-2">
                  <Input
                    placeholder="Location name"
                    bind:value={location.name}
                    class="flex-1"
                    required
                  />
                  <button
                    type="button"
                    onclick={() => removeLocation(i)}
                    class="text-muted-foreground hover:text-foreground"
                    aria-label="Remove location"
                  >✕</button>
                </div>

                {#each location.geos as geo, j (j)}
                  <div class="flex flex-col gap-1 pl-2">
                    <div class="flex items-center gap-2">
                      <Input
                        placeholder="Latitude"
                        bind:value={geo.latitude}
                        class="w-32"
                        type="number"
                        step="any"
                      />
                      <Input
                        placeholder="Longitude"
                        bind:value={geo.longitude}
                        class="w-32"
                        type="number"
                        step="any"
                      />
                      <button
                        type="button"
                        onclick={() => removeGeo(i, j)}
                        class="text-muted-foreground hover:text-foreground text-xs"
                        aria-label="Remove coordinates"
                      >✕</button>
                    </div>
                    {#if !Number.isNaN(parseFloat(String(geo.latitude ?? ''))) && !Number.isNaN(parseFloat(String(geo.longitude ?? '')))}
                      <GeoMap
                        latitude={String(geo.latitude)}
                        longitude={String(geo.longitude)}
                        oncoordinate={(lat, lng) => {
                          geo.latitude = lat;
                          geo.longitude = lng;
                        }}
                      />
                    {/if}
                  </div>
                {/each}

                {#each location.addresses as addr, j (j)}
                  <div class="flex flex-col gap-1 pl-2">
                    <div class="flex items-center gap-2">
                      <span class="text-muted-foreground w-20 text-xs">Country *</span>
                      <Input
                        placeholder="US"
                        bind:value={addr.country}
                        class="w-20"
                        maxlength={10}
                        required
                      />
                      <span class="text-muted-foreground w-20 text-xs">Postal code</span>
                      <Input
                        placeholder="94103"
                        bind:value={addr.postalCode}
                        class="w-24"
                      />
                      <button
                        type="button"
                        onclick={() => removeAddress(i, j)}
                        class="text-muted-foreground hover:text-foreground text-xs"
                        aria-label="Remove address"
                      >✕</button>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-muted-foreground w-20 text-xs">Region</span>
                      <Input placeholder="CA" bind:value={addr.region} class="w-24" />
                      <span class="text-muted-foreground w-20 text-xs">Locality</span>
                      <Input
                        placeholder="San Francisco"
                        bind:value={addr.locality}
                        class="flex-1"
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-muted-foreground w-20 text-xs">Street</span>
                      <Input
                        placeholder="123 Main St"
                        bind:value={addr.street}
                        class="flex-1"
                      />
                    </div>
                  </div>
                {/each}

                <div class="flex gap-2 pl-2">
                  {#if location.geos.length === 0}
                    <Button
                      type="button"
                      variant="ghost"
                      onclick={() => addGeo(i)}
                      class="h-7 text-xs"
                    >
                      + Add coordinates
                    </Button>
                  {/if}
                  {#if location.addresses.length === 0}
                    <Button
                      type="button"
                      variant="ghost"
                      onclick={() => addAddress(i)}
                      class="h-7 text-xs"
                    >
                      + Add address
                    </Button>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="bg-background flex flex-col gap-2 rounded-lg border p-3 mt-4">
          <div class="flex gap-2">
            <Input
              placeholder="Search for a place on OpenStreetMap…"
              bind:value={placeQuery}
              class="flex-1"
              autocomplete="off"
              oninput={() => { placeSearched = false; placeResults = []; }}
              onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchPlace(); } }}
              onblur={() => { placeSearched = false; }}
            />
            <Button
              type="button"
              variant={placeQuery.trim().length >= 2 && !placeSearched ? 'default' : 'outline'}
              onclick={searchPlace}
              disabled={searchingPlaces}
            >
              {searchingPlaces ? 'Searching…' : 'Search'}
            </Button>
          </div>
          {#if placeResults.length > 0}
            <ul class="flex flex-col divide-y overflow-hidden rounded border">
              {#each placeResults as result (result.placeId)}
                <li>
                  <button
                    type="button"
                    onclick={() => addPlaceFromResult(result)}
                    class="hover:bg-accent flex w-full min-w-0 flex-col px-3 py-2 text-left text-sm"
                  >
                    <div class="font-medium">{shortName(result.displayName)}</div>
                    <div class="text-muted-foreground text-xs line-clamp-1">
                      {result.displayName}
                    </div>
                  </button>
                </li>
              {/each}
            </ul>
          {:else if !searchingPlaces && placeSearched}
            <p class="text-muted-foreground text-xs">No results. Try a different search.</p>
          {/if}
          <Button type="button" variant="outline" onclick={addLocation} class="w-fit text-xs">
            + Add manually
          </Button>
        </div>
      </FormSection>

      <input type="hidden" name="targets" value={targetsJson()} />
      <input type="hidden" name="locationOptions" value={placesJson()} />

      <Button type="submit">{protocol ? 'Save changes' : 'Create protocol'}</Button>
    </Form>
    {/if}
  </Card.Content>
</Card.Root>
