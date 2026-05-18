import sanitizeHtmlLib from 'sanitize-html';

const ALLOWED_TAGS = [
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'mark',
  'code',
  'kbd',
  'sup',
  'sub',
  'br',
  'span',
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
];

function textToHtml(text: string): string {
  if (/<(p|div|h[1-6]|ul|ol|li|blockquote|pre)\b/i.test(text)) return text;
  return text
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function sanitizeHtml(html: string): string {
  return sanitizeHtmlLib(textToHtml(html), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
    },
  });
}

export function stripHtml(html: string): string {
  return sanitizeHtmlLib(html, { allowedTags: [], allowedAttributes: {} });
}
