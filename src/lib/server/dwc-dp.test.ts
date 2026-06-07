import { describe, expect, it } from 'vitest';
import type { Protocol } from '$lib/offline/db.js';
import type { OccurrenceExportRow, SurveyExportRow } from './db/surveys.js';
import {
  buildDatapackageJson,
  buildProtocolCsvLine,
  buildSurveyProtocolCsvLine,
  csvEscape,
  EVENT_COLUMNS,
  OCCURRENCE_COLUMNS,
  occurrenceRowToCsvLine,
  PROTOCOL_COLUMNS,
  SURVEY_COLUMNS,
  SURVEY_PROTOCOL_COLUMNS,
  SURVEY_TARGET_COLUMNS,
  surveyRowToEventCsvLine,
  surveyRowToSurveyCsvLine,
  surveyTargetRowToCsvLine,
} from './dwc-dp.js';

// Splits a CSV line respecting RFC 4180 quoting rules.
function parseCsvLine(line: string): string[] {
  return line.trimEnd().match(/(?:^|,)(?:"(?:[^"]|"")*"|[^,]*)/g) ?? [];
}

const mockProtocol: Protocol = {
  atUri: 'at://did:plc:abc/bio.cuanto.surveyProtocol/rkey123',
  rkey: 'rkey123',
  handle: 'testuser',
  record: {
    $type: 'bio.cuanto.surveyProtocol',
    title: 'Test Protocol',
    description: 'A test protocol',
    createdAt: '2026-01-01T00:00:00Z',
  },
  targets: [],
};

describe('buildDatapackageJson', () => {
  it('has the correct dwc-dp profile URL', () => {
    const dp = buildDatapackageJson(mockProtocol, 'testuser', 'rkey123');
    expect(dp.profile).toBe(
      'https://raw.githubusercontent.com/gbif/dwc-dp/0.1/dwc-dp/dwc-dp-profile.json',
    );
  });

  it('includes all required resources', () => {
    const dp = buildDatapackageJson(mockProtocol, 'testuser', 'rkey123');
    const names = dp.resources.map((r) => r.name);
    expect(names).toContain('event');
    expect(names).toContain('survey');
    expect(names).toContain('protocol');
    expect(names).toContain('survey-protocol');
    expect(names).toContain('survey-target');
    expect(names).toContain('occurrence');
  });

  it('sets resource profile to tabular-data-resource', () => {
    const dp = buildDatapackageJson(mockProtocol, 'testuser', 'rkey123');
    for (const r of dp.resources) {
      expect(r.profile).toBe('tabular-data-resource');
    }
  });

  it('uses protocol atUri as id', () => {
    const dp = buildDatapackageJson(mockProtocol, 'testuser', 'rkey123');
    expect(dp.id).toBe(mockProtocol.atUri);
  });

  it('includes a version field', () => {
    const dp = buildDatapackageJson(mockProtocol, 'testuser', 'rkey123');
    expect(dp.version).toBeTruthy();
  });

  it('includes a schema with fields for each resource', () => {
    const dp = buildDatapackageJson(mockProtocol, 'testuser', 'rkey123');
    for (const r of dp.resources) {
      expect(r.schema, `${r.name} missing schema`).toBeDefined();
      const fields = (r.schema as { fields?: unknown[] } | undefined)?.fields;
      expect(Array.isArray(fields), `${r.name} schema.fields not array`).toBe(
        true,
      );
      expect(fields?.length, `${r.name} has no fields`).toBeGreaterThan(0);
    }
  });

  it('includes surveyorCount in survey schema with a cuanto.bio IRI', () => {
    const dp = buildDatapackageJson(mockProtocol, 'testuser', 'rkey123');
    const survey = dp.resources.find((r) => r.name === 'survey');
    const schema = survey?.schema as
      | { fields?: { name: string; 'dcterms:isVersionOf'?: string }[] }
      | undefined;
    const field = schema?.fields?.find((f) => f.name === 'surveyorCount');
    expect(field).toBeDefined();
    expect(field?.['dcterms:isVersionOf']).toContain('cuanto.bio');
  });
});

describe('csvEscape', () => {
  it('returns empty string for null/undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('returns the value unchanged if no special chars', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
  });

  it('wraps in quotes if value contains a comma', () => {
    expect(csvEscape('hello, world')).toBe('"hello, world"');
  });

  it('escapes internal double quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps in quotes if value contains a newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('surveyRowToEventCsvLine', () => {
  const baseRow: SurveyExportRow = {
    at_uri: 'at://did:plc:abc/bio.cuanto.survey/survey1',
    did: 'did:plc:abc',
    handle: 'testuser',
    protocol_title: 'Test Protocol',
    record: {
      $type: 'bio.cuanto.survey',
      protocol: {
        uri: 'at://did:plc:abc/bio.cuanto.surveyProtocol/rkey123',
        cid: 'cid123',
      },
      createdAt: '2026-05-01T10:00:00Z',
      eventDate: '2026-05-01',
      eventDurationValue: 60,
      eventDurationUnit: 'minutes',
      location: {
        $type: 'org.atgeo.place',
        name: 'Test Location',
        locations: [
          {
            $type: 'community.lexicon.location.geo',
            latitude: '37.7749',
            longitude: '-122.4194',
          },
        ],
      },
    },
  };

  it('produces a line with the expected number of columns', () => {
    const line = surveyRowToEventCsvLine(baseRow);
    const fields = line.trimEnd().split(',');
    expect(fields).toHaveLength(EVENT_COLUMNS.length);
  });

  it('extracts latitude and longitude from geo location', () => {
    const line = surveyRowToEventCsvLine(baseRow);
    expect(line).toContain('37.7749');
    expect(line).toContain('-122.4194');
    expect(line).toContain('EPSG:4326');
  });

  it('leaves lat/lon empty and omits geodeticDatum when no geo location', () => {
    const row = {
      ...baseRow,
      record: {
        ...baseRow.record,
        location: {
          $type: 'org.atgeo.place' as const,
          name: 'Somewhere',
          locations: [],
        },
      },
    };
    const line = surveyRowToEventCsvLine(row);
    const fields = line.trimEnd().split(',');
    const latIndex = EVENT_COLUMNS.indexOf('decimalLatitude');
    const lonIndex = EVENT_COLUMNS.indexOf('decimalLongitude');
    const datumIndex = EVENT_COLUMNS.indexOf('geodeticDatum');
    expect(fields[latIndex]).toBe('');
    expect(fields[lonIndex]).toBe('');
    expect(fields[datumIndex]).toBe('');
  });

  it('sets eventType to "survey"', () => {
    const line = surveyRowToEventCsvLine(baseRow);
    const fields = line.trimEnd().split(',');
    expect(fields[EVENT_COLUMNS.indexOf('eventType')]).toBe('survey');
  });

  it('does not include sampling effort or protocol fields', () => {
    const line = surveyRowToEventCsvLine(baseRow);
    expect(line).not.toContain('personHours');
    expect(line).not.toContain('Test Protocol');
  });
});

describe('surveyRowToSurveyCsvLine', () => {
  const baseRow: SurveyExportRow = {
    at_uri: 'at://did:plc:abc/bio.cuanto.survey/survey1',
    did: 'did:plc:abc',
    handle: 'testuser',
    protocol_title: 'Test Protocol',
    record: {
      $type: 'bio.cuanto.survey',
      protocol: {
        uri: 'at://did:plc:abc/bio.cuanto.surveyProtocol/rkey123',
        cid: 'cid123',
      },
      createdAt: '2026-05-01T10:00:00Z',
      eventDate: '2026-05-01',
      eventDurationValue: 60,
      eventDurationUnit: 'minutes',
      location: {
        $type: 'org.atgeo.place',
        name: 'Somewhere',
        locations: [],
      },
    },
  };

  it('produces a line with the expected number of columns', () => {
    const line = surveyRowToSurveyCsvLine(baseRow);
    expect(parseCsvLine(line)).toHaveLength(SURVEY_COLUMNS.length);
  });

  it('sets surveyID and eventID to the same at_uri', () => {
    const line = surveyRowToSurveyCsvLine(baseRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_COLUMNS.indexOf('surveyID')]).toBe(baseRow.at_uri);
    expect(fields[SURVEY_COLUMNS.indexOf('eventID')]).toBe(baseRow.at_uri);
  });

  it('calculates samplingEffortValue in personHours from surveyorCount and duration', () => {
    const row = { ...baseRow, record: { ...baseRow.record, surveyorCount: 3 } };
    const line = surveyRowToSurveyCsvLine(row);
    const fields = line.trimEnd().split(',');
    // 3 people × 60 minutes = 3 person-hours
    expect(fields[SURVEY_COLUMNS.indexOf('samplingEffortValue')]).toBe('3');
    expect(fields[SURVEY_COLUMNS.indexOf('samplingEffortUnit')]).toBe(
      'personHours',
    );
    expect(fields[SURVEY_COLUMNS.indexOf('isSamplingEffortReported')]).toBe(
      'true',
    );
  });

  it('rounds samplingEffortValue to 4 decimal places for non-round durations', () => {
    const row = {
      ...baseRow,
      record: { ...baseRow.record, surveyorCount: 1, eventDurationValue: 61 },
    };
    const line = surveyRowToSurveyCsvLine(row);
    const fields = line.trimEnd().split(',');
    // 1 person × 61 minutes = 61/60 ≈ 1.0167 person-hours
    expect(fields[SURVEY_COLUMNS.indexOf('samplingEffortValue')]).toBe(
      '1.0167',
    );
  });

  it('leaves samplingEffort empty when surveyorCount is missing', () => {
    const line = surveyRowToSurveyCsvLine(baseRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_COLUMNS.indexOf('samplingEffortValue')]).toBe('');
    expect(fields[SURVEY_COLUMNS.indexOf('samplingEffortUnit')]).toBe('');
    expect(fields[SURVEY_COLUMNS.indexOf('isSamplingEffortReported')]).toBe('');
  });

  it('leaves samplingEffort empty when duration unit is unknown', () => {
    const row = {
      ...baseRow,
      record: {
        ...baseRow.record,
        surveyorCount: 2,
        eventDurationUnit: 'fortnights',
      },
    };
    const line = surveyRowToSurveyCsvLine(row);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_COLUMNS.indexOf('samplingEffortValue')]).toBe('');
    expect(fields[SURVEY_COLUMNS.indexOf('samplingEffortUnit')]).toBe('');
  });

  it('sets isAbsenceReported to true', () => {
    const line = surveyRowToSurveyCsvLine(baseRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_COLUMNS.indexOf('isAbsenceReported')]).toBe('true');
  });

  it('outputs surveyorCount when present', () => {
    const row = { ...baseRow, record: { ...baseRow.record, surveyorCount: 5 } };
    const line = surveyRowToSurveyCsvLine(row);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_COLUMNS.indexOf('surveyorCount')]).toBe('5');
  });

  it('outputs empty string for surveyorCount when absent', () => {
    const line = surveyRowToSurveyCsvLine(baseRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_COLUMNS.indexOf('surveyorCount')]).toBe('');
  });

  it('includes protocolNames and samplingPerformedBy', () => {
    const line = surveyRowToSurveyCsvLine(baseRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_COLUMNS.indexOf('protocolNames')]).toBe(
      'Test Protocol',
    );
    expect(fields[SURVEY_COLUMNS.indexOf('samplingPerformedBy')]).toBe(
      'testuser',
    );
    expect(fields[SURVEY_COLUMNS.indexOf('samplingPerformedByID')]).toBe(
      'did:plc:abc',
    );
  });
});

describe('buildProtocolCsvLine', () => {
  it('produces a line with the expected number of columns', () => {
    const line = buildProtocolCsvLine(mockProtocol);
    expect(parseCsvLine(line)).toHaveLength(PROTOCOL_COLUMNS.length);
  });

  it('uses atUri as protocolID', () => {
    const line = buildProtocolCsvLine(mockProtocol);
    const fields = line.trimEnd().split(',');
    expect(fields[PROTOCOL_COLUMNS.indexOf('protocolID')]).toBe(
      mockProtocol.atUri,
    );
  });

  it('includes title and description', () => {
    const line = buildProtocolCsvLine(mockProtocol);
    expect(line).toContain('Test Protocol');
    expect(line).toContain('A test protocol');
  });
});

describe('buildSurveyProtocolCsvLine', () => {
  it('produces a line with the expected number of columns', () => {
    const line = buildSurveyProtocolCsvLine(
      mockProtocol.atUri,
      'at://did:plc:abc/bio.cuanto.survey/survey1',
    );
    expect(parseCsvLine(line)).toHaveLength(SURVEY_PROTOCOL_COLUMNS.length);
  });

  it('sets protocolID and surveyID correctly', () => {
    const surveyUri = 'at://did:plc:abc/bio.cuanto.survey/survey1';
    const line = buildSurveyProtocolCsvLine(mockProtocol.atUri, surveyUri);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_PROTOCOL_COLUMNS.indexOf('protocolID')]).toBe(
      mockProtocol.atUri,
    );
    expect(fields[SURVEY_PROTOCOL_COLUMNS.indexOf('surveyID')]).toBe(surveyUri);
  });
});

describe('surveyTargetRowToCsvLine', () => {
  const taxonRow = {
    survey_at_uri: 'at://did:plc:abc/bio.cuanto.survey/survey1',
    survey_target_at_uri: 'at://did:plc:abc/bio.cuanto.protocolTarget/target1',
    scientific_name: 'Quercus agrifolia',
    taxon_id: 'https://www.gbif.org/species/2878688',
    verbatim_scope: null,
  };

  const verbatimRow = {
    survey_at_uri: 'at://did:plc:abc/bio.cuanto.survey/survey1',
    survey_target_at_uri: 'at://did:plc:abc/bio.cuanto.protocolTarget/target2',
    scientific_name: null,
    taxon_id: null,
    verbatim_scope: 'Trees > 10cm DBH',
  };

  it('produces a line with the expected number of columns', () => {
    const line = surveyTargetRowToCsvLine(taxonRow);
    expect(parseCsvLine(line)).toHaveLength(SURVEY_TARGET_COLUMNS.length);
  });

  it('synthesizes surveyTargetID as survey#target#target', () => {
    const line = surveyTargetRowToCsvLine(taxonRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_TARGET_COLUMNS.indexOf('surveyTargetID')]).toContain(
      '#target#',
    );
    expect(fields[SURVEY_TARGET_COLUMNS.indexOf('surveyTargetID')]).toContain(
      taxonRow.survey_at_uri,
    );
  });

  it('sets surveyID to survey_at_uri', () => {
    const line = surveyTargetRowToCsvLine(taxonRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_TARGET_COLUMNS.indexOf('surveyID')]).toBe(
      taxonRow.survey_at_uri,
    );
  });

  it('sets includeOrExclude to include and isSurveyTargetFullyReported to true', () => {
    const line = surveyTargetRowToCsvLine(taxonRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_TARGET_COLUMNS.indexOf('includeOrExclude')]).toBe(
      'include',
    );
    expect(
      fields[SURVEY_TARGET_COLUMNS.indexOf('isSurveyTargetFullyReported')],
    ).toBe('true');
  });

  it('sets surveyTargetType to taxon for taxon targets', () => {
    const line = surveyTargetRowToCsvLine(taxonRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_TARGET_COLUMNS.indexOf('surveyTargetType')]).toBe(
      'taxon',
    );
  });

  it('sets surveyTargetType to verbatim and uses verbatim_scope as surveyTargetValue', () => {
    const line = surveyTargetRowToCsvLine(verbatimRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_TARGET_COLUMNS.indexOf('surveyTargetType')]).toBe(
      'verbatim',
    );
    expect(fields[SURVEY_TARGET_COLUMNS.indexOf('surveyTargetValue')]).toBe(
      'Trees > 10cm DBH',
    );
  });

  it('leaves surveyTargetValueIRI empty for verbatim targets', () => {
    const line = surveyTargetRowToCsvLine(verbatimRow);
    const fields = line.trimEnd().split(',');
    expect(fields[SURVEY_TARGET_COLUMNS.indexOf('surveyTargetValueIRI')]).toBe(
      '',
    );
  });
});

describe('occurrenceRowToCsvLine', () => {
  const presenceRow: OccurrenceExportRow = {
    occurrence_at_uri:
      'at://did:plc:abc/bio.lexicons.temp.v0-1.occurrence/occ1',
    survey_at_uri: 'at://did:plc:abc/bio.cuanto.survey/survey1',
    survey_target_at_uri: 'at://did:plc:abc/bio.cuanto.protocolTarget/target1',
    occurrence_did: 'did:plc:abc',
    survey_did: 'did:plc:abc',
    occurrence_record: {
      $type: 'bio.lexicons.temp.v0-1.occurrence',
      eventID: 'at://did:plc:abc/bio.cuanto.survey/survey1',
      decimalLatitude: '37.7749',
      decimalLongitude: '-122.4194',
      coordinateUncertaintyInMeters: 10,
      eventDate: '2026-05-01T00:00:00Z',
      organismQuantity: '3',
      organismQuantityType: 'individuals',
    },
    scientific_name: 'Quercus agrifolia',
    taxon_rank: 'species',
    taxon_id: 'https://www.gbif.org/species/2878688',
    is_presence: true,
  };

  it('produces a line with the expected number of columns', () => {
    const line = occurrenceRowToCsvLine(presenceRow);
    // split by unquoted commas
    const fields =
      line.trimEnd().match(/(?:^|,)(?:"(?:[^"]|"")*"|[^,]*)/g) ?? [];
    expect(fields).toHaveLength(OCCURRENCE_COLUMNS.length);
  });

  it('sets occurrenceStatus to "detected" for presence rows', () => {
    const line = occurrenceRowToCsvLine(presenceRow);
    const fields = line.trimEnd().split(',');
    expect(fields[OCCURRENCE_COLUMNS.indexOf('occurrenceStatus')]).toBe(
      'detected',
    );
  });

  it('sets occurrenceStatus to "notDetected" and synthesizes occurrenceID for absence rows', () => {
    const absenceRow: OccurrenceExportRow = {
      ...presenceRow,
      occurrence_at_uri: null,
      occurrence_did: null,
      occurrence_record: null,
      is_presence: false,
    };
    const line = occurrenceRowToCsvLine(absenceRow);
    const fields = line.trimEnd().split(',');
    expect(fields[OCCURRENCE_COLUMNS.indexOf('occurrenceStatus')]).toBe(
      'notDetected',
    );
    expect(fields[OCCURRENCE_COLUMNS.indexOf('occurrenceID')]).toContain(
      '#notDetected#',
    );
  });

  it('outputs empty surveyTargetID for incidental occurrences (null survey_target_at_uri)', () => {
    const incidentalRow: OccurrenceExportRow = {
      ...presenceRow,
      survey_target_at_uri: null,
    };
    const line = occurrenceRowToCsvLine(incidentalRow);
    const fields = line.trimEnd().split(',');
    expect(fields[OCCURRENCE_COLUMNS.indexOf('surveyTargetID')]).toBe('');
  });
});
