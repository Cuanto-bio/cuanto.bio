import { describe, expect, test } from 'vitest';
import { didFromAtUri, parseAtUri } from './atUri';

describe('parseAtUri', () => {
  test('splits a well-formed AT-URI into did, collection, and rkey', () => {
    expect(
      parseAtUri('at://did:plc:abc123/bio.lexicons.temp.v0-1.survey/rkey99'),
    ).toEqual({
      did: 'did:plc:abc123',
      collection: 'bio.lexicons.temp.v0-1.survey',
      rkey: 'rkey99',
    });
  });

  test('throws on a malformed AT-URI', () => {
    expect(() => parseAtUri('at://did:plc:abc123/onlytwo')).toThrow(
      'Invalid AT-URI',
    );
    expect(() => parseAtUri('not-an-at-uri')).toThrow('Invalid AT-URI');
  });
});

describe('didFromAtUri', () => {
  test('returns the DID from a well-formed AT-URI', () => {
    expect(
      didFromAtUri('at://did:plc:abc123/bio.lexicons.temp.v0-1.survey/rkey99'),
    ).toBe('did:plc:abc123');
  });

  test('returns null when the URI is malformed', () => {
    expect(didFromAtUri('not-an-at-uri')).toBeNull();
  });
});
