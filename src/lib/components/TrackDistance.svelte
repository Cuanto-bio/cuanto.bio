<script lang="ts">
import { onMount } from 'svelte';
import * as Select from '$lib/components/ui/select';
import {
  DISTANCE_UNITS,
  type DistanceUnit,
  formatDistance,
  formatDistanceValue,
  trackDistanceMeters,
} from '$lib/distance';
import { readDistanceUnit, writeDistanceUnit } from '$lib/distanceUnit';
import type { GpsTrackPoint } from '$lib/gpx';
import { cn } from '$lib/utils';

interface Props {
  points: GpsTrackPoint[];
  class?: string;
}

let { points, class: className }: Props = $props();

// Start on the default and adopt the stored preference after mount: reading
// localStorage during render would disagree with the server-rendered markup.
let unit = $state<DistanceUnit>('km');

onMount(() => {
  unit = readDistanceUnit();
});

function setUnit(value: string) {
  unit = value as DistanceUnit;
  writeDistanceUnit(unit);
}

const meters = $derived(trackDistanceMeters(points));
</script>

<div class={cn('flex items-center gap-2', className)}>
  <!-- The select names the unit, so the readout itself is the bare number. -->
  <span aria-hidden="true" class="tabular-nums">{formatDistanceValue(meters, unit)}</span>
  <span class="sr-only">{formatDistance(meters, unit)}</span>
  <Select.Root type="single" bind:value={() => unit, setUnit}>
    <Select.Trigger size="sm" aria-label="Distance units" class="h-7 py-0 text-xs">
      {unit}
    </Select.Trigger>
    <Select.Content>
      {#each DISTANCE_UNITS as option (option.value)}
        <Select.Item value={option.value} label={option.label}>
          {option.label}
        </Select.Item>
      {/each}
    </Select.Content>
  </Select.Root>
</div>
