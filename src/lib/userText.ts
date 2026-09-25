import { linkifySegments } from '$lib/linkify';

// Renders free text a user typed (e.g. a survey remark) with a deliberately
// tiny subset of markdown: **bold**, *italic* / _italic_, and bare URLs as
// links. The source text is stored as-is, so it stays readable to any client
// or Darwin Core export that doesn't interpret the markers.
//
// Like linkifySegments, this returns segments for a Svelte template to render
// with ordinary {expr} interpolation, so Svelte escapes everything and there
// is no HTML string, no {@html}, and nothing to sanitize.

export type UserTextSegment =
  | { type: 'text'; value: string; strong: boolean; em: boolean }
  | { type: 'link'; url: string; text: string; strong: boolean; em: boolean };

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'link'; url: string; text: string }
  | {
      kind: 'delim';
      value: string;
      char: '*' | '_';
      count: 1 | 2;
      canOpen: boolean;
      canClose: boolean;
      pair?: 'open' | 'close';
    };

const WHITESPACE = /\s/;
const WORD_CHAR = /[\p{L}\p{N}]/u;
// Stands in for a neighboring link when deciding whether a delimiter touches
// text: a link counts as a word, so `**see https://x.y**` can still close.
const LINK_NEIGHBOR = 'a';

function tokenize(text: string): Token[] {
  const chunks = linkifySegments(text);
  const tokens: Token[] = [];
  chunks.forEach((chunk, i) => {
    if (chunk.type === 'link') {
      tokens.push({ kind: 'link', url: chunk.url, text: chunk.text });
      return;
    }
    const s = chunk.value;
    const prevIsLink = chunks[i - 1]?.type === 'link';
    const nextIsLink = chunks[i + 1]?.type === 'link';
    let last = 0;
    for (const m of s.matchAll(/\*+|_+/g)) {
      const run = m[0];
      const start = m.index;
      const end = start + run.length;
      if (start > last)
        tokens.push({ kind: 'text', value: s.slice(last, start) });
      last = end;

      const before = s[start - 1] ?? (prevIsLink ? LINK_NEIGHBOR : undefined);
      const after = s[end] ?? (nextIsLink ? LINK_NEIGHBOR : undefined);
      // A delimiter opens only when text follows it and closes only when text
      // precedes it, which keeps `2 * 3` literal.
      let canOpen = after !== undefined && !WHITESPACE.test(after);
      let canClose = before !== undefined && !WHITESPACE.test(before);
      const char = run[0] as '*' | '_';
      if (char === '_') {
        // Underscores inside a word (plot_a_3) are not emphasis.
        if (before && WORD_CHAR.test(before)) canOpen = false;
        if (after && WORD_CHAR.test(after)) canClose = false;
      }
      if (run.length > 2 || (!canOpen && !canClose)) {
        tokens.push({ kind: 'text', value: run });
        continue;
      }
      tokens.push({
        kind: 'delim',
        value: run,
        char,
        count: run.length as 1 | 2,
        canOpen,
        canClose,
      });
    }
    if (last < s.length) tokens.push({ kind: 'text', value: s.slice(last) });
  });
  return tokens;
}

// Pairs each closing delimiter with the nearest compatible opener. Openers
// skipped over by a match, and anything never matched, stay literal.
function pairDelimiters(tokens: Token[]) {
  const openers: number[] = [];
  tokens.forEach((token, i) => {
    if (token.kind !== 'delim') return;
    if (token.canClose) {
      for (let k = openers.length - 1; k >= 0; k--) {
        const opener = tokens[openers[k]];
        if (
          opener.kind === 'delim' &&
          opener.char === token.char &&
          opener.count === token.count
        ) {
          opener.pair = 'open';
          token.pair = 'close';
          openers.length = k;
          return;
        }
      }
    }
    if (token.canOpen) openers.push(i);
  });
}

export function userTextSegments(text: string): UserTextSegment[] {
  const tokens = tokenize(text);
  pairDelimiters(tokens);

  const segments: UserTextSegment[] = [];
  let strong = 0;
  let em = 0;
  const pushText = (value: string) => {
    const prev = segments.at(-1);
    const flags = { strong: strong > 0, em: em > 0 };
    if (
      prev?.type === 'text' &&
      prev.strong === flags.strong &&
      prev.em === flags.em
    ) {
      prev.value += value;
    } else {
      segments.push({ type: 'text', value, ...flags });
    }
  };

  for (const token of tokens) {
    if (token.kind === 'text') {
      pushText(token.value);
    } else if (token.kind === 'link') {
      segments.push({
        type: 'link',
        url: token.url,
        text: token.text,
        strong: strong > 0,
        em: em > 0,
      });
    } else if (token.pair) {
      const delta = token.pair === 'open' ? 1 : -1;
      if (token.count === 2) strong += delta;
      else em += delta;
    } else {
      pushText(token.value);
    }
  }
  return segments;
}
