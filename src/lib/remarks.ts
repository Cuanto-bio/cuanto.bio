import { isKnownLicense } from '$lib/licenses';

// Matches the maxLength on bio.lexicons.temp.v0-1.remark.body. Lexicon string
// maxLength counts UTF-8 bytes, not characters, and Remark.$build does not
// validate, so an over-long body would be published as an invalid record
// unless it is checked here.
export const REMARK_MAX_BYTES = 3000;

export function remarkByteLength(body: string): number {
  return new TextEncoder().encode(body.trim()).length;
}

/**
 * Checks an eventRemark from a survey payload. Returns an error message, or
 * null if the remark is valid. Shared by the survey API routes and the form so
 * they cannot disagree about what the lexicon allows.
 */
export function validateEventRemark(remark: {
  body?: unknown;
  license?: unknown;
}): string | null {
  if (typeof remark.body !== 'string') {
    return 'eventRemark.body must be a string';
  }
  if (remarkByteLength(remark.body) > REMARK_MAX_BYTES) {
    return 'Remarks are too long';
  }
  if (
    remark.license !== undefined &&
    !isKnownLicense(remark.license as string)
  ) {
    return 'eventRemark.license must be a supported license URI';
  }
  return null;
}
