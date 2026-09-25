import { describe, expect, test } from 'vitest';
import { userTextSegments } from './userText';

const plain = (value: string) => ({
  type: 'text',
  value,
  strong: false,
  em: false,
});

describe('userTextSegments', () => {
  test('returns plain text untouched', () => {
    expect(userTextSegments('Heavy fog until 10am.')).toEqual([
      plain('Heavy fog until 10am.'),
    ]);
  });

  test('returns nothing for an empty string', () => {
    expect(userTextSegments('')).toEqual([]);
  });

  test('bolds **double asterisks**', () => {
    expect(userTextSegments('Heavy **fog** today')).toEqual([
      plain('Heavy '),
      { type: 'text', value: 'fog', strong: true, em: false },
      plain(' today'),
    ]);
  });

  test('italicizes *single asterisks* and _underscores_', () => {
    expect(userTextSegments('*Quercus* and _Pinus_')).toEqual([
      { type: 'text', value: 'Quercus', strong: false, em: true },
      plain(' and '),
      { type: 'text', value: 'Pinus', strong: false, em: true },
    ]);
  });

  test('nests italics inside bold', () => {
    expect(userTextSegments('**lots of _Quercus_ here**')).toEqual([
      { type: 'text', value: 'lots of ', strong: true, em: false },
      { type: 'text', value: 'Quercus', strong: true, em: true },
      { type: 'text', value: ' here', strong: true, em: false },
    ]);
  });

  test('leaves an unmatched delimiter as literal text', () => {
    expect(userTextSegments('a **dangling marker')).toEqual([
      plain('a **dangling marker'),
    ]);
  });

  test('leaves arithmetic-style asterisks alone', () => {
    // A delimiter followed by whitespace cannot open, and one preceded by
    // whitespace cannot close.
    expect(userTextSegments('2 * 3 * 4')).toEqual([plain('2 * 3 * 4')]);
  });

  test('leaves intraword underscores alone', () => {
    // snake_case identifiers, file names and the like are common in field
    // remarks and must not turn half a word italic.
    expect(userTextSegments('see plot_a_3 and site_b_7')).toEqual([
      plain('see plot_a_3 and site_b_7'),
    ]);
  });

  test('keeps line breaks, which the renderer preserves', () => {
    expect(userTextSegments('line one\n**line two**')).toEqual([
      plain('line one\n'),
      { type: 'text', value: 'line two', strong: true, em: false },
    ]);
  });

  test('links URLs', () => {
    expect(userTextSegments('photos at https://cuanto.bio')).toEqual([
      plain('photos at '),
      {
        type: 'link',
        url: 'https://cuanto.bio',
        text: 'https://cuanto.bio',
        strong: false,
        em: false,
      },
    ]);
  });

  test('does not treat underscores inside a URL as emphasis', () => {
    expect(userTextSegments('https://example.com/a_b_c and _this_')).toEqual([
      {
        type: 'link',
        url: 'https://example.com/a_b_c',
        text: 'https://example.com/a_b_c',
        strong: false,
        em: false,
      },
      plain(' and '),
      { type: 'text', value: 'this', strong: false, em: true },
    ]);
  });

  test('emphasis can span a link', () => {
    expect(userTextSegments('**see https://cuanto.bio now**')).toEqual([
      { type: 'text', value: 'see ', strong: true, em: false },
      {
        type: 'link',
        url: 'https://cuanto.bio',
        text: 'https://cuanto.bio',
        strong: true,
        em: false,
      },
      { type: 'text', value: ' now', strong: true, em: false },
    ]);
  });

  test('treats runs of three or more markers as literal', () => {
    expect(userTextSegments('***odd***')).toEqual([plain('***odd***')]);
  });
});
