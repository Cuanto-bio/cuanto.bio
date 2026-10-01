import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Tap only delivers events for collections listed in TAP_COLLECTION_FILTERS, so
// any collection the webhook handles but the filter omits silently never lands
// in the index. These tests keep the filter in compose.yml and the Railway
// value documented in README.md in step with the webhook's NSID constants.

const root = resolve(__dirname, '../../../../..');

function read(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

function handledCollections(): string[] {
  const src = read('src/routes/api/tap/webhook/+server.ts');
  return [...src.matchAll(/^const \w+_NSID = '([^']+)';$/gm)].map((m) => m[1]);
}

function filterList(value: string): string[] {
  return value.split(',').map((s) => s.trim());
}

describe('TAP_COLLECTION_FILTERS', () => {
  test('webhook handles bio.cuanto.protocolTarget', () => {
    expect(handledCollections()).toContain('bio.cuanto.protocolTarget');
  });

  test('compose.yml includes every collection the webhook handles', () => {
    const match = read('compose.yml').match(
      /TAP_COLLECTION_FILTERS:\s*"([^"]+)"/,
    );
    expect(match).not.toBeNull();
    const filters = filterList(match?.[1] ?? '');
    for (const nsid of handledCollections()) {
      expect(filters).toContain(nsid);
    }
  });

  test('README Railway table includes every collection the webhook handles', () => {
    const match = read('README.md').match(
      /\|\s*`TAP_COLLECTION_FILTERS`\s*\|\s*`([^`]+)`/,
    );
    expect(match).not.toBeNull();
    const filters = filterList(match?.[1] ?? '');
    for (const nsid of handledCollections()) {
      expect(filters).toContain(nsid);
    }
  });
});
