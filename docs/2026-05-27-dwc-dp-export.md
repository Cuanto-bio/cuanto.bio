# DarwinCore Data Package Export

**Date:** 2026-05-27

## Context

Add the ability to export all surveys in a protocol as a gzipped DarwinCore Data Package
(dwc-dp), which is a Frictionless Data Package containing `datapackage.json` + CSV files.
A dwc-dp validator already exists as the `dwc-dp-validate` CLI
(`/Users/kueda/projects/dwc-dp-validator`). Our data schema already closely follows
DarwinCore conventions, so field mapping should be largely mechanical.

**Architecture decision:** streaming (not background jobs). The server holds the HTTP
connection open while streaming the gzipped tar directly to the browser using PostgreSQL
cursors. For practical protocol sizes this is fast (seconds to low minutes). Railway's proxy
timeout should be bumped to 5–10 min as a safeguard. Background job infrastructure is not
needed at current scale. See the appendix for a fuller discussion and future recommendations.

**Access:** any authenticated user (not just the owner).

---

## DwC-DP Format

Archive: `.tar.gz` containing:

```
datapackage.json    ← required, references resources
event.csv           ← one row per survey
occurrence.csv      ← one row per occurrence (presence + synthesized absence rows)
```

`datapackage.json` shape (minimal valid):
```json
{
  "profile": "https://raw.githubusercontent.com/gbif/dwc-dp/0.1/dwc-dp/dwc-dp-profile.json",
  "name": "{handle}-{rkey}",
  "id": "{protocol.atUri}",
  "title": "{protocol.record.title}",
  "created": "...",
  "resources": [
    { "name": "event",      "path": "event.csv",      "profile": "tabular-data-resource",
      "format": "csv", "mediatype": "text/csv", "encoding": "utf-8" },
    { "name": "occurrence", "path": "occurrence.csv", "profile": "tabular-data-resource",
      "format": "csv", "mediatype": "text/csv", "encoding": "utf-8" }
  ]
}
```

---

## Field Mapping

**event.csv** (one row per survey):

| CSV field | Source |
|---|---|
| `eventID` | `survey.at_uri` |
| `parentEventID` | _(empty — surveys have no parent event)_ |
| `eventType` | `"survey"` |
| `eventDate` | `survey.record.eventDate` |
| `eventDuration` | `survey.record.eventDurationValue` |
| `eventDurationUnit` | `survey.record.eventDurationUnit` |
| `decimalLatitude` | from `survey.record.location` (find `community.lexicon.location.geo` entry) |
| `decimalLongitude` | same |
| `geodeticDatum` | `"EPSG:4326"` (hardcoded, always WGS84) |
| `samplingProtocol` | `protocol.record.title` |
| `recordedByID` | `survey.did` |
| `sampleSizeValue` | `survey.record.surveyorCount` |
| `sampleSizeUnit` | `"person"` (when surveyorCount present) |

**occurrence.csv** (one row per presence occurrence + one synthesized absence per
survey_target with no occurrence in that survey):

| CSV field | Presence source | Absence source |
|---|---|---|
| `occurrenceID` | `occurrence.at_uri` | `{survey_at_uri}#absent#{target_at_uri}` |
| `eventID` | `occurrence.record.eventID` | `survey.at_uri` |
| `basisOfRecord` | `"HumanObservation"` | `"HumanObservation"` |
| `occurrenceStatus` | `"present"` | `"absent"` |
| `taxonID` | from accepted identification, fallback `occurrence.record.taxonID` | `target.record.scope[0].taxonID` |
| `scientificName` | `identification.record.scientificName` | `target.record.scope[0].scientificName` |
| `taxonRank` | `identification.record.taxonRank` | `target.record.scope[0].taxonRank` |
| `decimalLatitude` | `occurrence.record.decimalLatitude` | _(empty)_ |
| `decimalLongitude` | `occurrence.record.decimalLongitude` | _(empty)_ |
| `geodeticDatum` | `"EPSG:4326"` (when lat/lon present) | _(empty)_ |
| `coordinateUncertaintyInMeters` | `occurrence.record.coordinateUncertaintyInMeters` | _(empty)_ |
| `eventDate` | `occurrence.record.eventDate` | _(empty)_ |
| `organismQuantity` | `occurrence.record.organismQuantity` | _(empty)_ |
| `organismQuantityType` | `occurrence.record.organismQuantityType` | _(empty)_ |
| `recordedByID` | `occurrence.did` | `survey.did` |

_Note: scope entries with `$type` ending in `verbatimScope` produce empty taxon fields.
This is a known v1 limitation._

---

## Implementation Steps

### 1. Add `tar-stream` dependency

```
pnpm add tar-stream
```

`tar-stream` v3+ ships its own TypeScript types. Needed for correct tar header generation —
don't try to hand-craft tar format with Node built-ins.

### 2. New DB query functions in `src/lib/server/db/surveys.ts`

Add two streaming cursor functions (use `postgres` `.cursor(batchSize)` to avoid loading
all rows into memory):

**`streamSurveysByProtocolUri(protocolUri: string)`** — cursor over surveys joined to
protocol (for `protocol_title`), ordered by `event_date ASC`:
```sql
SELECT s.at_uri, s.did, s.record, sp.record->>'title' AS protocol_title
FROM surveys s
JOIN survey_protocols sp ON sp.at_uri = s.protocol_uri
WHERE s.protocol_uri = $protocolUri
ORDER BY s.event_date ASC NULLS LAST, s.indexed_at ASC
```
Cursor batch size: 50.

**`streamOccurrencesByProtocolUri(protocolUri: string)`** — cursor over presence
occurrences UNION ALL synthesized absence rows:
- Presence: `surveys JOIN occurrences LEFT JOIN identifications WHERE s.protocol_uri = $1`
- Absence: `surveys JOIN survey_targets LEFT JOIN occurrences ... WHERE o.at_uri IS NULL`

Include columns: `occurrence_at_uri` (null for absences), `survey_at_uri`,
`survey_target_at_uri`, `occurrence_did`, `survey_did`, `occurrence_record`,
`scientific_name`, `vernacular_name`, `taxon_rank`, `taxon_id`, `is_presence`.

Cursor batch size: 100.

### 3. New `src/lib/server/dwc-dp.ts`

Core module with:

- `buildDatapackageJson(protocol, handle, rkey)` → plain JS object
- `EVENT_COLUMNS` — ordered array of header strings for event.csv
- `OCCURRENCE_COLUMNS` — ordered array of header strings for occurrence.csv
- `surveyRowToCsvLine(row)` → CSV string (one line, LF-terminated)
- `occurrenceRowToCsvLine(row)` → CSV string (one line, LF-terminated)
- `csvEscape(value)` — wraps in quotes and escapes internal quotes per RFC 4180
- `buildDwcDpArchive(protocolUri, handle, rkey, protocolRecord)` → `ReadableStream<Uint8Array>`

**Archive streaming approach:**

```typescript
import pack from 'tar-stream/pack';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';

export function buildDwcDpArchive(...): ReadableStream<Uint8Array> {
  const tarPack = pack();
  const gzip = createGzip();
  tarPack.pipe(gzip);

  void (async () => {
    try {
      // 1. datapackage.json (buffered — tiny)
      await addEntry(tarPack, 'datapackage.json', JSON.stringify(buildDatapackageJson(...), null, 2));

      // 2. event.csv — streaming tar entry (size unknown upfront)
      const eventEntry = tarPack.entry({ name: 'event.csv' });
      eventEntry.write(EVENT_COLUMNS.join(',') + '\n');
      for await (const rows of streamSurveysByProtocolUri(protocolUri)) {
        for (const row of rows) eventEntry.write(surveyRowToCsvLine(row));
      }
      await finishEntry(eventEntry);

      // 3. occurrence.csv — same pattern
      ...

      tarPack.finalize();
    } catch (err) {
      tarPack.destroy(err as Error);
    }
  })();

  return Readable.toWeb(gzip) as ReadableStream<Uint8Array>;
}
```

`addEntry` / `finishEntry` are small promise wrappers around `tarPack.entry()` callback
and `entry.end()`.

### 4. New API route `src/routes/api/protocols/[handle]/[rkey]/export/+server.ts`

```typescript
export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.did) return new Response(null, { status: 401 });

  const protocol = await getProtocolDetailByHandleAndRkey(params.handle, params.rkey);
  if (!protocol) error(404, 'Protocol not found');

  const filename = `${params.handle}-${params.rkey}-dwcdp.tar.gz`;
  const stream = buildDwcDpArchive(protocol.atUri, params.handle, params.rkey, protocol.record);

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
```

### 5. UI: `src/lib/components/ProtocolDetail.svelte`

Add a "Download DwC-DP" button visible to any signed-in user. The `canFollow` prop is set
for signed-in non-owners; `isOwner` covers the owner. Place it in the existing button row
alongside "Add Past Survey" / "Start Survey".

```svelte
{#if canFollow || isOwner}
  <Button
    href="/api/protocols/{protocol.handle}/{protocol.rkey}/export"
    variant="outline"
    title="Download as DarwinCore Data Package"
  >
    <DownloadIcon />
    <span class="sm:hidden">Export</span>
    <span class="hidden sm:inline">Download DwC-DP</span>
  </Button>
{/if}
```

Import `DownloadIcon` from `@lucide/svelte/icons/download`. The `href` prop on `Button`
renders as `<a>` so the browser triggers a native file download.

### 6. Unit tests: `src/lib/server/dwc-dp.test.ts`

- `buildDatapackageJson` produces correct `profile` URL and resource structure
- `surveyRowToCsvLine` extracts lat/lon from a location with a geo entry
- `surveyRowToCsvLine` handles missing location gracefully (empty lat/lon)
- `occurrenceRowToCsvLine` sets `basisOfRecord = "HumanObservation"`, correct `occurrenceStatus`
- `csvEscape` handles commas, quotes, and newlines in values

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/lib/server/dwc-dp.ts` | Create — field mapping, CSV generation, archive streaming |
| `src/lib/server/db/surveys.ts` | Modify — add `streamSurveysByProtocolUri`, `streamOccurrencesByProtocolUri` |
| `src/routes/api/protocols/[handle]/[rkey]/export/+server.ts` | Create — GET handler |
| `src/lib/components/ProtocolDetail.svelte` | Modify — add Download button |
| `src/lib/server/dwc-dp.test.ts` | Create — unit tests |

No database migrations needed (read-only export).

---

## Verification

1. **Unit tests:** `pnpm test:unit` — dwc-dp.test.ts should pass
2. **Run the app locally** and sign in
3. Navigate to a protocol with at least a few surveys
4. Click "Download DwC-DP" — browser should prompt for file save
5. Validate: `dwc-dp-validate path/to/downloaded.tar.gz`
6. Confirm zero errors (warnings about missing optional fields are acceptable)
7. Spot-check event.csv and occurrence.csv row counts match DB counts for the protocol

---

## Appendix: Background Processing Discussion

### Why streaming now

The streaming approach was chosen over a background job queue because:

- No background job infrastructure currently exists in the codebase
- Adding one (job queue + object storage) is significant overhead for a problem we don't yet have
- Streaming with PostgreSQL cursors avoids loading all data into memory at once
- The Node.js event loop is not blocked during streaming — it's async I/O throughout
- For practical protocol sizes, generation takes seconds to low tens of seconds

### Scale estimates

The main timeout risk is the Railway proxy's upstream timeout (default ~60 seconds).
Rough throughput estimate: ~1,000 combined rows/second end-to-end (DB cursor read + CSV
format + gzip + network write). A survey with 5 occurrences produces 6 rows (1 event + 5
occurrences, plus absence rows for unrecorded targets).

| Surveys | Occurrences | Approx. total rows | Estimated time |
|---|---|---|---|
| 1,000 | 5,000 | ~10,000 | ~10 seconds |
| 5,000 | 25,000 | ~50,000 | ~50 seconds |
| 10,000 | 50,000 | ~100,000 | ~100 seconds |
| 30,000 | 150,000 | ~300,000 | ~5 minutes |

**Recommended near-term safeguard:** bump Railway's upstream response timeout to 5–10
minutes. This covers all realistic usage for the foreseeable future.

At 100 surveys/day (very high usage for a single protocol), reaching 30,000 surveys takes
nearly a year. Background jobs are unlikely to be necessary before then.

### When and how to add background processing

If exports start hitting timeouts or user experience suffers (no progress feedback during
long waits), the recommended migration path is:

**1. `pg-boss` as the job queue**

[pg-boss](https://github.com/timgit/pg-boss) stores jobs in a PostgreSQL table — no Redis
or separate broker needed. It can run in-process alongside the SvelteKit app. This means no
new services to deploy or operate.

```
pnpm add pg-boss
```

Migration would look like:
- `POST /api/protocols/[handle]/[rkey]/export` → enqueues a job, returns `{ jobId }`
- A `pg-boss` worker (started alongside the app) picks up the job, generates the file
- `GET /api/export-jobs/[jobId]` → returns status (`pending | running | complete | failed`)
  and a download URL when complete

**2. File storage**

Generated archives need somewhere to live until the user downloads them. Options in order
of operational simplicity:
- **Railway ephemeral disk** (cheapest, files lost on redeploy — acceptable for short TTLs)
- **Railway persistent volumes** (survives redeploys, fixed size)
- **Object storage** (S3-compatible, e.g. Railway's object storage or Backblaze B2) — best
  for production; enables pre-signed download URLs with automatic expiry

**3. UI changes**

The download button would change to trigger the export job, then poll (or use SSE) for
completion before offering the download link. A toast or progress indicator would replace
the native browser download progress.

**4. Cleanup**

Generated archives should be deleted after a TTL (e.g. 24 hours) via a `pg-boss`
scheduled job.

### Summary

Streaming is the right choice now. If/when protocols grow to tens of thousands of surveys,
`pg-boss` + object storage is the natural migration path — it reuses the existing PostgreSQL
infrastructure and requires no new broker services.
