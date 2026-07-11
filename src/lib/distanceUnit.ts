import { browser } from '$app/environment';
import { DISTANCE_UNITS, type DistanceUnit } from '$lib/distance';

// Persists the unit the user last picked for reading track distances. Stored in
// localStorage, following the `name:thing` key convention of the install-prompt
// flag: it is a display preference the server never needs, and it should
// survive reloads so the choice is made once rather than on every survey. All
// access is guarded for the absence of localStorage (SSR, private mode, storage
// disabled) so callers never throw.

export const DISTANCE_UNIT_KEY = 'cuanto:distance-unit';

const DEFAULT_UNIT: DistanceUnit = 'km';

function isDistanceUnit(value: string | null): value is DistanceUnit {
  return DISTANCE_UNITS.some((u) => u.value === value);
}

export function readDistanceUnit(): DistanceUnit {
  if (!browser) return DEFAULT_UNIT;
  try {
    const stored = localStorage.getItem(DISTANCE_UNIT_KEY);
    return isDistanceUnit(stored) ? stored : DEFAULT_UNIT;
  } catch {
    return DEFAULT_UNIT;
  }
}

export function writeDistanceUnit(unit: DistanceUnit): void {
  if (!browser) return;
  try {
    localStorage.setItem(DISTANCE_UNIT_KEY, unit);
  } catch {
    // Storage unavailable (private mode / quota) — the choice just won't stick.
  }
}
