<script lang="ts">
import Autocomplete from '$lib/components/Autocomplete.svelte';
import FormSection from '$lib/components/FormSection.svelte';
import GeoMap from '$lib/components/GeoMap.svelte';
import { Button } from '$lib/components/ui/button';
import * as Card from '$lib/components/ui/card';
import { Input } from '$lib/components/ui/input';
import { Label } from '$lib/components/ui/label';
import { Textarea } from '$lib/components/ui/textarea';
import { useOnline } from '$lib/composables/online.svelte';
import type {
  TaxonScope,
  VerbatimScope,
} from '$lib/lexicons/bio/lexicons/temp/surveyTarget.defs';
import type { Main as AtAddress } from '$lib/lexicons/community/lexicon/location/address.defs';
import type { Main as AtGeo } from '$lib/lexicons/community/lexicon/location/geo.defs';
import type { Protocol } from '$lib/offline/db';
import type { PlaceResult } from '$lib/places';

interface Props {
  protocol?: Protocol;
}

let { protocol }: Props = $props();

const onlineState = useOnline();

type TaxonTarget = {
  kind: 'taxon';
  scientificName: string;
  taxonRank: string;
  taxonID: string;
  kingdom?: string;
  commonName?: string;
};

type VerbatimTarget = {
  kind: 'verbatim';
  verbatimTargetScope: string;
};

type Target = TaxonTarget | VerbatimTarget;

type InatResult = {
  inatId: number;
  scientificName: string;
  taxonRank: string;
  commonName: string | null;
  kingdom: string | null;
  taxonID: string;
};

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
let targets = $state<Target[]>(
  (protocol?.targets || []).flatMap((t): Target[] => {
    const scope = t.record.scope[0];
    if (!scope) return [];
    if (scope.$type?.endsWith('taxonScope')) {
      const s = scope as TaxonScope;
      return [
        {
          kind: 'taxon',
          scientificName: s.scientificName,
          taxonRank: s.taxonRank,
          taxonID: (s.taxonID as string | undefined) ?? '',
          kingdom: s.kingdom,
          commonName: undefined,
        },
      ];
    }
    return [
      {
        kind: 'verbatim',
        verbatimTargetScope: (scope as VerbatimScope).verbatimTargetScope,
      },
    ];
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

let taxonQuery = $state('');
let taxonResults = $state<InatResult[]>([]);
let searching = $state(false);
let placeQuery = $state('');
let placeResults = $state<PlaceResult[]>([]);
let searchingPlaces = $state(false);
let placeSearched = $state(false);

$effect(() => {
  if (taxonQuery.trim().length < 2) {
    taxonResults = [];
    return;
  }
  const query = taxonQuery.trim();
  const timer = setTimeout(async () => {
    searching = true;
    try {
      const resp = await fetch(`/api/taxa?q=${encodeURIComponent(query)}`);
      const data = await resp.json();
      taxonResults = data.results ?? [];
    } finally {
      searching = false;
    }
  }, 300);
  return () => clearTimeout(timer);
});

function toScope(target: Target): unknown {
  if (target.kind === 'taxon') {
    return {
      $type: 'bio.lexicons.temp.surveyTarget#taxonScope',
      scientificName: target.scientificName,
      taxonRank: target.taxonRank,
      taxonID: target.taxonID,
      ...(target.kingdom ? { kingdom: target.kingdom } : {}),
    };
  }
  return {
    $type: 'bio.lexicons.temp.surveyTarget#verbatimScope',
    verbatimTargetScope: target.verbatimTargetScope,
  };
}

function targetsJson(): string {
  return JSON.stringify(targets.map((t) => ({ scope: [toScope(t)] })));
}

function addTaxon(result: InatResult) {
  targets = [
    ...targets,
    {
      kind: 'taxon',
      scientificName: result.scientificName,
      taxonRank: result.taxonRank,
      taxonID: result.taxonID,
      ...(result.kingdom ? { kingdom: result.kingdom } : {}),
      ...(result.commonName ? { commonName: result.commonName } : {}),
    },
  ];
  taxonQuery = '';
  taxonResults = [];
}

function addVerbatim() {
  targets = [...targets, { kind: 'verbatim', verbatimTargetScope: '' }];
}

function removeTarget(i: number) {
  targets = targets.filter((_, idx) => idx !== i);
}

function labelFor(target: Target): string {
  if (target.kind === 'taxon') {
    return target.commonName
      ? `${target.scientificName} (${target.commonName})`
      : target.scientificName;
  }
  return target.verbatimTargetScope || '(empty)';
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
    <form method="POST" class="flex flex-col gap-6">
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
        </div>
      </div>

      <FormSection title="SURVEY TARGETS">
        <div class="text-muted-foreground text-xs mb-4">
          Choose what surveyors will be looking for, either taxa or something custom.
        </div>

        {#if targets.length > 0}
          <ul class="flex flex-col gap-1">
            {#each targets as target, i (i)}
              <li class="flex items-center justify-between rounded-lg border px-3 py-2 text-sm bg-background">
                {#if target.kind === 'verbatim'}
                  <input
                    class="flex-1 bg-transparent outline-none"
                    placeholder="Describe what to look for…"
                    bind:value={target.verbatimTargetScope}
                  />
                {:else}
                  <span class="flex-1">{labelFor(target)}</span>
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
          <Autocomplete
            placeholder="Search iNaturalist taxa (e.g. Quercus)"
            autocomplete="off"
            bind:value={taxonQuery}
            items={taxonResults}
            onselect={addTaxon}
          >
            {#snippet item(result)}
              <span class="font-medium">{result.scientificName}</span>
              <span class="text-muted-foreground text-xs">{result.taxonRank}</span>
              {#if result.commonName}
                <span class="text-muted-foreground">— {result.commonName}</span>
              {/if}
            {/snippet}
          </Autocomplete>
          {#if searching && taxonResults.length === 0}
            <div class="text-muted-foreground text-xs">Searching…</div>
          {/if}
          <Button type="button" variant="outline" onclick={addVerbatim} class="w-fit text-xs">
            + Add custom target
          </Button>
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
    </form>
    {/if}
  </Card.Content>
</Card.Root>
