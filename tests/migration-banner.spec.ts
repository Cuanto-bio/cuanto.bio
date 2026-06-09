import { expect, seedProtocol, teardownDid, test } from './fixtures.js';

const DID = 'did:test:migrate-banner-spec';
const HANDLE = 'user-migrate-banner-spec';

function authCookie() {
  return {
    name: 'did',
    value: DID,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

test('shows the migration banner when the user is flagged', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([authCookie()]);
  const { protocolRkey } = await seedProtocol(sql, DID);
  await sql`UPDATE users SET needs_lexicon_migration = true WHERE did = ${DID}`;

  try {
    await page.goto(`/app/protocols/${HANDLE}/${protocolRkey}`);
    await expect(
      page.getByRole('button', { name: 'Update now' }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('no migration banner when the user is not flagged', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([authCookie()]);
  const { protocolRkey } = await seedProtocol(sql, DID);

  try {
    await page.goto(`/app/protocols/${HANDLE}/${protocolRkey}`);
    // wait for the page to settle before asserting absence
    await expect(page.getByText('Test Protocol')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Update now' }),
    ).not.toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});
