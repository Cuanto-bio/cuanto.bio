<script lang="ts">
import { l } from '@atproto/lex';
import Button from '$lib/components/Button.svelte';
import Form from '$lib/components/Form.svelte';
import FormSection from '$lib/components/FormSection.svelte';
import GeoMap from '$lib/components/GeoMap.svelte';
import TaxonAutocomplete, {
  type TaxonResult,
} from '$lib/components/TaxonAutocomplete.svelte';
import * as Card from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { Textarea } from '$lib/components/ui/textarea';
import { useOnline } from '$lib/composables/online.svelte';
import {
  type TaxonScope,
  taxonScope as taxonScopeType,
  type VerbatimScope,
  verbatimScope as verbatimScopeType,
} from '$lib/lexicons/bio/lexicons/temp/v0-1/surveyTarget.defs';
import type { Main as AtAddress } from '$lib/lexicons/community/lexicon/location/address.defs';
import type { Main as AtGeo } from '$lib/lexicons/community/lexicon/location/geo.defs';
import type { Protocol } from '$lib/offline/db';
import type { PlaceResult } from '$lib/places';

interface Props {
  protocol?: Protocol;
}

let { protocol }: Props = $props();

const onlineState = useOnline();

type Target = l.$Typed<TaxonScope> | l.$Typed<VerbatimScope>;

type PlaceEntry = {
  name: string;
  geos: AtGeo[];
  addresses: AtAddress[];
};

// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let title = $state(protocol?.record?.title ?? '');
// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let description = $state(protocol?.record?.description ?? '');

// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let requiredFieldDate = $state(
  protocol?.record?.requiredFields?.includes('eventDate') ?? false,
);
// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let requiredFieldDuration = $state(
  protocol?.record?.requiredFields?.includes('eventDuration') ?? false,
);
// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let requiredFieldSurveyorCount = $state(
  protocol?.record?.requiredFields?.includes('surveyorCount') ?? false,
);

// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let targets = $state<Target[]>(
  (protocol?.targets || []).flatMap((t): Target[] => {
    const scope = t.record.scope[0];
    if (!scope) return [];
    if (taxonScopeType.isTypeOf(scope)) return [{ ...scope }];
    if (verbatimScopeType.isTypeOf(scope)) return [{ ...scope }];
    return [];
  }),
);

// svelte-ignore state_referenced_locally -- intentional: initialize from server data
let places = $state<PlaceEntry[]>(
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

let placeQuery = $state('');
let placeResults = $state<PlaceResult[]>([]);
let searchingPlaces = $state(false);
let placeSearched = $state(false);

let bulkPasteOpen = $state(false);
let bulkPasteText = $state('');
let bulkMatching = $state(false);
let bulkProgress = $state<{ current: number; total: number } | null>(null);
let bulkUnmatched = $state<string[]>([]);

function targetsJson(): string {
  return JSON.stringify(targets.map((t) => ({ scope: [t] })));
}

function addTaxon(result: TaxonResult) {
  const target: l.$Typed<TaxonScope> = {
    $type: 'bio.lexicons.temp.v0-1.surveyTarget#taxonScope',
    scientificName: result.scientificName,
    taxonRank: result.taxonRank,
    ...(result.taxonID ? { taxonID: result.taxonID as l.UriString } : {}),
    ...(result.kingdom ? { kingdom: result.kingdom } : {}),
    ...(result.commonName ? { vernacularName: result.commonName } : {}),
  };
  targets = [...targets, target];
}

function addVerbatim() {
  targets = [
    ...targets,
    {
      $type: 'bio.lexicons.temp.v0-1.surveyTarget#verbatimScope' as const,
      verbatimTargetScope: '',
    },
  ];
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
            {#each targets as target, i (i)}
              <li class="flex items-start justify-between rounded-lg border p-4 text-sm bg-background">
                {#if verbatimScopeType.isTypeOf(target)}
                  <Input
                    placeholder="Describe what to look for…"
                    bind:value={target.verbatimTargetScope}
                  />
                {:else if taxonScopeType.isTypeOf(target)}
                  <div class="flex flex-1 flex-col gap-2">
                    <div class="flex flex-row gap-2">
                      <div class="flex flex-col gap-2 grow">
                        <Label for={`target-sciname-${i}`}>Scientific name</Label>
                        <Input
                          disabled
                          value={target.scientificName}
                          id={`target-sciname-${i}`}
                        />
                      </div>
                      <div class="flex flex-col gap-2">
                        <Label for={`target-rank-${i}`}>Rank</Label>
                        <Input
                          disabled
                          value={target.taxonRank}
                          id={`target-rank-${i}`}
                        />
                      </div>
                    </div>
                    <Label for={`target-vername-${i}`}>Common name</Label>
                    <Input
                      id={`target-vername-${i}`}
                      placeholder="Common name (optional)"
                      value={target.vernacularName ?? ''}
                      oninput={(e) => {
                        target.vernacularName =
                          (e.target as HTMLInputElement).value || undefined;
                      }}
                    />
                    {#if target.taxonID}
                      <div class="text-xs text-muted-foreground">
                        Source: <a href={target.taxonID} target="_blank">{target.taxonID}</a>
                      </div>
                    {/if}
                  </div>
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
