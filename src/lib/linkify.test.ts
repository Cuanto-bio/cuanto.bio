import { describe, expect, test } from 'vitest';
import { linkifySegments } from './linkify';

describe('linkifySegments', () => {
  test('splits a bare URL into a text segment and a link segment', () => {
    expect(linkifySegments('see https://cuanto.bio')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', url: 'https://cuanto.bio', text: 'https://cuanto.bio' },
    ]);
  });

  test('excludes a trailing sentence period from the link', () => {
    expect(linkifySegments('visit https://observ.ing.')).toEqual([
      { type: 'text', value: 'visit ' },
      { type: 'link', url: 'https://observ.ing', text: 'https://observ.ing' },
      { type: 'text', value: '.' },
    ]);
  });

  test('links multiple URLs in the same text', () => {
    const segments = linkifySegments('https://a.com and https://b.com');
    const links = segments.filter((s) => s.type === 'link');
    expect(links.map((l) => l.url)).toEqual(['https://a.com', 'https://b.com']);
  });

  test('returns a single text segment when there are no URLs', () => {
    expect(linkifySegments('just plain text')).toEqual([
      { type: 'text', value: 'just plain text' },
    ]);
  });

  test('returns an empty array for empty input', () => {
    expect(linkifySegments('')).toEqual([]);
  });

  test('does not treat a bare domain without a scheme as a URL', () => {
    expect(linkifySegments('cuanto.bio')).toEqual([
      { type: 'text', value: 'cuanto.bio' },
    ]);
  });

  test('keeps a balanced parenthetical as part of the URL', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    expect(linkifySegments(`see ${url}`)).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', url, text: url },
    ]);
  });

  test('excludes an unbalanced wrapping paren from the URL', () => {
    expect(linkifySegments('(https://cuanto.bio)')).toEqual([
      { type: 'text', value: '(' },
      { type: 'link', url: 'https://cuanto.bio', text: 'https://cuanto.bio' },
      { type: 'text', value: ')' },
    ]);
  });

  // The gap in the hand-rolled version this replaced: it excluded a leading
  // `<` from a URL match but not a trailing `>`, so "<https://cuanto.bio>"
  // (a common way to disambiguate a URL from surrounding text) swallowed the
  // `>` into the href.
  test('excludes angle brackets wrapping a URL', () => {
    const segments = linkifySegments('see <https://cuanto.bio> nice');
    const link = segments.find((s) => s.type === 'link');
    expect(link).toMatchObject({
      url: 'https://cuanto.bio',
      text: 'https://cuanto.bio',
    });
  });
});
