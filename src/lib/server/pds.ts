import { client as oauthClient } from './auth.js';

let mockSeq = 0;
const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';

/**
 * Creates a record on the PDS.
 *
 * When PDS_MOCK=true, returns a fake AT-URI/CID without making any HTTP call.
 * This exists because Playwright integration tests run the app as a live server
 * process, which means there is no way to mock this function from the test layer
 * (e.g. vi.mock) — any mocking must be configured via the environment.
 */
export async function createRecord(
  did: string,
  collection: string,
  record: unknown,
): Promise<{ uri: string; cid: string }> {
  if (process.env.PDS_MOCK === 'true') {
    mockSeq++;
    return { uri: `at://${did}/${collection}/test${mockSeq}`, cid: FAKE_CID };
  }

  const session = await oauthClient.restore(did);
  const resp = await session.fetchHandler(
    '/xrpc/com.atproto.repo.createRecord',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: did, collection, record }),
    },
  );
  if (!resp.ok) throw new Error(await resp.text());
  return resp.json() as Promise<{ uri: string; cid: string }>;
}
