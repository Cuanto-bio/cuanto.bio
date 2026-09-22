import { describe, expect, test } from 'vitest';
import { isScopeSufficient } from './auth';

describe('isScopeSufficient', () => {
  const required =
    'atproto repo:bio.cuanto.survey repo:bio.cuanto.survey?action=delete';

  test('returns true for an exact match', () => {
    expect(isScopeSufficient(required, required)).toBe(true);
  });

  test('returns true when granted scope is a superset', () => {
    const granted = `${required} repo:bio.cuanto.protocolTarget blob:*/*`;
    expect(isScopeSufficient(granted, required)).toBe(true);
  });

  test('returns false when missing a required repo:<nsid> token', () => {
    const granted = 'atproto repo:bio.cuanto.survey?action=delete';
    expect(isScopeSufficient(granted, required)).toBe(false);
  });

  test('returns false when the granted actions do not cover a required action', () => {
    // `required` needs full create+update+delete on bio.cuanto.survey; a
    // create-only grant is missing update and delete.
    const granted = 'atproto repo:bio.cuanto.survey?action=create';
    expect(isScopeSufficient(granted, required)).toBe(false);
  });

  test('returns false for a pre-#18 transition:generic grant', () => {
    expect(isScopeSufficient('atproto transition:generic', required)).toBe(
      false,
    );
  });

  test('returns false for undefined granted scope', () => {
    expect(isScopeSufficient(undefined, required)).toBe(false);
  });

  test('returns false for empty granted scope', () => {
    expect(isScopeSufficient('', required)).toBe(false);
  });
});

describe('isScopeSufficient with include: permission sets', () => {
  // Captured verbatim from oauth_sessions.value->tokenSet->>scope after a real
  // sign-in against the current SCOPE: the authorization server resolves
  // `include:bio.cuanto.authFull` and returns its expansion as the compact
  // `repo?collection=…` form, and never echoes the `include:` token itself.
  //
  // This predates issue #72 (bio.cuanto.protocolTarget added to authFull), so
  // it's now missing one of the required collections -- exactly the stale
  // grant a session that signed in before that fix is stuck with.
  const REAL_GRANTED_SCOPE =
    'repo?collection=bio.cuanto.survey&collection=bio.cuanto.surveyProtocol' +
    '&collection=bio.cuanto.surveyProtocol.follow&collection=bio.cuanto.surveyTarget' +
    ' atproto repo:bio.lexicons.temp.v0-1.occurrence' +
    ' repo:bio.lexicons.temp.v0-1.identification repo:bio.lexicons.temp.v0-1.media' +
    ' repo:bio.lexicons.temp.v0-1.surveyProtocol?action=delete' +
    ' repo:bio.lexicons.temp.surveyProtocol?action=delete' +
    ' repo:bio.lexicons.temp.v0-1.surveyTarget?action=delete' +
    ' repo:bio.lexicons.temp.surveyTarget?action=delete' +
    ' repo:bio.lexicons.temp.v0-1.survey?action=delete' +
    ' repo:bio.lexicons.temp.survey?action=delete blob:*/*';

  test('rejects a pre-#72 granted scope missing bio.cuanto.protocolTarget', () => {
    // Regression for issue #72: authFull's permission set omitted
    // bio.cuanto.protocolTarget, so the OAuth client never requested write
    // access to it and every ProtocolTarget create/update/delete failed with
    // a PDS ScopeMissingError -- even right after signing in, since the scope
    // requested was wrong, not stale.
    expect(isScopeSufficient(REAL_GRANTED_SCOPE)).toBe(false);
  });

  test('rejects a pre-#73 granted scope missing the remark collection', () => {
    // Adding bio.lexicons.temp.v0-1.remark to REPO_COLLECTIONS (#73) widened
    // SCOPE, so every session that consented before it is stale and has to
    // re-consent. This is the forced re-consent, asserted rather than
    // discovered in production.
    const granted = `${REAL_GRANTED_SCOPE} repo:bio.cuanto.protocolTarget`;
    expect(isScopeSufficient(granted)).toBe(false);
  });

  test('accepts the real granted scope for a session that consented in full', () => {
    const granted =
      `${REAL_GRANTED_SCOPE} repo:bio.cuanto.protocolTarget` +
      ' repo:bio.lexicons.temp.v0-1.remark';
    expect(isScopeSufficient(granted)).toBe(true);
  });

  test('a required include: set is satisfied by the compact repo?collection= grant', () => {
    const granted =
      'atproto repo?collection=bio.cuanto.survey&collection=bio.cuanto.surveyProtocol' +
      '&collection=bio.cuanto.surveyProtocol.follow&collection=bio.cuanto.surveyTarget' +
      '&collection=bio.cuanto.protocolTarget';
    expect(
      isScopeSufficient(granted, 'atproto include:bio.cuanto.authFull'),
    ).toBe(true);
  });

  test('a required include: set is satisfied by individual repo:<nsid> grants', () => {
    // In case the authorization server ever grants the expansion as separate
    // tokens rather than the compact form.
    const granted =
      'atproto repo:bio.cuanto.survey repo:bio.cuanto.surveyProtocol' +
      ' repo:bio.cuanto.surveyProtocol.follow repo:bio.cuanto.surveyTarget' +
      ' repo:bio.cuanto.protocolTarget';
    expect(
      isScopeSufficient(granted, 'atproto include:bio.cuanto.authFull'),
    ).toBe(true);
  });

  test('a required include: set fails when the grant is missing one of its collections', () => {
    const granted =
      'atproto repo?collection=bio.cuanto.survey&collection=bio.cuanto.surveyProtocol' +
      '&collection=bio.cuanto.surveyProtocol.follow&collection=bio.cuanto.surveyTarget';
    expect(
      isScopeSufficient(granted, 'atproto include:bio.cuanto.authFull'),
    ).toBe(false);
  });

  test('an unknown include: set must be granted verbatim', () => {
    expect(
      isScopeSufficient(
        'atproto include:com.example.unknown',
        'atproto include:com.example.unknown',
      ),
    ).toBe(true);
    expect(
      isScopeSufficient('atproto', 'atproto include:com.example.unknown'),
    ).toBe(false);
  });
});

describe('isScopeSufficient repo action and blob semantics', () => {
  test('compact repo?collection=…&action=delete grants delete only', () => {
    const granted = 'atproto repo?collection=bio.cuanto.survey&action=delete';
    expect(
      isScopeSufficient(
        granted,
        'atproto repo:bio.cuanto.survey?action=delete',
      ),
    ).toBe(true);
    expect(isScopeSufficient(granted, 'atproto repo:bio.cuanto.survey')).toBe(
      false,
    );
  });

  test('full repo:<nsid> access covers an action-qualified requirement on it', () => {
    // Full access is create+update+delete, so it subsumes `?action=delete`.
    expect(
      isScopeSufficient(
        'atproto repo:bio.cuanto.survey',
        'atproto repo:bio.cuanto.survey?action=delete',
      ),
    ).toBe(true);
  });

  test('repo:* covers any required collection', () => {
    expect(
      isScopeSufficient(
        'atproto repo:*',
        'atproto repo:bio.cuanto.survey repo:bio.lexicons.temp.survey?action=delete',
      ),
    ).toBe(true);
  });

  test('blob:*/* covers a specific required MIME type', () => {
    expect(
      isScopeSufficient('atproto blob:*/*', 'atproto blob:application/gpx+xml'),
    ).toBe(true);
  });

  test('blob:image/* covers image subtypes but not other types', () => {
    expect(
      isScopeSufficient('atproto blob:image/*', 'atproto blob:image/png'),
    ).toBe(true);
    expect(
      isScopeSufficient('atproto blob:image/*', 'atproto blob:application/pdf'),
    ).toBe(false);
  });
});
