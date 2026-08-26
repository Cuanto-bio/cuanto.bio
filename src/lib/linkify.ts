import { LinkifyIt } from 'linkify-it';

// For Bluesky bios, which are free text, not HTML -- unlike protocol/survey
// descriptions (see $lib/sanitize.ts), which already come from a rich-text
// editor. fuzzyLink defaults to false, so a bare domain like "cuanto.bio"
// (no scheme) is left as plain text; only explicit http(s)/ftp/mailto links
// are recognized.
const linkify = new LinkifyIt();

export type LinkSegment =
  | { type: 'text'; value: string }
  | { type: 'link'; url: string; text: string };

// Splits plain text into text/link segments for a Svelte template to render
// with ordinary {expr} interpolation. Svelte escapes that natively, so
// there's no HTML string to build (and no need to hand-roll escaping, or
// find a substitute for it) and no {@html} -- unlike a version of this that
// returned a raw HTML string would need.
export function linkifySegments(text: string): LinkSegment[] {
  const matches = linkify.match(text);
  if (!matches) return text ? [{ type: 'text', value: text }] : [];

  const segments: LinkSegment[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        value: text.slice(lastIndex, match.index),
      });
    }
    segments.push({ type: 'link', url: match.url, text: match.text });
    lastIndex = match.lastIndex;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}
