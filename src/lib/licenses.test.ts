import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMARK_LICENSE,
  isKnownLicense,
  licenseHref,
  licenseLabel,
  REMARK_LICENSES,
} from './licenses';

describe('remark licenses', () => {
  it('offers exactly the license URIs the remark lexicon lists as knownValues', () => {
    expect(REMARK_LICENSES.map((l) => l.value)).toEqual([
      'https://creativecommons.org/publicdomain/zero/1.0/',
      'https://creativecommons.org/licenses/by/4.0/',
      'https://creativecommons.org/licenses/by-nc/4.0/',
      'https://creativecommons.org/licenses/by-sa/4.0/',
      'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    ]);
  });

  it('defaults to CC0', () => {
    expect(DEFAULT_REMARK_LICENSE).toBe(
      'https://creativecommons.org/publicdomain/zero/1.0/',
    );
    expect(isKnownLicense(DEFAULT_REMARK_LICENSE)).toBe(true);
  });

  it('accepts every offered license', () => {
    for (const license of REMARK_LICENSES) {
      expect(isKnownLicense(license.value)).toBe(true);
    }
  });

  it('rejects anything not in the list', () => {
    // An SPDX identifier is the tempting wrong answer: media.license still uses
    // them, but dcterms:license wants the URI of the license document.
    expect(isKnownLicense('CC0-1.0')).toBe(false);
    expect(isKnownLicense('')).toBe(false);
    expect(isKnownLicense(null)).toBe(false);
    expect(isKnownLicense(undefined)).toBe(false);
    expect(isKnownLicense('http://example.com/license')).toBe(false);
  });

  it('labels a known license and falls back to the URI for an unknown one', () => {
    expect(licenseLabel('https://creativecommons.org/licenses/by/4.0/')).toBe(
      'CC BY 4.0',
    );
    expect(licenseLabel('http://example.com/license')).toBe(
      'http://example.com/license',
    );
  });
});

describe('licenseHref', () => {
  it('links known and unknown http(s) license URIs', () => {
    expect(licenseHref('https://creativecommons.org/licenses/by/4.0/')).toBe(
      'https://creativecommons.org/licenses/by/4.0/',
    );
    expect(licenseHref('http://example.com/license')).toBe(
      'http://example.com/license',
    );
  });

  it('refuses to link anything that is not http(s)', () => {
    // license comes from any user's record via tap, so it is untrusted input
    // that ends up in an href on a public page.
    expect(licenseHref('javascript:alert(1)')).toBeNull();
    expect(licenseHref(' JavaScript:alert(1)')).toBeNull();
    expect(licenseHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(licenseHref('CC0-1.0')).toBeNull();
    expect(licenseHref('')).toBeNull();
  });
});
