// The record types and references shown on /lexicons. This is the single source
// of truth for the diagram, the grouped entity cards, and the relationships
// table: add a record here (and its relationships) and all three update. Purpose
// and field lists are pulled from the lexicon definitions in +page.server.ts;
// only the grouping, display names, and edges are curated here.

export type EntityMeta = { name: string; nsid: string; shared?: boolean };

export type Rel = {
  from: string;
  to: string;
  toShared?: boolean;
  field: string;
  card: string;
  note: string;
  // Short verb shown on the diagram edge. Omit to draw a bare arrow.
  label?: string;
  // Terser form for the compact diagram shown on narrow screens, where dagre
  // reserves rank space for each label and a long one widens the whole layout
  // past a phone screen. Falls back to `label` when omitted.
  compactLabel?: string;
};

// Protocol authors design what a survey should capture.
export const authors: EntityMeta[] = [
  { name: 'Protocol', nsid: 'bio.cuanto.surveyProtocol' },
  { name: 'ProtocolTarget', nsid: 'bio.cuanto.protocolTarget' },
];

// Surveyors follow a protocol and record what they find. Occurrence and
// Identification are shared lexicons.bio records, not bio.cuanto ones.
export const surveyors: EntityMeta[] = [
  { name: 'Follow', nsid: 'bio.cuanto.surveyProtocol.follow' },
  { name: 'SurveyTarget', nsid: 'bio.cuanto.surveyTarget' },
  { name: 'Survey', nsid: 'bio.cuanto.survey' },
  {
    name: 'Occurrence',
    nsid: 'bio.lexicons.temp.v0-1.occurrence',
    shared: true,
  },
  {
    name: 'Identification',
    nsid: 'bio.lexicons.temp.v0-1.identification',
    shared: true,
  },
];

export const relationships: Rel[] = [
  // {
  //   from: 'Protocol',
  //   to: 'ProtocolTarget',
  //   label: 'defines',
  //   field: 'protocolTarget.protocol',
  //   card: '1 : N',
  //   note: 'An author defines the targets of a protocol.',
  // },
  {
    from: 'ProtocolTarget',
    to: 'Protocol',
    label: 'defined by',
    field: 'protocolTarget.protocol',
    card: 'N : 1',
    note: 'An author defines the targets of a protocol.',
  },
  // {
  //   from: 'Protocol',
  //   to: 'Survey',
  //   label: 'surveys',
  //   field: 'survey.protocol',
  //   card: '1 : N',
  //   note: 'Surveys are conducted under a protocol (strongRef).',
  // },
  {
    from: 'Survey',
    to: 'Protocol',
    label: 'counts targets from',
    compactLabel: 'targets from',
    field: 'survey.protocol',
    card: 'N : 1',
    note: 'Surveys are conducted under a protocol (strongRef).',
  },
  // {
  //   from: 'Protocol',
  //   to: 'Follow',
  //   label: 'follows',
  //   field: 'follow.subject',
  //   card: '1 : N',
  //   note: 'Surveyors following a protocol.',
  // },
  {
    from: 'Follow',
    to: 'Protocol',
    label: 'user follows',
    compactLabel: 'follows',
    field: 'follow.subject',
    card: 'N : 1',
    note: 'Surveyors following a protocol.',
  },
  // {
  //   from: 'Protocol',
  //   to: 'SurveyTarget',
  //   field: 'surveyTarget.protocol',
  //   card: '1 : N',
  //   note: 'Adopted targets keep a link to the protocol.',
  // },
  {
    from: 'SurveyTarget',
    to: 'Protocol',
    field: 'surveyTarget.protocol',
    label: 'comes from',
    compactLabel: 'from',
    card: 'N : 1',
    note: 'Adopted targets keep a link to the protocol.',
  },
  // {
  //   from: 'ProtocolTarget',
  //   to: 'SurveyTarget',
  //   label: 'copies',
  //   field: 'surveyTarget.protocolTargetID',
  //   card: '1 : N',
  //   note: 'Provenance: which target this was copied from.',
  // },
  {
    from: 'SurveyTarget',
    to: 'ProtocolTarget',
    label: 'copies',
    field: 'surveyTarget.protocolTargetID',
    card: 'N : 1',
    note: 'Provenance: which target this was copied from.',
  },
  // {
  //   from: 'Survey',
  //   to: 'Occurrence',
  //   toShared: true,
  //   label: 'records',
  //   field: 'occurrence.eventID',
  //   card: '1 : N',
  //   note: 'Observations recorded during the survey.',
  // },
  {
    from: 'Occurrence',
    to: 'Survey',
    toShared: true,
    label: 'happens during',
    compactLabel: 'during',
    field: 'occurrence.eventID',
    card: 'N : 1',
    note: 'Observations recorded during the survey.',
  },
  // {
  //   from: 'SurveyTarget',
  //   to: 'Occurrence',
  //   toShared: true,
  //   label: 'targets',
  //   field: 'occurrence.surveyTargetID',
  //   card: '1 : N',
  //   note: 'Which target an observation was meant to satisfy.',
  // },
  {
    from: 'Occurrence',
    to: 'SurveyTarget',
    toShared: true,
    label: 'counts',
    field: 'occurrence.surveyTargetID',
    card: 'N : 1',
    note: 'Which target an observation was meant to satisfy.',
  },
  // {
  //   from: 'Occurrence',
  //   to: 'Identification',
  //   toShared: true,
  //   label: 'identifies',
  //   field: 'identification.occurrence',
  //   card: '1 : N',
  //   note: 'Proposed IDs for an observation (strongRef).',
  // },
  {
    from: 'Identification',
    to: 'Occurrence',
    toShared: true,
    label: 'identifies',
    field: 'identification.occurrence',
    card: 'N : 1',
    note: 'Proposed IDs for an observation (strongRef).',
  },
  // {
  //   from: 'Occurrence',
  //   to: 'Identification',
  //   toShared: true,
  //   field: 'occurrence.acceptedIdentificationID',
  //   card: 'N : 0..1',
  //   note: 'The ID the observer accepted (strongRef).',
  // },
  {
    from: 'Occurrence',
    to: 'Identification',
    toShared: true,
    label: 'accepts',
    field: 'occurrence.acceptedIdentificationID',
    card: 'N : 0..1',
    note: 'The ID the observer accepted (strongRef).',
  },
];
