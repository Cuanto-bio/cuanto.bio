// Client-safe AT-URI parsing. Lives outside $lib/server so both the browser and
// the server can share one implementation (see $lib/server/pds.ts, which re-exports).

export interface ParsedAtUri {
  did: string;
  collection: string;
  rkey: string;
}

/**
 * Parses an AT-URI of the form `at://<did>/<collection>/<rkey>`.
 * Throws if the URI does not match that shape.
 */
export function parseAtUri(uri: string): ParsedAtUri {
  const match = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!match) throw new Error(`Invalid AT-URI: ${uri}`);
  return { did: match[1], collection: match[2], rkey: match[3] };
}

/** Returns the DID from an AT-URI, or null if the URI is malformed. */
export function didFromAtUri(uri: string): string | null {
  const m = /^at:\/\/([^/]+)\//.exec(uri);
  return m ? m[1] : null;
}
