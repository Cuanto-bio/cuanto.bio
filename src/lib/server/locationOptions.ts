import type { Main as AtAddress } from '$lib/lexicons/community/lexicon/location/address.defs';
import type { Main as AtGeo } from '$lib/lexicons/community/lexicon/location/geo.defs';
import type { Main as AtPlace } from '$lib/lexicons/org/atgeo/place.defs';

export function parseLocationOptions(json: string | null): AtPlace[] {
  const parsed: AtPlace[] = JSON.parse(json ?? '[]');
  return parsed
    .filter((place) => place.name.trim())
    .map((place) => {
      const locs: AtPlace['locations'] = [];
      for (const loc of place.locations ?? []) {
        if (loc.$type === 'community.lexicon.location.geo') {
          const geo = loc as AtGeo;
          for (const coord of [geo.latitude, geo.longitude]) {
            // We don't really know what the user sent us, so we ensure
            // these coordinates are numbers
            if (coord == null || coord === '' || Number.isNaN(Number(coord))) {
              throw new Error('Latitude and longitude must be numbers');
            }
          }
          locs.push({
            $type: 'community.lexicon.location.geo',
            // The lexicon specifies string floats, so no matter what we receive,
            latitude: String(geo.latitude),
            longitude: String(geo.longitude),
          });
        } else if (loc.$type === 'community.lexicon.location.address') {
          const addr = loc as AtAddress;
          if (!addr.country || addr.country.trim().length < 2) {
            throw new Error('Address country must be at least 2 characters');
          }
          locs.push({
            $type: 'community.lexicon.location.address',
            country: addr.country,
            ...(addr.postalCode ? { postalCode: addr.postalCode } : {}),
            ...(addr.region ? { region: addr.region } : {}),
            ...(addr.locality ? { locality: addr.locality } : {}),
            ...(addr.street ? { street: addr.street } : {}),
          });
        }
      }
      return {
        $type: 'org.atgeo.place' as const,
        name: place.name.trim(),
        ...(locs.length ? { locations: locs } : {}),
      };
    });
}
