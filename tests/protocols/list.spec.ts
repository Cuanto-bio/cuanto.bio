import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';

const DID = 'did:test:protocols-spec';
const HANDLE = 'user-protocols-spec';

// ── Public protocol list routes ───────────────────────────────────────────────

test('/protocols shows protocol titles', async ({ page, sql }) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID);

  try {
    await page.goto('/protocols');
    await expect(
      page.getByRole('link', { name: /Test Protocol.*@user-protocols-spec/ }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('/protocols/[handle] shows protocol titles for that user', async ({
  page,
  sql,
}) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID);

  try {
    await page.goto(`/protocols/${HANDLE}`);
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});
