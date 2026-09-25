import { describe, expect, it } from 'vitest';
import { REMARK_MAX_BYTES, validateEventRemark } from './remarks';

describe('validateEventRemark', () => {
  it('accepts a remark within the limit', () => {
    expect(validateEventRemark({ body: 'Windy.' })).toBeNull();
    expect(
      validateEventRemark({
        body: 'Windy.',
        license: 'https://creativecommons.org/licenses/by/4.0/',
      }),
    ).toBeNull();
  });

  it('measures the limit in UTF-8 bytes, as the lexicon does', () => {
    // 1001 three-byte characters are 1001 UTF-16 code units but 3003 bytes.
    expect(validateEventRemark({ body: 'あ'.repeat(1001) })).toMatch(
      /too long/,
    );
    expect(validateEventRemark({ body: 'あ'.repeat(1000) })).toBeNull();
    expect(
      validateEventRemark({ body: 'x'.repeat(REMARK_MAX_BYTES) }),
    ).toBeNull();
    expect(
      validateEventRemark({ body: 'x'.repeat(REMARK_MAX_BYTES + 1) }),
    ).toMatch(/too long/);
  });

  it('ignores surrounding whitespace, which is trimmed before writing', () => {
    expect(
      validateEventRemark({ body: ` ${'x'.repeat(REMARK_MAX_BYTES)} ` }),
    ).toBeNull();
  });

  it('rejects a body that is not a string', () => {
    expect(validateEventRemark({ body: 3 })).toMatch(/string/);
    expect(validateEventRemark({})).toMatch(/string/);
  });

  it('rejects a license we do not offer', () => {
    expect(validateEventRemark({ body: 'Windy.', license: 'MIT' })).toMatch(
      /license/,
    );
  });
});
