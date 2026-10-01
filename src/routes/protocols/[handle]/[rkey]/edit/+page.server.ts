import type { l } from '@atproto/lex';
import { error, fail, redirect } from '@sveltejs/kit';
import { webSignInHref } from '$lib/auth/signin';
import * as ProtocolTarget from '$lib/lexicons/bio/cuanto/protocolTarget';
import type { Main as ProtocolTargetMain } from '$lib/lexicons/bio/cuanto/protocolTarget.defs';
import * as SurveyProtocol from '$lib/lexicons/bio/cuanto/surveyProtocol';
import logger from '$lib/logger';
import sql from '$lib/server/db';
import {
  deleteFollow,
  getFollowByDidAndProtocol,
} from '$lib/server/db/protocol-follows';
import {
  getProtocolDetailByHandleAndRkey,
  insertProtocol,
  insertProtocolTarget,
  tombstoneProtocolByUri,
  tombstoneProtocolTargetsByUris,
} from '$lib/server/db/survey-protocols';
import { countSurveysByProtocolUri } from '$lib/server/db/surveys';
import { classifyTargets } from '$lib/server/inat-taxa';
import { parseLocationOptions } from '$lib/server/locationOptions';
import { createRecord, deleteRecord, putRecord } from '$lib/server/pds';
import { pdsAuthErrorFail } from '$lib/server/pds-error-response';
import type { Actions, PageServerLoad } from './$types';

const log = logger.child({ component: 'edit-protocol' });

/** This page's own path, used as the post-sign-in destination. */
function editPath({ handle, rkey }: { handle: string; rkey: string }): string {
  return `/protocols/${handle}/${rkey}/edit`;
}

export const load: PageServerLoad = async ({ locals, params }) => {
  // returnTo so signing in lands back on the edit the visitor came here for,
  // rather than dumping them on the home page having lost their place.
  if (!locals.did) redirect(302, webSignInHref(editPath(params)));

  const protocol = await getProtocolDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!protocol) error(404, 'Protocol not found');

  const [row] = await sql<{ did: string }[]>`
    SELECT did FROM survey_protocols WHERE at_uri = ${protocol.atUri}
  `;
  if (!row || row.did !== locals.did) error(403, 'Forbidden');

  // The record still exists (tombstoned, not hard-deleted — see #25), so
  // this isn't a 404, but there's nothing left to edit: 410 is the honest
  // status for "this used to be here and is gone for good."
  if (protocol.deletedAt) error(410, 'This protocol has been deleted');

  // For the delete confirmation's warning copy — not a block (see #25: we
  // can't actually prevent deletion, any AT Protocol client can do it
  // regardless of this UI), just naming the risk.
  const surveyCount = await countSurveysByProtocolUri(protocol.atUri);

  return { protocol, surveyCount };
};

export const actions: Actions = {
  // Named (not `default`) because this file also needs a `delete` action
  // (issue #25), and SvelteKit doesn't allow mixing a default action with
  // named ones in the same file. ProtocolForm.svelte posts here explicitly
  // via action="?/save" when editing; /protocols/new keeps its own `default`
  // action untouched, since it's a separate route file.
  save: async ({ request, locals, params }) => {
    if (!locals.did) redirect(302, webSignInHref(editPath(params)));
    const { did } = locals;
    const { handle, rkey } = params;

    const formData = await request.formData();
    const title = (formData.get('title') as string | null)?.trim();
    const description = (formData.get('description') as string | null)?.trim();
    const requiredFields = formData.getAll('requiredFields') as string[];
    const targetsJson = formData.get('targets') as string | null;
    const locationOptionsJson = formData.get('locationOptions') as
      | string
      | null;

    if (!title) return fail(422, { error: 'Title is required' });
    if (!description) return fail(422, { error: 'Description is required' });

    let targets: { scope: unknown[]; atUri?: string }[] = [];
    try {
      targets = JSON.parse(targetsJson ?? '[]');
    } catch {
      return fail(422, { error: 'Invalid targets' });
    }
    // Valid JSON of the wrong shape (e.g. from a stale or hand-built form) would
    // otherwise throw once the targets are used
    if (
      !Array.isArray(targets) ||
      !targets.every((t) => Array.isArray((t as { scope?: unknown })?.scope))
    ) {
      return fail(422, { error: 'Invalid targets' });
    }

    let locationOptions: ReturnType<typeof parseLocationOptions>;
    try {
      locationOptions = parseLocationOptions(locationOptionsJson);
    } catch {
      return fail(422, { error: 'Invalid location options' });
    }

    const existing = await getProtocolDetailByHandleAndRkey(handle, rkey);
    if (!existing) return fail(404, { error: 'Protocol not found' });

    const [ownerRow] = await sql<{ did: string }[]>`
      SELECT did FROM survey_protocols WHERE at_uri = ${existing.atUri}
    `;
    if (!ownerRow || ownerRow.did !== did)
      return fail(403, { error: 'Forbidden' });

    // Same 410 as `load` — reachable here only via a stale form or a direct
    // POST, since `load` already blocks normal navigation to this point.
    // Deliberately error() (a hard stop), not fail(): there's no valid page
    // left to return to, since the next load of this route 410s too.
    if (existing.deletedAt) error(410, 'This protocol has been deleted');

    // Only new targets are classified (issue
    // https://tangled.org/cuanto.bio/cuanto.bio/issues/81): they're being written
    // anyway, while classifying existing ones would rewrite every target on any
    // save. The edit form backfills those when the author asks. This happens
    // before any write, so a slow iNat can't leave the protocol half-saved.
    const toAdd = await classifyTargets(targets.filter((t) => !t.atUri));

    const protocolRecord = SurveyProtocol.$build({
      title,
      description,
      createdAt: existing.record.createdAt,
      ...(requiredFields.length ? { requiredFields } : {}),
      ...(locationOptions.length ? { locationOptions } : {}),
    });

    let protocolCid: string;
    try {
      ({ cid: protocolCid } = await putRecord(
        did,
        'bio.cuanto.surveyProtocol',
        rkey,
        protocolRecord,
      ));
    } catch (err) {
      return (
        pdsAuthErrorFail(err) ??
        fail(502, { error: `PDS error: ${String(err)}` })
      );
    }

    await insertProtocol(
      did,
      rkey,
      protocolRecord,
      existing.atUri,
      protocolCid,
    );

    const existingByUri = new Map(existing.targets.map((t) => [t.atUri, t]));
    const submittedUris = new Set(
      targets.flatMap((t) => (t.atUri ? [t.atUri] : [])),
    );

    const toDelete = existing.targets.filter(
      (t) => !submittedUris.has(t.atUri),
    );
    const toUpdate = targets.filter((t) => {
      if (!t.atUri) return false;
      const existingTarget = existingByUri.get(t.atUri);
      if (!existingTarget) return false;
      return (
        JSON.stringify(t.scope) !== JSON.stringify(existingTarget.record.scope)
      );
    });

    await tombstoneProtocolTargetsByUris(toDelete.map((t) => t.atUri));
    for (const target of toDelete) {
      try {
        await deleteRecord(target.atUri);
        log.info({ atUri: target.atUri, did }, 'deleted protocol target');
      } catch (err) {
        log.error(
          { err, atUri: target.atUri },
          'Failed to delete protocol target from PDS',
        );
        return (
          pdsAuthErrorFail(err) ??
          fail(502, { error: `Failed to delete a target: ${String(err)}` })
        );
      }
    }

    for (const target of toUpdate) {
      if (!target.atUri) continue;
      const existingTarget = existingByUri.get(target.atUri);
      if (!existingTarget) continue;
      const targetRecord = ProtocolTarget.$build({
        protocol: existing.atUri as l.AtUriString,
        scope: target.scope as unknown as ProtocolTargetMain['scope'],
      });
      const targetRkey = existingTarget.atUri.split('/').at(-1) ?? '';
      try {
        await putRecord(
          did,
          'bio.cuanto.protocolTarget',
          targetRkey,
          targetRecord,
        );
        await insertProtocolTarget(
          did,
          targetRkey,
          targetRecord,
          existingTarget.atUri,
        );
      } catch (err) {
        log.error({ err }, 'Failed to update survey target');
        return (
          pdsAuthErrorFail(err) ??
          fail(502, { error: `Failed to update a target: ${String(err)}` })
        );
      }
    }

    for (const target of toAdd) {
      const targetRecord = ProtocolTarget.$build({
        protocol: existing.atUri as l.AtUriString,
        scope: target.scope as unknown as ProtocolTargetMain['scope'],
      });

      try {
        const { uri: targetUri } = await createRecord(
          did,
          'bio.cuanto.protocolTarget',
          targetRecord,
        );
        const targetRkey = targetUri.split('/').at(-1) ?? '';
        await insertProtocolTarget(did, targetRkey, targetRecord, targetUri);
      } catch (err) {
        log.error({ err }, 'Failed to create survey target');
        return (
          pdsAuthErrorFail(err) ??
          fail(502, { error: `Failed to create a target: ${String(err)}` })
        );
      }
    }

    redirect(302, `/app/protocols/${handle}/${rkey}?updated=1`);
  },

  // Deletes the protocol and its targets (issue #25), tombstoning each DB
  // row only once its own PDS delete is confirmed, never before. Order
  // matters, at two levels:
  //
  // 1. Targets are deleted from the PDS before the protocol record itself,
  //    so a failure partway through leaves the protocol fully live and
  //    retryable rather than "deleted" with orphaned target records nobody
  //    will clean up.
  // 2. Within that, each target's own PDS delete must succeed *before* its
  //    DB row is tombstoned. Tombstoning eagerly (the first version of this
  //    code did) would have been indistinguishable from a genuinely deleted
  //    target on any retry: getProtocolDetailByHandleAndRkey's live-only
  //    view drops a tombstoned row, so a target whose DB write raced ahead
  //    of its still-failing PDS delete would never be retried again, ever —
  //    a permanently orphaned PDS record with no code path back to it. Same
  //    reasoning for the protocol's own tombstone, and it matters more
  //    there: `load` 410s once `deletedAt` is set, so an eager tombstone
  //    would also cut off the only UI path back to the Danger Zone button
  //    that could retry the delete.
  //
  // Tombstoning the confirmed targets is still one batched call, not one
  // per target, mirroring the `save` action's target-removal call above.
  //
  // survey_protocols is tombstoned, never hard-deleted — surveys and
  // occurrences reach it through ON DELETE CASCADE foreign keys.
  delete: async ({ locals, params }) => {
    if (!locals.did) redirect(302, webSignInHref(editPath(params)));
    const { did } = locals;
    const { handle, rkey } = params;

    const existing = await getProtocolDetailByHandleAndRkey(handle, rkey);
    if (!existing) return fail(404, { error: 'Protocol not found' });

    const [ownerRow] = await sql<{ did: string }[]>`
      SELECT did FROM survey_protocols WHERE at_uri = ${existing.atUri}
    `;
    if (!ownerRow || ownerRow.did !== did)
      return fail(403, { error: 'Forbidden' });

    const deletedTargetUris: string[] = [];
    for (const target of existing.targets) {
      try {
        await deleteRecord(target.atUri);
        log.info({ atUri: target.atUri, did }, 'deleted protocol target');
        deletedTargetUris.push(target.atUri);
      } catch (err) {
        if (deletedTargetUris.length > 0) {
          await tombstoneProtocolTargetsByUris(deletedTargetUris);
        }
        log.error(
          { err, atUri: target.atUri },
          'Failed to delete protocol target from PDS',
        );
        return (
          pdsAuthErrorFail(err) ??
          fail(502, { error: `Failed to delete a target: ${String(err)}` })
        );
      }
    }
    if (deletedTargetUris.length > 0) {
      await tombstoneProtocolTargetsByUris(deletedTargetUris);
    }

    try {
      await deleteRecord(existing.atUri);
      log.info({ atUri: existing.atUri, did }, 'deleted protocol');
    } catch (err) {
      log.error(
        { err, atUri: existing.atUri },
        'Failed to delete protocol from PDS',
      );
      return (
        pdsAuthErrorFail(err) ??
        fail(502, { error: `Failed to delete protocol: ${String(err)}` })
      );
    }

    await tombstoneProtocolByUri(existing.atUri);

    // Best-effort: the author's own follow record is theirs to clean up
    // (their repo, their live session right now), unlike other followers'
    // records, which we leave alone entirely (see docs/2026-09-14-issue-25).
    // A failure here doesn't undo the protocol delete that already succeeded.
    const ownFollow = await getFollowByDidAndProtocol(did, existing.atUri);
    if (ownFollow) {
      try {
        await deleteRecord(ownFollow.at_uri);
        await deleteFollow(ownFollow.at_uri);
      } catch (err) {
        log.error(
          { err, atUri: ownFollow.at_uri },
          'Failed to delete own follow record after protocol deletion',
        );
      }
    }

    redirect(302, `/app/protocols/${handle}/${rkey}?deleted=1`);
  },
};
