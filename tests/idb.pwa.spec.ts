import { test as base, expect, type Page } from '@playwright/test';
import postgres, { type Sql } from 'postgres';
import { CUANTO_IDB_VERSION } from '../src/lib/offline/constants';
import { seedProtocol, teardownDid } from './fixtures.js';

const TEST_DB_URL = 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test';
const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';

const DID = 'did:test:idb-pwa';
const HANDLE = 'user-idb-pwa';

const AUTH_COOKIE = {
  name: 'did',
  value: DID,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  sameSite: 'Lax' as const,
};

async function seedFollow(
  sql: Sql,
  did: string,
  protocolUri: string,
): Promise<void> {
  const rkey = `follow${Date.now()}`;
  await sql`
    INSERT INTO protocol_follows (at_uri, did, rkey, protocol_uri, created_at)
    VALUES (
      ${`at://${did}/bio.cuanto.surveyProtocol.follow/${rkey}`},
      ${did},
      ${rkey},
      ${protocolUri},
      now()
    )
  `;
}

async function seedSurvey(
  sql: Sql,
  did: string,
  protocolUri: string,
  locationName = 'Offline Test Park',
  createdAt = new Date().toISOString(),
): Promise<string> {
  const rkey = `survey${Date.now()}`;
  const atUri = `at://${did}/bio.lexicons.temp.v0-1.survey/${rkey}`;
  const record = {
    $type: 'bio.lexicons.temp.v0-1.survey',
    protocol: { uri: protocolUri, cid: FAKE_CID },
    createdAt,
    location: { $type: 'org.atgeo.place', name: locationName },
  };
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
    VALUES (
      ${atUri},
      ${did},
      ${rkey},
      ${protocolUri},
      ${new Date(createdAt)},
      ${sql.json(record)},
      now()
    )
  `;
  return atUri;
}

// Wait for the SW to install and control the page, then reach network idle.
async function waitForSW(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.controller !== null,
    {
      timeout: 15000,
    },
  );
  await page.waitForLoadState('networkidle', { timeout: 10000 });
}

type Fixtures = { sql: Sql };

const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring here
  sql: async ({}, use) => {
    const connection = postgres(TEST_DB_URL, { max: 1 });
    await use(connection);
    await connection.end();
  },
});

test('following page shows cached protocol offline', async ({
  page,
  context,
  sql,
}) => {
  await context.addCookies([AUTH_COOKIE]);
  const { protocolRkey } = await seedProtocol(sql, DID);
  const protocolUri = `at://${DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;
  await seedFollow(sql, DID, protocolUri);

  try {
    // Visit online — fetches from /api/protocols/following and writes to IDB.
    await page.goto('/app/protocols/following');
    await waitForSW(page);
    await expect(page.getByText('Test Protocol')).toBeVisible();

    await context.setOffline(true);
    await page.goto('/app/protocols/following');
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('surveys page shows cached surveys offline', async ({
  page,
  context,
  sql,
}) => {
  await context.addCookies([AUTH_COOKIE]);
  const { protocolRkey } = await seedProtocol(sql, DID);
  const protocolUri = `at://${DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;
  await seedSurvey(sql, DID, protocolUri);

  try {
    // Visit online — fetches from /api/surveys and writes to IDB.
    await page.goto('/app/surveys');
    await waitForSW(page);
    await expect(page.getByText('Offline Test Park')).toBeVisible();

    await context.setOffline(true);
    await page.goto('/app/surveys');
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    await expect(page.getByText('Offline Test Park')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('protocol detail loads from IDB cache offline', async ({
  page,
  context,
  sql,
}) => {
  await context.addCookies([AUTH_COOKIE]);
  const { protocolRkey } = await seedProtocol(sql, DID);

  try {
    // Visit the protocol detail page online — fetches from API and writes to IDB.
    await page.goto(`/app/protocols/${HANDLE}/${protocolRkey}`);
    await waitForSW(page);
    await expect(page.getByText('Test Protocol')).toBeVisible();

    await context.setOffline(true);
    await page.goto(`/app/protocols/${HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    await expect(page.getByText('Test Protocol')).toBeVisible();
    // Follow button disabled offline
    await expect(page.getByText('(follow requires connection)')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('New Protocol link navigates to working protocol creation page', async ({
  page,
  context,
  sql,
}) => {
  await context.addCookies([AUTH_COOKIE]);
  await seedProtocol(sql, DID);

  try {
    await page.goto(`/app/protocols`);
    await waitForSW(page);
    await page.getByRole('link', { name: 'New Protocol' }).click();
    await expect(page).not.toHaveURL(/.*\/404/);
    await expect(page.getByText('New Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('pending surveys page shows a pending survey from IDB', async ({
  page,
  context,
  sql,
}) => {
  await context.addCookies([AUTH_COOKIE]);
  const { protocolRkey } = await seedProtocol(sql, DID);
  const protocolUri = `at://${DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;

  try {
    // Visit online to install the SW.
    await page.goto('/app/protocols');
    await waitForSW(page);

    // Seed a pending survey directly into IDB.
    await page.evaluate(
      ({ protocolUri, protocolRkey, CUANTO_IDB_VERSION }) => {
        return new Promise<void>((resolve, reject) => {
          const req = indexedDB.open('cuanto', CUANTO_IDB_VERSION);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('pending-surveys', 'readwrite');
            tx.objectStore('pending-surveys').add({
              protocolUri,
              protocolRkey,
              locationName: 'Pending Test Park',
              latitude: null,
              longitude: null,
              eventDate: new Date().toISOString().slice(0, 10),
              eventDurationValue: 0,
              occurrences: [],
              createdAt: Date.now(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        });
      },
      { protocolUri, protocolRkey, CUANTO_IDB_VERSION },
    );

    await context.setOffline(true);
    await page.goto('/app/surveys');
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    await expect(page.getByText('Pending Test Park')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('sidebar shows handle offline from IDB', async ({
  page,
  context,
  sql,
}) => {
  await context.addCookies([AUTH_COOKIE]);
  const { protocolRkey } = await seedProtocol(sql, DID);

  try {
    // Visit /app/* online — app layout fetches /api/me and saves user to IDB.
    await page.goto(`/app/protocols/${HANDLE}/${protocolRkey}`);
    await waitForSW(page);

    await context.setOffline(true);
    await page.goto('/app/surveys');
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    // Root +layout.ts reads IDB when offline; sidebar renders @handle.
    await expect(page.getByText(`@${HANDLE}`)).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('surveys page renders cached surveys in createdAt DESC order when offline', async ({
  page,
  context,
  sql,
}) => {
  await context.addCookies([AUTH_COOKIE]);
  const { protocolRkey } = await seedProtocol(sql, DID);
  const protocolUri = `at://${DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;

  // Seed older first to confirm IDB cache order doesn't determine display order.
  await seedSurvey(
    sql,
    DID,
    protocolUri,
    'Older Site',
    '2026-01-01T00:00:00.000Z',
  );
  await seedSurvey(
    sql,
    DID,
    protocolUri,
    'Newer Site',
    '2026-06-01T00:00:00.000Z',
  );

  try {
    // Visit online to prime IDB cache.
    await page.goto('/app/surveys');
    await waitForSW(page);
    await expect(page.getByText('Newer Site')).toBeVisible();

    await context.setOffline(true);
    await page.goto('/app/surveys');
    await page.waitForLoadState('networkidle', { timeout: 10000 });

    const items = page.locator('ul').last().locator('li');
    await expect(items.nth(0)).toContainText('Newer Site');
    await expect(items.nth(1)).toContainText('Older Site');
  } finally {
    await teardownDid(sql, DID);
  }
});
