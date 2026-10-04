import { describe, expect, it } from 'vitest';
import { REMARK_MAX_BYTES, validateRemark } from './remarks';

describe('validateRemark', () => {
  it('accepts a remark within the limit', () => {
    expect(validateRemark({ body: 'Windy.' }, 'eventRemark')).toBeNull();
    expect(
      validateRemark(
        {
          body: 'Windy.',
          license: 'https://creativecommons.org/licenses/by/4.0/',
        },
        'eventRemark',
      ),
    ).toBeNull();
  });

  it('measures the limit in UTF-8 bytes, as the lexicon does', () => {
    // 1001 three-byte characters are 1001 UTF-16 code units but 3003 bytes.
    expect(validateRemark({ body: 'あ'.repeat(1001) }, 'eventRemark')).toMatch(
      /too long/,
    );
    expect(
      validateRemark({ body: 'あ'.repeat(1000) }, 'eventRemark'),
    ).toBeNull();
    expect(
      validateRemark({ body: 'x'.repeat(REMARK_MAX_BYTES) }, 'eventRemark'),
    ).toBeNull();
    expect(
      validateRemark({ body: 'x'.repeat(REMARK_MAX_BYTES + 1) }, 'eventRemark'),
    ).toMatch(/too long/);
  });

  it('ignores surrounding whitespace, which is trimmed before writing', () => {
    expect(
      validateRemark(
        { body: ` ${'x'.repeat(REMARK_MAX_BYTES)} ` },
        'eventRemark',
      ),
    ).toBeNull();
  });

  it('rejects a body that is not a string', () => {
    expect(validateRemark({ body: 3 }, 'eventRemark')).toMatch(/string/);
    expect(validateRemark({}, 'eventRemark')).toMatch(/string/);
  });

  it('names the field it was given in its errors', () => {
    expect(validateRemark({ body: 3 }, 'occurrences[2].remark')).toBe(
      'occurrences[2].remark.body must be a string',
    );
    expect(
      validateRemark(
        { body: 'Windy.', license: 'MIT' },
        'occurrences[2].remark',
      ),
    ).toMatch(/^occurrences\[2\]\.remark\.license /);
  });

  it('accepts a license we do not offer when the remark already has it', () => {
    // Another client may have published the remark under it; editing the
    // text must not force a different license onto the author's words.
    const custom = 'https://example.org/licenses/custom';
    expect(
      validateRemark(
        { body: 'Windy.', license: custom },
        'eventRemark',
        custom,
      ),
    ).toBeNull();
    expect(
      validateRemark(
        { body: 'Windy.', license: 'https://example.org/other' },
        'eventRemark',
        custom,
      ),
    ).toMatch(/license/);
  });

  it('rejects a license we do not offer', () => {
    expect(
      validateRemark({ body: 'Windy.', license: 'MIT' }, 'eventRemark'),
    ).toMatch(/license/);
  });
});
