import { isKnownLicense } from '$lib/licenses';

// Matches the maxLength on bio.lexicons.temp.v0-1.remark.body. Lexicon string
// maxLength counts UTF-8 bytes, not characters, and Remark.$build does not
// validate, so an over-long body would be published as an invalid record
// unless it is checked here.
export const REMARK_MAX_BYTES = 3000;

// A remark as the form saves it and the survey API accepts it, whether the
// survey's eventRemark or an occurrence's remark. `license` is set only when
// the surveyor picked one, or the remark already had one; without it the
// server stamps the account default at upload.
export type RemarkInput = { body: string; license?: string };

export function remarkByteLength(body: string): number {
  return new TextEncoder().encode(body.trim()).length;
}

/**
 * Checks a remark from a survey payload (the survey's eventRemark or an
 * occurrence's remark). Returns an error message naming `field`, or null if
 * the remark is valid. Shared by the survey API routes and the form so they
 * cannot disagree about what the lexicon allows.
 *
 * `existingLicense` is the license the remark being edited already has. It is
 * accepted even if we do not offer it, so an edit to the text never forces a
 * different license onto words another client published.
 */
export function validateRemark(
  remark: {
    body?: unknown;
    license?: unknown;
  },
  field: string,
  existingLicense?: string,
): string | null {
  if (typeof remark.body !== 'string') {
    return `${field}.body must be a string`;
  }
  if (remarkByteLength(remark.body) > REMARK_MAX_BYTES) {
    return 'Remarks are too long';
  }
  if (
    remark.license !== undefined &&
    !isKnownLicense(remark.license as string) &&
    remark.license !== existingLicense
  ) {
    return `${field}.license must be a supported license URI`;
  }
  return null;
}
