import { describe, expect, test } from 'vitest';
import { nativeHandoffPage } from './native-handoff';

const CODE = 'abc-123_XYZ';

describe('nativeHandoffPage', () => {
  test('is an HTML page, not a redirect', async () => {
    // The whole point. SFSafariViewController ignores redirects to custom
    // schemes when there was no user interaction, so a 302 here silently loses
    // the sign-in. If someone "simplifies" this back to a redirect, sign-in
    // breaks on device and nothing else fails.
    const res = nativeHandoffPage(CODE);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  test('offers the callback as a tappable link', async () => {
    const html = await nativeHandoffPage(CODE).text();
    expect(html).toContain(`href="bio.cuanto.app://auth?code=${CODE}"`);
  });

  test('escapes the code rather than trusting its encoding', async () => {
    const html = await nativeHandoffPage('a&b"c').text();
    expect(html).not.toContain('a&b"c');
    expect(html).toContain('%26');
  });

  test('does not attempt a scripted redirect', async () => {
    // A scripted redirect would be ignored without user interaction anyway, and
    // would make a page that appears broken before the button is noticed.
    const html = await nativeHandoffPage(CODE).text();
    expect(html).not.toContain('location.replace');
    expect(html).not.toContain('http-equiv="refresh"');
  });
});
