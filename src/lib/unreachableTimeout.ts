// How long a request gets once the ping has already found the server
// unreachable: enough for a server that just came back to answer, short
// enough that a navigation doesn't feel stuck. Also how long the service
// worker waits on the network before serving a cached page instead.
//
// Kept out of online.svelte.ts so the service worker can import it without
// pulling in that module's reactive state.
export const UNREACHABLE_TIMEOUT_MS = 2000;
