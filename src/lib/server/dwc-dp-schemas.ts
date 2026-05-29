// Field-level schema definitions for each DwC-DP table we export.
// Standard fields mirror the upstream GBIF table schemas at
// https://rs.gbif.org/sandbox/experimental/data-packages/dwc-dp/0.1/table-schemas/
// to make the datapackage.json self-describing. Custom Cuanto fields use the
// https://cuanto.bio/terms/ namespace.

type Field = {
  name: string;
  title: string;
  description: string;
  type: string;
  format: string;
  namespace: string;
  'dcterms:isVersionOf': string;
  constraints?: Record<string, unknown>;
};

const DWC = 'http://rs.tdwg.org/dwc/terms/';
const ECO = 'http://rs.tdwg.org/eco/terms/';

function dwc(
  name: string,
  title: string,
  description: string,
  type: string,
  constraints?: Record<string, unknown>,
): Field {
  return {
    name,
    title,
    description,
    type,
    format: 'default',
    namespace: 'dwc',
    'dcterms:isVersionOf': `${DWC}${name}`,
    ...(constraints ? { constraints } : {}),
  };
}

function eco(
  name: string,
  title: string,
  description: string,
  type: string,
  iri: string,
  constraints?: Record<string, unknown>,
): Field {
  return {
    name,
    title,
    description,
    type,
    format: 'default',
    namespace: 'eco',
    'dcterms:isVersionOf': iri,
    ...(constraints ? { constraints } : {}),
  };
}

function cuanto(
  name: string,
  title: string,
  description: string,
  type: string,
  constraints?: Record<string, unknown>,
): Field {
  return {
    name,
    title,
    description,
    type,
    format: 'default',
    namespace: 'cuanto',
    'dcterms:isVersionOf': `https://cuanto.bio/terms/${name}`,
    ...(constraints ? { constraints } : {}),
  };
}

// Shared location fields reused in both event and occurrence schemas.
const locationFields: Field[] = [
  dwc(
    'decimalLatitude',
    'Decimal Latitude',
    'A geographic latitude (in decimal degrees, using the spatial reference system given in dwc:geodeticDatum) of a dcterms:Location.',
    'number',
    { minimum: -90, maximum: 90 },
  ),
  dwc(
    'decimalLongitude',
    'Decimal Longitude',
    'A geographic longitude (in decimal degrees, using the spatial reference system given in dwc:geodeticDatum) of a dcterms:Location.',
    'number',
    { minimum: -180, maximum: 180 },
  ),
  dwc(
    'geodeticDatum',
    'Geodetic Datum',
    'The ellipsoid, geodetic datum, or spatial reference system (SRS) upon which the geographic coordinates given in dwc:decimalLatitude and dwc:decimalLongitude are based.',
    'string',
  ),
];

export const EVENT_SCHEMA = {
  name: 'event',
  identifier: 'http://rs.tdwg.org/dwc/dwc-dp/event',
  url: 'https://rs.gbif.org/sandbox/experimental/data-packages/dwc-dp/0.1/table-schemas/event.json',
  title: 'Event',
  description:
    'An action, process, or set of circumstances occurring at a dcterms:Location during a period of time.',
  fields: [
    dwc('eventID', 'Event ID', 'An identifier for a dwc:Event.', 'string', {
      required: true,
      unique: true,
    }),
    dwc(
      'parentEventID',
      'Parent Event ID',
      'An identifier for a broader dwc:Event that contains this and potentially other dwc:Events.',
      'string',
      { required: false, unique: false },
    ),
    dwc(
      'eventType',
      'Event Type',
      'A narrow category that best matches the nature of a dwc:Event.',
      'string',
    ),
    dwc(
      'eventDate',
      'Event Date',
      'A date-time or time interval during which a dwc:Event occurred.',
      'string',
    ),
    ...locationFields,
  ],
  primaryKey: 'eventID',
};

export const SURVEY_SCHEMA = {
  name: 'survey',
  identifier: 'http://rs.tdwg.org/dwc/dwc-dp/survey',
  url: 'https://rs.gbif.org/sandbox/experimental/data-packages/dwc-dp/0.1/table-schemas/survey.json',
  title: 'Survey',
  description: 'A biotic survey or inventory.',
  fields: [
    {
      ...dwc(
        'surveyID',
        'Survey ID',
        'An identifier for a dwc:Survey.',
        'string',
        { required: true, unique: true },
      ),
      'dcterms:isVersionOf': 'http://example.com/term-pending/dwc/surveyID',
    },
    dwc('eventID', 'Event ID', 'An identifier for a dwc:Event.', 'string', {
      required: true,
      unique: false,
    }),
    eco(
      'eventDurationValue',
      'Event Duration Value',
      'The numeric value for the duration of a dwc:Event.',
      'number',
      `${ECO}eventDurationValue`,
      { minimum: 0 },
    ),
    eco(
      'eventDurationUnit',
      'Event Duration Unit',
      'Units associated with a value in eco:eventDurationValue.',
      'string',
      `${ECO}eventDurationUnit`,
    ),
    eco(
      'protocolNames',
      'Protocol Names',
      'Categorical descriptive names for the dwc:Protocols used during a dwc:Event.',
      'string',
      `${ECO}protocolNames`,
    ),
    eco(
      'samplingPerformedBy',
      'Sampling Performed By',
      'A dcterms:Agent responsible for sampling.',
      'string',
      `${ECO}samplingPerformedBy`,
    ),
    {
      ...dwc(
        'samplingPerformedByID',
        'Sampling Performed By ID',
        'An identifier for a dcterms:Agent responsible for sampling.',
        'string',
        { required: false, unique: false },
      ),
      'dcterms:isVersionOf':
        'http://example.com/term-pending/dwc/samplingPerformedByID',
    },
    cuanto(
      'surveyorCount',
      'Surveyor Count',
      'The number of people who conducted the survey, including the observer who created the record. Used together with eventDurationValue and eventDurationUnit to compute samplingEffortValue in personHours.',
      'integer',
      { required: false, minimum: 1 },
    ),
    eco(
      'isSamplingEffortReported',
      'Is Sampling Effort Reported',
      'The sampling effort associated with a dwc:Event was reported.',
      'boolean',
      `${ECO}isSamplingEffortReported`,
    ),
    eco(
      'samplingEffortValue',
      'Sampling Effort Value',
      'The numeric value for the sampling effort expended during a dwc:Event.',
      'number',
      `${ECO}samplingEffortValue`,
      { minimum: 0 },
    ),
    eco(
      'samplingEffortUnit',
      'Sampling Effort Unit',
      'Units associated with a value in eco:samplingEffortValue.',
      'string',
      `${ECO}samplingEffortUnit`,
    ),
    eco(
      'isAbsenceReported',
      'Is Absence Reported',
      'Taxonomic absences were reported.',
      'boolean',
      `${ECO}isAbsenceReported`,
    ),
  ],
  primaryKey: 'surveyID',
  foreignKeys: [
    {
      fields: 'eventID',
      predicate: 'extends',
      reference: { resource: 'event', fields: 'eventID' },
    },
  ],
};

export const OCCURRENCE_SCHEMA = {
  name: 'occurrence',
  identifier: 'http://rs.tdwg.org/dwc/dwc-dp/occurrence',
  url: 'https://rs.gbif.org/sandbox/experimental/data-packages/dwc-dp/0.1/table-schemas/occurrence.json',
  title: 'Occurrence',
  description: 'A state of a dwc:Organism in a dwc:Event.',
  fields: [
    dwc(
      'occurrenceID',
      'Occurrence ID',
      'An identifier for a dwc:Occurrence.',
      'string',
      { required: true, unique: true },
    ),
    dwc('eventID', 'Event ID', 'An identifier for a dwc:Event.', 'string', {
      required: true,
      unique: false,
    }),
    {
      ...dwc(
        'surveyTargetID',
        'Survey Target ID',
        'An identifier for a dwc:SurveyTarget.',
        'string',
        { required: false, unique: false },
      ),
      'dcterms:isVersionOf':
        'http://example.com/term-pending/dwc/surveyTargetID',
    },
    dwc(
      'occurrenceStatus',
      'Occurrence Status',
      'A statement about the detection or non-detection of a dwc:Organism.',
      'string',
    ),
    dwc('taxonID', 'Taxon ID', 'An identifier for a dwc:Taxon.', 'string'),
    dwc(
      'scientificName',
      'Scientific Name',
      'A scientific name string, not including authorship, date or identification qualifiers.',
      'string',
    ),
    dwc(
      'taxonRank',
      'Taxon Rank',
      'A taxonomic rank of the most specific name in a dwc:scientificName.',
      'string',
    ),
    dwc(
      'organismQuantity',
      'Organism Quantity',
      'A number or enumeration value for the quantity of dwc:Organisms.',
      'string',
    ),
    dwc(
      'organismQuantityType',
      'Organism Quantity Type',
      'The type of quantification system used for the quantity of dwc:Organisms.',
      'string',
    ),
    dwc(
      'recordedByID',
      'Recorded By ID',
      'An identifier for a dcterms:Agent responsible for recording a dwc:Occurrence.',
      'string',
      { required: false, unique: false },
    ),
  ],
  primaryKey: 'occurrenceID',
  foreignKeys: [
    {
      fields: 'eventID',
      predicate: 'happened during',
      reference: { resource: 'event', fields: 'eventID' },
    },
    {
      fields: 'surveyTargetID',
      predicate: 'satisfied',
      reference: { resource: 'survey-target', fields: 'surveyTargetID' },
    },
  ],
};

export const SURVEY_TARGET_SCHEMA = {
  name: 'survey-target',
  identifier: 'http://rs.tdwg.org/dwc/dwc-dp/survey-target',
  url: 'https://rs.gbif.org/sandbox/experimental/data-packages/dwc-dp/0.1/table-schemas/survey-target.json',
  title: 'Survey Target',
  description: 'An intended scope for dwc:Occurrences in an eco:Survey.',
  fields: [
    {
      ...dwc(
        'surveyTargetID',
        'Survey Target ID',
        'An identifier for a dwc:SurveyTarget.',
        'string',
        { required: true, unique: false },
      ),
      'dcterms:isVersionOf':
        'http://example.com/term-pending/dwc/surveyTargetID',
    },
    {
      ...dwc(
        'surveyID',
        'Survey ID',
        'An identifier for a dwc:Survey.',
        'string',
        { required: true, unique: false },
      ),
      'dcterms:isVersionOf': 'http://example.com/term-pending/dwc/surveyID',
    },
    {
      ...dwc(
        'surveyTargetType',
        'Survey Target Type',
        'A scope a dwc:SurveyTarget describes.',
        'string',
      ),
      'dcterms:isVersionOf':
        'http://example.com/term-pending/dwc/surveyTargetType',
    },
    {
      ...dwc(
        'surveyTargetValue',
        'Survey Target Value',
        'A value of a characteristic to include or exclude in a dwc:SurveyTarget for a given dwc:surveyTargetType.',
        'string',
      ),
      'dcterms:isVersionOf':
        'http://example.com/term-pending/dwc/surveyTargetValue',
    },
    {
      name: 'surveyTargetValueIRI',
      title: 'Survey Target Value IRI',
      description:
        'An IRI of a controlled vocabulary value for a target value.',
      type: 'string',
      format: 'default',
      namespace: 'dwciri',
      'dcterms:isVersionOf':
        'http://example.com/term-pending/dwciri/surveyTargetValueIRI',
    },
    {
      ...dwc(
        'includeOrExclude',
        'Include Or Exclude',
        'Whether the combination of dwc:surveyTargetType and dwc:surveyTargetValue is included or excluded in a dwc:SurveyTarget.',
        'string',
        { required: true, unique: false },
      ),
      'dcterms:isVersionOf':
        'http://example.com/term-pending/dwc/includeOrExclude',
    },
    {
      ...dwc(
        'isSurveyTargetFullyReported',
        'Is Survey Target Fully Reported',
        'A declaration of whether the counts for an instance of the dwc:SurveyTarget report everything that matches the declared dwc:SurveyTarget.',
        'boolean',
        { required: true, unique: false },
      ),
      'dcterms:isVersionOf':
        'http://example.com/term-pending/dwc/isSurveyTargetFullyReported',
    },
  ],
  foreignKeys: [
    {
      fields: 'surveyID',
      predicate: 'for',
      reference: { resource: 'survey', fields: 'surveyID' },
    },
  ],
};

export const PROTOCOL_SCHEMA = {
  name: 'protocol',
  identifier: 'https://cuanto.bio/terms/Protocol',
  title: 'Protocol',
  description: 'A survey protocol defined in Cuanto.',
  fields: [
    cuanto(
      'protocolID',
      'Protocol ID',
      'An identifier for a Cuanto survey protocol. Value is an AT Protocol URI (at://).',
      'string',
      { required: true, unique: true },
    ),
    cuanto(
      'protocolName',
      'Protocol Name',
      'The name of the survey protocol.',
      'string',
    ),
    cuanto(
      'protocolDescription',
      'Protocol Description',
      'A description of the survey protocol.',
      'string',
    ),
  ],
  primaryKey: 'protocolID',
};

export const SURVEY_PROTOCOL_SCHEMA = {
  name: 'survey-protocol',
  identifier: 'https://cuanto.bio/terms/SurveyProtocol',
  title: 'Survey Protocol',
  description:
    'A join table linking surveys to the protocols under which they were conducted.',
  fields: [
    cuanto(
      'protocolID',
      'Protocol ID',
      'An identifier for a Cuanto survey protocol.',
      'string',
      { required: true },
    ),
    cuanto(
      'surveyID',
      'Survey ID',
      'An identifier for a Cuanto survey.',
      'string',
      { required: true },
    ),
  ],
  foreignKeys: [
    {
      fields: 'protocolID',
      predicate: 'described by',
      reference: { resource: 'protocol', fields: 'protocolID' },
    },
    {
      fields: 'surveyID',
      predicate: 'for',
      reference: { resource: 'survey', fields: 'surveyID' },
    },
  ],
};
