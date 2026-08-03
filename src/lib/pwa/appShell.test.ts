import { describe, expect, test } from 'vitest';
import { rewriteAppShell } from './appShell';

describe('rewriteAppShell', () => {
  test("rebases SvelteKit's base URL to the origin root", () => {
    const html =
      '<script>base: new URL(".", location).pathname.slice(0,-1)</script>';
    expect(rewriteAppShell(html)).toContain('new URL("/", location)');
    expect(rewriteAppShell(html)).not.toContain('new URL(".", location)');
  });

  test('makes every ./_app/ asset reference root-relative', () => {
    const html = [
      '<link href="./_app/immutable/assets/app.css">',
      '<script src="./_app/immutable/entry/start.js"></script>',
      '<link href="./_app/immutable/chunks/x.js">',
    ].join('\n');
    const out = rewriteAppShell(html);
    expect(out).not.toContain('"./_app/');
    expect(out.match(/"\/_app\//g)?.length).toBe(3);
  });

  // The base rewrite is a single `.replace`, which is correct only because
  // SvelteKit emits that expression exactly once. If a future SvelteKit emits
  // it more than once this test still passes but the shell would break at
  // depth, so the asset rewrite deliberately uses replaceAll instead.
  test('leaves unrelated relative URLs alone', () => {
    const html = '<img src="./logo.png"><a href="./about">About</a>';
    expect(rewriteAppShell(html)).toBe(html);
  });

  test('is a no-op on already-rewritten markup', () => {
    const html =
      '<script>new URL("/", location)</script><link href="/_app/x.css">';
    expect(rewriteAppShell(html)).toBe(html);
  });
});
