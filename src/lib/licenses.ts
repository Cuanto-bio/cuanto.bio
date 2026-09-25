import type { Main as Remark } from '$lib/lexicons/bio/lexicons/temp/v0-1/remark.defs';

// The licenses a Remark record can be published under. Kept in step with the
// `license` knownValues in lexicons/bio/lexicons/temp/v0-1/remark.json, which
// are license *document URIs* (Dublin Core dcterms:license), not the SPDX
// identifiers media.license still uses. SPDX is primarily a software-license
// vocabulary, so the two are deliberately not interchangeable.

export type RemarkLicense = NonNullable<Remark['license']>;

export const REMARK_LICENSES = [
  {
    value: 'https://creativecommons.org/publicdomain/zero/1.0/',
    label: 'CC0 1.0',
    fullLabel: 'Creative Commons Zero 1.0',
    description: 'No rights reserved',
  },
  {
    value: 'https://creativecommons.org/licenses/by/4.0/',
    label: 'CC BY 4.0',
    fullLabel: 'Creative Commons BY 4.0',
    description: 'Reuse with attribution',
  },
  {
    value: 'https://creativecommons.org/licenses/by-nc/4.0/',
    label: 'CC BY-NC 4.0',
    fullLabel: 'Creative Commons BY-NC 4.0',
    description: 'Attribution, non-commercial use only',
  },
  {
    value: 'https://creativecommons.org/licenses/by-sa/4.0/',
    label: 'CC BY-SA 4.0',
    fullLabel: 'Creative Commons BY-SA 4.0',
    description: 'Attribution, share alike',
  },
  {
    value: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    label: 'CC BY-NC-SA 4.0',
    fullLabel: 'Creative Commons BY-NC-SA 4.0',
    description: 'Attribution, non-commercial, share alike',
  },
] as const satisfies readonly {
  value: RemarkLicense;
  // Short form for compact spots (a Select trigger, a link on a remark).
  label: string;
  // Spelled out for the list a surveyor picks from.
  fullLabel: string;
  description: string;
}[];

// CC0 is the default because biodiversity data is most useful when it can be
// aggregated without license friction (GBIF and iNaturalist both default to
// permissive terms). A surveyor who wants credit can change it on /app/account.
export const DEFAULT_REMARK_LICENSE =
  'https://creativecommons.org/publicdomain/zero/1.0/';

export function isKnownLicense(
  value: string | null | undefined,
): value is RemarkLicense {
  return REMARK_LICENSES.some((l) => l.value === value);
}

/** Short display name for a license URI, falling back to the URI itself. */
export function licenseLabel(value: string): string {
  return REMARK_LICENSES.find((l) => l.value === value)?.label ?? value;
}

/**
 * The license URI if it is safe to use as a link, otherwise null. license comes
 * from any user's record, so only http(s) URLs are linked; anything else (e.g.
 * javascript:) would be a script link on a public page.
 */
export function licenseHref(value: string): string | null {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The signed-in user's default remark license from /api/me/settings, or
 * undefined when it cannot be fetched (offline, signed out). Callers treat
 * undefined as "unknown" and degrade rather than fail, since /app works offline.
 */
export async function fetchDefaultRemarkLicense(
  fetchFn: typeof fetch = fetch,
): Promise<RemarkLicense | undefined> {
  try {
    const res = await fetchFn('/api/me/settings');
    if (!res.ok) return undefined;
    const { defaultRemarkLicense } = (await res.json()) as {
      defaultRemarkLicense?: string;
    };
    return isKnownLicense(defaultRemarkLicense)
      ? defaultRemarkLicense
      : undefined;
  } catch {
    return undefined;
  }
}
