import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import type { Pack } from 'tar-stream';
import { pack } from 'tar-stream';
import type { Main as LocationGeo } from '$lib/lexicons/community/lexicon/location/geo.defs.js';
import type { Protocol } from '$lib/offline/db.js';
import {
  type OccurrenceExportRow,
  type SurveyExportRow,
  type SurveyTargetExportRow,
  streamAbsencesByProtocolUri,
  streamIncidentalOccurrencesByProtocolUri,
  streamSurveysByProtocolUri,
  streamSurveyTargetsByProtocolUri,
  streamTargetedOccurrencesByProtocolUri,
} from './db/surveys.js';
import readme from './dwc-dp-README.md?raw';
import {
  EVENT_SCHEMA,
  OCCURRENCE_SCHEMA,
  PROTOCOL_SCHEMA,
  SURVEY_PROTOCOL_SCHEMA,
  SURVEY_SCHEMA,
  SURVEY_TARGET_SCHEMA,
} from './dwc-dp-schemas.js';

const DWC_DP_PROFILE =
  'https://raw.githubusercontent.com/gbif/dwc-dp/0.1/dwc-dp/dwc-dp-profile.json';

// Builds a Frictionless tabular-data-resource descriptor for a CSV file.
// The fixed fields (profile, format, mediatype, encoding) are required by the
// Frictionless spec for all tabular CSV resources; only name, path, and schema
// vary between our six files.
function resource(name: string, path: string, schema: object) {
  return {
    name,
    path,
    profile: 'tabular-data-resource',
    format: 'csv',
    mediatype: 'text/csv',
    encoding: 'utf-8',
    schema,
  };
}

export function buildDatapackageJson(
  protocol: Protocol,
  handle: string,
  rkey: string,
) {
  return {
    profile: DWC_DP_PROFILE,
    name: `${handle}-${rkey}`,
    id: protocol.atUri,
    title: protocol.record.title,
    version: '1.0.0',
    created: new Date().toISOString(),
    resources: [
      resource('event', 'event.csv', EVENT_SCHEMA),
      resource('survey', 'survey.csv', SURVEY_SCHEMA),
      resource('protocol', 'protocol.csv', PROTOCOL_SCHEMA),
      resource(
        'survey-protocol',
        'survey-protocol.csv',
        SURVEY_PROTOCOL_SCHEMA,
      ),
      resource('survey-target', 'survey-target.csv', SURVEY_TARGET_SCHEMA),
      resource('occurrence', 'occurrence.csv', OCCURRENCE_SCHEMA),
    ],
  };
}

// The Event table holds only temporal and spatial context. Survey-specific
// fields (effort, protocol, duration) go in the Survey table instead.
export const EVENT_COLUMNS = [
  'eventID',
  'parentEventID',
  'eventType',
  'eventDate',
  'decimalLatitude',
  'decimalLongitude',
  'geodeticDatum',
] as const;

// The Survey table extends Event 1:1 (surveyID = eventID) with ecology-specific
// fields defined in the eco: namespace.
export const SURVEY_COLUMNS = [
  'surveyID',
  'eventID',
  'eventDurationValue',
  'eventDurationUnit',
  'protocolNames',
  'samplingPerformedBy',
  'samplingPerformedByID',
  'surveyorCount',
  'isSamplingEffortReported',
  'samplingEffortValue',
  'samplingEffortUnit',
  'isAbsenceReported',
] as const;

export const PROTOCOL_COLUMNS = [
  'protocolID',
  'protocolName',
  'protocolDescription',
] as const;

export const SURVEY_PROTOCOL_COLUMNS = ['protocolID', 'surveyID'] as const;

export function buildProtocolCsvLine(protocol: Protocol): string {
  const fields = [
    protocol.atUri,
    protocol.record.title,
    protocol.record.description ?? '',
  ];
  return `${fields.map(csvEscape).join(',')}\n`;
}

export function buildSurveyProtocolCsvLine(
  protocolAtUri: string,
  surveyAtUri: string,
): string {
  return `${[protocolAtUri, surveyAtUri].map(csvEscape).join(',')}\n`;
}

// surveyTargetID is a synthesized ID unique per (survey × target) pair:
// {survey_at_uri}#target#{survey_target_at_uri}
export const SURVEY_TARGET_COLUMNS = [
  'surveyTargetID',
  'surveyID',
  'surveyTargetType',
  'surveyTargetValue',
  'surveyTargetValueIRI',
  'includeOrExclude',
  'isSurveyTargetFullyReported',
] as const;

export const OCCURRENCE_COLUMNS = [
  'occurrenceID',
  'eventID',
  'surveyTargetID',
  'occurrenceStatus',
  'taxonID',
  'scientificName',
  'taxonRank',
  'organismQuantity',
  'organismQuantityType',
  'recordedByID',
] as const;

export function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Returns person-hours, or null if any required field is missing or the unit
// is not one of the known values ('minutes', 'hours', 'days').
function toPersonHours(
  surveyorCount: number | undefined,
  durationValue: number | undefined,
  durationUnit: string | undefined,
): number | null {
  if (surveyorCount == null || durationValue == null || !durationUnit)
    return null;
  const unitToHours: Record<string, number> = {
    minutes: 1 / 60,
    hours: 1,
    days: 24,
  };
  const factor = unitToHours[durationUnit];
  if (factor == null) return null;
  return surveyorCount * durationValue * factor;
}

function extractGeo(
  location: Protocol['record'] extends { location?: infer L } ? L : never,
): { lat: string; lon: string } | null {
  const loc = location as { locations?: { $type?: string }[] } | undefined;
  if (!loc?.locations) return null;
  for (const entry of loc.locations) {
    if (entry.$type === 'community.lexicon.location.geo') {
      const geo = entry as LocationGeo;
      return { lat: geo.latitude, lon: geo.longitude };
    }
  }
  return null;
}

// Generates one row for event.csv — temporal/spatial context only.
export function surveyRowToEventCsvLine(row: SurveyExportRow): string {
  const r = row.record;
  const geo = extractGeo(r.location as Parameters<typeof extractGeo>[0]);
  const fields = [
    row.at_uri,
    '', // parentEventID — surveys have no parent event
    'survey',
    r.eventDate ?? '',
    geo?.lat ?? '',
    geo?.lon ?? '',
    geo ? 'EPSG:4326' : '',
  ];
  return `${fields.map(csvEscape).join(',')}\n`;
}

// Generates one row for survey.csv — ecology-specific fields that extend the
// corresponding event row (surveyID = eventID, 1:1 relationship).
export function surveyRowToSurveyCsvLine(row: SurveyExportRow): string {
  const r = row.record;
  const personHours = toPersonHours(
    r.surveyorCount,
    r.eventDurationValue,
    r.eventDurationUnit,
  );
  const fields = [
    row.at_uri, // surveyID = eventID (1:1 with event row)
    row.at_uri, // eventID
    r.eventDurationValue != null ? String(r.eventDurationValue) : '',
    r.eventDurationUnit ?? '',
    row.protocol_title,
    row.handle,
    row.did,
    r.surveyorCount != null ? String(r.surveyorCount) : '',
    personHours != null ? 'true' : '', // isSamplingEffortReported
    personHours != null ? +personHours.toFixed(4) : '',
    personHours != null ? 'personHours' : '',
    'true', // isAbsenceReported — we always synthesize absence rows for survey targets
  ];
  return `${fields.map(csvEscape).join(',')}\n`;
}

export function surveyTargetRowToCsvLine(row: SurveyTargetExportRow): string {
  // surveyTargetID must be unique per (survey × target) pair; the target's
  // at_uri alone is not unique because the same target appears in every survey.
  const surveyTargetID = `${row.survey_at_uri}#target#${row.survey_target_at_uri}`;
  const isVerbatim = row.verbatim_scope != null;
  const fields = [
    surveyTargetID,
    row.survey_at_uri, // surveyID
    isVerbatim ? 'verbatim' : 'taxon',
    isVerbatim ? row.verbatim_scope : (row.scientific_name ?? ''),
    isVerbatim ? '' : (row.taxon_id ?? ''), // surveyTargetValueIRI — taxon ID URL as controlled vocab IRI
    'include',
    'true', // isSurveyTargetFullyReported — we report all occurrences for each target
  ];
  return `${fields.map(csvEscape).join(',')}\n`;
}

export function occurrenceRowToCsvLine(row: OccurrenceExportRow): string {
  const r = row.occurrence_record;

  const occurrenceID = row.is_presence
    ? (row.occurrence_at_uri ?? '')
    : `${row.survey_at_uri}#notDetected#${row.survey_target_at_uri}`;

  const surveyTargetID = row.survey_target_at_uri
    ? `${row.survey_at_uri}#target#${row.survey_target_at_uri}`
    : '';

  const fields = [
    occurrenceID,
    row.survey_at_uri,
    surveyTargetID,
    row.is_presence ? 'detected' : 'notDetected',
    row.taxon_id ?? '',
    row.scientific_name ?? '',
    row.taxon_rank ?? '',
    r?.organismQuantity ?? '',
    r?.organismQuantityType ?? '',
    row.occurrence_did ?? row.survey_did,
  ];
  return `${fields.map(csvEscape).join(',')}\n`;
}

// tar-stream's pack.entry() uses a Node.js callback API; this wraps it in a
// Promise so the async archive builder below can await each file in sequence.
// tar requires the byte size in the header, so we buffer each CSV string to
// a Buffer first (to know the exact byte length before writing).
function addEntry(tarPack: Pack, name: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(content, 'utf-8');
    tarPack.entry({ name, size: buf.byteLength }, buf, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Returns a Web ReadableStream that the caller (SvelteKit Response) reads from.
// The stream is produced by three Node.js objects piped together:
//
//   tarPack  →  gzip  →  (Web ReadableStream returned to SvelteKit)
//
// tarPack (tar-stream) accepts file entries written to it and emits tar-format
// bytes. Those bytes flow into gzip (node:zlib), which compresses them and
// emits gzip bytes. Readable.toWeb() converts the Node.js Readable (gzip) into
// the Web Streams API type that SvelteKit's Response constructor accepts.
//
// The archive builder is an immediately-invoked async function that runs
// concurrently with the return statement. The `void` keyword discards the
// returned Promise — errors are handled inside by destroying the tarPack stream,
// which propagates the error downstream through the gzip pipe to the HTTP
// response. We cannot `await` it here because buildDwcDpArchive is synchronous:
// it must return the ReadableStream immediately so SvelteKit can start sending
// HTTP headers before any DB work begins.
export function buildDwcDpArchive(
  protocol: Protocol,
  handle: string,
  rkey: string,
): ReadableStream<Uint8Array> {
  const tarPack = pack();
  const gzip = createGzip();
  tarPack.pipe(gzip);

  // This async IIFE runs in the background while the caller is already reading
  // from the returned stream. Each `await addEntry(...)` writes one tar file
  // and waits for tar-stream to accept it before moving on; this provides
  // natural backpressure — the DB cursors only advance as fast as the HTTP
  // client is consuming bytes.
  void (async () => {
    try {
      const dp = buildDatapackageJson(protocol, handle, rkey);
      await addEntry(tarPack, 'README.md', readme);
      await addEntry(tarPack, 'datapackage.json', JSON.stringify(dp, null, 2));

      // The cursor batches rows from the DB incrementally (50 at a time), but
      // each CSV string is fully accumulated in memory before being handed to
      // tar-stream. This is because the tar format requires the file's byte size
      // in the header, which precedes the content — so we can't write a row and
      // forget it; we need the total before starting the entry.
      //
      // If memory pressure becomes a concern, the alternative is a two-pass
      // approach: run the cursor once to count bytes, then a second time to
      // stream rows directly into an open tar entry (no accumulation). That
      // halves peak memory at the cost of two DB round-trips per CSV file.
      const protocolCsv = `${PROTOCOL_COLUMNS.join(',')}\n${buildProtocolCsvLine(protocol)}`;
      await addEntry(tarPack, 'protocol.csv', protocolCsv);

      let eventCsv = `${EVENT_COLUMNS.join(',')}\n`;
      let surveyCsv = `${SURVEY_COLUMNS.join(',')}\n`;
      let surveyProtocolCsv = `${SURVEY_PROTOCOL_COLUMNS.join(',')}\n`;
      for await (const rows of streamSurveysByProtocolUri(protocol.atUri)) {
        for (const row of rows) {
          eventCsv += surveyRowToEventCsvLine(row);
          surveyCsv += surveyRowToSurveyCsvLine(row);
          surveyProtocolCsv += buildSurveyProtocolCsvLine(
            protocol.atUri,
            row.at_uri,
          );
        }
      }
      await addEntry(tarPack, 'event.csv', eventCsv);
      await addEntry(tarPack, 'survey.csv', surveyCsv);
      await addEntry(tarPack, 'survey-protocol.csv', surveyProtocolCsv);

      let surveyTargetCsv = `${SURVEY_TARGET_COLUMNS.join(',')}\n`;
      for await (const rows of streamSurveyTargetsByProtocolUri(
        protocol.atUri,
      )) {
        for (const row of rows) {
          surveyTargetCsv += surveyTargetRowToCsvLine(row);
        }
      }
      await addEntry(tarPack, 'survey-target.csv', surveyTargetCsv);

      let occurrenceCsv = `${OCCURRENCE_COLUMNS.join(',')}\n`;
      for await (const rows of streamTargetedOccurrencesByProtocolUri(
        protocol.atUri,
      )) {
        for (const row of rows) occurrenceCsv += occurrenceRowToCsvLine(row);
      }
      for await (const rows of streamAbsencesByProtocolUri(protocol.atUri)) {
        for (const row of rows) occurrenceCsv += occurrenceRowToCsvLine(row);
      }
      for await (const rows of streamIncidentalOccurrencesByProtocolUri(
        protocol.atUri,
      )) {
        for (const row of rows) occurrenceCsv += occurrenceRowToCsvLine(row);
      }
      await addEntry(tarPack, 'occurrence.csv', occurrenceCsv);

      // Signals to tar-stream that all entries have been written; it emits the
      // end-of-archive marker and closes, which in turn closes the gzip stream
      // and ends the HTTP response.
      tarPack.finalize();
    } catch (err) {
      // Destroying tarPack with an error propagates it through the pipe to
      // gzip, causing the ReadableStream to error and the HTTP response to abort.
      tarPack.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return Readable.toWeb(gzip) as ReadableStream<Uint8Array>;
}
