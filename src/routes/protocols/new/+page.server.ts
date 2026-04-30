import type { l } from '@atproto/lex';
import { fail, redirect } from '@sveltejs/kit';
import * as SurveyProtocol from '$lib/lexicons/bio/lexicons/temp/surveyProtocol';
import * as SurveyTarget from '$lib/lexicons/bio/lexicons/temp/surveyTarget';
import type { Main as SurveyTargetMain } from '$lib/lexicons/bio/lexicons/temp/surveyTarget.defs';
import type { Main as AtAddress } from '$lib/lexicons/community/lexicon/location/address.defs';
import type { Main as AtGeo } from '$lib/lexicons/community/lexicon/location/geo.defs';
import type { Main as AtPlace } from '$lib/lexicons/org/atgeo/place.defs';
import sql from '$lib/server/db';
import { insertProtocol, insertTarget } from '$lib/server/db/survey-protocols';
import { createRecord } from '$lib/server/pds';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.did) redirect(302, '/auth/signin');
  return {};
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.did) redirect(302, '/auth/signin');
    const { did } = locals;

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

    let targets: { scope: unknown[] }[] = [];
    try {
      targets = JSON.parse(targetsJson ?? '[]');
    } catch {
      return fail(422, { error: 'Invalid targets' });
    }

    let locationOptions: AtPlace[] = [];
    try {
      const parsed: AtPlace[] = JSON.parse(locationOptionsJson ?? '[]');
      locationOptions = parsed
        .filter((place) => place.name.trim())
        .map((place) => {
          const locs: AtPlace['locations'] = [];
          for (const l of place.locations ?? []) {
            if (l.$type === 'community.lexicon.location.geo') {
              const geo = l as AtGeo;
              for (const coord of [geo.latitude, geo.longitude]) {
                // We don't really know what the user sent us, so we ensure
                // these coordinates are numbers
                if (
                  coord == null ||
                  coord === '' ||
                  Number.isNaN(Number(coord))
                ) {
                  throw new Error('Latitude and longitude must be numbers');
                }
              }
              locs.push({
                $type: 'community.lexicon.location.geo',
                // The lexicon specifies string floats, so no matter what we receive,
                latitude: String(geo.latitude),
                longitude: String(geo.longitude),
              });
            } else if (l.$type === 'community.lexicon.location.address') {
              const addr = l as AtAddress;
              if (!addr.country || addr.country.trim().length < 2) {
                throw new Error(
                  'Address country must be at least 2 characters',
                );
              }
              locs.push({
                $type: 'community.lexicon.location.address',
                country: addr.country,
                ...(addr.postalCode ? { postalCode: addr.postalCode } : {}),
                ...(addr.region ? { region: addr.region } : {}),
                ...(addr.locality ? { locality: addr.locality } : {}),
                ...(addr.street ? { street: addr.street } : {}),
              });
            }
          }
          return {
            $type: 'org.atgeo.place' as const,
            name: place.name.trim(),
            ...(locs.length ? { locations: locs } : {}),
          };
        });
    } catch {
      return fail(422, { error: 'Invalid location options' });
    }

    const protocolRecord = SurveyProtocol.$build({
      title,
      description,
      createdAt: new Date().toISOString() as l.DatetimeString,
      ...(requiredFields.length ? { requiredFields } : {}),
      ...(locationOptions.length ? { locationOptions } : {}),
    });

    let protocolUri: string;
    let protocolCid: string;
    try {
      ({ uri: protocolUri, cid: protocolCid } = await createRecord(
        did,
        'bio.lexicons.temp.surveyProtocol',
        protocolRecord,
      ));
    } catch (err) {
      return fail(502, { error: `PDS error: ${String(err)}` });
    }
    const protocolRkey = protocolUri.split('/').at(-1) ?? '';

    await insertProtocol(
      did,
      protocolRkey,
      protocolRecord,
      protocolUri,
      protocolCid,
    );

    for (const target of targets) {
      const targetRecord = SurveyTarget.$build({
        protocol: protocolUri as l.AtUriString,
        scope: target.scope as unknown as SurveyTargetMain['scope'],
      });

      try {
        const { uri: targetUri } = await createRecord(
          did,
          'bio.lexicons.temp.surveyTarget',
          targetRecord,
        );
        const targetRkey = targetUri.split('/').at(-1) ?? '';
        await insertTarget(did, targetRkey, targetRecord, targetUri);
      } catch (err) {
        console.error('Failed to create survey target:', err);
      }
    }

    const [user] = await sql<{ handle: string }[]>`
      SELECT handle FROM users WHERE did = ${did}
    `;
    if (!user?.handle) {
      return fail(500, {
        error: 'User handle not found after protocol creation',
      });
    }

    redirect(302, `/protocols/${user.handle}/${protocolRkey}`);
  },
};
