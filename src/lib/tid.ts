// AT Protocol TID (timestamp identifier) helpers.
//
// A TID is a 64-bit integer with the high bit cleared, encoded as 13
// base32-sortable characters. We generate them client-side so that a survey
// write carries a stable record key: if the client times out after the server
// already created the record and then retries, the retry reuses the same key
// and `putRecord` overwrites identical content instead of creating a duplicate
// (issue #13).

import { TID } from '@atproto/common-web';

// base32-sortable alphabet used by AT Protocol record keys.
const S32 = '234567abcdefghijklmnopqrstuvwxyz';

// Encodes a 63-bit value as a 13-character base32-sortable TID (most
// significant character first). The caller must clear bit 63 so the leading
// character stays within the valid TID range.
function encodeTid(n: bigint): string {
  let out = '';
  let v = n;
  for (let i = 0; i < 13; i++) {
    out = S32[Number(v & 31n)] + out;
    v >>= 5n;
  }
  return out;
}

// Mask that clears the high bit, keeping the value in the valid TID range.
const TID_MASK = 0x7fffffffffffffffn;

// Generates a fresh, roughly time-ordered TID. Suitable as a client-chosen
// record key.
export function generateTid(): string {
  return TID.nextStr();
}

// Derives a stable TID from a seed string via a 64-bit FNV-1a hash. Same seed
// always yields the same TID, so the server can compute a record's key
// deterministically (e.g. from the survey key plus the target) and have retries
// land on the same key. Not time-ordered; only used where a stable, unique key
// is what matters.
export function deterministicTid(seed: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < seed.length; i++) {
    hash ^= BigInt(seed.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return encodeTid(hash & TID_MASK);
}
