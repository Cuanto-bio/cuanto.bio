import { expect, seedProtocol, teardownDid, test } from '../fixtures.js';
import {
  cacheAndOpenNewSurvey,
  confirmFinishSurvey,
  readPendingSurveys,
} from './helpers.js';

test('can create a survey and see it in the surveys list', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  const placeholder = '[placeholder="e.g. Mission Dolores Park"]';
  await page.fill(placeholder, 'Integration Test Park');
  await page.locator('[aria-label="Increase count"]').first().click();
  await page.locator('[aria-label="Increase count"]').first().click();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  await expect(page.getByText('Integration Test Park')).toBeVisible();
});

test('survey detail page shows occurrences', async ({ page, protocolRkey }) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  const placeholder = '[placeholder="e.g. Mission Dolores Park"]';
  await page.fill(placeholder, 'Detail Test Site');
  await page.locator('[aria-label="Increase count"]').nth(1).click();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
  await expect(page.getByText('All birds')).toBeVisible();
  await expect(page.getByText('1', { exact: true })).toBeVisible();
});

test('can create survey from protocol created by different user', async ({
  page,
  context,
  sql,
  protocolRkey,
}) => {
  // protocolRkey belongs to 'did:test:survey-spec' (set up by the fixture).
  // Switch to a different authenticated user.
  const otherDid = 'did:test:survey-spec-other-user';
  await seedProtocol(sql, otherDid);

  await context.addCookies([
    {
      name: 'did',
      value: otherDid,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

  const placeholder = '[placeholder="e.g. Mission Dolores Park"]';
  await page.fill(placeholder, 'Cross-user Survey');
  await page.locator('[aria-label="Increase count"]').first().click();
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(
    /\/app\/surveys\/user-survey-spec-other-user\/\w+/,
  );
  await expect(page.getByText('Cross-user Survey')).toBeVisible();

  await teardownDid(sql, otherDid);
});

// ── surveyorCount validation ──────────────────────────────────────────────────

test.describe('surveyorCount validation', () => {
  test('shows error immediately when input is invalid', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    for (const value of ['-1', '1.5', '0', 'abc']) {
      await page.fill('#surveyorCount', value);
      await expect(
        page.getByText('Number of surveyors must be a positive integer'),
      ).toBeVisible();
      await page.fill('#surveyorCount', '');
      await expect(
        page.getByText('Number of surveyors must be a positive integer'),
      ).not.toBeVisible();
    }
  });

  test('saves surveyorCount to the survey record when valid', async ({
    page,
    protocolRkey,
    sql,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Test Site');
    await page.fill('#surveyorCount', '3');
    await confirmFinishSurvey(page);
    await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);
    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM surveys WHERE did = 'did:test:survey-spec'
      ORDER BY indexed_at DESC LIMIT 1
    `;
    expect(row.record.surveyorCount).toBe(3);
  });
});

// ── Cancel survey guard ───────────────────────────────────────────────────────

test.describe('cancel survey guard', () => {
  test('Cancel Survey button opens confirmation dialog', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Cancel Survey' }).click();
    await expect(
      page.getByRole('heading', { name: 'Cancel survey?' }),
    ).toBeVisible();
  });

  test('Keep surveying dismisses the dialog without navigating', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Cancel Survey' }).click();
    await page.getByRole('button', { name: 'Keep surveying' }).click();
    await expect(
      page.getByRole('heading', { name: 'Cancel survey?' }),
    ).not.toBeVisible();
    await expect(page).toHaveURL(/\/app\/surveys\/new\//);
  });

  test('confirming cancel navigates back to the protocol page', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Cancel Survey' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel survey' })
      .click();
    await expect(page).toHaveURL(/\/app\/protocols\/user-survey-spec\//);
  });
});

// ── Finish survey confirmation dialog ────────────────────────────────────────

test.describe('finish survey confirmation dialog', () => {
  test('Finish Survey button opens a confirmation dialog', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Finish Survey' }).click();
    await expect(
      page.getByRole('heading', { name: 'Finish survey?' }),
    ).toBeVisible();
  });

  test('Keep going dismisses the finish dialog without submitting', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.getByRole('button', { name: 'Finish Survey' }).click();
    await page.getByRole('button', { name: 'Keep going' }).click();
    await expect(
      page.getByRole('heading', { name: 'Finish survey?' }),
    ).not.toBeVisible();
    await expect(page).toHaveURL(/\/app\/surveys\/new\//);
  });

  test('dialog shows location in summary', async ({ page, protocolRkey }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill('[placeholder="e.g. Mission Dolores Park"]', 'Owl Ridge');
    await page.getByRole('button', { name: 'Finish Survey' }).click();
    await expect(page.getByText('Owl Ridge')).toBeVisible();
  });

  test('finish dialog requires location before completing', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await confirmFinishSurvey(page);
    await expect(page.getByText('Location name is required')).toBeVisible();
    await expect(page).toHaveURL(/\/app\/surveys\/new\//);
  });

  test('scrolls location field into view when location is missing', async ({
    page,
    protocolRkey,
  }) => {
    await page.setViewportSize({ width: 390, height: 300 });
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    const locationInput = page.getByPlaceholder('e.g. Mission Dolores Park');
    // Scroll so location is out of view, then confirm it is actually not visible.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(locationInput).not.toBeInViewport();
    await confirmFinishSurvey(page);
    await expect(page.getByText('Location name is required')).toBeVisible();
    await expect(locationInput).toBeInViewport();
  });
});

// ── Protocol link removed ─────────────────────────────────────────────────────

test('survey form does not show a back link to the protocol', async ({
  page,
  protocolRkey,
}) => {
  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await expect(
    page.getByRole('link', { name: /← Protocol/i }),
  ).not.toBeVisible();
});

// ── Navigation guard: auto-save on navigate away ──────────────────────────────

test.describe('navigation guard', () => {
  test('navigating away from an in-progress survey saves a draft', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Nav Guard Park',
    );

    // Click the sidebar link to trigger beforeNavigate
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);

    await expect(page.getByText('In progress')).toBeVisible();
    await expect(page.getByText('Nav Guard Park')).toBeVisible();
  });

  test('draft from navigating away can be resumed with form state restored', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Resume Test Site',
    );
    await page.locator('[aria-label="Increase count"]').first().click();

    // Navigate away to trigger auto-save
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);

    // Resume the draft
    await page.getByRole('link', { name: 'Resume', exact: true }).click();
    await page.waitForSelector('text=Finish Survey', { state: 'visible' });

    await expect(
      page.locator('[placeholder="e.g. Mission Dolores Park"]'),
    ).toHaveValue('Resume Test Site');
    // The first count button should show 1 (was incremented before navigating away)
    await expect(
      page.locator('[aria-label="Increase count"]').first(),
    ).toContainText('1');
  });

  test('canceling a survey with a draft removes it from the surveys list', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Cancel Draft Park',
    );

    // Navigate away to create a draft
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);
    await expect(page.getByText('In progress')).toBeVisible();

    // Resume the draft and cancel it
    await page.getByRole('link', { name: 'Resume' }).click();
    await page.waitForSelector('text=Finish Survey', { state: 'visible' });
    await page.getByRole('button', { name: 'Cancel Survey' }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cancel survey' })
      .click();

    // Canceling navigates to the protocol page; go to surveys list to confirm draft is gone
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);
    await expect(page.getByText('In progress')).not.toBeVisible();
  });

  test('deleting an in-progress draft from Your Surveys removes it', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Delete Draft Park',
    );

    // Navigate away to create a draft
    await page.getByRole('link', { name: 'Your Surveys' }).click();
    await page.waitForURL(/\/app\/surveys$/);
    await expect(page.getByText('In progress')).toBeVisible();
    await expect(page.getByText('Delete Draft Park')).toBeVisible();

    // Click the trash icon to open the delete dialog
    await page.getByRole('button', { name: 'Delete survey' }).click();
    await page.waitForSelector('text=Delete this survey?', {
      state: 'visible',
    });

    // Confirm deletion
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('In progress')).not.toBeVisible();
    await expect(page.getByText('Delete Draft Park')).not.toBeVisible();
  });

  test('deleting a finished pending survey from Your Surveys removes it', async ({
    page,
    protocolRkey,
  }) => {
    // Block the upload endpoint so the survey stays in the pending-upload queue
    await page.route('**/api/surveys', (route) => {
      if (route.request().method() === 'POST') {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Delete Finished Park',
    );
    await confirmFinishSurvey(page);

    // Upload failed, so the survey stays in pending-upload and we stay on the survey list
    await page.waitForURL(/\/app\/surveys$/);
    await expect(page.getByText('Pending upload')).toBeVisible();
    await expect(page.getByText('Delete Finished Park')).toBeVisible();

    // Click the trash icon in the pending-upload section
    await page.getByRole('button', { name: 'Delete survey' }).click();
    await page.waitForSelector('text=Delete this survey?', {
      state: 'visible',
    });

    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Delete' })
      .click();

    await expect(page.getByText('Pending upload')).not.toBeVisible();
    await expect(page.getByText('Delete Finished Park')).not.toBeVisible();
  });
});

// ── Past survey mode ──────────────────────────────────────────────────────────

test('past survey saves the entered date and duration', async ({
  page,
  protocolRkey,
  sql,
}) => {
  await page.goto(`/app/protocols/user-survey-spec/${protocolRkey}`);
  await page.waitForLoadState('networkidle');
  await page.goto(`/app/surveys/new/${protocolRkey}?past=1`);
  await page.waitForSelector('text=Finish Survey', { state: 'visible' });

  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Past Test Site',
  );
  await page.fill('#pastDate', '2026-01-15T10:00');
  await page.fill('#pastDuration', '45');
  await confirmFinishSurvey(page);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/);

  const [row] = await sql<{ record: Record<string, unknown> }[]>`
    SELECT record FROM surveys WHERE did = 'did:test:survey-spec'
    ORDER BY indexed_at DESC LIMIT 1
  `;

  expect(row.record.eventDate).toBe(new Date('2026-01-15T10:00').toISOString());
  expect(row.record.eventDurationValue).toBe(45);
});

// ── Race condition: auto-save orphan after successful submit ──────────────────

test('does not leave an orphaned in-progress draft when auto-save fires during navigation after submit', async ({
  page,
  protocolRkey,
}) => {
  // Install fake clock before any navigation so the form's setInterval is
  // registered under the fake clock and we can fire it on demand.
  await page.clock.install({ time: Date.now() });

  // Delay the survey detail GET so goto() stays pending long enough for
  // us to advance the clock and fire the auto-save interval after deletion.
  await page.route('**/api/surveys/user-survey-spec/**', async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise<void>((r) => setTimeout(r, 800));
    }
    await route.continue();
  });

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Race Condition Site',
  );

  // Fire the 10s auto-save interval to create a draft in IDB with complete: false.
  await page.clock.runFor(11_000);

  // Wait for the IDB write to settle before submitting.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open('cuanto');
              req.onsuccess = () => {
                const tx = req.result.transaction(
                  'pending-surveys',
                  'readonly',
                );
                const countReq = tx.objectStore('pending-surveys').count();
                countReq.onsuccess = () => resolve(countReq.result);
                countReq.onerror = () => resolve(0);
              };
              req.onerror = () => resolve(0);
            }),
        ),
      { timeout: 5_000 },
    )
    .toBe(1);

  // Submit. The upload succeeds quickly, deletePendingSurvey runs, then
  // goto() starts and blocks on the delayed survey detail GET (800ms real).
  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();

  // Let the upload and delete complete in real time (~100ms on localhost).
  // goto() is now awaiting the delayed GET response.
  await page.waitForTimeout(300);

  // Fire the auto-save interval again. Without the fix, autoSave() runs,
  // calls updatePendingSurvey with complete: false, and re-inserts the
  // deleted draft as an orphan because navigatingAway is not checked.
  await page.clock.runFor(11_000);

  await expect(page).toHaveURL(/\/app\/surveys\/user-survey-spec\/\w+/, {
    timeout: 10_000,
  });

  const pending = await page.evaluate(
    () =>
      new Promise<unknown[]>((resolve) => {
        const req = indexedDB.open('cuanto');
        req.onsuccess = () => {
          const tx = req.result.transaction('pending-surveys', 'readonly');
          const getAllReq = tx.objectStore('pending-surveys').getAll();
          getAllReq.onsuccess = () => resolve(getAllReq.result);
        };
      }),
  );

  expect(pending).toHaveLength(0);
});

// ── Race condition: auto-save reverting a finished survey to in progress ─────

test('does not revert a finished survey to in progress when auto-save fires during the connectivity check', async ({
  page,
  protocolRkey,
}) => {
  // Fake clock so the form's 10s auto-save interval fires where the test wants
  // it to, instead of wherever the wall clock happens to put it.
  await page.clock.install({ time: Date.now() });

  // Hold /api/ping open so the finish flow parks inside checkConnectivity().
  // That is what offline looks like in the field: not a fetch that fails
  // instantly, but one that hangs until its 5s abort while the interval keeps
  // ticking. The route is never fulfilled — the abort timer ends the fetch.
  let releasePing = () => {};
  const pingHeld = new Promise<void>((resolve) => {
    releasePing = resolve;
  });
  await page.route('**/api/ping', async (route) => {
    await pingHeld;
    await route.abort('failed').catch(() => {});
  });

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Stuck Draft Meadow',
  );
  await page.locator('[aria-label="Increase count"]').first().click();

  // One interval tick writes the in-progress draft.
  await page.clock.runFor(11_000);
  await expect
    .poll(async () => (await readPendingSurveys(page)).length, {
      timeout: 5_000,
    })
    .toBe(1);

  // Advance to 3s before the next tick, so that after Finish is clicked the
  // tick lands inside the 5s connectivity check rather than after it.
  await page.clock.runFor(6_000);

  await page.getByRole('button', { name: 'Finish Survey' }).click();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();

  // Finish has written complete: true and is now parked on the held ping.
  await expect
    .poll(async () => (await readPendingSurveys(page))[0]?.complete, {
      timeout: 5_000,
    })
    .toBe(true);

  // Fire the interval tick (3s away) and then the connectivity abort (5s away),
  // in that order. The tick is the one that used to rewrite the row.
  await page.clock.runFor(6_000);

  await page.waitForURL(/\/app\/surveys$/);
  // Let any auto-save write that is still in flight land before reading.
  await page.waitForTimeout(500);

  const pending = await readPendingSurveys(page);
  expect(pending).toHaveLength(1);
  expect(pending[0].complete).toBe(true);
  expect(pending[0].eventDurationValue).not.toBeNull();

  releasePing();
});

// ── Idempotent retry after a lost response (#13) ──────────────────────────────

test('retrying an upload after a lost response does not duplicate the survey', async ({
  page,
  protocolRkey,
  sql,
}) => {
  // Let the first POST really reach the server and complete (so the survey +
  // occurrence are actually written), then drop the response so the client
  // sees it as a failure. This reproduces "server wrote the record, client
  // never found out" rather than just simulating a network error.
  let firstAttemptServed = false;
  await page.route('**/api/surveys', async (route) => {
    if (route.request().method() !== 'POST' || firstAttemptServed) {
      return route.continue();
    }
    firstAttemptServed = true;
    await route.fetch();
    await route.abort('failed');
  });

  // Ensure the test db is clean
  const [{ count: preTestCount }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM surveys
    WHERE did = 'did:test:survey-spec'
      AND record->'location'->>'name' = 'Lost Response Park'
  `;
  expect(preTestCount).toBe(0);

  await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);
  await page.fill(
    '[placeholder="e.g. Mission Dolores Park"]',
    'Lost Response Park',
  );
  await page.locator('[aria-label="Increase count"]').first().click();
  await confirmFinishSurvey(page);

  // Upload "failed" from the client's perspective, so the survey stays pending
  // — even though the server already wrote it, so it also shows up in the
  // completed-surveys section, hence scoping this locator to the pending alert.
  await page.waitForURL(/\/app\/surveys$/);
  const pendingUploadAlert = page
    .getByRole('alert')
    .filter({ hasText: 'Pending upload' });
  await expect(pendingUploadAlert).toBeVisible();
  await expect(
    pendingUploadAlert.getByText('Lost Response Park'),
  ).toBeVisible();

  // The server actually wrote the survey (and its occurrence) already.
  const [{ count: preRetryCount }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM surveys
    WHERE did = 'did:test:survey-spec'
      AND record->'location'->>'name' = 'Lost Response Park'
  `;
  expect(preRetryCount).toBe(1);

  // Retry the upload; the client resubmits with the same client-generated
  // surveyRkey, so the server's putRecord + ON CONFLICT should overwrite the
  // existing rows instead of creating duplicates.
  await page.getByRole('button', { name: 'Upload all' }).click();
  await expect(pendingUploadAlert).not.toBeVisible();

  const [{ count: afterRetryCount }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM surveys
    WHERE did = 'did:test:survey-spec'
      AND record->'location'->>'name' = 'Lost Response Park'
  `;
  expect(afterRetryCount).toBe(1);

  const [{ count: occCount }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM occurrences o
    JOIN surveys s ON s.at_uri = o.survey_uri
    WHERE s.did = 'did:test:survey-spec'
      AND s.record->'location'->>'name' = 'Lost Response Park'
  `;
  expect(occCount).toBe(1);
});

// ── Counted targets indicator ─────────────────────────────────────────────────

test.describe('counted targets indicator', () => {
  test('filter button shows count and updates as targets are counted', async ({
    page,
    protocolRkey,
  }) => {
    await cacheAndOpenNewSurvey(page, 'user-survey-spec', protocolRkey);

    // Before any counts, button is aria-disabled with no count shown
    await expect(
      page.getByRole('button', {
        name: 'Only counted, count a target first',
        exact: true,
      }),
    ).toBeVisible();

    // Count the first target
    await page.locator('[aria-label="Increase count"]').first().click();

    // Button now shows '1' and is no longer aria-disabled
    const btn = page.getByRole('button', { name: 'Only counted', exact: true });
    await expect(btn).toContainText('1');
    await expect(btn).toHaveAttribute('aria-pressed', 'false');

    // Count a second target
    await page.locator('[aria-label="Increase count"]').nth(1).click();
    await expect(btn).toContainText('2');

    // Activate the filter — button text changes to "2 counted"
    await btn.click();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    await expect(btn).toContainText('2 counted');
  });
});
