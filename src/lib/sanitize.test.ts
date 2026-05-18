import { describe, expect, it } from 'vitest';
import { sanitizeHtml, stripHtml } from './sanitize';

describe('sanitizeHtml', () => {
  describe('plain text (no HTML tags)', () => {
    it('wraps a single line in a <p>', () => {
      expect(sanitizeHtml('hello world')).toBe('<p>hello world</p>');
    });

    it('splits on \\n\\n into multiple <p> tags', () => {
      expect(sanitizeHtml('para one\n\npara two')).toBe(
        '<p>para one</p><p>para two</p>',
      );
    });

    it('converts single \\n to <br>', () => {
      expect(sanitizeHtml('line one\nline two')).toBe(
        '<p>line one<br />line two</p>',
      );
    });

    it('collapses multiple blank lines into one paragraph break', () => {
      expect(sanitizeHtml('para one\n\n\npara two')).toBe(
        '<p>para one</p><p>para two</p>',
      );
    });
  });

  describe('HTML input', () => {
    it('wraps plain text containing inline HTML tags in a <p>', () => {
      expect(sanitizeHtml('hello <a href="https://example.com">link</a>')).toBe(
        '<p>hello <a href="https://example.com">link</a></p>',
      );
    });

    it('passes HTML through without double-wrapping', () => {
      expect(sanitizeHtml('<p>hello</p>')).toBe('<p>hello</p>');
    });

    it('strips <script> tags', () => {
      expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).toBe(
        '<p>hi</p>',
      );
    });

    it('allows safe tags', () => {
      expect(
        sanitizeHtml('<p>hello <a href="https://example.com">link</a></p>'),
      ).toBe('<p>hello <a href="https://example.com">link</a></p>');
    });
  });
});

describe('stripHtml', () => {
  it('removes all HTML tags', () => {
    expect(stripHtml('<p>hello <b>world</b></p>')).toBe('hello world');
  });

  it('returns plain text unchanged', () => {
    expect(stripHtml('hello world')).toBe('hello world');
  });
});
