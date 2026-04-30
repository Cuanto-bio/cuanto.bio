import { json } from '@sveltejs/kit';
import type { PlaceResult } from '$lib/places';
import type { RequestHandler } from './$types';

type NominatimAddress = {
  country?: string;
  country_code?: string;
  state?: string;
  city?: string;
  town?: string;
  village?: string;
  postcode?: string;
  road?: string;
  house_number?: string;
};

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address: NominatimAddress;
};

// Per Nominatim usage policy: results must be cached. This is a per-process
// cache, so if this ever deals with serious traffic we'll need a separate
// cache system
const cache = new Map<string, { results: PlaceResult[]; ts: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

// Per Nominatim usage policy: max 1 request/second
let lastRequest = 0;

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return json({ results: [] });
  }

  const key = q.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return json({ results: cached.results });
  }

  const now = Date.now();
  const elapsed = now - lastRequest;
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
  }
  lastRequest = Date.now();

  const params = new URLSearchParams({
    q: q.trim(),
    format: 'jsonv2',
    addressdetails: '1',
    limit: '10',
  });

  const resp = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        'User-Agent': 'cuanto.bio/0.1 (https://cuanto.bio)',
        Referer: 'https://cuanto.bio',
      },
    },
  );

  if (!resp.ok) {
    return json({ error: 'Nominatim API error' }, { status: 502 });
  }

  const data = (await resp.json()) as NominatimResult[];

  const results: PlaceResult[] = data.map((r) => {
    const street = r.address.house_number
      ? `${r.address.house_number} ${r.address.road ?? ''}`.trim()
      : r.address.road;
    return {
      placeId: r.place_id,
      displayName: r.display_name,
      lat: r.lat,
      lon: r.lon,
      address: {
        countryCode: r.address.country_code?.toUpperCase(),
        region: r.address.state,
        locality: r.address.city ?? r.address.town ?? r.address.village,
        postalCode: r.address.postcode,
        street,
      },
    };
  });

  cache.set(key, { results, ts: Date.now() });

  return json({ results });
};
